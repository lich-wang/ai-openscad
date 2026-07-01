import {
  Check,
  Code2,
  Download,
  Eye,
  FileUp,
  KeyRound,
  Play,
  RefreshCw,
  Send,
  X
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { InteractiveStlPreview } from "./InteractiveStlPreview";
import {
  describeReferenceImages,
  generateOpenScad,
  proposeRevision,
  reviewViews
} from "./lib/apiClient";
import {
  downloadText
} from "./lib/capture";
import { getBrowserLocale, t, type Locale, type MessageKey } from "./lib/i18n";
import {
  CODE_MODEL_PRESETS,
  getModelPreset,
  VISION_MODEL_PRESETS,
  type ModelPreset
} from "./lib/models";
import { createPromptTraceEntry } from "./lib/promptTrace";
import {
  createEmptyProject,
  exportProject,
  importProject,
  loadLlmApiKey,
  loadProjectWorkspace,
  loadVisionApiKey,
  saveLlmApiKey,
  saveProject,
  saveVisionApiKey,
  upsertProjectList,
  type ProjectState,
  type PromptTraceEntry,
  type RenderEvidence,
  type RunEvent,
  type RunEventRole,
  type RunEventStatus
} from "./lib/project";
import { createRenderMcp, type RenderMcpStage } from "./lib/render";
import {
  buildRenderPrecisionInstruction,
  normalizeOpenScadPrecision
} from "./lib/renderSkill";
import {
  VIEW_FILE_STEMS,
  VIEW_KEYS,
  countRenderedViews,
  createEmptyViewSet,
  hasCompleteViewSet,
  viewImagesInOrder,
  type ViewKey
} from "./lib/viewSpecs";
import { acceptRevision, rejectRevision } from "./lib/workflow";

type BusyState =
  | "idle"
  | "draftingReference"
  | "generating"
  | "compiling"
  | "reviewing"
  | "exporting";
type WorkflowStage = "code" | "render" | "review";
type WorkflowStageState = "waiting" | "active" | "complete" | "error";
type ReferenceImageSelection = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  dataUrl: string;
  fingerprint: string;
};
type DraftCompileSuccess = {
  ok: true;
  diagnostics: string;
  evidence: RenderEvidence;
  trace: PromptTraceEntry;
  views: ProjectState["views"];
  stl: string;
};
type DraftCompileFailure = {
  ok: false;
  diagnostics: string;
  evidence: RenderEvidence;
  trace: PromptTraceEntry;
  repairable: boolean;
  views: null;
  stl: null;
};
type DraftCompileResult = DraftCompileSuccess | DraftCompileFailure;
type AutoRunCheckpoint = {
  code: string;
  views: ProjectState["views"];
  stl: string;
  renderEvidence: RenderEvidence;
  review: NonNullable<ProjectState["review"]>;
};

const MAX_COMPILER_REPAIR_ATTEMPTS = 2;
const TARGET_CONFIDENCE_STORAGE_KEY = "ai-openscad.target-confidence-percent";
const AUTO_ITERATION_STORAGE_KEY = "ai-openscad.auto-iteration-limit";
const DEFAULT_TARGET_CONFIDENCE_PERCENT = 85;
const MIN_TARGET_CONFIDENCE_PERCENT = 1;
const MAX_TARGET_CONFIDENCE_PERCENT = 100;
const DEFAULT_AUTO_ITERATION_LIMIT = 0;
const MIN_AUTO_ITERATION_LIMIT = 0;
const MAX_AUTO_ITERATION_LIMIT = 5;
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
const VIEW_DOWNLOAD_KEYS: Record<ViewKey, MessageKey> = {
  front: "downloadFrontPng",
  back: "downloadBackPng",
  left: "downloadLeftPng",
  right: "downloadRightPng",
  top: "downloadTopPng",
  bottom: "downloadBottomPng",
  isoFrontRightTop: "downloadIsoFrontRightTopPng",
  isoFrontLeftTop: "downloadIsoFrontLeftTopPng",
  isoBackRightTop: "downloadIsoBackRightTopPng",
  isoBackLeftTop: "downloadIsoBackLeftTopPng",
  isoFrontRightBottom: "downloadIsoFrontRightBottomPng",
  isoFrontLeftBottom: "downloadIsoFrontLeftBottomPng",
  isoBackRightBottom: "downloadIsoBackRightBottomPng",
  isoBackLeftBottom: "downloadIsoBackLeftBottomPng"
};

function emptyViews(): ProjectState["views"] {
  return createEmptyViewSet();
}

function renderedViewCount(views: ProjectState["views"]): number {
  return countRenderedViews(views);
}

function allViewsRendered(views: ProjectState["views"]): boolean {
  return hasCompleteViewSet(views);
}

function referenceImageFingerprint(images: ReferenceImageSelection[]): string {
  return images.map((image) => image.fingerprint).join("|");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

function canUseCodeModel(modelId: string, apiKey: string): boolean {
  const provider = getModelPreset(modelId, "code").provider;
  return provider === "mimo" || Boolean(apiKey.trim());
}

class AutoRunCanceledError extends Error {
  constructor() {
    super("Automatic confidence run was canceled.");
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readStoredInteger(key: string, fallback: number, min: number, max: number): number {
  if (typeof localStorage === "undefined") {
    return fallback;
  }
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return clampInteger(fallback, min, max);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return clampInteger(fallback, min, max);
  }
  return clampInteger(parsed, min, max);
}

function writeStoredInteger(key: string, value: number): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(key, String(value));
}

function formatConfidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function hasUnsafeRenderDiagnostics(diagnostics?: string | null): boolean {
  if (!diagnostics) {
    return false;
  }
  const unsafePatterns = [
    /\bundefined operation\b/i,
    /\bIgnoring unknown variable\b/i,
    /\bIgnoring unknown module\b/i,
    /\bUnable to convert\b.*\bparameter\b/i,
    /\bCan'?t open (include|library|file)\b/i,
    /\bCould not open (include|library|file)\b/i,
    /^\s*ERROR:/im,
    /\bNaN\b/i,
    /\bnon[-\s]?finite\b/i
  ];
  return unsafePatterns.some((pattern) => pattern.test(diagnostics));
}

function addUnsafeRenderDiagnosticsGuidance(diagnostics: string): string {
  if (!hasUnsafeRenderDiagnostics(diagnostics)) {
    return diagnostics;
  }
  return `${diagnostics}\nUnsafe OpenSCAD diagnostics were reported. The render may be incomplete or invalid; repair before review or export.`;
}

function renderEvidenceIsClean(renderEvidence?: RenderEvidence | null): boolean {
  if (!renderEvidence) {
    return false;
  }
  return (
    renderEvidence.compileStatus === "success" &&
    !hasUnsafeRenderDiagnostics(renderEvidence.diagnostics)
  );
}

function hasCleanRenderedViews(project: ProjectState): boolean {
  return allViewsRendered(project.views) && renderEvidenceIsClean(project.renderEvidence);
}

export default function App() {
  const [initialWorkspace] = useState(() => loadProjectWorkspace());
  const [project, setProject] = useState<ProjectState>(() => initialWorkspace.activeProject);
  const [projectList, setProjectList] = useState<ProjectState[]>(
    () => initialWorkspace.projects
  );
  const [llmApiKey, setLlmApiKey] = useState(() => loadLlmApiKey());
  const [visionApiKey, setVisionApiKey] = useState(() => loadVisionApiKey());
  const [targetConfidencePercent, setTargetConfidencePercent] = useState(() =>
    readStoredInteger(
      TARGET_CONFIDENCE_STORAGE_KEY,
      DEFAULT_TARGET_CONFIDENCE_PERCENT,
      MIN_TARGET_CONFIDENCE_PERCENT,
      MAX_TARGET_CONFIDENCE_PERCENT
    )
  );
  const [autoIterationLimit, setAutoIterationLimit] = useState(() =>
    readStoredInteger(
      AUTO_ITERATION_STORAGE_KEY,
      DEFAULT_AUTO_ITERATION_LIMIT,
      MIN_AUTO_ITERATION_LIMIT,
      MAX_AUTO_ITERATION_LIMIT
    )
  );
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState("");
  const [errorStage, setErrorStage] = useState<WorkflowStage | "">("");
  const [renderStatus, setRenderStatus] = useState("");
  const [autoRunActive, setAutoRunActive] = useState(false);
  const busyRef = useRef<BusyState>("idle");
  const operationTokenRef = useRef(0);
  const referenceDraftTokenRef = useRef(0);
  const referenceDraftFingerprintRef = useRef("");
  const projectRef = useRef(project);
  const requirementInputRef = useRef<HTMLTextAreaElement | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const autoRunTokenRef = useRef(0);
  const targetConfidencePercentRef = useRef(targetConfidencePercent);
  const autoIterationLimitRef = useRef(autoIterationLimit);

  const locale = getBrowserLocale();
  const tr = (key: MessageKey) => t(locale, key);
  const adapter = useMemo(() => createRenderMcp("web"), []);
  const isBusy = busy !== "idle";
  const controlsLocked = autoRunActive || isBusy;
  const hasRenderedViews = hasCleanRenderedViews(project);
  const hasCurrentReview = Boolean(project.review && hasRenderedViews);
  const hasPendingRevision = Boolean(project.proposedCode.trim());
  const canUseCodeModelForRepair = canUseCodeModel(project.codeModelId, llmApiKey);
  const hasDiagnosticFix = Boolean(
    project.currentCode.trim() &&
      !hasRenderedViews &&
      !hasPendingRevision &&
      !hasCurrentReview &&
      project.renderEvidence?.compileStatus === "failure" &&
      project.renderEvidence.repairable !== false &&
      canUseCodeModelForRepair
  );
  const compilerOutputForDisplay =
    renderStatus ||
    (hasPendingRevision && busy === "idle" ? tr("revisionReady") : project.compilerOutput);
  const workflowStages = buildWorkflowStages({
    busy,
    errorStage,
    hasCode: Boolean(project.currentCode.trim() || project.proposedCode.trim()),
    hasRenderedViews,
    hasReview: hasCurrentReview
  });
  const hasModelWork = Boolean(
    project.currentCode.trim() ||
      project.proposedCode.trim() ||
      renderedViewCount(project.views) > 0 ||
      project.review
  );
  const canUseVisionModelForDraft =
    getModelPreset(project.visionModelId, "vision").provider === "mimo" ||
    Boolean(visionApiKey.trim());
  const referenceControlsDisabled =
    controlsLocked || hasPendingRevision || !canUseVisionModelForDraft;
  const describeReferenceDisabled = referenceControlsDisabled;

  function addDraftRenderTimeoutGuidance(diagnostics: string): string {
    if (!diagnostics.includes("OpenSCAD render timed out")) {
      return diagnostics;
    }
    return `${diagnostics} The draft likely exceeded the browser draft render complexity budget. Simplify stacked extrusions, dense arrays, per-layer booleans, or high segment counts, then rerender.`;
  }

  function addFinalExportTimeoutGuidance(diagnostics: string): string {
    if (!diagnostics.includes("OpenSCAD render timed out")) {
      return diagnostics;
    }
    return `${diagnostics} The high precision final export timed out. Simplify the accepted source or try a lower-complexity model before exporting again.`;
  }

  function addIncompleteViewGuidance(
    diagnostics: string,
    result: { ok: boolean; stl?: string; views?: ProjectState["views"] },
    viewCount: number
  ): string {
    if (!result.ok || !result.stl || !result.views || viewCount === VIEW_KEYS.length) {
      return diagnostics;
    }
    return `${diagnostics}\nRendered ${viewCount} of ${VIEW_KEYS.length} required views. Rerender all views before review or export.`;
  }

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    saveProject(project);
    setProjectList((current) => upsertProjectList(current, project));
  }, [project]);

  useEffect(() => {
    adapter.prewarm();
  }, [adapter]);

  useEffect(() => {
    saveLlmApiKey(llmApiKey);
  }, [llmApiKey]);

  useEffect(() => {
    saveVisionApiKey(visionApiKey);
  }, [visionApiKey]);

  function updateBusy(nextBusy: BusyState) {
    busyRef.current = nextBusy;
    setBusy(nextBusy);
  }

  function invalidateReferenceDrafts() {
    referenceDraftTokenRef.current += 1;
    referenceDraftFingerprintRef.current = "";
  }

  function clearReferenceImages() {
    invalidateReferenceDrafts();
    if (referenceFileInputRef.current) {
      referenceFileInputRef.current.value = "";
    }
  }

  function updateTargetConfidence(value: number) {
    const next = clampInteger(
      value,
      MIN_TARGET_CONFIDENCE_PERCENT,
      MAX_TARGET_CONFIDENCE_PERCENT
    );
    targetConfidencePercentRef.current = next;
    setTargetConfidencePercent(next);
    writeStoredInteger(TARGET_CONFIDENCE_STORAGE_KEY, next);
  }

  function updateAutoIterationLimit(value: number) {
    const next = clampInteger(value, MIN_AUTO_ITERATION_LIMIT, MAX_AUTO_ITERATION_LIMIT);
    autoIterationLimitRef.current = next;
    setAutoIterationLimit(next);
    writeStoredInteger(AUTO_ITERATION_STORAGE_KEY, next);
  }

  function beginAutoRun(): number {
    const token = autoRunTokenRef.current + 1;
    autoRunTokenRef.current = token;
    setAutoRunActive(true);
    return token;
  }

  function cancelActiveAutoRun() {
    if (!autoRunActive) {
      return;
    }
    autoRunTokenRef.current += 1;
    setAutoRunActive(false);
    updateBusy("idle");
  }

  function ensureAutoRunCurrent(token: number) {
    if (autoRunTokenRef.current !== token) {
      throw new AutoRunCanceledError();
    }
  }

  function autoRunStopEvent(message: string): RunEvent {
    return createRunEvent({
      role: "tool",
      title: message,
      content: message,
      status: "complete"
    });
  }

  function autoRunRollbackEvent(input: {
    checkpointConfidence: number;
    regressedConfidence: number;
  }): RunEvent {
    return createRunEvent({
      role: "tool",
      title: tr("autoRunRollbackTitle"),
      content: [
        tr("autoRunRollbackRestored"),
        `${tr("checkpointConfidence")} ${formatConfidencePercent(input.checkpointConfidence)}`,
        `${tr("regressedConfidence")} ${formatConfidencePercent(input.regressedConfidence)}`,
        tr("autoRunRollbackFreshReview")
      ].join("\n"),
      status: "complete"
    });
  }

  function createRunEvent(input: {
    role: RunEventRole;
    title: string;
    content: string;
    status?: RunEventStatus;
    code?: string;
    id?: string;
    review?: NonNullable<ProjectState["review"]>;
  }): RunEvent {
    return {
      id: input.id ?? crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      role: input.role,
      title: input.title,
      content: input.content,
      status: input.status ?? "complete",
      code: input.code,
      review: input.review
    };
  }

  function appendRunEvent(event: RunEvent) {
    setProject((current) => ({
      ...current,
      runEvents: [...current.runEvents, event],
      updatedAt: new Date().toISOString()
    }));
  }

  function originalRequirementFor(current: ProjectState): string {
    return current.originalRequirement.trim() || current.requirement.trim();
  }

  function buildDiagnosticFixPrompt(requirement: string, diagnostics: string): string {
    if (locale === "zh") {
      return [
        "修复当前 OpenSCAD 渲染失败诊断。",
        `原始需求：${requirement || "保留原始用户需求。"}`,
        "当前编译/渲染诊断：",
        diagnostics,
        "返回完整修正后的 OpenSCAD 源码。保留可打印几何、尺寸，以及所有与该错误无关的需求细节。"
      ].join("\n");
    }
    return [
      "Fix the current OpenSCAD render failed diagnostic.",
      `Original requirement: ${requirement || "Preserve the original user requirement."}`,
      "Current compile/render diagnostics:",
      diagnostics,
      "Return a complete corrected OpenSCAD source file. Preserve printable geometry, dimensions, and any requirement details not related to the error."
    ].join("\n");
  }

  function fallbackRenderEvidence(diagnostics: string): RenderEvidence {
    return {
      compileStatus: "failure",
      diagnostics,
      renderPrecision: "draft",
      backend: "web-manifold",
      viewCount: 0,
      repairable: true
    };
  }

  function diagnosticFixPatch(current: ProjectState, diagnostics: string, evidence: RenderEvidence) {
    const canRepairWithText = evidence.repairable !== false;
    const prompt = buildDiagnosticFixPrompt(originalRequirementFor(current), diagnostics);
    return {
      requirement: canRepairWithText ? prompt : current.requirement,
      compilerOutput: diagnostics,
      renderEvidence: evidence,
      proposedCode: "",
      review: null,
      stl: "",
      views: emptyViews(),
      runEvents: canRepairWithText
        ? [
            ...current.runEvents,
            createRunEvent({
              role: "tool",
              title: tr("diagnosticFixPromptReady"),
              content: prompt
            })
          ]
        : current.runEvents,
      updatedAt: new Date().toISOString()
    };
  }

  async function runSafely(action: BusyState, task: () => Promise<void>) {
    const operationToken = operationTokenRef.current + 1;
    operationTokenRef.current = operationToken;
    updateBusy(action);
    setError("");
    setErrorStage("");
    try {
      await task();
    } catch (caught) {
      if (caught instanceof AutoRunCanceledError) {
        return;
      }
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setErrorStage(workflowStageForBusy(busyRef.current === "idle" ? action : busyRef.current));
      appendRunEvent(createRunEvent({
        role: "error",
        title: tr("workflowError"),
        content: message,
        status: "error"
      }));
    } finally {
      if (operationTokenRef.current === operationToken) {
        setRenderStatus("");
        setAutoRunActive(false);
        updateBusy("idle");
      }
    }
  }

  function requireLlmApiKey() {
    const provider = getModelPreset(project.codeModelId, "code").provider;
    if (provider !== "mimo" && !llmApiKey.trim()) {
      throw new Error(tr("missingLlmKey"));
    }
  }

  function requireVisionApiKey() {
    const provider = getModelPreset(project.visionModelId, "vision").provider;
    if (provider !== "mimo" && !visionApiKey.trim()) {
      throw new Error(tr("missingVisionKey"));
    }
  }

  async function buildReferenceImagesFromFiles(
    files: File[]
  ): Promise<ReferenceImageSelection[]> {
    return Promise.all(
      files.map(async (file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        dataUrl: await readFileAsDataUrl(file),
        fingerprint: `${file.name}:${file.type}:${file.size}:${file.lastModified}`
      }))
    );
  }

  async function handleReferenceImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []).filter((file) =>
      file.type.startsWith("image/")
    );
    event.currentTarget.value = "";
    if (!files.length) {
      return;
    }
    await draftReferenceImages(files);
  }

  function handleDescribeReferenceImages() {
    if (describeReferenceDisabled) {
      return;
    }
    referenceFileInputRef.current?.click();
  }

  async function draftReferenceImages(files: File[]) {
    await runSafely("draftingReference", async () => {
      requireVisionApiKey();
      const imagesAtStart = await buildReferenceImagesFromFiles(files);
      if (!imagesAtStart.length) {
        return;
      }
      const activeProject = projectRef.current;
      if (activeProject.proposedCode.trim()) {
        throw new Error(tr("pendingRevisionActionHint"));
      }
      const baselineRequirement = activeProject.requirement;
      const activeProjectId = activeProject.id;
      const imageSetFingerprint = referenceImageFingerprint(imagesAtStart);
      const requestToken = referenceDraftTokenRef.current + 1;
      referenceDraftTokenRef.current = requestToken;
      referenceDraftFingerprintRef.current = imageSetFingerprint;
      try {
        const { prompt, trace } = await describeReferenceImages({
          apiKey: visionApiKey,
          modelId: activeProject.visionModelId,
          images: imagesAtStart.map((image) => image.dataUrl)
        });
        const stillCurrent =
          projectRef.current.id === activeProjectId &&
          projectRef.current.requirement === baselineRequirement &&
          (requirementInputRef.current?.value ?? projectRef.current.requirement) ===
            baselineRequirement &&
          referenceDraftFingerprintRef.current === imageSetFingerprint &&
          referenceDraftTokenRef.current === requestToken;
        if (!stillCurrent) {
          return;
        }
        setProject((current) => {
          if (
            current.id !== activeProjectId ||
            current.requirement !== baselineRequirement ||
            (requirementInputRef.current?.value ?? current.requirement) !== baselineRequirement
          ) {
            return current;
          }
          const next = {
            ...current,
            requirement: prompt,
            originalRequirement: "",
            currentCode: "",
            proposedCode: "",
            compilerOutput: "",
            renderEvidence: null,
            review: null,
            stl: "",
            views: emptyViews(),
            runEvents: [
              ...current.runEvents,
              createRunEvent({
                role: "assistant",
                title: tr("referencePromptDrafted"),
                content: prompt,
                status: "complete"
              })
            ],
            promptTrace: [...current.promptTrace, trace],
            updatedAt: new Date().toISOString()
          };
          projectRef.current = next;
          return next;
        });
      } finally {
        if (referenceDraftTokenRef.current === requestToken) {
          referenceDraftFingerprintRef.current = "";
        }
      }
    });
  }

  async function handleGenerate() {
    const shouldAutoRun = autoIterationLimitRef.current > 0;
    const autoRunToken = shouldAutoRun ? beginAutoRun() : 0;
    await runSafely("generating", async () => {
      requireLlmApiKey();
      if (!project.requirement.trim()) {
        throw new Error(tr("missingRequirement"));
      }
      const originalRequirement = project.requirement.trim();
      const userEvent = createRunEvent({
        role: "user",
        title: tr("userRequest"),
        content: originalRequirement
      });
      const codeEventId = crypto.randomUUID();
      const codeEvent = createRunEvent({
        id: codeEventId,
        role: "assistant",
        title: tr("generatedCode"),
        content: tr("streamingCode"),
        status: "active"
      });
      setProject((current) => ({
        ...current,
        originalRequirement,
        currentCode: "",
        proposedCode: "",
        review: null,
        stl: "",
        views: emptyViews(),
        renderEvidence: null,
        compilerOutput: tr("streamingCode"),
        runEvents: [userEvent, codeEvent]
      }));
      let generated: Awaited<ReturnType<typeof generateOpenScad>>;
      try {
        generated = await generateOpenScad({
          apiKey: llmApiKey,
          modelId: project.codeModelId,
          requirement: originalRequirement,
          precision: "draft",
          onToken: (streamedCode) => {
            if (shouldAutoRun && autoRunTokenRef.current !== autoRunToken) {
              return;
            }
            setProject((current) => ({
              ...current,
              currentCode: streamedCode,
              compilerOutput: tr("streamingCode"),
              runEvents: current.runEvents.map((event) =>
                event.id === codeEventId ? { ...event, code: streamedCode } : event
              )
            }));
          }
        });
      } catch (caught) {
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        throw caught;
      }
      const { code, trace } = generated;
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      setProject((current) => ({
        ...current,
        currentCode: code,
        proposedCode: "",
        review: null,
        stl: "",
        views: emptyViews(),
        renderEvidence: null,
        compilerOutput: tr("renderingDraft"),
        runEvents: current.runEvents.map((event) =>
          event.id === codeEventId
            ? { ...event, content: "", code, status: "complete" }
            : event
        ),
        promptTrace: [...current.promptTrace, trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: current.originalRequirement,
            code,
            modelId: current.codeModelId,
            status: "generated"
          }
        ]
      }));
      updateBusy("compiling");
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      let finalCode = code;
      let rendered = await compileDraftCode(code, shouldAutoRun ? autoRunToken : undefined);
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code,
          rendered,
          originalRequirement,
          sourceCodeEventId: codeEventId,
          autoRunToken: shouldAutoRun ? autoRunToken : undefined
        });
        finalCode = repaired.code;
        rendered = repaired.rendered;
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        setProject((current) => ({
          ...current,
          ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
          promptTrace: [...current.promptTrace, rendered.trace],
          updatedAt: new Date().toISOString()
        }));
        if (shouldAutoRun) {
          appendRunEvent(autoRunStopEvent(tr("autoRunCompileStopped")));
        }
        throw new Error(rendered.diagnostics);
      }
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderFinished"),
        content: `${rendered.diagnostics}\n${tr("compiledDraft")}`
      }));
      setProject((current) => ({
        ...current,
        currentCode: finalCode,
        proposedCode: "",
        review: null,
        views: rendered.views,
        stl: rendered.stl,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        renderEvidence: rendered.evidence,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: current.requirement,
            code: finalCode,
            modelId: current.codeModelId,
            status: "compiled"
          }
        ]
      }));
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
        await runBoundedConfidenceLoop({
          autoRunToken,
          originalRequirement,
          code: finalCode,
          views: rendered.views,
          stl: rendered.stl,
          renderEvidence: rendered.evidence
        });
      }
    });
  }

  async function handleCompile() {
    await runSafely("compiling", async () => {
      if (!project.currentCode.trim()) {
        throw new Error(tr("missingCode"));
      }
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      const originalRequirement = originalRequirementFor(project);
      let finalCode = project.currentCode;
      let rendered = await compileDraftCode(project.currentCode);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code: project.currentCode,
          rendered,
          originalRequirement
        });
        finalCode = repaired.code;
        rendered = repaired.rendered;
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        setProject((current) => ({
          ...current,
          ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
          promptTrace: [...current.promptTrace, rendered.trace],
          updatedAt: new Date().toISOString()
        }));
        throw new Error(rendered.diagnostics);
      }
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderFinished"),
        content: `${rendered.diagnostics}\n${tr("compiledDraft")}`
      }));
      setProject((current) => ({
        ...current,
        currentCode: finalCode,
        review: null,
        proposedCode: "",
        views: rendered.views,
        stl: rendered.stl,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        renderEvidence: rendered.evidence,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: current.requirement,
            code: finalCode,
            modelId: current.codeModelId,
            status: "compiled"
          }
        ]
      }));
    });
  }

  async function compileDraftCode(
    code: string,
    autoRunToken?: number
  ): Promise<DraftCompileResult> {
    await updateRenderStatus("renderPreparing", autoRunToken);
    const draftCode = normalizeOpenScadPrecision(code, "draft");
    let result: Awaited<ReturnType<typeof adapter.render>>;
    try {
      result = await adapter.render({
        source: draftCode,
        onProgress: (stage) => updateRenderStatus(renderMcpStageMessageKey(stage), autoRunToken)
      });
    } catch (caught) {
      if (autoRunToken !== undefined) {
        ensureAutoRunCurrent(autoRunToken);
      }
      throw caught;
    }
    const viewCount = result.views ? renderedViewCount(result.views) : 0;
    const hasCompleteViews = result.views ? allViewsRendered(result.views) : false;
    const diagnostics = addDraftRenderTimeoutGuidance(
      addUnsafeRenderDiagnosticsGuidance(
        addIncompleteViewGuidance(result.diagnostics, result, viewCount)
      )
    );
    const hasUnsafeDiagnostics = hasUnsafeRenderDiagnostics(diagnostics);
    const renderSucceeded =
      result.ok && Boolean(result.stl) && hasCompleteViews && !hasUnsafeDiagnostics;
    const evidence: RenderEvidence = {
      compileStatus: renderSucceeded ? "success" : "failure",
      diagnostics,
      renderPrecision: "draft",
      backend: result.backend ?? "web",
      viewCount,
      repairable: renderSucceeded ? undefined : hasUnsafeDiagnostics || !result.stl
    };
    const trace = createPromptTraceEntry({
      phase: "compile",
      modelId: "render-mcp:web",
      systemPrompt: buildRenderPrecisionInstruction("draft"),
      userPrompt: tr("compileDraftTrace"),
      response: diagnostics
    });
    if (!result.ok || !result.stl || !result.views || !hasCompleteViews || hasUnsafeDiagnostics) {
      return {
        ok: false,
        diagnostics,
        evidence,
        trace,
        repairable: evidence.repairable !== false,
        views: null,
        stl: null
      };
    }
    return {
      ok: true,
      diagnostics,
      evidence,
      trace,
      views: result.views,
      stl: result.stl
    };
  }

  async function repairDraftCompileIfPossible(input: {
    code: string;
    rendered: DraftCompileResult;
    originalRequirement: string;
    sourceCodeEventId?: string;
    autoRunToken?: number;
  }): Promise<{ code: string; rendered: DraftCompileResult }> {
    if (input.autoRunToken !== undefined) {
      ensureAutoRunCurrent(input.autoRunToken);
    }
    let code = input.code;
    let rendered = input.rendered;
    if (
      rendered.ok ||
      !rendered.repairable ||
      !canUseCodeModel(project.codeModelId, llmApiKey)
    ) {
      return { code, rendered };
    }

    for (let attempt = 1; attempt <= MAX_COMPILER_REPAIR_ATTEMPTS; attempt += 1) {
      const diagnostics = rendered.diagnostics;
      const renderEvidence = rendered.evidence;
      const repairPrompt = buildDiagnosticFixPrompt(input.originalRequirement, diagnostics);
      const codeEventId = crypto.randomUUID();
      const title = `${tr("compilerRepairStarted")} ${attempt} of ${MAX_COMPILER_REPAIR_ATTEMPTS}`;

      updateBusy("generating");
      setProject((current) => ({
        ...current,
        currentCode: code,
        proposedCode: "",
        review: null,
        stl: "",
        views: emptyViews(),
        renderEvidence,
        compilerOutput: diagnostics,
        runEvents: [
          ...current.runEvents,
          createRunEvent({
            role: "tool",
            title: tr("renderDiagnostics"),
            content: diagnostics,
            status: "error"
          }),
          createRunEvent({
            id: codeEventId,
            role: "assistant",
            title,
            content: title,
            status: "active"
          })
        ],
        updatedAt: new Date().toISOString()
      }));

      let repairedCode: string;
      let trace: PromptTraceEntry;
      try {
        const proposed = await proposeRevision({
          apiKey: llmApiKey,
          modelId: project.codeModelId,
          requirement: input.originalRequirement,
          code,
          review: {
            summary: "Compile failed before visual review.",
            issues: [diagnostics],
            correctionPrompt: repairPrompt,
            confidence: 0.2
          },
          userNotes: repairPrompt,
          renderEvidence,
          precision: "draft",
          onToken: (streamedCode) => {
            if (
              input.autoRunToken !== undefined &&
              autoRunTokenRef.current !== input.autoRunToken
            ) {
              return;
            }
            setProject((current) => ({
              ...current,
              currentCode: streamedCode,
              compilerOutput: tr("streamingIteration")
            }));
          }
        });
        if (input.autoRunToken !== undefined) {
          ensureAutoRunCurrent(input.autoRunToken);
        }
        repairedCode = proposed.code;
        trace = proposed.trace;
      } catch (caught) {
        if (caught instanceof AutoRunCanceledError) {
          throw caught;
        }
        if (input.autoRunToken !== undefined) {
          ensureAutoRunCurrent(input.autoRunToken);
        }
        const message = caught instanceof Error ? caught.message : String(caught);
        setProject((current) => ({
          ...current,
          currentCode: code,
          runEvents: current.runEvents.map((event) =>
            event.id === codeEventId
              ? { ...event, content: message, status: "error" }
              : event
          ),
          updatedAt: new Date().toISOString()
        }));
        updateBusy("compiling");
        return { code, rendered };
      }

      code = repairedCode;
      setProject((current) => ({
        ...current,
        currentCode: code,
        proposedCode: "",
        review: null,
        stl: "",
        views: emptyViews(),
        renderEvidence: null,
        compilerOutput: tr("renderingDraft"),
        runEvents: current.runEvents.map((event) =>
          event.id === codeEventId
            ? { ...event, content: "", status: "complete" }
            : event.id === input.sourceCodeEventId
              ? { ...event, code }
            : event
        ),
        promptTrace: [...current.promptTrace, trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: repairPrompt,
            code,
            modelId: current.codeModelId,
            status: "generated"
          }
        ]
      }));

      updateBusy("compiling");
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      rendered = await compileDraftCode(code, input.autoRunToken);
      if (input.autoRunToken !== undefined) {
        ensureAutoRunCurrent(input.autoRunToken);
      }
      if (rendered.ok) {
        return { code, rendered };
      }
      if (!rendered.repairable) {
        return { code, rendered };
      }
    }

    return { code, rendered };
  }

  async function reviewRenderedDraft(input: {
    originalRequirement: string;
    code: string;
    views: ProjectState["views"];
    renderEvidence: RenderEvidence | null;
    strictConfidence: boolean;
    autoRunToken?: number;
  }) {
    if (!allViewsRendered(input.views) || !renderEvidenceIsClean(input.renderEvidence)) {
      throw new Error(tr("compileBeforeReview"));
    }
    requireVisionApiKey();
    appendRunEvent(createRunEvent({
      role: "review",
      title: tr("reviewStarted"),
      content: tr("reviewStarted"),
      status: "active"
    }));
    let reviewed: Awaited<ReturnType<typeof reviewViews>>;
    try {
      reviewed = await reviewViews({
        apiKey: visionApiKey,
        modelId: project.visionModelId,
        requirement: input.originalRequirement,
        code: input.code,
        images: viewImagesInOrder(input.views),
        renderEvidence: input.renderEvidence,
        strictConfidence: input.strictConfidence
      });
    } catch (caught) {
      if (input.autoRunToken !== undefined) {
        ensureAutoRunCurrent(input.autoRunToken);
      }
      throw caught;
    }
    const { review, trace: reviewTrace } = reviewed;
    if (input.autoRunToken !== undefined) {
      ensureAutoRunCurrent(input.autoRunToken);
    }
    setProject((current) => ({
      ...current,
      originalRequirement: current.originalRequirement.trim()
        ? current.originalRequirement
        : input.originalRequirement,
      review,
      requirement: review.correctionPrompt || current.requirement,
      promptTrace: [...current.promptTrace, reviewTrace],
      compilerOutput: tr("visionComplete"),
      runEvents: [
        ...current.runEvents.filter((event) => event.title !== tr("reviewStarted")),
        createRunEvent({
          role: "review",
          title: tr("visionComplete"),
          content: tr("visionComplete"),
          status: "complete"
        }),
        createRunEvent({
          role: "review",
          title: tr("visualReview"),
          content: review.summary,
          review,
          status: "complete"
        }),
        createRunEvent({
          role: "review",
          title: tr("correctionPrompt"),
          content: review.correctionPrompt,
          status: "complete"
        })
      ],
      updatedAt: new Date().toISOString(),
      iterations: [
        ...current.iterations,
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          requirement: current.requirement,
          code: input.code,
          modelId: current.visionModelId,
          status: "reviewed",
          reviewSummary: review.summary
        }
      ]
    }));
    return review;
  }

  async function runBoundedConfidenceLoop(input: {
    autoRunToken: number;
    originalRequirement: string;
    code: string;
    views: ProjectState["views"];
    stl: string;
    renderEvidence: RenderEvidence;
  }) {
    let code = input.code;
    let views = input.views;
    let stl = input.stl;
    let renderEvidence: RenderEvidence | null = input.renderEvidence;
    let pendingCheckpoint: AutoRunCheckpoint | null = null;
    let usedAutoIterations = 0;
    const targetConfidence = targetConfidencePercentRef.current / 100;
    const iterationLimit = autoIterationLimitRef.current;

    while (true) {
      ensureAutoRunCurrent(input.autoRunToken);
      updateBusy("reviewing");
      let review;
      try {
        review = await reviewRenderedDraft({
          originalRequirement: input.originalRequirement,
          code,
          views,
          renderEvidence,
          strictConfidence: true,
          autoRunToken: input.autoRunToken
        });
      } catch (caught) {
        if (caught instanceof AutoRunCanceledError) {
          throw caught;
        }
        const message = caught instanceof Error ? caught.message : String(caught);
        appendRunEvent(autoRunStopEvent(message));
        throw caught;
      }
      ensureAutoRunCurrent(input.autoRunToken);

      if (pendingCheckpoint && review.confidence < pendingCheckpoint.review.confidence) {
        const checkpoint: AutoRunCheckpoint = pendingCheckpoint;
        const regressedReview = review;
        pendingCheckpoint = null;
        code = checkpoint.code;
        views = checkpoint.views;
        stl = checkpoint.stl;
        renderEvidence = checkpoint.renderEvidence;
        setProject((current) => ({
          ...current,
          currentCode: checkpoint.code,
          proposedCode: "",
          review: checkpoint.review,
          requirement: checkpoint.review.correctionPrompt || current.requirement,
          views: checkpoint.views,
          stl: checkpoint.stl,
          renderEvidence: checkpoint.renderEvidence,
          compilerOutput: `${checkpoint.renderEvidence.diagnostics}\n${tr("compiledDraft")}`,
          runEvents: [
            ...current.runEvents,
            autoRunRollbackEvent({
              checkpointConfidence: checkpoint.review.confidence,
              regressedConfidence: regressedReview.confidence
            })
          ],
          updatedAt: new Date().toISOString()
        }));
        ensureAutoRunCurrent(input.autoRunToken);
        updateBusy("reviewing");
        try {
          review = await reviewRenderedDraft({
            originalRequirement: input.originalRequirement,
            code,
            views,
            renderEvidence,
            strictConfidence: true,
            autoRunToken: input.autoRunToken
          });
        } catch (caught) {
          if (caught instanceof AutoRunCanceledError) {
            throw caught;
          }
          const message = caught instanceof Error ? caught.message : String(caught);
          appendRunEvent(autoRunStopEvent(message));
          throw caught;
        }
        ensureAutoRunCurrent(input.autoRunToken);
      } else {
        pendingCheckpoint = null;
      }

      if (review.confidence >= targetConfidence) {
        appendRunEvent(autoRunStopEvent(tr("targetConfidenceReached")));
        return;
      }
      if (usedAutoIterations >= iterationLimit) {
        appendRunEvent(autoRunStopEvent(tr("autoIterationLimitReached")));
        return;
      }

      if (!renderEvidence) {
        appendRunEvent(autoRunStopEvent(tr("autoRunCompileStopped")));
        throw new Error(tr("compileBeforeReview"));
      }
      pendingCheckpoint = {
        code,
        views,
        stl,
        renderEvidence,
        review
      };
      usedAutoIterations += 1;
      const autoIterationTitle = `${tr("autoIterationStarted")} ${usedAutoIterations} of ${iterationLimit}`;
      appendRunEvent(createRunEvent({
        role: "assistant",
        title: autoIterationTitle,
        content: autoIterationTitle,
        status: "complete"
      }));
      updateBusy("generating");
      const codeEventId = crypto.randomUUID();
      setProject((current) => ({
        ...current,
        currentCode: "",
        proposedCode: "",
        review: null,
        views: emptyViews(),
        stl: "",
        renderEvidence: null,
        compilerOutput: tr("streamingIteration"),
        runEvents: [
          ...current.runEvents,
          createRunEvent({
            id: codeEventId,
            role: "assistant",
            title: tr("generatedCode"),
            content: tr("streamingIteration"),
            status: "active"
          })
        ],
        updatedAt: new Date().toISOString()
      }));

      let proposed: Awaited<ReturnType<typeof proposeRevision>>;
      try {
        proposed = await proposeRevision({
          apiKey: llmApiKey,
          modelId: project.codeModelId,
          requirement: input.originalRequirement,
          code,
          review,
          userNotes: review.correctionPrompt,
          renderEvidence,
          precision: "draft",
          onToken: (streamedCode) => {
            if (autoRunTokenRef.current !== input.autoRunToken) {
              return;
            }
            setProject((current) => ({
              ...current,
              currentCode: streamedCode,
              compilerOutput: tr("streamingIteration"),
              runEvents: current.runEvents.map((event) =>
                event.id === codeEventId ? { ...event, code: streamedCode } : event
              )
            }));
          }
        });
      } catch (caught) {
        ensureAutoRunCurrent(input.autoRunToken);
        throw caught;
      }
      ensureAutoRunCurrent(input.autoRunToken);

      code = proposed.code;
      setProject((current) => ({
        ...current,
        currentCode: code,
        proposedCode: "",
        review: null,
        stl: "",
        views: emptyViews(),
        renderEvidence: null,
        compilerOutput: tr("renderingDraft"),
        runEvents: current.runEvents.map((event) =>
          event.id === codeEventId
            ? { ...event, content: "", code, status: "complete" }
            : event
        ),
        promptTrace: [...current.promptTrace, proposed.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: review.correctionPrompt,
            code,
            modelId: current.codeModelId,
            status: "generated"
          }
        ]
      }));

      updateBusy("compiling");
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      let rendered = await compileDraftCode(code, input.autoRunToken);
      ensureAutoRunCurrent(input.autoRunToken);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code,
          rendered,
          originalRequirement: input.originalRequirement,
          sourceCodeEventId: codeEventId,
          autoRunToken: input.autoRunToken
        });
        code = repaired.code;
        rendered = repaired.rendered;
      }
      ensureAutoRunCurrent(input.autoRunToken);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        setProject((current) => ({
          ...current,
          ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
          promptTrace: [...current.promptTrace, rendered.trace],
          updatedAt: new Date().toISOString()
        }));
        appendRunEvent(autoRunStopEvent(tr("autoRunCompileStopped")));
        throw new Error(rendered.diagnostics);
      }
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderFinished"),
        content: `${rendered.diagnostics}\n${tr("compiledDraft")}`
      }));
      setProject((current) => ({
        ...current,
        currentCode: code,
        proposedCode: "",
        review: null,
        views: rendered.views,
        stl: rendered.stl,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        renderEvidence: rendered.evidence,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: review.correctionPrompt,
            code,
            modelId: current.codeModelId,
            status: "compiled"
          }
        ]
      }));
      views = rendered.views;
      stl = rendered.stl;
      renderEvidence = rendered.evidence;
    }
  }

  async function updateRenderStatus(key: MessageKey, autoRunToken?: number) {
    if (autoRunToken !== undefined) {
      ensureAutoRunCurrent(autoRunToken);
    }
    const message = tr(key);
    setRenderStatus(message);
    setProject((current) => ({
      ...current,
      compilerOutput: message,
      updatedAt: new Date().toISOString()
    }));
    await waitForPaint();
  }

  async function handleReview() {
    await runSafely("reviewing", async () => {
      const originalRequirement = originalRequirementFor(project);
      await reviewRenderedDraft({
        originalRequirement,
        code: project.currentCode,
        views: project.views,
        renderEvidence: project.renderEvidence,
        strictConfidence: false
      });
    });
  }

  async function handleDiagnosticFix() {
    await runSafely("generating", async () => {
      requireLlmApiKey();
      if (!project.currentCode.trim()) {
        throw new Error(tr("missingCode"));
      }
      const originalRequirement = originalRequirementFor(project);
      const diagnostics = project.renderEvidence?.diagnostics || project.compilerOutput;
      const renderEvidence = project.renderEvidence ?? fallbackRenderEvidence(diagnostics);
      const fixPrompt =
        project.requirement.trim() || buildDiagnosticFixPrompt(originalRequirement, diagnostics);
      const codeEventId = crypto.randomUUID();
      setProject((current) => ({
        ...current,
        currentCode: "",
        proposedCode: "",
        review: null,
        views: emptyViews(),
        stl: "",
        renderEvidence: null,
        compilerOutput: tr("streamingIteration"),
        runEvents: [
          ...(current.runEvents.length
            ? current.runEvents
            : [
                createRunEvent({
                  role: "user",
                  title: tr("userRequest"),
                  content: originalRequirement
                })
              ]),
          createRunEvent({
            role: "user",
            title: tr("diagnosticFixStarted"),
            content: fixPrompt
          }),
          createRunEvent({
            id: codeEventId,
            role: "assistant",
            title: tr("generatedCode"),
            content: tr("streamingIteration"),
            status: "active"
          })
        ]
      }));
      const { code, trace } = await proposeRevision({
        apiKey: llmApiKey,
        modelId: project.codeModelId,
        requirement: originalRequirement,
        code: project.currentCode,
        review: {
          summary: "Compile failed before visual review.",
          issues: [diagnostics],
          correctionPrompt: fixPrompt,
          confidence: 0.2
        },
        userNotes: fixPrompt,
        renderEvidence,
        precision: "draft",
        onToken: (streamedCode) => {
          setProject((current) => ({
            ...current,
            currentCode: streamedCode,
            compilerOutput: tr("streamingIteration"),
            runEvents: current.runEvents.map((event) =>
              event.id === codeEventId ? { ...event, code: streamedCode } : event
            )
          }));
        }
      });
      setProject((current) => ({
        ...current,
        currentCode: code,
        proposedCode: "",
        review: null,
        views: emptyViews(),
        stl: "",
        renderEvidence: null,
        compilerOutput: tr("renderingDraft"),
        runEvents: current.runEvents.map((event) =>
          event.id === codeEventId
            ? { ...event, content: "", code, status: "complete" }
            : event
        ),
        promptTrace: [...current.promptTrace, trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: fixPrompt,
            code,
            modelId: current.codeModelId,
            status: "generated"
          }
        ]
      }));
      updateBusy("compiling");
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      let finalCode = code;
      let rendered = await compileDraftCode(code);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code,
          rendered,
          originalRequirement,
          sourceCodeEventId: codeEventId
        });
        finalCode = repaired.code;
        rendered = repaired.rendered;
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        setProject((current) => ({
          ...current,
          ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
          promptTrace: [...current.promptTrace, rendered.trace],
          updatedAt: new Date().toISOString()
        }));
        throw new Error(rendered.diagnostics);
      }
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderFinished"),
        content: `${rendered.diagnostics}\n${tr("compiledDraft")}`
      }));
      setProject((current) => ({
        ...current,
        currentCode: finalCode,
        proposedCode: "",
        review: null,
        views: rendered.views,
        stl: rendered.stl,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        renderEvidence: rendered.evidence,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: fixPrompt,
            code,
            modelId: current.codeModelId,
            status: "compiled"
          }
        ]
      }));
    });
  }

  async function handleIterateAgain() {
    const shouldAutoRun = autoIterationLimitRef.current > 0;
    const autoRunToken = shouldAutoRun ? beginAutoRun() : 0;
    await runSafely("generating", async () => {
      requireLlmApiKey();
      if (!project.review) {
        throw new Error(tr("reviewBeforeIterate"));
      }
      if (!hasCleanRenderedViews(project)) {
        throw new Error(tr("compileBeforeReview"));
      }
      const originalRequirement = originalRequirementFor(project);
      const iterationPrompt = project.requirement.trim() || project.review.correctionPrompt;
      const codeEventId = crypto.randomUUID();
      setProject((current) => ({
        ...current,
        currentCode: "",
        proposedCode: "",
        review: null,
        views: emptyViews(),
        stl: "",
        renderEvidence: null,
        compilerOutput: tr("streamingIteration"),
        runEvents: [
          ...(current.runEvents.length
            ? current.runEvents
            : [
                createRunEvent({
                  role: "user",
                  title: tr("userRequest"),
                  content: originalRequirement
                })
              ]),
          createRunEvent({
            role: "user",
            title: tr("iterationStarted"),
            content: iterationPrompt
          }),
          createRunEvent({
            id: codeEventId,
            role: "assistant",
            title: tr("generatedCode"),
            content: tr("streamingIteration"),
            status: "active"
          })
        ]
      }));
      let revision: Awaited<ReturnType<typeof proposeRevision>>;
      try {
        revision = await proposeRevision({
          apiKey: llmApiKey,
          modelId: project.codeModelId,
          requirement: originalRequirement,
          code: project.currentCode,
          review: project.review,
          userNotes: iterationPrompt,
          renderEvidence: project.renderEvidence,
          precision: "draft",
          onToken: (streamedCode) => {
            if (shouldAutoRun && autoRunTokenRef.current !== autoRunToken) {
              return;
            }
            setProject((current) => ({
              ...current,
              currentCode: streamedCode,
              compilerOutput: tr("streamingIteration"),
              runEvents: current.runEvents.map((event) =>
                event.id === codeEventId ? { ...event, code: streamedCode } : event
              )
            }));
          }
        });
      } catch (caught) {
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        throw caught;
      }
      const { code, trace } = revision;
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      setProject((current) => ({
        ...current,
        currentCode: code,
        proposedCode: "",
        review: null,
        views: emptyViews(),
        stl: "",
        renderEvidence: null,
        compilerOutput: tr("renderingDraft"),
        runEvents: current.runEvents.map((event) =>
          event.id === codeEventId
            ? { ...event, content: "", code, status: "complete" }
            : event
        ),
        promptTrace: [...current.promptTrace, trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: iterationPrompt,
            code,
            modelId: current.codeModelId,
            status: "generated"
          }
        ]
      }));
      updateBusy("compiling");
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      let finalCode = code;
      let rendered = await compileDraftCode(code, shouldAutoRun ? autoRunToken : undefined);
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code,
          rendered,
          originalRequirement,
          sourceCodeEventId: codeEventId,
          autoRunToken: shouldAutoRun ? autoRunToken : undefined
        });
        finalCode = repaired.code;
        rendered = repaired.rendered;
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        setProject((current) => ({
          ...current,
          ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
          promptTrace: [...current.promptTrace, rendered.trace],
          updatedAt: new Date().toISOString()
        }));
        if (shouldAutoRun) {
          appendRunEvent(autoRunStopEvent(tr("autoRunCompileStopped")));
        }
        throw new Error(rendered.diagnostics);
      }
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderFinished"),
        content: `${rendered.diagnostics}\n${tr("compiledDraft")}`
      }));
      setProject((current) => ({
        ...current,
        currentCode: finalCode,
        proposedCode: "",
        review: null,
        views: rendered.views,
        stl: rendered.stl,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        renderEvidence: rendered.evidence,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: iterationPrompt,
            code: finalCode,
            modelId: current.codeModelId,
            status: "compiled"
          }
        ]
      }));
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
        await runBoundedConfidenceLoop({
          autoRunToken,
          originalRequirement,
          code: finalCode,
          views: rendered.views,
          stl: rendered.stl,
          renderEvidence: rendered.evidence
        });
      }
    });
  }

  async function handleHighPrecisionExport() {
    const confirmed = window.confirm(tr("finalExportConfirm"));
    if (!confirmed) {
      return;
    }
    await runSafely("exporting", async () => {
      if (!project.currentCode.trim()) {
        throw new Error(tr("missingCode"));
      }
      if (!hasCleanRenderedViews(project)) {
        throw new Error(tr("compileBeforeReview"));
      }
      const finalCode = normalizeOpenScadPrecision(project.currentCode, "final");
      await updateRenderStatus("renderPreparing");
      const result = await adapter.render({
        source: finalCode,
        onProgress: (stage) => updateRenderStatus(renderMcpStageMessageKey(stage))
      });
      const viewCount = result.views ? renderedViewCount(result.views) : 0;
      const hasCompleteViews = result.views ? allViewsRendered(result.views) : false;
      const diagnostics = addFinalExportTimeoutGuidance(
        addUnsafeRenderDiagnosticsGuidance(
          addIncompleteViewGuidance(result.diagnostics, result, viewCount)
        )
      );
      const hasUnsafeDiagnostics = hasUnsafeRenderDiagnostics(diagnostics);
      const renderSucceeded =
        result.ok && Boolean(result.stl) && hasCompleteViews && !hasUnsafeDiagnostics;
      const evidence: RenderEvidence = {
        compileStatus: renderSucceeded ? "success" : "failure",
        diagnostics,
        renderPrecision: "final",
        backend: result.backend ?? "web",
        viewCount,
        repairable: renderSucceeded ? undefined : false
      };
      const trace = createPromptTraceEntry({
        phase: "final-export",
        modelId: "render-mcp:web",
        systemPrompt: buildRenderPrecisionInstruction("final"),
        userPrompt: tr("finalExportTrace"),
        response: diagnostics
      });
      if (!result.ok || !result.stl || !result.views || !hasCompleteViews || hasUnsafeDiagnostics) {
        setProject((current) => ({
          ...current,
          compilerOutput: diagnostics,
          promptTrace: [...current.promptTrace, trace],
          updatedAt: new Date().toISOString()
        }));
        throw new Error(diagnostics);
      }
      const finalStl = result.stl;
      const finalViews = result.views;
      downloadText("ai-openscad-final.scad", finalCode, "text/plain;charset=utf-8");
      downloadText("ai-openscad-final.stl", finalStl, "model/stl;charset=utf-8");
      setProject((current) => ({
        ...current,
        currentCode: finalCode,
        views: finalViews,
        stl: finalStl,
        compilerOutput: `${diagnostics}\n${tr("finalExportDone")}`,
        renderEvidence: evidence,
        promptTrace: [...current.promptTrace, trace],
        updatedAt: new Date().toISOString()
      }));
    });
  }

  async function handleAcceptRevision() {
    await runSafely("compiling", async () => {
      const accepted = acceptRevision(project);
      setProject(accepted);
      if (!accepted.currentCode.trim()) {
        throw new Error(tr("missingCode"));
      }
      const originalRequirement = originalRequirementFor(accepted);
      let finalCode = accepted.currentCode;
      let rendered = await compileDraftCode(accepted.currentCode);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code: accepted.currentCode,
          rendered,
          originalRequirement
        });
        finalCode = repaired.code;
        rendered = repaired.rendered;
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        setProject((current) => ({
          ...current,
          ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
          promptTrace: [...current.promptTrace, rendered.trace],
          updatedAt: new Date().toISOString()
        }));
        throw new Error(rendered.diagnostics);
      }
      setProject((current) => ({
        ...current,
        currentCode: finalCode,
        views: rendered.views,
        stl: rendered.stl,
        review: null,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        renderEvidence: rendered.evidence,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: current.requirement,
            code: finalCode,
            modelId: current.codeModelId,
            status: "compiled"
          }
        ]
      }));
    });
  }

  function handleNewModel() {
    cancelActiveAutoRun();
    clearReferenceImages();
    const next = createEmptyProject();
    setProjectList((current) => upsertProjectList(current, next));
    projectRef.current = next;
    setProject(next);
    setError("");
    setErrorStage("");
  }

  function handleSelectProject(projectId: string) {
    cancelActiveAutoRun();
    clearReferenceImages();
    const selected = projectList.find((item) => item.id === projectId);
    if (!selected) {
      return;
    }
    projectRef.current = selected;
    setProject(selected);
    setError("");
    setErrorStage("");
  }

  function updateProject(patch: Partial<ProjectState>) {
    setProject((current) => {
      const next = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString()
      };
      projectRef.current = next;
      return next;
    });
  }

  function handleCodeEdit(code: string) {
    cancelActiveAutoRun();
    setProject((current) => ({
      ...current,
      currentCode: code,
      proposedCode: "",
      review: null,
      stl: "",
      views: emptyViews(),
      renderEvidence: null,
      updatedAt: new Date().toISOString()
    }));
  }

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    cancelActiveAutoRun();
    clearReferenceImages();
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    file.text()
      .then((content) => {
        const imported = importProject(content);
        setProjectList((current) => upsertProjectList(current, imported));
        projectRef.current = imported;
        setProject(imported);
        setError("");
        setErrorStage("");
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });
  }

  return (
    <main className="appShell">
      <header className="topbar">
        <div>
          <h1>{tr("browserLanguageTitle")}</h1>
          <p>{tr("subtitle")}</p>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel controlPanel">
          <details className="sidebarSettings" open>
            <summary>
              <span>{tr("basicSettings")}</span>
              <small>{tr("basicSettingsSummary")}</small>
            </summary>
            <div className="sidebarSettingsBody">
              <div className="fieldGroup autoRunField">
                <span>{tr("autoRunSettings")}</span>
                <label className="rangeField">
                  <span>{tr("targetConfidence")}</span>
                  <div className="rangeInputRow">
                    <input
                      aria-label={tr("targetConfidence")}
                      disabled={controlsLocked}
                      max={MAX_TARGET_CONFIDENCE_PERCENT}
                      min={MIN_TARGET_CONFIDENCE_PERCENT}
                      onChange={(event) => updateTargetConfidence(Number(event.target.value))}
                      onInput={(event) => updateTargetConfidence(Number(event.currentTarget.value))}
                      step={1}
                      type="range"
                      value={targetConfidencePercent}
                    />
                    <output>{targetConfidencePercent}%</output>
                  </div>
                </label>
                <label className="numberField">
                  <span>{tr("autoIterations")}</span>
                  <input
                    aria-label={tr("autoIterations")}
                    disabled={controlsLocked}
                    max={MAX_AUTO_ITERATION_LIMIT}
                    min={MIN_AUTO_ITERATION_LIMIT}
                    onChange={(event) => updateAutoIterationLimit(Number(event.target.value))}
                    onInput={(event) => updateAutoIterationLimit(Number(event.currentTarget.value))}
                    step={1}
                    type="number"
                    value={autoIterationLimit}
                  />
                </label>
              </div>

              <label>
                <div className="fieldHeader">
                  <span>{tr("llmApiKey")}</span>
                  <ApiKeyHint locale={locale} />
                </div>
                <div className="keyInput">
                  <KeyRound size={16} />
                  <input
                    disabled={controlsLocked}
                    value={llmApiKey}
                    onChange={(event) => setLlmApiKey(event.target.value)}
                    placeholder="sk-..."
                    type="password"
                  />
                </div>
              </label>

              <ModelPicker
                label={tr("llmModel")}
                models={CODE_MODEL_PRESETS}
                value={project.codeModelId}
                onChange={(codeModelId) => updateProject({ codeModelId })}
                disabled={controlsLocked}
              />

              <label>
                <div className="fieldHeader">
                  <span>{tr("visionApiKey")}</span>
                  <ApiKeyHint locale={locale} />
                </div>
                <div className="keyInput">
                  <KeyRound size={16} />
                  <input
                    disabled={controlsLocked}
                    value={visionApiKey}
                    onChange={(event) => setVisionApiKey(event.target.value)}
                    placeholder="sk-..."
                    type="password"
                  />
                </div>
              </label>

              <ModelPicker
                label={tr("visionModel")}
                models={VISION_MODEL_PRESETS}
                value={project.visionModelId}
                onChange={(visionModelId) => updateProject({ visionModelId })}
                disabled={controlsLocked}
              />
            </div>
          </details>

          <section className="projectTools">
            <span>{tr("projectFiles")}</span>
            <div className="projectToolActions">
              <label
                aria-disabled={controlsLocked}
                className="projectToolButton fileButton"
                title={tr("importProject")}
              >
                <FileUp size={15} />
                <span>{tr("importProject")}</span>
                <input
                  accept="application/json"
                  disabled={controlsLocked}
                  type="file"
                  onChange={handleImport}
                />
              </label>
              <button
                className="projectToolButton"
                disabled={hasPendingRevision || controlsLocked}
                title={hasPendingRevision ? tr("exportProjectPending") : tr("exportProject")}
                onClick={() =>
                  downloadText("ai-openscad-project.json", exportProject(project))
                }
              >
                <Download size={15} />
                <span>{tr("exportProject")}</span>
              </button>
            </div>
          </section>

          <button
            className="newModelButton"
            disabled={controlsLocked}
            title={tr("newModelHint")}
            onClick={handleNewModel}
          >
            <RefreshCw size={16} />
            {tr("newModel")}
          </button>

          <section className="modelHistory">
            <span>{tr("models")}</span>
            <div className="modelList">
              {projectList.map((item) => (
                <button
                  aria-pressed={item.id === project.id}
                  disabled={controlsLocked}
                  key={item.id}
                  onClick={() => handleSelectProject(item.id)}
                  type="button"
                >
                  <strong>{projectTitle(item, tr("untitledModel"))}</strong>
                  <small>{new Date(item.updatedAt).toLocaleTimeString()}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="panel codePanel agentPanel">
          <WorkflowStageStrip locale={locale} stages={workflowStages} />
          <AgentRunPanel
            busy={busy}
            compilerOutput={compilerOutputForDisplay}
            error={error}
            locale={locale}
            pendingRevision={hasPendingRevision}
            project={project}
          />
          <section className="agentComposer">
            <div className="panelHeader">
              <h2>{tr("agentComposer")}</h2>
              <span>{tr("draftPrecision")}</span>
            </div>
            <textarea
              className="agentInput requirementInput"
              disabled={busy === "draftingReference"}
              ref={requirementInputRef}
              value={project.requirement}
              onChange={(event) => updateProject({ requirement: event.target.value })}
              onInput={(event) => updateProject({ requirement: event.currentTarget.value })}
              placeholder={tr("requirementPlaceholder")}
            />
            <div className="referenceImagePanel">
              <input
                accept="image/*"
                aria-label={tr("referenceImages")}
                className="referenceImageInput"
                disabled={referenceControlsDisabled}
                multiple
                onChange={handleReferenceImageChange}
                ref={referenceFileInputRef}
                type="file"
              />
              <div className="referenceImageActions">
                <span className="referenceImageLabel">{tr("referenceImages")}</span>
                <button
                  className="referenceDescribeButton"
                  disabled={describeReferenceDisabled}
                  onClick={handleDescribeReferenceImages}
                  type="button"
                >
                  <Eye size={15} />
                  <span>{tr("describeReferenceImages")}</span>
                </button>
              </div>
            </div>
            <div className="buttonGrid agentActions">
              {hasPendingRevision ? (
                <p className="pendingActionHint">{tr("pendingRevisionActionHint")}</p>
              ) : null}
              {hasDiagnosticFix ? (
                <button className="primaryAction" disabled={isBusy} onClick={handleDiagnosticFix}>
                  <RefreshCw size={16} />
                  {tr("fixWithDiagnostics")}
                </button>
              ) : null}
              {!hasPendingRevision && !hasRenderedViews && !hasDiagnosticFix ? (
                <button className="primaryAction" disabled={isBusy} onClick={handleGenerate}>
                  <Send size={16} />
                  {tr("generate")}
                </button>
              ) : null}
              {!hasPendingRevision && !hasRenderedViews && project.currentCode.trim() ? (
                <button className="secondaryAction" disabled={isBusy} onClick={handleCompile}>
                  <Play size={16} />
                  {tr("rerender")}
                </button>
              ) : null}
              {!hasPendingRevision && hasRenderedViews && !project.review ? (
                <>
                  <button className="primaryAction" disabled={isBusy} onClick={handleReview}>
                    <Eye size={16} />
                    {tr("review")}
                  </button>
                  <button className="secondaryAction" disabled={isBusy} onClick={handleCompile}>
                    <Play size={16} />
                    {tr("rerender")}
                  </button>
                  <button
                    className="secondaryAction"
                    disabled={isBusy}
                    onClick={handleHighPrecisionExport}
                  >
                    <Download size={16} />
                    {tr("finalExport")}
                  </button>
                </>
              ) : null}
              {!hasPendingRevision && hasCurrentReview ? (
                <>
                  <button className="primaryAction" disabled={isBusy} onClick={handleIterateAgain}>
                    <RefreshCw size={16} />
                    {tr("iterateAgain")}
                  </button>
                  <button className="secondaryAction" disabled={isBusy} onClick={handleCompile}>
                    <Play size={16} />
                    {tr("rerender")}
                  </button>
                  <button
                    className="secondaryAction"
                    disabled={isBusy}
                    onClick={handleHighPrecisionExport}
                  >
                    <Download size={16} />
                    {tr("finalExport")}
                  </button>
                </>
              ) : null}
            </div>
          </section>

          <details className="codeDisclosure" open={autoRunActive ? true : undefined}>
            <summary>
              <span>
                <Code2 size={17} />
                {tr("codeDetails")}
              </span>
              <small>{tr("draftPrecision")}</small>
            </summary>
            <textarea
              className="codeEditor"
              disabled={busy === "draftingReference"}
              spellCheck={false}
              value={project.currentCode}
              onChange={(event) => handleCodeEdit(event.target.value)}
            />
          </details>

          {project.proposedCode ? (
            <div className="revisionArea revisionCard">
              <div className="panelHeader compact">
                <h2>{tr("proposedRevision")}</h2>
                <div className="inlineActions">
                  <button
                    className="smallButton success"
                    disabled={isBusy || controlsLocked}
                    onClick={handleAcceptRevision}
                  >
                    <Check size={15} />
                    {tr("accept")}
                  </button>
                  <button
                    className="smallButton"
                    disabled={isBusy || controlsLocked}
                    onClick={() => setProject((current) => rejectRevision(current))}
                  >
                    <X size={15} />
                    {tr("reject")}
                  </button>
                </div>
              </div>
              <p>
                {project.review
                  ? `${tr("visualReview")}: ${project.review.summary}`
                  : tr("generatedCode")}
              </p>
              <p className="pendingRevisionNotice">{tr("pendingRevisionNotice")}</p>
              {project.review?.issues.length ? (
                <ul>
                  {project.review.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}
              <details className="codeDisclosure revisionCodeDisclosure">
                <summary>
                  <span>
                    <Code2 size={17} />
                    {tr("codeDetails")}
                  </span>
                  <small>{tr("proposedRevision")}</small>
                </summary>
                <textarea
                  className="codeEditor proposed"
                  disabled={busy === "draftingReference"}
                  spellCheck={false}
                  value={project.proposedCode}
                  onChange={(event) => updateProject({ proposedCode: event.target.value })}
                />
              </details>
            </div>
          ) : null}
        </section>

        <aside className="panel resultPanel">
          <div className="panelHeader">
            <h2>{tr("views")}</h2>
          </div>
          <InteractiveStlPreview
            label={tr("interactiveStlPreview")}
            stl={project.stl}
          />
          <div className="viewGrid">
            {VIEW_KEYS.map((key) => (
              <ViewImage key={key} label={tr(VIEW_LABEL_KEYS[key])} src={project.views[key]} />
            ))}
          </div>

          {hasRenderedViews || project.stl || project.currentCode.trim() ? (
            <section className="renderAssetPanel" aria-label={tr("renderOutputs")}>
              <span>{tr("renderOutputs")}</span>
              <div className="renderAssetActions">
                <button
                  disabled={!project.currentCode.trim()}
                  onClick={() =>
                    downloadText(
                      "ai-openscad-source.scad",
                      project.currentCode,
                      "text/plain;charset=utf-8"
                    )
                  }
                  type="button"
                >
                  <Download size={14} />
                  <span>{tr("downloadSourceScad")}</span>
                </button>
                {VIEW_KEYS.map((key) => (
                  <button
                    key={key}
                    disabled={!project.views[key]}
                    onClick={() =>
                      downloadDataUrl(
                        `ai-openscad-${VIEW_FILE_STEMS[key]}.png`,
                        project.views[key]
                      )
                    }
                    type="button"
                  >
                    <Download size={14} />
                    <span>{tr(VIEW_DOWNLOAD_KEYS[key])}</span>
                  </button>
                ))}
                <button
                  disabled={!project.stl || !hasRenderedViews}
                  onClick={() =>
                    downloadText("ai-openscad-model.stl", project.stl, "model/stl;charset=utf-8")
                  }
                  type="button"
                >
                  <Download size={14} />
                  <span>{tr("downloadStl")}</span>
                </button>
              </div>
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function ApiKeyHint(props: { locale: Locale }) {
  return (
    <span className="keyHelp">
      <button
        aria-label={t(props.locale, "noApiKey")}
        className="keyHelpButton"
        type="button"
      >
        {t(props.locale, "noApiKey")}
      </button>
      <span className="keyHelpTooltip" role="tooltip">
        <strong>{t(props.locale, "inviteTitle")}</strong>
        <span>{t(props.locale, "inviteDescription")}</span>
        <img
          alt={t(props.locale, "inviteQrAlt")}
          src="/mimo-invite-QRU857.png"
        />
        <span className="inviteCodeLine">
          {t(props.locale, "inviteCodeLabel")}
          <b>QRU857</b>
        </span>
        <span>{t(props.locale, "inviteInstruction")}</span>
      </span>
    </span>
  );
}

function ModelPicker(props: {
  label: string;
  models: ModelPreset[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="fieldGroup">
      <span>{props.label}</span>
      <div className="segmentedControl" role="group" aria-label={props.label}>
        {props.models.map((model) => (
          <button
            aria-pressed={model.id === props.value}
            disabled={props.disabled}
            key={model.id}
            onClick={() => props.onChange(model.id)}
            type="button"
          >
            {model.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkflowStageStrip(props: {
  locale: Locale;
  stages: Array<{ id: WorkflowStage; state: WorkflowStageState }>;
}) {
  const labelKeys: Record<WorkflowStage, MessageKey> = {
    code: "stageCode",
    render: "stageRender",
    review: "stageReview"
  };
  return (
    <ol className="workflowStageStrip arrowPipeline" aria-label={t(props.locale, "workflowStages")}>
      {props.stages.map((stage) => (
        <li
          className={`workflowStage ${stage.state}`}
          data-stage={stage.id}
          data-state={stage.state}
          key={stage.id}
        >
          <span className="workflowStageName">{t(props.locale, labelKeys[stage.id])}</span>
          <span className="workflowStageState">
            {workflowStageStateLabel(props.locale, stage.state)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function AgentRunPanel(props: {
  busy: BusyState;
  compilerOutput: string;
  error: string;
  locale: Locale;
  pendingRevision: boolean;
  project: ProjectState;
}) {
  const [openCodeEvents, setOpenCodeEvents] = useState<Record<string, boolean>>({});
  const events = props.project.runEvents;
  return (
    <section className="agentRun" aria-live="polite">
      <div className="panelHeader">
        <h2>{t(props.locale, "agentRun")}</h2>
        <span>
          {props.busy === "idle"
            ? props.pendingRevision
              ? t(props.locale, "revisionPending")
              : t(props.locale, "ready")
            : busyStatusLabel(props.locale, props.busy)}
        </span>
      </div>
      <div className="agentTimeline">
        {props.error ? (
          <article className="agentEvent agentError" role="alert">
            <h3>{t(props.locale, "workflowError")}</h3>
            <p>{props.error}</p>
          </article>
        ) : null}

        {events.map((event) => {
          const codeOpen = Boolean(openCodeEvents[event.id]);
          const eventReview =
            event.title === t(props.locale, "visualReview")
              ? event.review ?? props.project.review
              : null;
          const showEventContent =
            Boolean(event.content) &&
            event.title !== t(props.locale, "correctionPrompt") &&
            event.content !== event.title &&
            (!event.content.startsWith(event.title) ||
              event.title === t(props.locale, "autoRunRollbackTitle"));
          return (
            <article
              className={`agentEvent chatEvent ${event.role} ${event.status}`}
              data-role={event.role}
              data-status={event.status}
              key={event.id}
            >
              <h3>{event.title}</h3>
              {showEventContent ? <p>{event.content}</p> : null}
              {eventReview ? (
                <>
                  <ul>
                    {eventReview.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                  <p className="confidence">
                    {t(props.locale, "confidence")}{" "}
                    {formatConfidencePercent(eventReview.confidence)}
                  </p>
                </>
              ) : null}
              {event.title === t(props.locale, "correctionPrompt") ? (
                <div className="correctionPromptPreview">
                  <span>{t(props.locale, "correctionPrompt")}</span>
                  <p>{event.content}</p>
                </div>
              ) : null}
              {event.code && event.status === "active" ? (
                <pre className="agentCodePreview liveCodePreview">{event.code}</pre>
              ) : null}
              {event.code && event.status !== "active" ? (
                <details
                  className="chatCodeDisclosure"
                  open={codeOpen}
                  onToggle={(toggleEvent) => {
                    const open = (toggleEvent.currentTarget as HTMLDetailsElement).open;
                    setOpenCodeEvents((current) => ({
                      ...current,
                      [event.id]: open
                    }));
                  }}
                >
                  <summary role="button" aria-expanded={codeOpen}>
                    <span>
                      <Code2 size={17} />
                      {t(props.locale, "openscad")}
                    </span>
                    <small>{t(props.locale, "codeCollapsed")}</small>
                  </summary>
                  {codeOpen ? <pre className="agentCodePreview">{event.code}</pre> : null}
                </details>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function busyStatusLabel(locale: Locale, busy: Exclude<BusyState, "idle">): string {
  const keys: Record<Exclude<BusyState, "idle">, MessageKey> = {
    draftingReference: "busyDraftingReference",
    generating: "busyGenerating",
    compiling: "busyCompiling",
    reviewing: "busyReviewing",
    exporting: "busyExporting"
  };
  return t(locale, keys[busy]);
}

function workflowStageForBusy(busy: BusyState): WorkflowStage {
  if (busy === "generating" || busy === "draftingReference") {
    return "code";
  }
  if (busy === "reviewing") {
    return "review";
  }
  return "render";
}

function workflowStageStateLabel(locale: Locale, state: WorkflowStageState): string {
  const keys: Record<WorkflowStageState, MessageKey> = {
    waiting: "stageWaiting",
    active: "stageActive",
    complete: "stageComplete",
    error: "stageError"
  };
  return t(locale, keys[state]);
}

function buildWorkflowStages(args: {
  busy: BusyState;
  errorStage: WorkflowStage | "";
  hasCode: boolean;
  hasRenderedViews: boolean;
  hasReview: boolean;
}): Array<{ id: WorkflowStage; state: WorkflowStageState }> {
  const activeStage = args.busy === "idle" ? "" : workflowStageForBusy(args.busy);
  return [
    {
      id: "code",
      state: workflowStageState("code", args.errorStage, activeStage, args.hasCode)
    },
    {
      id: "render",
      state: workflowStageState("render", args.errorStage, activeStage, args.hasRenderedViews)
    },
    {
      id: "review",
      state: workflowStageState("review", args.errorStage, activeStage, args.hasReview)
    }
  ];
}

function workflowStageState(
  stage: WorkflowStage,
  errorStage: WorkflowStage | "",
  activeStage: WorkflowStage | "",
  complete: boolean
): WorkflowStageState {
  if (errorStage === stage) {
    return "error";
  }
  if (activeStage === stage) {
    return "active";
  }
  return complete ? "complete" : "waiting";
}

function projectTitle(project: ProjectState, fallback: string): string {
  const requirement = project.requirement.trim();
  if (!requirement) {
    return fallback;
  }
  return requirement.length > 28 ? `${requirement.slice(0, 28)}...` : requirement;
}

function ViewImage(props: { label: string; src: string }) {
  return (
    <figure className="viewTile">
      {props.src ? <img alt={props.label} src={props.src} /> : <div />}
      <figcaption>{props.label}</figcaption>
    </figure>
  );
}

function renderMcpStageMessageKey(stage: RenderMcpStage): MessageKey {
  const keys: Record<RenderMcpStage, MessageKey> = {
    compile: "renderCompiling",
    front: "renderFront",
    back: "renderBack",
    left: "renderLeft",
    right: "renderRight",
    top: "renderTop",
    bottom: "renderBottom",
    isoFrontRightTop: "renderIsoFrontRightTop",
    isoFrontLeftTop: "renderIsoFrontLeftTop",
    isoBackRightTop: "renderIsoBackRightTop",
    isoBackLeftTop: "renderIsoBackLeftTop",
    isoFrontRightBottom: "renderIsoFrontRightBottom",
    isoFrontLeftBottom: "renderIsoFrontLeftBottom",
    isoBackRightBottom: "renderIsoBackRightBottom",
    isoBackLeftBottom: "renderIsoBackLeftBottom"
  };
  return keys[stage];
}

function downloadDataUrl(filename: string, dataUrl: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTimeout(resolve, 120));
      });
      return;
    }
    setTimeout(resolve, 120);
  });
}
