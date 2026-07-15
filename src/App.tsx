import {
  Code2,
  Download,
  ExternalLink,
  Eye,
  FileUp,
  KeyRound,
  Play,
  RefreshCw,
  Send,
  WandSparkles
} from "lucide-react";
import {
  ChangeEvent,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { PrintabilityPanel } from "./PrintabilityPanel";
import {
  describeReferenceImages,
  generateOpenScad,
  optimizePrompt,
  proposeRevision,
  reviewViews
} from "./lib/apiClient";
import type { SliceDiagnostics } from "./lib/openscadSkills";
import {
  captureSliceStageViews,
  downloadText
} from "./lib/capture";
import {
  describeSupportLocations,
  findSliceProgressStages,
  parseGcodeToolpath,
  type GcodeToolpath
} from "./lib/gcodeParse";
import { formatMessage, getBrowserLocale, t, type Locale, type MessageKey } from "./lib/i18n";
import {
  CODE_MODEL_PRESETS,
  getModelPreset,
  VISION_MODEL_PRESETS,
  type ModelPreset
} from "./lib/models";
import { createPromptTraceEntry } from "./lib/promptTrace";
import {
  promptFieldLabels,
  promptFieldsToText,
  type PromptFieldArrayKey,
  type PromptFields
} from "./lib/promptFields";
import {
  createEmptyProject,
  exportProject,
  importProject,
  loadLlmApiKey,
  loadProjectWorkspace,
  loadVisionApiKey,
  savePreferredCodeModel,
  savePreferredVisionModel,
  saveLlmApiKey,
  saveProject,
  saveVisionApiKey,
  upsertProjectList,
  type ProjectState,
  type PromptTraceEntry,
  type RenderEvidence,
  type RunEvent,
  type RunEventKind,
  type RunEventRole,
  type RunEventStatus,
  type SliceMetadata,
  type SliceStageViews
} from "./lib/project";
import { sliceStlForPrintability } from "./lib/slice";
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
type BusyState =
  | "idle"
  | "draftingReference"
  | "optimizingPrompt"
  | "generating"
  | "compiling"
  | "reviewing"
  | "slicing"
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
  sliceMetadata: SliceMetadata | null;
  sliceStageViews: SliceStageViews | null;
  sliceToolpath: GcodeToolpath | null;
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
  sliceMetadata: SliceMetadata | null;
  sliceStageViews: SliceStageViews | null;
  sliceToolpath: GcodeToolpath | null;
  // Unlike project.sliceMetadata/sliceStageViews (persisted to
  // localStorage), this checkpoint only ever lives in memory for the
  // duration of one auto-run loop, so the size concern that keeps raw
  // G-code out of persisted state doesn't apply here — restored on
  // rollback purely so the UI (toolpath viewer/download button) matches
  // the restored code; the review logic itself uses sliceToolpath above.
  sliceGcodeText: string | null;
};
type PromptFieldDraft = {
  fields: PromptFields;
  language: Locale;
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

class StaleTextStreamError extends Error {
  constructor() {
    super("Stale text stream was ignored.");
  }
}

interface TextStreamIdentity {
  token: number;
  projectId: string;
  eventId: string;
  submittedRequirement: string;
}

interface WorkflowIdentity {
  token: number;
  projectId: string;
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

function addUnsafeRenderDiagnosticsGuidance(diagnostics: string, guidance: string): string {
  if (!hasUnsafeRenderDiagnostics(diagnostics)) {
    return diagnostics;
  }
  return `${diagnostics}\n${guidance}`;
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
  const [promptFieldDraft, setPromptFieldDraft] = useState<PromptFieldDraft | null>(null);
  // The raw G-code/toolpath is ephemeral (not persisted to localStorage,
  // unlike project.sliceMetadata): a real print's G-code can be ~20x
  // larger than its STL, which risks blowing the localStorage quota.
  // Re-slicing is cheap (it reruns automatically on every render), so
  // this is simply cleared whenever the STL changes.
  const [sliceGcodeText, setSliceGcodeText] = useState<string | null>(null);
  // Long-running async loops (the auto-confidence loop) are kicked off from
  // one render's closure and keep executing across many subsequent state
  // updates; reading `sliceGcodeText` directly inside them would see a
  // stale snapshot from whenever the loop started, the same reason
  // `projectRef` exists below instead of reading `project` directly.
  const sliceGcodeTextRef = useRef(sliceGcodeText);
  const busyRef = useRef<BusyState>("idle");
  const operationTokenRef = useRef(0);
  const workflowTokenRef = useRef(0);
  const textStreamTokenRef = useRef(0);
  const referenceDraftTokenRef = useRef(0);
  const referenceDraftFingerprintRef = useRef("");
  const promptOptimizationTokenRef = useRef(0);
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
  const sliceToolpath = useMemo<GcodeToolpath | null>(() => {
    if (!sliceGcodeText) {
      return null;
    }
    try {
      return parseGcodeToolpath(sliceGcodeText);
    } catch {
      return null;
    }
  }, [sliceGcodeText]);
  const hasReviewReadyModel = Boolean(
    project.currentCode.trim() && hasRenderedViews && !hasCurrentReview
  );
  const canUseCodeModelForPrompt = canUseCodeModel(project.codeModelId, llmApiKey);
  const canUseCodeModelForRepair = canUseCodeModel(project.codeModelId, llmApiKey);
  const hasDiagnosticFix = Boolean(
    project.currentCode.trim() &&
      !hasRenderedViews &&
      !hasCurrentReview &&
      project.renderEvidence?.compileStatus === "failure" &&
      project.renderEvidence.repairable !== false &&
      canUseCodeModelForRepair
  );
  const compilerOutputForDisplay = renderStatus || project.compilerOutput;
  const workflowStages = buildWorkflowStages({
    busy,
    errorStage,
    hasCode: Boolean(project.currentCode.trim()),
    hasRenderedViews,
    hasReview: hasCurrentReview
  });
  const canUseVisionModelForDraft =
    getModelPreset(project.visionModelId, "vision").provider === "mimo" ||
    Boolean(visionApiKey.trim());
  const referenceControlsDisabled = controlsLocked || !canUseVisionModelForDraft;
  const describeReferenceDisabled = referenceControlsDisabled;
  const showPromptOptimizeAction = !hasDiagnosticFix && !hasReviewReadyModel;
  const optimizePromptDisabled =
    controlsLocked ||
    hasDiagnosticFix ||
    hasReviewReadyModel ||
    !project.requirement.trim() ||
    !canUseCodeModelForPrompt;
  const showGenerateAction =
    !hasDiagnosticFix &&
    (!hasRenderedViews || !project.currentCode.trim() || busy === "optimizingPrompt");

  function addDraftRenderTimeoutGuidance(diagnostics: string): string {
    if (!diagnostics.includes("OpenSCAD render timed out")) {
      return diagnostics;
    }
    return `${diagnostics} ${tr("draftTimeoutGuidance")}`;
  }

  function addFinalExportTimeoutGuidance(diagnostics: string): string {
    if (!diagnostics.includes("OpenSCAD render timed out")) {
      return diagnostics;
    }
    return `${diagnostics} ${tr("finalTimeoutGuidance")}`;
  }

  function addIncompleteViewGuidance(
    diagnostics: string,
    result: { ok: boolean; stl?: string; views?: ProjectState["views"] },
    viewCount: number
  ): string {
    if (!result.ok || !result.stl || !result.views || viewCount === VIEW_KEYS.length) {
      return diagnostics;
    }
    return `${diagnostics}\n${formatMessage(tr("viewsIncompleteGuidance"), {
      count: viewCount,
      total: VIEW_KEYS.length
    })}`;
  }

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    sliceGcodeTextRef.current = sliceGcodeText;
  }, [sliceGcodeText]);

  useEffect(() => {
    setSliceGcodeText(null);
  }, [project.id, project.stl]);

  // Persisting the workspace serializes every stored project; doing that per
  // streamed token freezes the UI, so writes are throttled with a trailing
  // flush and a flush on page hide.
  const SAVE_THROTTLE_MS = 300;
  const lastSaveAtRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<ProjectState | null>(null);
  const flushPendingSaveRef = useRef(() => {});
  flushPendingSaveRef.current = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (pending) {
      pendingSaveRef.current = null;
      lastSaveAtRef.current = Date.now();
      saveProject(pending);
    }
  };

  useEffect(() => {
    pendingSaveRef.current = project;
    const elapsed = Date.now() - lastSaveAtRef.current;
    // Idle edits persist immediately; only busy workflows (which stream many
    // state updates per second) are throttled.
    if (busyRef.current === "idle" || elapsed >= SAVE_THROTTLE_MS) {
      flushPendingSaveRef.current();
    } else if (!saveTimerRef.current) {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        flushPendingSaveRef.current();
      }, SAVE_THROTTLE_MS - elapsed);
    }
    setProjectList((current) => upsertProjectList(current, project));
  }, [project]);

  useEffect(() => {
    const flush = () => flushPendingSaveRef.current();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  // Streamed tokens arrive only while busy; once the workbench settles the
  // latest state must be durable immediately.
  useEffect(() => {
    if (busy === "idle") {
      flushPendingSaveRef.current();
    }
  }, [busy]);

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

  function clearPromptFieldDraft() {
    setPromptFieldDraft(null);
  }

  function updatePromptFieldDraft(
    updater: (fields: PromptFields) => PromptFields
  ) {
    if (!promptFieldDraft) {
      return;
    }
    const nextDraft = {
      ...promptFieldDraft,
      fields: updater(promptFieldDraft.fields)
    };
    const prompt = promptFieldsToText(nextDraft.fields, nextDraft.language);
    setPromptFieldDraft(nextDraft);
    setProject((activeProject) => {
      const nextProject = {
        ...activeProject,
        requirement: prompt,
        updatedAt: new Date().toISOString()
      };
      projectRef.current = nextProject;
      return nextProject;
    });
  }

  function updatePromptStringField(
    field: "objectTarget" | "useCase",
    value: string
  ) {
    updatePromptFieldDraft((fields) => ({
      ...fields,
      [field]: value
    }));
  }

  function updatePromptArrayField(
    field: PromptFieldArrayKey,
    index: number,
    value: string
  ) {
    updatePromptFieldDraft((fields) => {
      const values = [...fields[field]];
      values[index] = value;
      return {
        ...fields,
        [field]: values
      };
    });
  }

  function handleRequirementInput(value: string) {
    clearPromptFieldDraft();
    updateProject({ requirement: value });
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

  function cancelTextStreams() {
    textStreamTokenRef.current += 1;
  }

  function cancelWorkflows() {
    workflowTokenRef.current += 1;
    cancelTextStreams();
  }

  function beginWorkflow(projectId: string): WorkflowIdentity {
    const token = workflowTokenRef.current + 1;
    workflowTokenRef.current = token;
    return { token, projectId };
  }

  function workflowIsCurrent(identity: WorkflowIdentity, current = projectRef.current) {
    return workflowTokenRef.current === identity.token && current.id === identity.projectId;
  }

  function ensureWorkflowCurrent(identity?: WorkflowIdentity) {
    if (identity && !workflowIsCurrent(identity)) {
      throw new StaleTextStreamError();
    }
  }

  function beginTextStream(input: {
    projectId: string;
    eventId: string;
    submittedRequirement: string;
  }): TextStreamIdentity {
    const token = textStreamTokenRef.current + 1;
    textStreamTokenRef.current = token;
    return {
      token,
      projectId: input.projectId,
      eventId: input.eventId,
      submittedRequirement: input.submittedRequirement
    };
  }

  function textStreamIsCurrent(identity: TextStreamIdentity, current = projectRef.current) {
    return (
      textStreamTokenRef.current === identity.token &&
      current.id === identity.projectId &&
      current.runEvents.some((event) => event.id === identity.eventId)
    );
  }

  function ensureTextStreamCurrent(identity: TextStreamIdentity) {
    if (!textStreamIsCurrent(identity)) {
      throw new StaleTextStreamError();
    }
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
    kind?: RunEventKind;
    code?: string;
    thinking?: string;
    thinkingCollapsed?: boolean;
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
      kind: input.kind,
      code: input.code,
      thinking: input.thinking,
      thinkingCollapsed: input.thinkingCollapsed,
      review: input.review
    };
  }

  function updateRunEventThinking(identity: TextStreamIdentity, thinking: string) {
    setProject((current) => {
      if (!textStreamIsCurrent(identity, current)) {
        return current;
      }
      return {
        ...current,
        runEvents: current.runEvents.map((event) =>
          event.id === identity.eventId
            ? { ...event, thinking, thinkingCollapsed: false }
            : event
        ),
        updatedAt: new Date().toISOString()
      };
    });
  }

  function collapseRunEventThinking(event: RunEvent) {
    return event.thinking ? { ...event, thinkingCollapsed: true } : event;
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
      review: null,
      sliceMetadata: null,
      sliceStageViews: null,
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
      if (caught instanceof AutoRunCanceledError || caught instanceof StaleTextStreamError) {
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
    clearPromptFieldDraft();
    await runSafely("draftingReference", async () => {
      requireVisionApiKey();
      const imagesAtStart = await buildReferenceImagesFromFiles(files);
      if (!imagesAtStart.length) {
        return;
      }
      const activeProject = projectRef.current;
      const failureRetentionMessage = activeProject.referenceImages.length
        ? tr("referenceImagesNotRetainedPreviousRemain")
        : tr("referenceImagesNotRetained");
      const baselineRequirement = activeProject.requirement;
      const activeProjectId = activeProject.id;
      const imageSetFingerprint = referenceImageFingerprint(imagesAtStart);
      const requestToken = referenceDraftTokenRef.current + 1;
      referenceDraftTokenRef.current = requestToken;
      referenceDraftFingerprintRef.current = imageSetFingerprint;
      try {
        const { fields, language, prompt, trace } = await describeReferenceImages({
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
        setPromptFieldDraft({ fields, language });
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
            compilerOutput: "",
            renderEvidence: null,
            review: null,
            sliceMetadata: null,
            sliceStageViews: null,
            stl: "",
            views: emptyViews(),
            referenceImages: imagesAtStart.map((image) => image.dataUrl),
            runEvents: [
              ...current.runEvents,
              createRunEvent({
                role: "assistant",
                title: tr("referencePromptDrafted"),
                content: prompt,
                status: "complete"
              }),
              createRunEvent({
                role: "tool",
                title: tr("referenceImagesRetained"),
                content: tr("referenceImagesRetained"),
                status: "complete"
              })
            ],
            promptTrace: [...current.promptTrace, trace],
            updatedAt: new Date().toISOString()
          };
          projectRef.current = next;
          return next;
        });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        throw new Error(`${message}\n${failureRetentionMessage}`);
      } finally {
        if (referenceDraftTokenRef.current === requestToken) {
          referenceDraftFingerprintRef.current = "";
        }
      }
    });
  }

  async function handleOptimizePrompt() {
    if (optimizePromptDisabled) {
      return;
    }
    clearPromptFieldDraft();
    await runSafely("optimizingPrompt", async () => {
      requireLlmApiKey();
      const activeProject = projectRef.current;
      if (!activeProject.requirement.trim()) {
        throw new Error(tr("missingRequirement"));
      }
      if (
        activeProject.currentCode.trim() &&
        hasCleanRenderedViews(activeProject) &&
        !activeProject.review
      ) {
        return;
      }
      const baselineRequirement = activeProject.requirement;
      const activeProjectId = activeProject.id;
      const requestToken = promptOptimizationTokenRef.current + 1;
      promptOptimizationTokenRef.current = requestToken;
      const { fields, language, prompt, trace } = await optimizePrompt({
        apiKey: llmApiKey,
        modelId: activeProject.codeModelId,
        requirement: baselineRequirement
      });
      const editorValue = requirementInputRef.current?.value ?? projectRef.current.requirement;
      const stillCurrent =
        projectRef.current.id === activeProjectId &&
        projectRef.current.requirement === baselineRequirement &&
        editorValue === baselineRequirement &&
        promptOptimizationTokenRef.current === requestToken;
      if (!stillCurrent) {
        return;
      }
      setPromptFieldDraft({ fields, language });
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
          compilerOutput: "",
          renderEvidence: null,
          review: null,
          sliceMetadata: null,
          sliceStageViews: null,
          stl: "",
          views: emptyViews(),
          runEvents: [
            ...current.runEvents,
            createRunEvent({
              role: "assistant",
              title: tr("promptOptimized"),
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
    });
  }

  async function handleGenerate() {
    clearPromptFieldDraft();
    const shouldAutoRun = autoIterationLimitRef.current > 0;
    const autoRunToken = shouldAutoRun ? beginAutoRun() : 0;
    await runSafely("generating", async () => {
      requireLlmApiKey();
      const activeProject = projectRef.current;
      if (!activeProject.requirement.trim()) {
        throw new Error(tr("missingRequirement"));
      }
      const originalRequirement = activeProject.requirement.trim();
      const workflow = beginWorkflow(activeProject.id);
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
      const textStream = beginTextStream({
        projectId: activeProject.id,
        eventId: codeEventId,
        submittedRequirement: originalRequirement
      });
      setProject((current) =>
        current.id === activeProject.id
          ? {
              ...current,
              requirement: "",
              originalRequirement,
              currentCode: "",
              review: null,
              sliceMetadata: null,
              sliceStageViews: null,
              stl: "",
              views: emptyViews(),
              renderEvidence: null,
              compilerOutput: tr("streamingCode"),
              runEvents: [userEvent, codeEvent]
            }
          : current
      );
      let generated: Awaited<ReturnType<typeof generateOpenScad>>;
      try {
        generated = await generateOpenScad({
          apiKey: llmApiKey,
          modelId: activeProject.codeModelId,
          requirement: originalRequirement,
          precision: "draft",
          onToken: (streamedCode) => {
            if (shouldAutoRun && autoRunTokenRef.current !== autoRunToken) {
              return;
            }
            setProject((current) => ({
              ...(workflowIsCurrent(workflow, current) && textStreamIsCurrent(textStream, current)
                ? {
                    ...current,
                    currentCode: streamedCode,
                    compilerOutput: tr("streamingCode"),
                    runEvents: current.runEvents.map((event) =>
                      event.id === codeEventId ? { ...event, code: streamedCode } : event
                    )
                  }
                : current)
            }));
          },
          onThinkingToken: (thinking) => updateRunEventThinking(textStream, thinking)
        });
      } catch (caught) {
        if (!workflowIsCurrent(workflow) || !textStreamIsCurrent(textStream)) {
          throw new StaleTextStreamError();
        }
        // The composer was cleared when the request started; put the prompt
        // back so a failed generation can be retried without retyping.
        setProject((current) =>
          workflowIsCurrent(workflow, current) && !current.requirement.trim()
            ? { ...current, requirement: originalRequirement, updatedAt: new Date().toISOString() }
            : current
        );
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        throw caught;
      }
      const { code, trace } = generated;
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      ensureTextStreamCurrent(textStream);
      ensureWorkflowCurrent(workflow);
      setProject((current) => ({
        ...(workflowIsCurrent(workflow, current) && textStreamIsCurrent(textStream, current)
          ? {
              ...current,
              currentCode: code,
              review: null,
              sliceMetadata: null,
              sliceStageViews: null,
              stl: "",
              views: emptyViews(),
              renderEvidence: null,
              compilerOutput: tr("renderingDraft"),
              runEvents: current.runEvents.map((event) =>
                event.id === codeEventId
                  ? collapseRunEventThinking({
                      ...event,
                      content: "",
                      code,
                      status: "complete"
                    })
                  : event
              ),
              promptTrace: [...current.promptTrace, trace],
              updatedAt: new Date().toISOString(),
              iterations: [
                ...current.iterations,
                {
                  id: crypto.randomUUID(),
                  createdAt: new Date().toISOString(),
                  requirement: originalRequirement,
                  code,
                  modelId: current.codeModelId,
                  status: "generated"
                }
              ]
            }
          : current)
      }));
      ensureWorkflowCurrent(workflow);
      updateBusy("compiling");
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      let finalCode = code;
      let rendered = await compileDraftCode(
        code,
        shouldAutoRun ? autoRunToken : undefined,
        workflow
      );
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      ensureWorkflowCurrent(workflow);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code,
          rendered,
          originalRequirement,
          sourceCodeEventId: codeEventId,
          autoRunToken: shouldAutoRun ? autoRunToken : undefined,
          workflow
        });
        finalCode = repaired.code;
        rendered = repaired.rendered;
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        ensureWorkflowCurrent(workflow);
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        ensureWorkflowCurrent(workflow);
        setProject((current) => ({
          ...(workflowIsCurrent(workflow, current)
            ? {
                ...current,
                ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
                promptTrace: [...current.promptTrace, rendered.trace],
                updatedAt: new Date().toISOString()
              }
            : current)
        }));
        if (shouldAutoRun) {
          ensureWorkflowCurrent(workflow);
          appendRunEvent(autoRunStopEvent(tr("autoRunCompileStopped")));
        }
        throw new Error(rendered.diagnostics);
      }
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      ensureWorkflowCurrent(workflow);
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderFinished"),
        content: `${rendered.diagnostics}\n${tr("compiledDraft")}`
      }));
      setProject((current) => ({
        ...(workflowIsCurrent(workflow, current)
          ? {
              ...current,
              currentCode: finalCode,
              review: null,
              sliceMetadata: rendered.sliceMetadata,
              sliceStageViews: rendered.sliceStageViews,
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
                  requirement: originalRequirement,
                  code: finalCode,
                  modelId: current.codeModelId,
                  status: "compiled"
                }
              ]
            }
          : current)
      }));
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
        await runBoundedConfidenceLoop({
          autoRunToken,
          originalRequirement,
          code: finalCode,
          views: rendered.views,
          stl: rendered.stl,
          renderEvidence: rendered.evidence,
          sliceMetadata: rendered.sliceMetadata,
          sliceStageViews: rendered.sliceStageViews,
          sliceToolpath: rendered.sliceToolpath
        });
      }
    });
  }

  async function handleCompile() {
    await runSafely("compiling", async () => {
      if (!project.currentCode.trim()) {
        throw new Error(tr("missingCode"));
      }
      const workflow = beginWorkflow(projectRef.current.id);
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      const originalRequirement = originalRequirementFor(project);
      let finalCode = project.currentCode;
      let rendered = await compileDraftCode(project.currentCode, undefined, workflow);
      ensureWorkflowCurrent(workflow);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code: project.currentCode,
          rendered,
          originalRequirement,
          workflow
        });
        finalCode = repaired.code;
        rendered = repaired.rendered;
        ensureWorkflowCurrent(workflow);
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        ensureWorkflowCurrent(workflow);
        setProject((current) => ({
          ...(workflowIsCurrent(workflow, current)
            ? {
                ...current,
                ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
                promptTrace: [...current.promptTrace, rendered.trace],
                updatedAt: new Date().toISOString()
              }
            : current)
        }));
        throw new Error(rendered.diagnostics);
      }
      ensureWorkflowCurrent(workflow);
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderFinished"),
        content: `${rendered.diagnostics}\n${tr("compiledDraft")}`
      }));
      setProject((current) => ({
        ...(workflowIsCurrent(workflow, current)
          ? {
              ...current,
              currentCode: finalCode,
              review: null,
              sliceMetadata: rendered.sliceMetadata,
              sliceStageViews: rendered.sliceStageViews,
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
            }
          : current)
      }));
    });
  }

  async function compileDraftCode(
    code: string,
    autoRunToken?: number,
    workflow?: WorkflowIdentity
  ): Promise<DraftCompileResult> {
    await updateRenderStatus("renderPreparing", autoRunToken, workflow);
    const draftCode = normalizeOpenScadPrecision(code, "draft");
    let result: Awaited<ReturnType<typeof adapter.render>>;
    try {
      ensureWorkflowCurrent(workflow);
      result = await adapter.render({
        source: draftCode,
        onProgress: (stage) =>
          updateRenderStatus(renderMcpStageMessageKey(stage), autoRunToken, workflow)
      });
      ensureWorkflowCurrent(workflow);
    } catch (caught) {
      if (autoRunToken !== undefined) {
        ensureAutoRunCurrent(autoRunToken);
      }
      ensureWorkflowCurrent(workflow);
      throw caught;
    }
    const viewCount = result.views ? renderedViewCount(result.views) : 0;
    const hasCompleteViews = result.views ? allViewsRendered(result.views) : false;
    const diagnostics = addDraftRenderTimeoutGuidance(
      addUnsafeRenderDiagnosticsGuidance(
        addIncompleteViewGuidance(result.diagnostics, result, viewCount),
        tr("unsafeDiagnosticsGuidance")
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
    const sliced = await sliceDraftStl(result.stl, autoRunToken, workflow);
    return {
      ok: true,
      diagnostics,
      evidence,
      trace,
      views: result.views,
      stl: result.stl,
      sliceMetadata: sliced.sliceMetadata,
      sliceStageViews: sliced.sliceStageViews,
      sliceToolpath: sliced.sliceToolpath
    };
  }

  // Slicing is folded into every draft render (fully automatic, per user
  // request) instead of being a separate manual step. A slicing failure
  // must never fail the render itself — CuraEngine is less forgiving of
  // edge-case geometry than the OpenSCAD render pipeline, and a successful
  // render should never be blocked by a slicer quirk. The raw G-code stays
  // out of DraftCompileResult (same size reasoning as project.sliceMetadata
  // not persisting it) and is stashed directly via setSliceGcodeText; the
  // rendered stage screenshots are small PNGs though (same size class as
  // the persisted mesh views), so those do travel through the result and
  // get persisted onto the project.
  async function sliceDraftStl(
    stl: string,
    autoRunToken?: number,
    workflow?: WorkflowIdentity
  ): Promise<{
    sliceMetadata: SliceMetadata | null;
    sliceStageViews: SliceStageViews | null;
    sliceToolpath: GcodeToolpath | null;
  }> {
    try {
      await updateRenderStatus("slicing", autoRunToken, workflow);
      const result = await sliceStlForPrintability(stl);
      ensureWorkflowCurrent(workflow);
      if (!result.ok) {
        setSliceGcodeText(null);
        return { sliceMetadata: null, sliceStageViews: null, sliceToolpath: null };
      }
      const gcodeText = new TextDecoder().decode(result.gcode);
      const toolpath = parseGcodeToolpath(gcodeText);
      setSliceGcodeText(gcodeText);
      const stages = findSliceProgressStages(toolpath);
      const images = captureSliceStageViews(toolpath, stages);
      return {
        sliceMetadata: {
          layerCount: result.layerCount,
          printTimeSeconds: result.printTimeSeconds,
          filamentVolumeMm3: result.filamentVolumeMm3,
          supportSegmentRatio: toolpath.supportSegmentRatio
        },
        sliceStageViews: {
          usedSupportRange: stages.usedSupportRange,
          images
        },
        // Returned directly (not read back later via a ref/state lookup) so
        // reviewRenderedDraft can use the exact toolpath that matches this
        // exact compile, instead of racing React's state-commit timing.
        sliceToolpath: toolpath
      };
    } catch {
      setSliceGcodeText(null);
      return { sliceMetadata: null, sliceStageViews: null, sliceToolpath: null };
    }
  }

  async function repairDraftCompileIfPossible(input: {
    code: string;
    rendered: DraftCompileResult;
    originalRequirement: string;
    sourceCodeEventId?: string;
    autoRunToken?: number;
    workflow?: WorkflowIdentity;
  }): Promise<{ code: string; rendered: DraftCompileResult }> {
    if (input.autoRunToken !== undefined) {
      ensureAutoRunCurrent(input.autoRunToken);
    }
    ensureWorkflowCurrent(input.workflow);
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
      ensureWorkflowCurrent(input.workflow);
      const diagnostics = rendered.diagnostics;
      const renderEvidence = rendered.evidence;
      const repairPrompt = buildDiagnosticFixPrompt(input.originalRequirement, diagnostics);
      const codeEventId = crypto.randomUUID();
      const title = formatMessage(tr("compilerRepairProgress"), {
        current: attempt,
        total: MAX_COMPILER_REPAIR_ATTEMPTS
      });
      const textStream = beginTextStream({
        projectId: projectRef.current.id,
        eventId: codeEventId,
        submittedRequirement: repairPrompt
      });

      updateBusy("generating");
      setProject((current) => ({
        ...(input.workflow && !workflowIsCurrent(input.workflow, current)
          ? current
          : {
              ...current,
              currentCode: code,
              review: null,
              sliceMetadata: null,
              sliceStageViews: null,
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
            })
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
              ...(input.workflow && !workflowIsCurrent(input.workflow, current)
                ? current
                : textStreamIsCurrent(textStream, current)
                ? {
                    ...current,
                    currentCode: streamedCode,
                    compilerOutput: tr("streamingIteration"),
                    runEvents: current.runEvents.map((event) =>
                      event.id === codeEventId ? { ...event, code: streamedCode } : event
                    )
                  }
                : current)
            }));
          },
          onThinkingToken: (thinking) => updateRunEventThinking(textStream, thinking)
        });
        if (input.autoRunToken !== undefined) {
          ensureAutoRunCurrent(input.autoRunToken);
        }
        ensureTextStreamCurrent(textStream);
        ensureWorkflowCurrent(input.workflow);
        repairedCode = proposed.code;
        trace = proposed.trace;
      } catch (caught) {
        if (caught instanceof AutoRunCanceledError) {
          throw caught;
        }
        if (caught instanceof StaleTextStreamError) {
          throw caught;
        }
        if (input.autoRunToken !== undefined) {
          ensureAutoRunCurrent(input.autoRunToken);
        }
        ensureWorkflowCurrent(input.workflow);
        const message = caught instanceof Error ? caught.message : String(caught);
        setProject((current) => ({
          ...(input.workflow && !workflowIsCurrent(input.workflow, current)
            ? current
            : {
                ...current,
                currentCode: code,
                runEvents: current.runEvents.map((event) =>
                  event.id === codeEventId
                    ? { ...event, content: message, status: "error" }
                    : event
                ),
                updatedAt: new Date().toISOString()
              })
        }));
        updateBusy("compiling");
        return { code, rendered };
      }

      code = repairedCode;
      setProject((current) => ({
        ...(input.workflow && !workflowIsCurrent(input.workflow, current)
          ? current
          : {
              ...current,
              currentCode: code,
              review: null,
              sliceMetadata: null,
              sliceStageViews: null,
              stl: "",
              views: emptyViews(),
              renderEvidence: null,
              compilerOutput: tr("renderingDraft"),
              runEvents: current.runEvents.map((event) =>
                event.id === codeEventId
                  ? collapseRunEventThinking({ ...event, content: "", code, status: "complete" })
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
            })
      }));

      updateBusy("compiling");
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      rendered = await compileDraftCode(code, input.autoRunToken, input.workflow);
      if (input.autoRunToken !== undefined) {
        ensureAutoRunCurrent(input.autoRunToken);
      }
      ensureWorkflowCurrent(input.workflow);
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
    workflow?: WorkflowIdentity;
    sliceMetadata: SliceMetadata | null;
    sliceStageViews: SliceStageViews | null;
    sliceToolpath: GcodeToolpath | null;
  }) {
    if (!allViewsRendered(input.views) || !renderEvidenceIsClean(input.renderEvidence)) {
      throw new Error(tr("compileBeforeReview"));
    }
    requireVisionApiKey();
    // If the user edits the requirement while the review runs, their text
    // must survive; only an unchanged baseline is replaced by the
    // correction prompt.
    const baselineRequirement = projectRef.current.requirement;
    const startedEventId = crypto.randomUUID();
    appendRunEvent(createRunEvent({
      id: startedEventId,
      role: "review",
      title: tr("reviewStarted"),
      content: tr("reviewStarted"),
      status: "active",
      kind: "review-started"
    }));
    // Slice diagnostics (from the automatic post-render slice) ride along
    // in the same review call instead of a separate slice-review pass, so
    // the model produces one unified correctionPrompt covering both
    // geometry and printability. The stage screenshots were already
    // captured and persisted at render time (see sliceDraftStl) — reused
    // as-is here so the images reviewed match the images shown in the
    // panel, instead of capturing a fresh (and differently framed) set.
    // These all arrive as explicit parameters (not read back via a ref or
    // `projectRef.current`) because this function is called from inside
    // the long-lived auto-confidence loop, where a ref synced only by a
    // `useEffect` can still be a render behind by the time it's read here.
    const stageViews = input.sliceStageViews;
    const toolpathImages = stageViews?.images.map((image) => image.dataUrl) ?? [];
    const sliceDiagnostics: SliceDiagnostics | null =
      input.sliceToolpath && stageViews && stageViews.images.length > 0
        ? {
            supportPercent: Math.round(input.sliceToolpath.supportSegmentRatio * 100),
            layerCount: input.sliceMetadata?.layerCount ?? null,
            locationSummaries: describeSupportLocations(input.sliceToolpath),
            usedSupportRange: stageViews.usedSupportRange,
            stageImages: stageViews.images.map((image) => ({
              stage: image.stage,
              viewKey: image.viewKey
            }))
          }
        : null;
    let reviewed: Awaited<ReturnType<typeof reviewViews>>;
    try {
      const currentProject = projectRef.current;
      reviewed = await reviewViews({
        apiKey: visionApiKey,
        modelId: currentProject.visionModelId,
        requirement: input.originalRequirement,
        code: input.code,
        renderedImages: viewImagesInOrder(input.views),
        referenceImages: currentProject.referenceImages,
        renderEvidence: input.renderEvidence,
        strictConfidence: input.strictConfidence,
        toolpathImages,
        sliceDiagnostics
      });
    } catch (caught) {
      setProject((current) => ({
        ...current,
        runEvents: current.runEvents.map((event) =>
          event.id === startedEventId ? { ...event, status: "error" as const } : event
        ),
        updatedAt: new Date().toISOString()
      }));
      if (input.autoRunToken !== undefined) {
        ensureAutoRunCurrent(input.autoRunToken);
      }
      throw caught;
    }
    const { review, trace: reviewTrace } = reviewed;
    if (input.autoRunToken !== undefined) {
      ensureAutoRunCurrent(input.autoRunToken);
    }
    ensureWorkflowCurrent(input.workflow);
    setProject((current) => {
      if (input.workflow && !workflowIsCurrent(input.workflow, current)) {
        return current;
      }
      return {
        ...current,
        originalRequirement: current.originalRequirement.trim()
          ? current.originalRequirement
          : input.originalRequirement,
        review,
        requirement:
          current.requirement === baselineRequirement
            ? review.correctionPrompt || current.requirement
            : current.requirement,
        promptTrace: [...current.promptTrace, reviewTrace],
        compilerOutput: tr("visionComplete"),
        runEvents: [
          ...current.runEvents.filter((event) => event.id !== startedEventId),
          createRunEvent({
            role: "review",
            title: tr("visionComplete"),
            content: tr("visionComplete"),
            status: "complete",
            kind: "notice"
          }),
          createRunEvent({
            role: "review",
            title: tr("visualReview"),
            content: review.summary,
            review,
            status: "complete",
            kind: "review"
          }),
          createRunEvent({
            role: "review",
            title: tr("correctionPrompt"),
            content: review.correctionPrompt,
            status: "complete",
            kind: "correction-prompt"
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
            status: "reviewed" as const,
            reviewSummary: review.summary
          }
        ]
      };
    });
    return review;
  }

  async function runBoundedConfidenceLoop(input: {
    autoRunToken: number;
    originalRequirement: string;
    code: string;
    views: ProjectState["views"];
    stl: string;
    renderEvidence: RenderEvidence;
    sliceMetadata: SliceMetadata | null;
    sliceStageViews: SliceStageViews | null;
    sliceToolpath: GcodeToolpath | null;
  }) {
    let code = input.code;
    let views = input.views;
    let stl = input.stl;
    let renderEvidence: RenderEvidence | null = input.renderEvidence;
    let sliceMetadata = input.sliceMetadata;
    let sliceStageViews = input.sliceStageViews;
    let sliceToolpath = input.sliceToolpath;
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
          autoRunToken: input.autoRunToken,
          sliceMetadata,
          sliceStageViews,
          sliceToolpath
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
        sliceMetadata = checkpoint.sliceMetadata;
        sliceStageViews = checkpoint.sliceStageViews;
        sliceToolpath = checkpoint.sliceToolpath;
        // UI-only restore (toolpath viewer/download button); the review
        // call below uses the sliceToolpath variable above directly, not
        // this state, so it isn't affected by React's commit timing.
        setSliceGcodeText(checkpoint.sliceGcodeText);
        setProject((current) => ({
          ...current,
          currentCode: checkpoint.code,
          review: checkpoint.review,
          requirement: checkpoint.review.correctionPrompt || current.requirement,
          views: checkpoint.views,
          stl: checkpoint.stl,
          renderEvidence: checkpoint.renderEvidence,
          sliceMetadata: checkpoint.sliceMetadata,
          sliceStageViews: checkpoint.sliceStageViews,
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
            autoRunToken: input.autoRunToken,
            sliceMetadata,
            sliceStageViews,
            sliceToolpath
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
        review,
        sliceMetadata,
        sliceStageViews,
        sliceToolpath,
        sliceGcodeText: sliceGcodeTextRef.current
      };
      usedAutoIterations += 1;
      const autoIterationTitle = formatMessage(tr("autoIterationProgress"), {
        current: usedAutoIterations,
        total: iterationLimit
      });
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
        review: null,
        sliceMetadata: null,
        sliceStageViews: null,
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
      const textStream = beginTextStream({
        projectId: projectRef.current.id,
        eventId: codeEventId,
        submittedRequirement: review.correctionPrompt
      });
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
              ...(textStreamIsCurrent(textStream, current)
                ? {
                    ...current,
                    currentCode: streamedCode,
                    compilerOutput: tr("streamingIteration"),
                    runEvents: current.runEvents.map((event) =>
                      event.id === codeEventId ? { ...event, code: streamedCode } : event
                    )
                  }
                : current)
            }));
          },
          onThinkingToken: (thinking) => updateRunEventThinking(textStream, thinking)
        });
      } catch (caught) {
        ensureAutoRunCurrent(input.autoRunToken);
        throw caught;
      }
      ensureAutoRunCurrent(input.autoRunToken);
      ensureTextStreamCurrent(textStream);

      code = proposed.code;
      setProject((current) => ({
        ...current,
        currentCode: code,
        review: null,
        sliceMetadata: null,
        sliceStageViews: null,
        stl: "",
        views: emptyViews(),
        renderEvidence: null,
        compilerOutput: tr("renderingDraft"),
        runEvents: current.runEvents.map((event) =>
          event.id === codeEventId
            ? collapseRunEventThinking({ ...event, content: "", code, status: "complete" })
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
        review: null,
        sliceMetadata: rendered.sliceMetadata,
        sliceStageViews: rendered.sliceStageViews,
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
      sliceMetadata = rendered.sliceMetadata;
      sliceStageViews = rendered.sliceStageViews;
      sliceToolpath = rendered.sliceToolpath;
    }
  }

  async function updateRenderStatus(
    key: MessageKey,
    autoRunToken?: number,
    workflow?: WorkflowIdentity
  ) {
    if (autoRunToken !== undefined) {
      ensureAutoRunCurrent(autoRunToken);
    }
    ensureWorkflowCurrent(workflow);
    const message = tr(key);
    setRenderStatus(message);
    setProject((current) => ({
      ...(workflow && !workflowIsCurrent(workflow, current)
        ? current
        : {
            ...current,
            compilerOutput: message,
            updatedAt: new Date().toISOString()
          })
    }));
    await waitForPaint();
  }

  async function handleReview() {
    await runSafely("reviewing", async () => {
      const originalRequirement = originalRequirementFor(project);
      const workflow = beginWorkflow(projectRef.current.id);
      await reviewRenderedDraft({
        originalRequirement,
        code: project.currentCode,
        views: project.views,
        renderEvidence: project.renderEvidence,
        strictConfidence: false,
        workflow,
        sliceMetadata: project.sliceMetadata,
        sliceStageViews: project.sliceStageViews,
        sliceToolpath
      });
    });
  }

  async function handleDiagnosticFix() {
    clearPromptFieldDraft();
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
      const workflow = beginWorkflow(projectRef.current.id);
      const textStream = beginTextStream({
        projectId: projectRef.current.id,
        eventId: codeEventId,
        submittedRequirement: fixPrompt
      });
      setProject((current) => ({
        ...current,
        currentCode: "",
        review: null,
        sliceMetadata: null,
        sliceStageViews: null,
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
      let fixed: Awaited<ReturnType<typeof proposeRevision>>;
      try {
        fixed = await proposeRevision({
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
              ...(workflowIsCurrent(workflow, current) && textStreamIsCurrent(textStream, current)
                ? {
                    ...current,
                    currentCode: streamedCode,
                    compilerOutput: tr("streamingIteration"),
                    runEvents: current.runEvents.map((event) =>
                      event.id === codeEventId ? { ...event, code: streamedCode } : event
                    )
                  }
                : current)
            }));
          },
          onThinkingToken: (thinking) => updateRunEventThinking(textStream, thinking)
        });
      } catch (caught) {
        if (!workflowIsCurrent(workflow) || !textStreamIsCurrent(textStream)) {
          throw new StaleTextStreamError();
        }
        throw caught;
      }
      const { code, trace } = fixed;
      ensureTextStreamCurrent(textStream);
      ensureWorkflowCurrent(workflow);
      setProject((current) => ({
        ...(workflowIsCurrent(workflow, current) && textStreamIsCurrent(textStream, current)
          ? {
              ...current,
              currentCode: code,
              review: null,
              sliceMetadata: null,
              sliceStageViews: null,
              views: emptyViews(),
              stl: "",
              renderEvidence: null,
              compilerOutput: tr("renderingDraft"),
              runEvents: current.runEvents.map((event) =>
                event.id === codeEventId
                  ? collapseRunEventThinking({ ...event, content: "", code, status: "complete" })
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
            }
          : current)
      }));
      ensureWorkflowCurrent(workflow);
      updateBusy("compiling");
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      let finalCode = code;
      let rendered = await compileDraftCode(code, undefined, workflow);
      ensureWorkflowCurrent(workflow);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code,
          rendered,
          originalRequirement,
          sourceCodeEventId: codeEventId,
          workflow
        });
        finalCode = repaired.code;
        rendered = repaired.rendered;
        ensureWorkflowCurrent(workflow);
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        ensureWorkflowCurrent(workflow);
        setProject((current) => ({
          ...(workflowIsCurrent(workflow, current)
            ? {
                ...current,
                ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
                promptTrace: [...current.promptTrace, rendered.trace],
                updatedAt: new Date().toISOString()
              }
            : current)
        }));
        throw new Error(rendered.diagnostics);
      }
      ensureWorkflowCurrent(workflow);
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderFinished"),
        content: `${rendered.diagnostics}\n${tr("compiledDraft")}`
      }));
      setProject((current) => ({
        ...(workflowIsCurrent(workflow, current)
          ? {
              ...current,
              currentCode: finalCode,
              review: null,
              sliceMetadata: rendered.sliceMetadata,
              sliceStageViews: rendered.sliceStageViews,
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
            }
          : current)
      }));
    });
  }

  async function handleIterateAgain() {
    clearPromptFieldDraft();
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
      const workflow = beginWorkflow(projectRef.current.id);
      const textStream = beginTextStream({
        projectId: projectRef.current.id,
        eventId: codeEventId,
        submittedRequirement: iterationPrompt
      });
      setProject((current) => ({
        ...current,
        currentCode: "",
        review: null,
        sliceMetadata: null,
        sliceStageViews: null,
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
              ...(workflowIsCurrent(workflow, current) && textStreamIsCurrent(textStream, current)
                ? {
                    ...current,
                    currentCode: streamedCode,
                    compilerOutput: tr("streamingIteration"),
                    runEvents: current.runEvents.map((event) =>
                      event.id === codeEventId ? { ...event, code: streamedCode } : event
                    )
                  }
                : current)
            }));
          },
          onThinkingToken: (thinking) => updateRunEventThinking(textStream, thinking)
        });
      } catch (caught) {
        if (!workflowIsCurrent(workflow) || !textStreamIsCurrent(textStream)) {
          throw new StaleTextStreamError();
        }
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        throw caught;
      }
      const { code, trace } = revision;
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      ensureTextStreamCurrent(textStream);
      ensureWorkflowCurrent(workflow);
      setProject((current) => ({
        ...(workflowIsCurrent(workflow, current) && textStreamIsCurrent(textStream, current)
          ? {
              ...current,
              currentCode: code,
              review: null,
              sliceMetadata: null,
              sliceStageViews: null,
              views: emptyViews(),
              stl: "",
              renderEvidence: null,
              compilerOutput: tr("renderingDraft"),
              runEvents: current.runEvents.map((event) =>
                event.id === codeEventId
                  ? collapseRunEventThinking({ ...event, content: "", code, status: "complete" })
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
            }
          : current)
      }));
      ensureWorkflowCurrent(workflow);
      updateBusy("compiling");
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderStarted"),
        content: tr("renderStarted")
      }));
      let finalCode = code;
      let rendered = await compileDraftCode(
        code,
        shouldAutoRun ? autoRunToken : undefined,
        workflow
      );
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      ensureWorkflowCurrent(workflow);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        const repaired = await repairDraftCompileIfPossible({
          code,
          rendered,
          originalRequirement,
          sourceCodeEventId: codeEventId,
          autoRunToken: shouldAutoRun ? autoRunToken : undefined,
          workflow
        });
        finalCode = repaired.code;
        rendered = repaired.rendered;
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        ensureWorkflowCurrent(workflow);
      }
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        if (shouldAutoRun) {
          ensureAutoRunCurrent(autoRunToken);
        }
        ensureWorkflowCurrent(workflow);
        setProject((current) => ({
          ...(workflowIsCurrent(workflow, current)
            ? {
                ...current,
                ...diagnosticFixPatch(current, rendered.diagnostics, rendered.evidence),
                promptTrace: [...current.promptTrace, rendered.trace],
                updatedAt: new Date().toISOString()
              }
            : current)
        }));
        if (shouldAutoRun) {
          ensureWorkflowCurrent(workflow);
          appendRunEvent(autoRunStopEvent(tr("autoRunCompileStopped")));
        }
        throw new Error(rendered.diagnostics);
      }
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
      }
      ensureWorkflowCurrent(workflow);
      appendRunEvent(createRunEvent({
        role: "tool",
        title: tr("renderFinished"),
        content: `${rendered.diagnostics}\n${tr("compiledDraft")}`
      }));
      setProject((current) => ({
        ...(workflowIsCurrent(workflow, current)
          ? {
              ...current,
              currentCode: finalCode,
              review: null,
              sliceMetadata: rendered.sliceMetadata,
              sliceStageViews: rendered.sliceStageViews,
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
            }
          : current)
      }));
      if (shouldAutoRun) {
        ensureAutoRunCurrent(autoRunToken);
        await runBoundedConfidenceLoop({
          autoRunToken,
          originalRequirement,
          code: finalCode,
          views: rendered.views,
          stl: rendered.stl,
          renderEvidence: rendered.evidence,
          sliceMetadata: rendered.sliceMetadata,
          sliceStageViews: rendered.sliceStageViews,
          sliceToolpath: rendered.sliceToolpath
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
          addIncompleteViewGuidance(result.diagnostics, result, viewCount),
          tr("unsafeDiagnosticsGuidance")
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

  function handleNewModel() {
    cancelActiveAutoRun();
    cancelWorkflows();
    clearReferenceImages();
    clearPromptFieldDraft();
    const next = createEmptyProject();
    setProjectList((current) => upsertProjectList(current, next));
    projectRef.current = next;
    setProject(next);
    setError("");
    setErrorStage("");
  }

  function handleSelectProject(projectId: string) {
    cancelActiveAutoRun();
    cancelWorkflows();
    clearReferenceImages();
    clearPromptFieldDraft();
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
    cancelWorkflows();
    setProject((current) => ({
      ...current,
      currentCode: code,
      review: null,
      sliceMetadata: null,
      sliceStageViews: null,
      stl: "",
      views: emptyViews(),
      renderEvidence: null,
      updatedAt: new Date().toISOString()
    }));
  }

  function handleOpenInMakerLab() {
    const scadCode = projectRef.current.currentCode;
    if (!scadCode.trim()) {
      return;
    }
    const MAKERLAB_URL =
      "https://makerworld.com.cn/zh/makerlab/parametricModelMaker?pageType=home&from=makerlab";
    navigator.clipboard.writeText(scadCode).then(
      () => {
        window.open(MAKERLAB_URL, "_blank", "noopener,noreferrer");
      },
      () => {
        // Clipboard write may fail in insecure contexts; still open MakerLab.
        window.open(MAKERLAB_URL, "_blank", "noopener,noreferrer");
      }
    );
  }

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    cancelActiveAutoRun();
    cancelWorkflows();
    clearReferenceImages();
    clearPromptFieldDraft();
    const file = event.currentTarget.files?.[0];
    // Reset so importing the same file twice still fires a change event.
    event.currentTarget.value = "";
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
                  <span className="fieldLabelWithHint">
                    {tr("targetConfidence")}
                    <InfoHint locale={locale} text={tr("hintTargetConfidence")} />
                  </span>
                  <div className="rangeInputRow">
                    <input
                      aria-label={tr("targetConfidence")}
                      disabled={controlsLocked}
                      max={MAX_TARGET_CONFIDENCE_PERCENT}
                      min={MIN_TARGET_CONFIDENCE_PERCENT}
                      onChange={(event) => updateTargetConfidence(Number(event.target.value))}
                      step={1}
                      type="range"
                      value={targetConfidencePercent}
                    />
                    <output>{targetConfidencePercent}%</output>
                  </div>
                </label>
                <label className="numberField">
                  <span className="fieldLabelWithHint">
                    {tr("autoIterations")}
                    <InfoHint locale={locale} text={tr("hintAutoIterations")} />
                  </span>
                  <input
                    aria-label={tr("autoIterations")}
                    disabled={controlsLocked}
                    max={MAX_AUTO_ITERATION_LIMIT}
                    min={MIN_AUTO_ITERATION_LIMIT}
                    onChange={(event) => updateAutoIterationLimit(Number(event.target.value))}
                    step={1}
                    type="number"
                    value={autoIterationLimit}
                  />
                </label>
              </div>

              <label>
                <div className="fieldHeader">
                  <span className="fieldLabelWithHint">
                    {tr("llmApiKey")}
                    <InfoHint locale={locale} text={tr("hintLlmApiKey")} />
                  </span>
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
                hint={<InfoHint locale={locale} text={tr("hintLlmModel")} />}
                models={CODE_MODEL_PRESETS}
                value={project.codeModelId}
                onChange={(codeModelId) => {
                  savePreferredCodeModel(codeModelId);
                  updateProject({ codeModelId });
                }}
                disabled={controlsLocked}
              />

              <label>
                <div className="fieldHeader">
                  <span className="fieldLabelWithHint">
                    {tr("visionApiKey")}
                    <InfoHint locale={locale} text={tr("hintVisionApiKey")} />
                  </span>
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
                hint={<InfoHint locale={locale} text={tr("hintVisionModel")} />}
                models={VISION_MODEL_PRESETS}
                value={project.visionModelId}
                onChange={(visionModelId) => {
                  savePreferredVisionModel(visionModelId);
                  updateProject({ visionModelId });
                }}
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
                disabled={controlsLocked}
                title={tr("exportProject")}
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
            project={project}
          />
          <section className="agentComposer">
            <div className="panelHeader">
              <h2>{tr("agentComposer")}</h2>
              <span>{tr("draftPrecision")}</span>
            </div>
            {promptFieldDraft ? (
              <PromptFieldEditor
                disabled={busy === "draftingReference" || busy === "optimizingPrompt"}
                draft={promptFieldDraft}
                onArrayChange={updatePromptArrayField}
                onStringChange={updatePromptStringField}
              />
            ) : (
              <textarea
                className="agentInput requirementInput"
                disabled={busy === "draftingReference" || busy === "optimizingPrompt"}
                ref={requirementInputRef}
                value={project.requirement}
                onChange={(event) => handleRequirementInput(event.target.value)}
                placeholder={tr("requirementPlaceholder")}
              />
            )}
            <input
              accept="image/*"
              aria-hidden="true"
              className="referenceImageInput"
              disabled={referenceControlsDisabled}
              multiple
              onChange={handleReferenceImageChange}
              ref={referenceFileInputRef}
              tabIndex={-1}
              type="file"
            />
            <div className="buttonGrid agentActions">
              <button
                className="referenceDescribeButton"
                disabled={describeReferenceDisabled}
                onClick={handleDescribeReferenceImages}
                type="button"
              >
                <Eye size={15} />
                <span>{tr("referenceImages")}</span>
              </button>
              {showPromptOptimizeAction ? (
                <button
                  className="promptOptimizeButton"
                  disabled={optimizePromptDisabled}
                  onClick={handleOptimizePrompt}
                  type="button"
                >
                  <WandSparkles size={15} />
                  <span>{tr("optimizePrompt")}</span>
                </button>
              ) : null}
              {hasDiagnosticFix ? (
                <button className="primaryAction" disabled={isBusy} onClick={handleDiagnosticFix}>
                  <RefreshCw size={16} />
                  {tr("fixWithDiagnostics")}
                </button>
              ) : null}
              {showGenerateAction ? (
                <button className="primaryAction" disabled={isBusy} onClick={handleGenerate}>
                  <Send size={16} />
                  {tr("generate")}
                </button>
              ) : null}
              {!hasRenderedViews && project.currentCode.trim() ? (
                <button className="secondaryAction" disabled={isBusy} onClick={handleCompile}>
                  <Play size={16} />
                  {tr("rerender")}
                </button>
              ) : null}
              {hasRenderedViews && !project.review ? (
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
              {hasCurrentReview ? (
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
              disabled={busy === "draftingReference" || busy === "optimizingPrompt"}
              spellCheck={false}
              value={project.currentCode}
              onChange={(event) => handleCodeEdit(event.target.value)}
            />
          </details>

        </section>

        <aside className="panel resultPanel">
          <div className="panelHeader">
            <h2>{tr("views")}</h2>
          </div>
          <PrintabilityPanel
            gcodeText={sliceGcodeText}
            locale={locale}
            sliceMetadata={project.sliceMetadata}
            sliceStageViews={project.sliceStageViews}
            stl={project.stl}
            toolpath={sliceToolpath}
            views={project.views}
          />

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
                <button
                  disabled={!project.currentCode.trim()}
                  onClick={handleOpenInMakerLab}
                  title={tr("makerlabHint")}
                  type="button"
                >
                  <ExternalLink size={14} />
                  <span>{tr("openInMakerLab")}</span>
                </button>
              </div>
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function InfoHint(props: { locale: Locale; text: string }) {
  const tooltipId = useId();
  return (
    <span className="infoHint">
      <button
        aria-describedby={tooltipId}
        aria-label={t(props.locale, "infoHintLabel")}
        className="infoHintButton"
        type="button"
      >
        !
      </button>
      <span className="infoHintTooltip" id={tooltipId} role="tooltip">
        {props.text}
      </span>
    </span>
  );
}

function ApiKeyHint(props: { locale: Locale }) {
  const tooltipId = useId();
  return (
    <span className="keyHelp">
      <button
        aria-describedby={tooltipId}
        aria-label={t(props.locale, "noApiKey")}
        className="keyHelpButton"
        type="button"
      >
        {t(props.locale, "noApiKey")}
      </button>
      <span className="keyHelpTooltip" id={tooltipId} role="tooltip">
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
  hint?: ReactNode;
  models: ModelPreset[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="fieldGroup">
      <span className="fieldLabelWithHint">
        {props.label}
        {props.hint}
      </span>
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

function PromptFieldEditor(props: {
  disabled: boolean;
  draft: PromptFieldDraft;
  onArrayChange: (field: PromptFieldArrayKey, index: number, value: string) => void;
  onStringChange: (field: "objectTarget" | "useCase", value: string) => void;
}) {
  const labels = promptFieldLabels(props.draft.language);
  return (
    <div className="promptFieldEditor">
      <label className="promptField promptFieldWide">
        <span>{labels.objectTarget}</span>
        <textarea
          aria-label={labels.objectTarget}
          className="promptFieldInput"
          data-prompt-field="objectTarget"
          disabled={props.disabled}
          value={props.draft.fields.objectTarget}
          onChange={(event) => props.onStringChange("objectTarget", event.target.value)}
        />
      </label>
      <label className="promptField promptFieldWide">
        <span>{labels.useCase}</span>
        <textarea
          aria-label={labels.useCase}
          className="promptFieldInput"
          data-prompt-field="useCase"
          disabled={props.disabled}
          value={props.draft.fields.useCase}
          onChange={(event) => props.onStringChange("useCase", event.target.value)}
        />
      </label>
      <PromptArrayField
        disabled={props.disabled}
        field="knownDetails"
        label={labels.knownDetails}
        values={props.draft.fields.knownDetails}
        onChange={props.onArrayChange}
      />
      <PromptArrayField
        disabled={props.disabled}
        field="geometry"
        label={labels.geometry}
        values={props.draft.fields.geometry}
        onChange={props.onArrayChange}
      />
      <PromptArrayField
        disabled={props.disabled}
        field="keyDimensions"
        label={labels.keyDimensions}
        values={props.draft.fields.keyDimensions}
        onChange={props.onArrayChange}
      />
      <PromptArrayField
        disabled={props.disabled}
        field="printabilityConstraints"
        label={labels.printabilityConstraints}
        values={props.draft.fields.printabilityConstraints}
        onChange={props.onArrayChange}
      />
      <PromptArrayField
        disabled={props.disabled}
        field="detailsToConfirm"
        label={labels.detailsToConfirm}
        values={props.draft.fields.detailsToConfirm}
        onChange={props.onArrayChange}
      />
    </div>
  );
}

function PromptArrayField(props: {
  disabled: boolean;
  field: PromptFieldArrayKey;
  label: string;
  values: string[];
  onChange: (field: PromptFieldArrayKey, index: number, value: string) => void;
}) {
  return (
    <fieldset className="promptField promptFieldList">
      <legend>{props.label}</legend>
      {props.values.map((value, index) => (
        <textarea
          aria-label={`${props.label} ${index + 1}`}
          className="promptFieldInput"
          data-prompt-field={props.field}
          disabled={props.disabled}
          key={`${props.field}-${index}`}
          value={value}
          onChange={(event) => props.onChange(props.field, index, event.target.value)}
        />
      ))}
    </fieldset>
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
  project: ProjectState;
}) {
  const [openCodeEvents, setOpenCodeEvents] = useState<Record<string, boolean>>({});
  const [openThinkingEvents, setOpenThinkingEvents] = useState<Record<string, boolean>>({});
  const events = props.project.runEvents;
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Follow streaming output (thinking and code tokens) by keeping the
  // timeline pinned to the bottom, but stop following once the user
  // scrolls up to read something. The thinking and live-code panes are
  // their own scroll regions, so pin them to their own bottom too.
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !stickToBottomRef.current) {
      return;
    }
    timeline.scrollTop = timeline.scrollHeight;
    timeline
      .querySelectorAll<HTMLElement>(".liveThinkingPreview, .liveCodePreview")
      .forEach((pane) => {
        pane.scrollTop = pane.scrollHeight;
      });
  }, [events, props.error, props.busy]);

  const handleTimelineScroll = () => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    stickToBottomRef.current =
      timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 48;
  };

  return (
    <section className="agentRun">
      <div className="panelHeader">
        <h2>{t(props.locale, "agentRun")}</h2>
        <span aria-live="polite">
          {props.busy === "idle"
            ? t(props.locale, "ready")
            : busyStatusLabel(props.locale, props.busy)}
        </span>
      </div>
      <div className="agentTimeline" onScroll={handleTimelineScroll} ref={timelineRef}>
        {props.error ? (
          <article className="agentEvent agentError" role="alert">
            <h3>{t(props.locale, "workflowError")}</h3>
            <p>{props.error}</p>
          </article>
        ) : null}

        {events.map((event) => {
          const codeOpen = Boolean(openCodeEvents[event.id]);
          const thinkingOpen =
            event.status === "active" ? true : Boolean(openThinkingEvents[event.id]);
          // Prefer the durable kind field; fall back to localized titles only
          // for events persisted before kinds existed.
          const isReviewEvent = event.kind
            ? event.kind === "review"
            : event.title === t(props.locale, "visualReview");
          const isCorrectionPromptEvent = event.kind
            ? event.kind === "correction-prompt"
            : event.title === t(props.locale, "correctionPrompt");
          const eventReview = isReviewEvent
            ? event.review ?? props.project.review
            : null;
          const showEventContent =
            Boolean(event.content) &&
            !isCorrectionPromptEvent &&
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
              {event.thinking ? (
                <details
                  className="thinkingDisclosure"
                  open={thinkingOpen}
                  onToggle={(toggleEvent) => {
                    if (event.status === "active") {
                      return;
                    }
                    const open = (toggleEvent.currentTarget as HTMLDetailsElement).open;
                    setOpenThinkingEvents((current) => ({
                      ...current,
                      [event.id]: open
                    }));
                  }}
                >
                  <summary
                    role="button"
                    aria-expanded={thinkingOpen}
                    onClick={(clickEvent) => {
                      if (event.status === "active") {
                        clickEvent.preventDefault();
                      }
                    }}
                  >
                    <span>{t(props.locale, "thinking")}</span>
                    {!thinkingOpen ? (
                      <small>{t(props.locale, "thinkingCollapsed")}</small>
                    ) : null}
                  </summary>
                  <pre className={event.status === "active" ? "liveThinkingPreview" : undefined}>
                    {event.thinking}
                  </pre>
                </details>
              ) : null}
              {showEventContent ? <p>{event.content}</p> : null}
              {eventReview ? (
                <>
                  <ul>
                    {eventReview.issues.map((issue, index) => (
                      <li key={`${event.id}-issue-${index}`}>{issue}</li>
                    ))}
                  </ul>
                  <p className="confidence">
                    {t(props.locale, "confidence")}{" "}
                    {formatConfidencePercent(eventReview.confidence)}
                  </p>
                </>
              ) : null}
              {isCorrectionPromptEvent ? (
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
    optimizingPrompt: "busyOptimizingPrompt",
    generating: "busyGenerating",
    compiling: "busyCompiling",
    reviewing: "busyReviewing",
    slicing: "busySlicing",
    exporting: "busyExporting"
  };
  return t(locale, keys[busy]);
}

function workflowStageForBusy(busy: BusyState): WorkflowStage {
  if (busy === "generating" || busy === "draftingReference" || busy === "optimizingPrompt") {
    return "code";
  }
  if (busy === "reviewing") {
    return "review";
  }
  // Slicing is folded into the render step (it runs automatically right
  // after a successful compile), so it stays under the "render" stage.
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
