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
import {
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
import { acceptRevision, rejectRevision } from "./lib/workflow";

type BusyState = "idle" | "generating" | "compiling" | "reviewing" | "exporting";
type WorkflowStage = "code" | "render" | "review";
type WorkflowStageState = "waiting" | "active" | "complete" | "error";
type ViewKey = keyof ProjectState["views"];
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
  views: null;
  stl: null;
};
type DraftCompileResult = DraftCompileSuccess | DraftCompileFailure;

const VIEW_KEYS: ViewKey[] = ["front", "back", "left", "right", "top", "isometric"];
const MAX_COMPILER_REPAIR_ATTEMPTS = 2;
const VIEW_LABEL_KEYS: Record<ViewKey, MessageKey> = {
  front: "front",
  back: "back",
  left: "left",
  right: "right",
  top: "top",
  isometric: "isometric"
};
const VIEW_DOWNLOAD_KEYS: Record<ViewKey, MessageKey> = {
  front: "downloadFrontPng",
  back: "downloadBackPng",
  left: "downloadLeftPng",
  right: "downloadRightPng",
  top: "downloadTopPng",
  isometric: "downloadIsometricPng"
};

function emptyViews(): ProjectState["views"] {
  return {
    front: "",
    back: "",
    left: "",
    right: "",
    top: "",
    isometric: ""
  };
}

function renderedViewCount(views: ProjectState["views"]): number {
  return VIEW_KEYS.filter((key) => Boolean(views[key])).length;
}

function allViewsRendered(views: ProjectState["views"]): boolean {
  return renderedViewCount(views) === VIEW_KEYS.length;
}

function viewImagesInOrder(views: ProjectState["views"]): string[] {
  return VIEW_KEYS.map((key) => views[key]);
}

function canUseCodeModel(modelId: string, apiKey: string): boolean {
  const provider = getModelPreset(modelId, "code").provider;
  return provider === "mimo" || Boolean(apiKey.trim());
}

export default function App() {
  const [initialWorkspace] = useState(() => loadProjectWorkspace());
  const [project, setProject] = useState<ProjectState>(() => initialWorkspace.activeProject);
  const [projectList, setProjectList] = useState<ProjectState[]>(
    () => initialWorkspace.projects
  );
  const [llmApiKey, setLlmApiKey] = useState(() => loadLlmApiKey());
  const [visionApiKey, setVisionApiKey] = useState(() => loadVisionApiKey());
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState("");
  const [errorStage, setErrorStage] = useState<WorkflowStage | "">("");
  const [renderStatus, setRenderStatus] = useState("");
  const busyRef = useRef<BusyState>("idle");

  const locale = getBrowserLocale();
  const tr = (key: MessageKey) => t(locale, key);
  const adapter = useMemo(() => createRenderMcp("web"), []);
  const isBusy = busy !== "idle";
  const hasRenderedViews = allViewsRendered(project.views);
  const hasCurrentReview = Boolean(project.review && hasRenderedViews);
  const hasPendingRevision = Boolean(project.proposedCode.trim());
  const canUseCodeModelForRepair = canUseCodeModel(project.codeModelId, llmApiKey);
  const hasDiagnosticFix = Boolean(
    project.currentCode.trim() &&
      !hasRenderedViews &&
      !hasPendingRevision &&
      !hasCurrentReview &&
      project.renderEvidence?.compileStatus === "failure" &&
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

  function createRunEvent(input: {
    role: RunEventRole;
    title: string;
    content: string;
    status?: RunEventStatus;
    code?: string;
    id?: string;
  }): RunEvent {
    return {
      id: input.id ?? crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      role: input.role,
      title: input.title,
      content: input.content,
      status: input.status ?? "complete",
      code: input.code
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
      viewCount: 0
    };
  }

  function diagnosticFixPatch(current: ProjectState, diagnostics: string, evidence: RenderEvidence) {
    const prompt = buildDiagnosticFixPrompt(originalRequirementFor(current), diagnostics);
    return {
      requirement: prompt,
      compilerOutput: diagnostics,
      renderEvidence: evidence,
      proposedCode: "",
      review: null,
      stl: "",
      views: emptyViews(),
      runEvents: [
        ...current.runEvents,
        createRunEvent({
          role: "tool",
          title: tr("diagnosticFixPromptReady"),
          content: prompt
        })
      ],
      updatedAt: new Date().toISOString()
    };
  }

  async function runSafely(action: BusyState, task: () => Promise<void>) {
    updateBusy(action);
    setError("");
    setErrorStage("");
    try {
      await task();
    } catch (caught) {
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
      setRenderStatus("");
      updateBusy("idle");
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

  async function handleGenerate() {
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
      const { code, trace } = await generateOpenScad({
        apiKey: llmApiKey,
        modelId: project.codeModelId,
        requirement: originalRequirement,
        precision: "draft",
        onToken: (streamedCode) => {
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
            requirement: current.requirement,
            code: finalCode,
            modelId: current.codeModelId,
            status: "compiled"
          }
        ]
      }));
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

  async function compileDraftCode(code: string): Promise<DraftCompileResult> {
    await updateRenderStatus("renderPreparing");
    const draftCode = normalizeOpenScadPrecision(code, "draft");
    const result = await adapter.render({
      source: draftCode,
      onProgress: (stage) => updateRenderStatus(renderMcpStageMessageKey(stage))
    });
    const diagnostics = addDraftRenderTimeoutGuidance(result.diagnostics);
    const evidence: RenderEvidence = {
      compileStatus: result.ok && Boolean(result.stl && result.views) ? "success" : "failure",
      diagnostics,
      renderPrecision: "draft",
      backend: result.backend ?? "web",
      viewCount: result.views ? renderedViewCount(result.views) : 0
    };
    const trace = createPromptTraceEntry({
      phase: "compile",
      modelId: "render-mcp:web",
      systemPrompt: buildRenderPrecisionInstruction("draft"),
      userPrompt: tr("compileDraftTrace"),
      response: diagnostics
    });
    if (!result.ok || !result.stl || !result.views) {
      return {
        ok: false,
        diagnostics,
        evidence,
        trace,
        views: null,
        stl: null
      };
    }
    return {
      ok: true,
      diagnostics: result.diagnostics,
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
  }): Promise<{ code: string; rendered: DraftCompileResult }> {
    let code = input.code;
    let rendered = input.rendered;
    if (rendered.ok || !canUseCodeModel(project.codeModelId, llmApiKey)) {
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
            setProject((current) => ({
              ...current,
              currentCode: streamedCode,
              compilerOutput: tr("streamingIteration")
            }));
          }
        });
        repairedCode = proposed.code;
        trace = proposed.trace;
      } catch (caught) {
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
      rendered = await compileDraftCode(code);
      if (rendered.ok && rendered.views && rendered.stl) {
        return { code, rendered };
      }
    }

    return { code, rendered };
  }

  async function updateRenderStatus(key: MessageKey) {
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
      if (!allViewsRendered(project.views)) {
        throw new Error(tr("compileBeforeReview"));
      }
      requireVisionApiKey();
      const originalRequirement = originalRequirementFor(project);
      appendRunEvent(createRunEvent({
        role: "review",
        title: tr("reviewStarted"),
        content: tr("reviewStarted"),
        status: "active"
      }));
      const { review, trace: reviewTrace } = await reviewViews({
        apiKey: visionApiKey,
        modelId: project.visionModelId,
        requirement: originalRequirement,
        code: project.currentCode,
        images: viewImagesInOrder(project.views),
        renderEvidence: project.renderEvidence
      });
      setProject((current) => ({
        ...current,
        originalRequirement: current.originalRequirement.trim()
          ? current.originalRequirement
          : originalRequirement,
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
            code: current.currentCode,
            modelId: current.visionModelId,
            status: "reviewed",
            reviewSummary: review.summary
          }
        ]
      }));
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
    await runSafely("generating", async () => {
      requireLlmApiKey();
      if (!project.review) {
        throw new Error(tr("reviewBeforeIterate"));
      }
      if (!allViewsRendered(project.views)) {
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
      const { code, trace } = await proposeRevision({
        apiKey: llmApiKey,
        modelId: project.codeModelId,
        requirement: originalRequirement,
        code: project.currentCode,
        review: project.review,
        userNotes: iterationPrompt,
        renderEvidence: project.renderEvidence,
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
            requirement: iterationPrompt,
            code: finalCode,
            modelId: current.codeModelId,
            status: "compiled"
          }
        ]
      }));
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
      if (!allViewsRendered(project.views)) {
        throw new Error(tr("compileBeforeReview"));
      }
      const finalCode = normalizeOpenScadPrecision(project.currentCode, "final");
      await updateRenderStatus("renderPreparing");
      const result = await adapter.render({
        source: finalCode,
        onProgress: (stage) => updateRenderStatus(renderMcpStageMessageKey(stage))
      });
      const diagnostics = addFinalExportTimeoutGuidance(result.diagnostics);
      const evidence: RenderEvidence = {
        compileStatus: result.ok && Boolean(result.stl && result.views) ? "success" : "failure",
        diagnostics,
        renderPrecision: "final",
        backend: result.backend ?? "web",
        viewCount: result.views
          ? renderedViewCount(result.views)
          : 0
      };
      const trace = createPromptTraceEntry({
        phase: "final-export",
        modelId: "render-mcp:web",
        systemPrompt: buildRenderPrecisionInstruction("final"),
        userPrompt: tr("finalExportTrace"),
        response: diagnostics
      });
      if (!result.ok || !result.stl || !result.views) {
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
    const next = createEmptyProject();
    setProjectList((current) => upsertProjectList(current, next));
    setProject(next);
    setError("");
    setErrorStage("");
  }

  function handleSelectProject(projectId: string) {
    const selected = projectList.find((item) => item.id === projectId);
    if (!selected) {
      return;
    }
    setProject(selected);
    setError("");
    setErrorStage("");
  }

  function updateProject(patch: Partial<ProjectState>) {
    setProject((current) => ({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    }));
  }

  function handleCodeEdit(code: string) {
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
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    file.text()
      .then((content) => {
        const imported = importProject(content);
        setProjectList((current) => upsertProjectList(current, imported));
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
              <label>
                <div className="fieldHeader">
                  <span>{tr("llmApiKey")}</span>
                  <ApiKeyHint locale={locale} />
                </div>
                <div className="keyInput">
                  <KeyRound size={16} />
                  <input
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
              />

              <label>
                <div className="fieldHeader">
                  <span>{tr("visionApiKey")}</span>
                  <ApiKeyHint locale={locale} />
                </div>
                <div className="keyInput">
                  <KeyRound size={16} />
                  <input
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
              />
            </div>
          </details>

          <section className="projectTools">
            <span>{tr("projectFiles")}</span>
            <div className="projectToolActions">
              <label className="projectToolButton fileButton" title={tr("importProject")}>
                <FileUp size={15} />
                <span>{tr("importProject")}</span>
                <input accept="application/json" type="file" onChange={handleImport} />
              </label>
              <button
                className="projectToolButton"
                disabled={hasPendingRevision}
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
              value={project.requirement}
              onChange={(event) => updateProject({ requirement: event.target.value })}
              placeholder={tr("requirementPlaceholder")}
            />
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

          <details className="codeDisclosure">
            <summary>
              <span>
                <Code2 size={17} />
                {tr("codeDetails")}
              </span>
              <small>{tr("draftPrecision")}</small>
            </summary>
            <textarea
              className="codeEditor"
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
                    disabled={isBusy}
                    onClick={handleAcceptRevision}
                  >
                    <Check size={15} />
                    {tr("accept")}
                  </button>
                  <button
                    className="smallButton"
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
          <div className="viewGrid">
            {VIEW_KEYS.map((key) => (
              <ViewImage key={key} label={tr(VIEW_LABEL_KEYS[key])} src={project.views[key]} />
            ))}
          </div>

          {hasRenderedViews || project.stl ? (
            <section className="renderAssetPanel" aria-label={tr("renderOutputs")}>
              <span>{tr("renderOutputs")}</span>
              <div className="renderAssetActions">
                {VIEW_KEYS.map((key) => (
                  <button
                    key={key}
                    disabled={!project.views[key]}
                    onClick={() => downloadDataUrl(`ai-openscad-${key}.png`, project.views[key])}
                    type="button"
                  >
                    <Download size={14} />
                    {tr(VIEW_DOWNLOAD_KEYS[key])}
                  </button>
                ))}
                <button
                  disabled={!project.stl}
                  onClick={() =>
                    downloadText("ai-openscad-model.stl", project.stl, "model/stl;charset=utf-8")
                  }
                  type="button"
                >
                  <Download size={14} />
                  {tr("downloadStl")}
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
}) {
  return (
    <div className="fieldGroup">
      <span>{props.label}</span>
      <div className="segmentedControl" role="group" aria-label={props.label}>
        {props.models.map((model) => (
          <button
            aria-pressed={model.id === props.value}
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
          return (
            <article
              className={`agentEvent chatEvent ${event.role} ${event.status}`}
              data-role={event.role}
              data-status={event.status}
              key={event.id}
            >
              <h3>{event.title}</h3>
              {event.content && !event.content.startsWith(event.title) ? (
                <p>{event.content}</p>
              ) : null}
              {event.title === t(props.locale, "visualReview") && props.project.review ? (
                <>
                  <ul>
                    {props.project.review.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                  <p className="confidence">
                    {t(props.locale, "confidence")}{" "}
                    {Math.round(props.project.review.confidence * 100)}%
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
    generating: "busyGenerating",
    compiling: "busyCompiling",
    reviewing: "busyReviewing",
    exporting: "busyExporting"
  };
  return t(locale, keys[busy]);
}

function workflowStageForBusy(busy: BusyState): WorkflowStage {
  if (busy === "generating") {
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
    isometric: "renderIsometric"
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
