import { useEffect, useMemo, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GcodeSlicePreview } from "./GcodeSlicePreview";
import { InteractiveStlPreview } from "./InteractiveStlPreview";
import { downloadText } from "./lib/capture";
import { parseGcodeToolpath, type GcodeToolpath } from "./lib/gcodeParse";
import { formatMessage, type Locale, t } from "./lib/i18n";
import { checkPrintability, type PrintabilityResult } from "./lib/printability";
import { sliceStlForPrintability, type SliceResult } from "./lib/slice";

interface PrintabilityPanelProps {
  locale: Locale;
  stl: string;
  onOptimizeForPrintability: (note: string) => void;
}

type SliceStatus = "idle" | "slicing" | "done";
type ViewerTab = "model" | "slice";

export function PrintabilityPanel({ locale, stl, onOptimizeForPrintability }: PrintabilityPanelProps) {
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

  const [sliceStatus, setSliceStatus] = useState<SliceStatus>("idle");
  const [sliceProgress, setSliceProgress] = useState(0);
  const [sliceResult, setSliceResult] = useState<SliceResult | null>(null);
  const [activeTab, setActiveTab] = useState<ViewerTab>("model");

  useEffect(() => {
    setSliceStatus("idle");
    setSliceProgress(0);
    setSliceResult(null);
    setActiveTab("model");
  }, [stl]);

  const toolpath = useMemo<GcodeToolpath | null>(() => {
    if (!sliceResult?.ok) {
      return null;
    }
    try {
      return parseGcodeToolpath(new TextDecoder().decode(sliceResult.gcode));
    } catch {
      return null;
    }
  }, [sliceResult]);

  async function handleRunSliceTest() {
    setSliceStatus("slicing");
    setSliceProgress(0);
    setSliceResult(null);
    const result = await sliceStlForPrintability(stl, {
      onProgress: setSliceProgress
    });
    setSliceResult(result);
    setSliceStatus("done");
    if (result.ok) {
      setActiveTab("slice");
    }
  }

  function handleOptimizeForPrintability() {
    if (!toolpath) {
      return;
    }
    const supportPercent = Math.round(toolpath.supportSegmentRatio * 100);
    onOptimizeForPrintability(
      formatMessage(tr("optimizeForPrintabilityNoteTemplate"), { percent: supportPercent })
    );
  }

  const supportRatio = toolpath?.supportSegmentRatio ?? null;
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

      <div className="printabilitySliceCheck">
        <strong>{tr("sliceSectionTitle")}</strong>
        <button disabled={!stl.trim() || sliceStatus === "slicing"} onClick={handleRunSliceTest} type="button">
          {sliceStatus === "slicing" ? `${tr("slicing")} ${sliceProgress}%` : tr("runSliceTest")}
        </button>

        {sliceStatus === "done" && sliceResult ? (
          sliceResult.ok ? (
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
                  {tr("sliceLayerCount")}: {sliceResult.layerCount ?? tr("sliceUnknown")}
                </li>
                <li>
                  {tr("slicePrintTime")}: {formatSeconds(sliceResult.printTimeSeconds)}
                </li>
                <li>
                  {tr("sliceFilamentVolume")}: {formatVolume(sliceResult.filamentVolumeMm3)}
                </li>
              </ul>
              <div className="printabilitySliceActions">
                <button
                  onClick={() =>
                    downloadText(
                      "ai-openscad-model.gcode",
                      new TextDecoder().decode(sliceResult.gcode),
                      "text/x-gcode;charset=utf-8"
                    )
                  }
                  type="button"
                >
                  {tr("downloadGcode")}
                </button>
                {supportPercentLabel ? (
                  <button onClick={handleOptimizeForPrintability} type="button">
                    {tr("optimizeForPrintability")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="printabilitySliceResult" data-outcome="failure">
              <PrintabilityBadge ok={false} label={tr("sliceFailure")} />
              <p className="printabilitySliceReason">{sliceResult.reason}</p>
            </div>
          )
        ) : null}
      </div>
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
