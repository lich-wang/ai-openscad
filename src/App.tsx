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
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  estimateTokenUsage,
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
  type ProjectIteration,
  type PromptTraceEntry,
  type ProjectState
} from "./lib/project";
import { createRenderMcp, type RenderMcpStage } from "./lib/render";
import {
  buildRenderPrecisionInstruction,
  normalizeOpenScadPrecision
} from "./lib/renderSkill";
import { acceptRevision, rejectRevision } from "./lib/workflow";

type BusyState = "idle" | "generating" | "compiling" | "reviewing" | "exporting";

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
  const [renderStatus, setRenderStatus] = useState("");

  const locale = getBrowserLocale();
  const tr = (key: MessageKey) => t(locale, key);
  const adapter = useMemo(() => createRenderMcp("web"), []);
  const isBusy = busy !== "idle";
  const hasRenderedViews = Boolean(project.views.front && project.views.top && project.views.right);
  const hasPendingRevision = Boolean(project.proposedCode.trim());
  const compilerOutputForDisplay =
    renderStatus ||
    (hasPendingRevision && busy === "idle" ? tr("revisionReady") : project.compilerOutput);
  const hasModelWork = Boolean(
    project.currentCode.trim() ||
      project.proposedCode.trim() ||
      project.views.front ||
      project.views.top ||
      project.views.right ||
      project.review
  );

  useEffect(() => {
    saveProject(project);
    setProjectList((current) => upsertProjectList(current, project));
  }, [project]);

  useEffect(() => {
    saveLlmApiKey(llmApiKey);
  }, [llmApiKey]);

  useEffect(() => {
    saveVisionApiKey(visionApiKey);
  }, [visionApiKey]);

  const tokenUsage = useMemo(() => {
    const imageCount = [project.views.front, project.views.top, project.views.right].filter(
      Boolean
    ).length;
    return estimateTokenUsage({
      llmText: `${project.requirement}\n${project.currentCode}\n${project.proposedCode}\n${project.review?.summary ?? ""}`,
      visionText: `${project.requirement}\n${project.currentCode}`,
      imageCount
    });
  }, [
    project.currentCode,
    project.proposedCode,
    project.requirement,
    project.review,
    project.views
  ]);

  async function runSafely(action: BusyState, task: () => Promise<void>) {
    setBusy(action);
    setError("");
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRenderStatus("");
      setBusy("idle");
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
      setProject((current) => ({
        ...current,
        currentCode: "",
        proposedCode: "",
        review: null,
        stl: "",
        views: { front: "", top: "", right: "" },
        compilerOutput: tr("streamingCode")
      }));
      const { code, trace } = await generateOpenScad({
        apiKey: llmApiKey,
        modelId: project.codeModelId,
        requirement: project.requirement,
        precision: "draft",
        onToken: (streamedCode) => {
          setProject((current) => ({
            ...current,
            currentCode: streamedCode,
            compilerOutput: tr("streamingCode")
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
        promptTrace: [...current.promptTrace, trace],
        updatedAt: new Date().toISOString(),
        iterations: [
          ...current.iterations,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            requirement: current.requirement,
            code,
            modelId: current.codeModelId,
            status: "generated"
          }
        ]
      }));
      setBusy("compiling");
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
    const trace = createPromptTraceEntry({
      phase: "compile",
      modelId: "render-mcp:web",
      systemPrompt: buildRenderPrecisionInstruction("draft"),
      userPrompt: tr("compileDraftTrace"),
      response: result.diagnostics
    });
    if (!result.ok || !result.stl || !result.views) {
      return {
        ok: false,
        diagnostics: result.diagnostics,
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
      const { review, trace: reviewTrace } = await reviewViews({
        apiKey: visionApiKey,
        modelId: project.visionModelId,
        requirement: project.requirement,
        code: project.currentCode,
        images: [project.views.front, project.views.top, project.views.right]
      });
      setProject((current) => ({
        ...current,
        review,
        requirement: review.correctionPrompt || current.requirement,
        promptTrace: [...current.promptTrace, reviewTrace],
        compilerOutput: tr("visionComplete"),
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
      const iterationPrompt = project.requirement.trim() || project.review.correctionPrompt;
      setProject((current) => ({
        ...current,
        currentCode: "",
        proposedCode: "",
        compilerOutput: tr("streamingIteration")
      }));
      const { code, trace } = await proposeRevision({
        apiKey: llmApiKey,
        modelId: project.codeModelId,
        requirement: iterationPrompt,
        code: project.currentCode,
        review: project.review,
        userNotes: iterationPrompt,
        precision: "draft",
        onToken: (streamedCode) => {
          setProject((current) => ({
            ...current,
            currentCode: streamedCode,
            compilerOutput: tr("streamingIteration")
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
      setBusy("compiling");
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
      const trace = createPromptTraceEntry({
        phase: "final-export",
        modelId: "render-mcp:web",
        systemPrompt: buildRenderPrecisionInstruction("final"),
        userPrompt: tr("finalExportTrace"),
        response: result.diagnostics
      });
      if (!result.ok || !result.stl || !result.views) {
        setProject((current) => ({
          ...current,
          compilerOutput: result.diagnostics,
          promptTrace: [...current.promptTrace, trace],
          updatedAt: new Date().toISOString()
        }));
        throw new Error(result.diagnostics);
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
        compilerOutput: `${result.diagnostics}\n${tr("finalExportDone")}`,
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
  }

  function handleSelectProject(projectId: string) {
    const selected = projectList.find((item) => item.id === projectId);
    if (!selected) {
      return;
    }
    setProject(selected);
    setError("");
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

          <div className="tokenPanel">
            <div>
              <span>{tr("llmTokens")}</span>
              <strong>{tokenUsage.llmTokens}</strong>
            </div>
            <div>
              <span>{tr("visionTokens")}</span>
              <strong>{tokenUsage.visionTokens}</strong>
            </div>
          </div>

          <Status
            busy={busy}
            error={error}
            locale={locale}
            pendingRevision={hasPendingRevision}
          />

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
        </aside>

        <section className="panel codePanel agentPanel">
          <AgentRunPanel
            busy={busy}
            compilerOutput={compilerOutputForDisplay}
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
              {!hasRenderedViews ? (
                <button className="primaryAction" disabled={isBusy} onClick={handleGenerate}>
                  <Send size={16} />
                  {tr("generate")}
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
              {project.review && hasPendingRevision ? (
                <p className="pendingActionHint">{tr("pendingRevisionActionHint")}</p>
              ) : null}
              {project.review && !hasPendingRevision ? (
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

          <section className="outputBlock">
            <h3>{tr("compiler")}</h3>
            <pre>{compilerOutputForDisplay || tr("noCompileOutput")}</pre>
          </section>

          <section className="outputBlock">
            <h3>{tr("review")}</h3>
            {project.review ? (
              <>
                <p>{project.review.summary}</p>
                <ul>
                  {project.review.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
                <p className="confidence">
                  {tr("confidence")} {Math.round(project.review.confidence * 100)}%
                </p>
                <div className="correctionPromptPreview">
                  <span>{tr("correctionPrompt")}</span>
                  <p>{project.review.correctionPrompt}</p>
                </div>
              </>
            ) : (
              <p>{tr("noReview")}</p>
            )}
          </section>

          <section className="outputBlock historyBlock">
            <h3>{tr("history")}</h3>
            <ol>
              {project.iterations.slice(-8).map((iteration) => (
                <li key={iteration.id}>
                  <span>{iterationStatusLabel(locale, iteration.status)}</span>
                  <time>{new Date(iteration.createdAt).toLocaleTimeString()}</time>
                </li>
              ))}
            </ol>
          </section>
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

function AgentRunPanel(props: {
  busy: BusyState;
  compilerOutput: string;
  locale: Locale;
  pendingRevision: boolean;
  project: ProjectState;
}) {
  const latestTrace = props.project.promptTrace.slice(-4).reverse();
  const visibleCode = props.project.proposedCode || props.project.currentCode;
  return (
    <section className="agentRun">
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
        <article className="agentEvent">
          <h3>{t(props.locale, "agentThinking")}</h3>
          <p>
            {props.busy === "generating"
              ? t(props.locale, "streamingCode")
              : props.project.currentCode
                ? t(props.locale, "generatedCode")
                : t(props.locale, "emptyTrace")}
          </p>
        </article>

        {visibleCode ? (
          <article className="agentEvent">
            <h3>{t(props.locale, "generatedOutput")}</h3>
            <pre className="agentCodePreview">{visibleCode}</pre>
          </article>
        ) : null}

        {props.project.views.front || props.project.views.top || props.project.views.right ? (
          <article className="agentEvent">
            <h3>{t(props.locale, "draftRender")}</h3>
            <p>{props.compilerOutput || t(props.locale, "compiledDraft")}</p>
          </article>
        ) : null}

        {props.project.review ? (
          <article className="agentEvent">
            <h3>{t(props.locale, "visualReview")}</h3>
            <p>{props.project.review.summary}</p>
            <ul>
              {props.project.review.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            <div className="correctionPromptPreview">
              <span>{t(props.locale, "correctionPrompt")}</span>
              <p>{props.project.review.correctionPrompt}</p>
            </div>
          </article>
        ) : null}

        {latestTrace.length ? (
          <article className="agentEvent traceEvent">
            <h3>{t(props.locale, "aiPromptTrace")}</h3>
            <div className="traceList compactTraceList">
              {latestTrace.map((entry) => (
                <details key={entry.id} className="traceItem">
                  <summary>
                    <strong>{entry.phase}</strong>
                    <span>{entry.modelId}</span>
                    <time>{new Date(entry.createdAt).toLocaleTimeString()}</time>
                  </summary>
                  <TraceBlock title={t(props.locale, "system")} value={entry.systemPrompt} />
                  <TraceBlock title={t(props.locale, "user")} value={entry.userPrompt} />
                  {entry.response ? (
                    <TraceBlock title={t(props.locale, "response")} value={entry.response} />
                  ) : null}
                </details>
              ))}
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function Status(props: {
  busy: BusyState;
  error: string;
  locale: Locale;
  pendingRevision: boolean;
}) {
  if (props.error) {
    return <p className="status error">{props.error}</p>;
  }
  if (props.busy !== "idle") {
    return (
      <p className="status">
        {t(props.locale, "working")}: {busyStatusLabel(props.locale, props.busy)}
      </p>
    );
  }
  if (props.pendingRevision) {
    return <p className="status warning">{t(props.locale, "revisionPending")}</p>;
  }
  return <p className="status">{t(props.locale, "ready")}</p>;
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

function iterationStatusLabel(
  locale: Locale,
  status: ProjectIteration["status"]
): string {
  const keys: Record<ProjectIteration["status"], MessageKey> = {
    generated: "iterationGenerated",
    compiled: "iterationCompiled",
    reviewed: "iterationReviewed",
    accepted: "iterationAccepted",
    rejected: "iterationRejected",
    error: "iterationError"
  };
  return t(locale, keys[status]);
}

function projectTitle(project: ProjectState, fallback: string): string {
  const requirement = project.requirement.trim();
  if (!requirement) {
    return fallback;
  }
  return requirement.length > 28 ? `${requirement.slice(0, 28)}...` : requirement;
}

function PromptTracePanel(props: { entries: PromptTraceEntry[]; locale: Locale }) {
  const entries = props.entries.slice(-6).reverse();
  return (
    <section className="promptTrace" aria-label={t(props.locale, "aiPromptTrace")}>
      <div className="panelHeader">
        <h2>{t(props.locale, "aiPromptTrace")}</h2>
        <span>
          {props.entries.length} {t(props.locale, "events")}
        </span>
      </div>
      {entries.length ? (
        <div className="traceList">
          {entries.map((entry) => (
            <details key={entry.id} className="traceItem">
              <summary>
                <strong>{entry.phase}</strong>
                <span>{entry.modelId}</span>
                <time>{new Date(entry.createdAt).toLocaleTimeString()}</time>
              </summary>
              <TraceBlock title={t(props.locale, "system")} value={entry.systemPrompt} />
              <TraceBlock title={t(props.locale, "user")} value={entry.userPrompt} />
              {entry.response ? (
                <TraceBlock title={t(props.locale, "response")} value={entry.response} />
              ) : null}
            </details>
          ))}
        </div>
      ) : (
        <p className="emptyTrace">{t(props.locale, "emptyTrace")}</p>
      )}
    </section>
  );
}

function TraceBlock(props: { title: string; value: string }) {
  return (
    <div className="traceBlock">
      <span>{props.title}</span>
      <pre>{props.value}</pre>
    </div>
  );
}

function ViewImage(props: { label: string; src: string }) {
  return (
    <figure className="viewTile">
      {props.src ? <img alt={`${props.label} view`} src={props.src} /> : <div />}
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
