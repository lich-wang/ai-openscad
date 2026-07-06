import { useEffect, useMemo, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GcodeSlicePreview } from "./GcodeSlicePreview";
import { InteractiveStlPreview } from "./InteractiveStlPreview";
import { downloadText } from "./lib/capture";
import { type GcodeToolpath } from "./lib/gcodeParse";
import { type Locale, t } from "./lib/i18n";
import { checkPrintability, type PrintabilityResult } from "./lib/printability";
import type { SliceMetadata, VisionReview } from "./lib/project";

interface PrintabilityPanelProps {
  locale: Locale;
  stl: string;
  toolpath: GcodeToolpath | null;
  gcodeText: string | null;
  sliceMetadata: SliceMetadata | null;
  sliceReview: VisionReview | null;
}

type ViewerTab = "model" | "slice";

// A pure viewer: all slicing/review business logic (running the slice test,
// running the vision-driven slice review) lives in App.tsx, which owns the
// busy-state machine, the persisted project.sliceMetadata/sliceReview, and
// the buttons that trigger them (next to Rerender/Review/Iterate). This
// component only displays what's already been computed.
export function PrintabilityPanel({
  locale,
  stl,
  toolpath,
  gcodeText,
  sliceMetadata,
  sliceReview
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
    if (!toolpath) {
      setActiveTab("model");
    }
  }, [toolpath]);

  const supportRatio = sliceMetadata?.supportSegmentRatio ?? toolpath?.supportSegmentRatio ?? null;
  const supportPercentLabel = supportRatio != null ? Math.round(supportRatio * 100) : null;

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
        <InteractiveStlPreview label={tr("interactiveStlPreview")} stl={stl} />
      ) : (
        <GcodeSlicePreview label={tr("sliceTab")} locale={locale} toolpath={toolpath} />
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

      {sliceReview ? (
        <div className="printabilitySliceReview">
          <strong>{tr("sliceReviewTitle")}</strong>
          <p>{sliceReview.summary}</p>
          <ul className="printabilityStats">
            {sliceReview.issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
          <p className="confidence">
            {tr("confidence")} {Math.round(sliceReview.confidence * 100)}%
          </p>
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
