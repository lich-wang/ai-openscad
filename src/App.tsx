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
import { captureOrthographicViews, downloadText } from "./lib/capture";
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
  loadProject,
  loadVisionApiKey,
  saveLlmApiKey,
  saveProject,
  saveVisionApiKey,
  type ProjectIteration,
  type PromptTraceEntry,
  type ProjectState
} from "./lib/project";
import { BrowserOpenScadAdapter } from "./lib/render";
import {
  buildRenderPrecisionInstruction,
  normalizeOpenScadPrecision
} from "./lib/renderSkill";
import { acceptRevision, rejectRevision, setProposedRevision } from "./lib/workflow";

type BusyState = "idle" | "generating" | "compiling" | "reviewing" | "exporting";

export default function App() {
  const [project, setProject] = useState<ProjectState>(() => loadProject());
  const [llmApiKey, setLlmApiKey] = useState(() => loadLlmApiKey());
  const [visionApiKey, setVisionApiKey] = useState(() => loadVisionApiKey());
  const [iterationNotes, setIterationNotes] = useState("");
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState("");

  const locale = getBrowserLocale();
  const tr = (key: MessageKey) => t(locale, key);
  const adapter = useMemo(() => new BrowserOpenScadAdapter(), []);
  const isBusy = busy !== "idle";
  const hasRenderedViews = Boolean(project.views.front && project.views.top && project.views.right);
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
      llmText: `${project.requirement}\n${project.currentCode}\n${project.review?.summary ?? ""}\n${iterationNotes}`,
      visionText: `${project.requirement}\n${project.currentCode}`,
      imageCount
    });
  }, [iterationNotes, project.currentCode, project.requirement, project.review, project.views]);

  async function runSafely(action: BusyState, task: () => Promise<void>) {
    setBusy(action);
    setError("");
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
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
      const rendered = await compileDraftCode(code);
      if (!rendered.ok || !rendered.views) {
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
        views: rendered.views,
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
      if (!rendered.ok || !rendered.views) {
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
    const draftCode = normalizeOpenScadPrecision(code, "draft");
    const result = await adapter.compile(draftCode);
    const trace = createPromptTraceEntry({
      phase: "compile",
      modelId: "browser-openscad",
      systemPrompt: buildRenderPrecisionInstruction("draft"),
      userPrompt: tr("compileDraftTrace"),
      response: result.diagnostics
    });
    if (!result.ok || !result.stl) {
      return {
        ok: false,
        diagnostics: result.diagnostics,
        trace,
        views: null
      };
    }
    return {
      ok: true,
      diagnostics: result.diagnostics,
      trace,
      views: await captureOrthographicViews(result.stl)
    };
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
        promptTrace: [...current.promptTrace, reviewTrace],
        compilerOutput: tr("visionComplete")
      }));
      requireLlmApiKey();
      setProject((current) => ({
        ...current,
        proposedCode: ""
      }));
      const { code: proposedCode, trace: revisionTrace } = await proposeRevision({
        apiKey: llmApiKey,
        modelId: project.codeModelId,
        requirement: project.requirement,
        code: project.currentCode,
        review,
        precision: "draft",
        onToken: (streamedCode) => {
          setProject((current) => ({
            ...current,
            proposedCode: streamedCode
          }));
        }
      });
      setProject((current) => ({
        ...setProposedRevision(current, proposedCode, review),
        promptTrace: [...current.promptTrace, revisionTrace]
      }));
    });
  }

  async function handleIterateAgain() {
    await runSafely("generating", async () => {
      requireLlmApiKey();
      if (!project.review) {
        throw new Error(tr("reviewBeforeIterate"));
      }
      setProject((current) => ({
        ...current,
        proposedCode: "",
        compilerOutput: tr("streamingIteration")
      }));
      const { code: proposedCode, trace } = await proposeRevision({
        apiKey: llmApiKey,
        modelId: project.codeModelId,
        requirement: project.requirement,
        code: project.currentCode,
        review: project.review,
        userNotes: iterationNotes,
        precision: "draft",
        onToken: (streamedCode) => {
          setProject((current) => ({
            ...current,
            proposedCode: streamedCode
          }));
        }
      });
      setProject((current) => ({
        ...setProposedRevision(current, proposedCode, project.review!),
        promptTrace: [...current.promptTrace, trace]
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
      const result = await adapter.compile(finalCode);
      const trace = createPromptTraceEntry({
        phase: "final-export",
        modelId: "browser-openscad",
        systemPrompt: buildRenderPrecisionInstruction("final"),
        userPrompt: tr("finalExportTrace"),
        response: result.diagnostics
      });
      if (!result.ok || !result.stl) {
        setProject((current) => ({
          ...current,
          compilerOutput: result.diagnostics,
          promptTrace: [...current.promptTrace, trace],
          updatedAt: new Date().toISOString()
        }));
        throw new Error(result.diagnostics);
      }
      const views = await captureOrthographicViews(result.stl);
      downloadText("ai-openscad-final.scad", finalCode, "text/plain;charset=utf-8");
      setProject((current) => ({
        ...current,
        currentCode: finalCode,
        views,
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
      if (!rendered.ok || !rendered.views) {
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
    if (hasModelWork && !window.confirm(tr("newModelConfirm"))) {
      return;
    }
    setProject(createEmptyProject());
    setIterationNotes("");
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
        setProject(importProject(content));
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
        <div className="topbarActions">
          <label className="iconButton fileButton" title={tr("importProject")}>
            <FileUp size={18} />
            <input accept="application/json" type="file" onChange={handleImport} />
          </label>
          <button
            className="iconButton"
            title={tr("exportProject")}
            onClick={() =>
              downloadText("ai-openscad-project.json", exportProject(project))
            }
          >
            <Download size={18} />
          </button>
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

          <Status busy={busy} error={error} locale={locale} />
        </aside>

        <section className="panel codePanel agentPanel">
          <AgentRunPanel busy={busy} locale={locale} project={project} />
          <section className="agentComposer">
            <div className="panelHeader">
              <h2>{tr("agentComposer")}</h2>
              <span>{tr("draftPrecision")}</span>
            </div>
            <textarea
              className="requirementInput"
              value={project.requirement}
              onChange={(event) => updateProject({ requirement: event.target.value })}
              placeholder={tr("requirementPlaceholder")}
            />
            <textarea
              className="iterationInput"
              value={iterationNotes}
              onChange={(event) => setIterationNotes(event.target.value)}
              placeholder={tr("iterationPlaceholder")}
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
              {project.review ? (
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

          <section className="outputBlock">
            <h3>{tr("compiler")}</h3>
            <pre>{project.compilerOutput || tr("noCompileOutput")}</pre>
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
  locale: Locale;
  project: ProjectState;
}) {
  const latestTrace = props.project.promptTrace.slice(-4).reverse();
  return (
    <section className="agentRun">
      <div className="panelHeader">
        <h2>{t(props.locale, "agentRun")}</h2>
        <span>
          {props.busy === "idle"
            ? t(props.locale, "ready")
            : busyStatusLabel(props.locale, props.busy)}
        </span>
      </div>
      <div className="agentTimeline">
        <article className="agentEvent userEvent">
          <h3>{t(props.locale, "userRequest")}</h3>
          <p>{props.project.requirement || t(props.locale, "missingRequirement")}</p>
        </article>

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

        {props.project.currentCode ? (
          <article className="agentEvent">
            <h3>{t(props.locale, "generatedOutput")}</h3>
            <p>{t(props.locale, "codeDetails")}</p>
          </article>
        ) : null}

        {props.project.views.front || props.project.views.top || props.project.views.right ? (
          <article className="agentEvent">
            <h3>{t(props.locale, "draftRender")}</h3>
            <p>{props.project.compilerOutput || t(props.locale, "compiledDraft")}</p>
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

function Status(props: { busy: BusyState; error: string; locale: Locale }) {
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
