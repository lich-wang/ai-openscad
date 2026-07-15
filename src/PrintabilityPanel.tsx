import { useEffect, useMemo, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GcodeSlicePreview } from "./GcodeSlicePreview";
import { InteractiveStlPreview } from "./InteractiveStlPreview";
import { downloadText, type SliceStage } from "./lib/capture";
import { type GcodeToolpath } from "./lib/gcodeParse";
import { type Locale, t, type MessageKey } from "./lib/i18n";
import { checkPrintability, type PrintabilityResult } from "./lib/printability";
import type { SliceMetadata, SliceStageViews } from "./lib/project";
import { VIEW_KEYS, type ViewKey, type ViewSet } from "./lib/viewSpecs";

interface PrintabilityPanelProps {
  locale: Locale;
  stl: string;
  toolpath: GcodeToolpath | null;
  gcodeText: string | null;
  sliceMetadata: SliceMetadata | null;
  sliceStageViews: SliceStageViews | null;
  views: ViewSet;
}

type ViewerTab = "model" | "slice";

const VIEW_LABEL_KEYS: Record<ViewKey, MessageKey> = {
  front: "front",
  back: "back",
  left: "left",
  right: "right",
  top: "top",
  bottom: "bottom",
  isoFrontRightTop: "isoFrontRightTop",
  isoFrontLeftTop: "isoFrontLeftTop",
  isoBackRightTop: "isoBackRightTop",
  isoBackLeftTop: "isoBackLeftTop",
  isoFrontRightBottom: "isoFrontRightBottom",
  isoFrontLeftBottom: "isoFrontLeftBottom",
  isoBackRightBottom: "isoBackRightBottom",
  isoBackLeftBottom: "isoBackLeftBottom"
};

const SLICE_STAGE_LABEL_KEYS: Record<"support" | "print", Record<SliceStage, MessageKey>> = {
  support: {
    start: "sliceStageSupportStart",
    middle: "sliceStageSupportMiddle",
    end: "sliceStageSupportEnd"
  },
  print: {
    start: "sliceStagePrintStart",
    middle: "sliceStagePrintMiddle",
    end: "sliceStagePrintEnd"
  }
};

// A pure viewer: slicing is now automatic (App.tsx runs it as part of every
// draft render and its findings ride along in the same vision review — see
// compileDraftCode/reviewRenderedDraft), so this component only displays
// what's already been computed, with no buttons of its own.
export function PrintabilityPanel({
  locale,
  stl,
  toolpath,
  gcodeText,
  sliceMetadata,
  sliceStageViews,
  views
}: PrintabilityPanelProps) {
  const tr = (key: Parameters<typeof t>[1]) => t(locale, key);

  const geometryResult = useMemo<PrintabilityResult | null>(() => {
    if (!stl.trim()) {
      return null;
    }
    try {
      const loader = new STLLoader();
      const bytes = new TextEncoder().encode(stl);
      const geometry = loader.parse(bytes.buffer);
      const positions = geometry.getAttribute("position")?.array ?? new Float32Array();
      const result = checkPrintability(positions);
      geometry.dispose();
      return result;
    } catch {
      return null;
    }
  }, [stl]);

  const [activeTab, setActiveTab] = useState<ViewerTab>("model");

  useEffect(() => {
    setActiveTab("model");
  }, [stl]);

  useEffect(() => {
    if (toolpath) {
      // Auto-switch to slice tab when slicing completes so the user
      // immediately sees the toolpath preview and support analysis.
      setActiveTab("slice");
    } else {
      setActiveTab("model");
    }
  }, [toolpath]);

  const supportRatio = sliceMetadata?.supportSegmentRatio ?? toolpath?.supportSegmentRatio ?? null;
  const supportPercentLabel = supportRatio != null ? Math.round(supportRatio * 100) : null;
  const stageNoun = sliceStageViews?.usedSupportRange ? "support" : "print";

  return (
    <section className="printabilityPanel" aria-label={tr("printability")}>
      <span>{tr("printability")}</span>

      {stl.trim() ? (
        <div className="printabilityGeometryCheck">
          <strong>{tr("printabilityGeometrySectionTitle")}</strong>
          {geometryResult ? (
            <>
              <PrintabilityBadge ok={geometryResult.watertight} label={tr("printabilityWatertight")} />
              <PrintabilityBadge ok={geometryResult.manifold} label={tr("printabilityManifold")} />
              <ul className="printabilityStats">
                <li>
                  {tr("printabilityTriangleCount")}: {geometryResult.triangleCount}
                </li>
                <li>
                  {tr("printabilityOpenEdges")}: {geometryResult.openEdgeCount}
                </li>
                <li>
                  {tr("printabilityNonManifoldEdges")}: {geometryResult.nonManifoldEdgeCount}
                </li>
                <li>
                  {tr("printabilityDegenerateTriangles")}: {geometryResult.degenerateTriangleCount}
                </li>
              </ul>
            </>
          ) : null}
        </div>
      ) : (
        <p className="printabilityEmpty">{tr("printabilityNoStl")}</p>
      )}

      <div className="viewerTabs" role="tablist">
        <button
          aria-selected={activeTab === "model"}
          onClick={() => setActiveTab("model")}
          role="tab"
          type="button"
        >
          {tr("modelTab")}
        </button>
        <button
          aria-selected={activeTab === "slice"}
          disabled={!toolpath}
          onClick={() => setActiveTab("slice")}
          role="tab"
          type="button"
        >
          {tr("sliceTab")}
        </button>
      </div>

      {activeTab === "model" ? (
        <>
          <InteractiveStlPreview label={tr("interactiveStlPreview")} stl={stl} />
          <div className="viewGrid">
            {VIEW_KEYS.map((key) => (
              <ViewImage key={key} label={tr(VIEW_LABEL_KEYS[key])} src={views[key]} />
            ))}
          </div>
        </>
      ) : (
        <>
          <GcodeSlicePreview label={tr("sliceTab")} locale={locale} toolpath={toolpath} />
          {sliceStageViews && sliceStageViews.images.length > 0 ? (
            <div className="sliceViewGrid">
              {sliceStageViews.images.map((image, index) => (
                <ViewImage
                  className="sliceViewTile"
                  key={index}
                  label={`${tr(SLICE_STAGE_LABEL_KEYS[stageNoun][image.stage])} · ${tr(VIEW_LABEL_KEYS[image.viewKey])}`}
                  src={image.dataUrl}
                />
              ))}
            </div>
          ) : (
            <p className="printabilityEmpty">{tr("sliceNoGcode")}</p>
          )}
        </>
      )}

      {sliceMetadata ? (
        <div className="printabilitySliceCheck">
          <strong>{tr("sliceSectionTitle")}</strong>
          <div className="printabilitySliceResult" data-outcome="success">
            <PrintabilityBadge ok label={tr("sliceSuccess")} />
            {supportPercentLabel != null ? (
              <PrintabilityBadge
                ok={supportPercentLabel === 0}
                label={
                  supportPercentLabel === 0
                    ? tr("sliceNoSupportNeeded")
                    : `${tr("sliceSupportNeeded")} (~${supportPercentLabel}%)`
                }
              />
            ) : null}
            <ul className="printabilityStats">
              <li>
                {tr("sliceLayerCount")}: {sliceMetadata.layerCount ?? tr("sliceUnknown")}
              </li>
              <li>
                {tr("slicePrintTime")}: {formatSeconds(sliceMetadata.printTimeSeconds)}
              </li>
              <li>
                {tr("sliceFilamentVolume")}: {formatVolume(sliceMetadata.filamentVolumeMm3)}
              </li>
            </ul>
            {gcodeText ? (
              <div className="printabilitySliceActions">
                <button
                  onClick={() =>
                    downloadText("ai-openscad-model.gcode", gcodeText, "text/x-gcode;charset=utf-8")
                  }
                  type="button"
                >
                  {tr("downloadGcode")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PrintabilityBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="printabilityBadge" data-ok={ok}>
      {label}
    </span>
  );
}

function ViewImage(props: { label: string; src: string; className?: string }) {
  return (
    <figure className={props.className ?? "viewTile"}>
      {props.src ? <img alt={props.label} src={props.src} /> : <div />}
      <figcaption>{props.label}</figcaption>
    </figure>
  );
}

function formatSeconds(seconds: number | null): string {
  if (seconds == null) {
    return "—";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatVolume(cubicMillimeters: number | null): string {
  if (cubicMillimeters == null) {
    return "—";
  }
  return `${cubicMillimeters.toFixed(0)} mm³`;
}
