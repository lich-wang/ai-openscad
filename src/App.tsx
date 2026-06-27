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
  const hasRenderedViews = Boolean(project.views.front && project.views.top && project.views.right);
  const hasPendingRevision = Boolean(project.proposedCode.trim());
  const compilerOutputForDisplay =
    renderStatus ||
    (hasPendingRevision && busy === "idle" ? tr("revisionReady") : project.compilerOutput);
  const workflowStages = buildWorkflowStages({
    busy,
    errorStage,
    hasCode: Boolean(project.currentCode.trim() || project.proposedCode.trim()),
    hasRenderedViews,
    hasReview: Boolean(project.review)
  });
  const hasModelWork = Boolean(
    project.currentCode.trim() ||
      project.proposedCode.trim() ||
      project.views.front ||
      project.views.top ||
      project.views.right ||
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
        views: { front: "", top: "", right: "" },
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
        views: { front: "", top: "", right: "" },
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
      const rendered = await compileDraftCode(code);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        setProject((current) => ({
          ...current,
          compilerOutput: rendered.diagnostics,
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
        currentCode: code,
        proposedCode: "",
        review: null,
        views: rendered.views,
        stl: rendered.stl,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: current.requirement,
            code,
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
      const rendered = await compileDraftCode(project.currentCode);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        setProject((current) => ({
          ...current,
          compilerOutput: rendered.diagnostics,
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
        review: null,
        proposedCode: "",
        views: rendered.views,
        stl: rendered.stl,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: current.requirement,
            code: current.currentCode,
            modelId: current.codeModelId,
            status: "compiled"
          }
        ]
      }));
    });
  }

  async function compileDraftCode(code: string) {
    await updateRenderStatus("renderPreparing");
    const draftCode = normalizeOpenScadPrecision(code, "draft");
    const result = await adapter.render({
      source: draftCode,
      onProgress: (stage) => updateRenderStatus(renderMcpStageMessageKey(stage))
    });
    const diagnostics = addDraftRenderTimeoutGuidance(result.diagnostics);
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
        trace,
        views: null,
        stl: null
      };
    }
    return {
      ok: true,
      diagnostics: result.diagnostics,
      trace,
      views: result.views,
      stl: result.stl
    };
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
      if (!project.views.front || !project.views.top || !project.views.right) {
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
        images: [project.views.front, project.views.top, project.views.right]
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

  async function handleIterateAgain() {
    await runSafely("generating", async () => {
      requireLlmApiKey();
      if (!project.review) {
        throw new Error(tr("reviewBeforeIterate"));
      }
      const originalRequirement = originalRequirementFor(project);
      const iterationPrompt = project.requirement.trim() || project.review.correctionPrompt;
      const codeEventId = crypto.randomUUID();
      setProject((current) => ({
        ...current,
        currentCode: "",
        proposedCode: "",
        review: null,
        views: { front: "", top: "", right: "" },
        stl: "",
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
        views: { front: "", top: "", right: "" },
        stl: "",
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
      const rendered = await compileDraftCode(code);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        setProject((current) => ({
          ...current,
          compilerOutput: rendered.diagnostics,
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
        currentCode: code,
        proposedCode: "",
        review: null,
        views: rendered.views,
        stl: rendered.stl,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: iterationPrompt,
            code,
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
      const finalCode = normalizeOpenScadPrecision(project.currentCode, "final");
      await updateRenderStatus("renderPreparing");
      const result = await adapter.render({
        source: finalCode,
        onProgress: (stage) => updateRenderStatus(renderMcpStageMessageKey(stage))
      });
      const diagnostics = addFinalExportTimeoutGuidance(result.diagnostics);
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
      const rendered = await compileDraftCode(accepted.currentCode);
      if (!rendered.ok || !rendered.views || !rendered.stl) {
        setProject((current) => ({
          ...current,
          compilerOutput: rendered.diagnostics,
          promptTrace: [...current.promptTrace, rendered.trace],
          updatedAt: new Date().toISOString()
        }));
        throw new Error(rendered.diagnostics);
      }
      setProject((current) => ({
        ...current,
        views: rendered.views,
        stl: rendered.stl,
        review: null,
        compilerOutput: `${rendered.diagnostics}\n${tr("compiledDraft")}`,
        promptTrace: [...current.promptTrace, rendered.trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: current.requirement,
            code: accepted.currentCode,
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
              {!hasPendingRevision && !hasRenderedViews ? (
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
              {!hasPendingRevision && project.review ? (
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
              onChange={(event) => updateProject({ currentCode: event.target.value })}
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
            <ViewImage label={tr("front")} src={project.views.front} />
            <ViewImage label={tr("top")} src={project.views.top} />
            <ViewImage label={tr("right")} src={project.views.right} />
          </div>

          {hasRenderedViews || project.stl ? (
            <section className="renderAssetPanel" aria-label={tr("renderOutputs")}>
              <span>{tr("renderOutputs")}</span>
              <div className="renderAssetActions">
                <button
                  disabled={!project.views.front}
                  onClick={() =>
                    downloadDataUrl("ai-openscad-front.png", project.views.front)
                  }
                  type="button"
                >
                  <Download size={14} />
                  {tr("downloadFrontPng")}
                </button>
                <button
                  disabled={!project.views.top}
                  onClick={() => downloadDataUrl("ai-openscad-top.png", project.views.top)}
                  type="button"
                >
                  <Download size={14} />
                  {tr("downloadTopPng")}
                </button>
                <button
                  disabled={!project.views.right}
                  onClick={() =>
                    downloadDataUrl("ai-openscad-right.png", project.views.right)
                  }
                  type="button"
                >
                  <Download size={14} />
                  {tr("downloadRightPng")}
                </button>
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
    top: "renderTop",
    right: "renderRight"
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
