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
import { CODE_MODEL_PRESETS, VISION_MODEL_PRESETS } from "./lib/models";
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

  const adapter = useMemo(() => new BrowserOpenScadAdapter(), []);
  const isBusy = busy !== "idle";

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
    if (!llmApiKey.trim()) {
      throw new Error("LLM API key is required.");
    }
  }

  function requireVisionApiKey() {
    if (!visionApiKey.trim()) {
      throw new Error("Vision API key is required.");
    }
  }

  async function handleGenerate() {
    await runSafely("generating", async () => {
      requireLlmApiKey();
      if (!project.requirement.trim()) {
        throw new Error("Requirement is required.");
      }
      setProject((current) => ({
        ...current,
        currentCode: "",
        proposedCode: "",
        compilerOutput: "Streaming OpenSCAD from LLM..."
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
            compilerOutput: "Streaming OpenSCAD from LLM..."
          }));
        }
      });
      setProject((current) => ({
        ...current,
        currentCode: code,
        proposedCode: "",
        compilerOutput: "Generated OpenSCAD code.",
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
    });
  }

  async function handleCompile() {
    await runSafely("compiling", async () => {
      if (!project.currentCode.trim()) {
        throw new Error("OpenSCAD code is required.");
      }
      const draftCode = normalizeOpenScadPrecision(project.currentCode, "draft");
      const result = await adapter.compile(draftCode);
      const trace = createPromptTraceEntry({
        phase: "compile",
        modelId: "browser-openscad",
        systemPrompt: buildRenderPrecisionInstruction("draft"),
        userPrompt: "Compile current OpenSCAD with draft precision for fast review.",
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
      setProject((current) => ({
        ...current,
        views,
        compilerOutput: `${result.diagnostics}\nDraft precision was used for fast review.`,
        promptTrace: [...current.promptTrace, trace],
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

  async function handleReview() {
    await runSafely("reviewing", async () => {
      if (!project.views.front || !project.views.top || !project.views.right) {
        throw new Error("Compile the model before review.");
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
        compilerOutput: "Vision review complete. Streaming revision proposal..."
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
        throw new Error("Run vision review before iterating again.");
      }
      setProject((current) => ({
        ...current,
        proposedCode: "",
        compilerOutput: "Streaming review-driven iteration from LLM..."
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
    const confirmed = window.confirm(
      "Generate high precision final images and export SCAD? This can be slower than draft review."
    );
    if (!confirmed) {
      return;
    }
    await runSafely("exporting", async () => {
      if (!project.currentCode.trim()) {
        throw new Error("OpenSCAD code is required.");
      }
      const finalCode = normalizeOpenScadPrecision(project.currentCode, "final");
      const result = await adapter.compile(finalCode);
      const trace = createPromptTraceEntry({
        phase: "final-export",
        modelId: "browser-openscad",
        systemPrompt: buildRenderPrecisionInstruction("final"),
        userPrompt: "User confirmed high precision final export.",
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
        compilerOutput: `${result.diagnostics}\nHigh precision final export generated.`,
        promptTrace: [...current.promptTrace, trace],
        updatedAt: new Date().toISOString()
      }));
    });
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
          <h1>AI OpenSCAD</h1>
          <p>Text to code to model to visual review.</p>
        </div>
        <div className="topbarActions">
          <button
            className="iconButton"
            title="New project"
            onClick={() => setProject(createEmptyProject())}
          >
            <RefreshCw size={18} />
          </button>
          <label className="iconButton fileButton" title="Import project">
            <FileUp size={18} />
            <input accept="application/json" type="file" onChange={handleImport} />
          </label>
          <button
            className="iconButton"
            title="Export project"
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
          <label>
            <span>LLM API Key</span>
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

          <label>
            <span>LLM Model</span>
            <select
              value={project.codeModelId}
              onChange={(event) => updateProject({ codeModelId: event.target.value })}
            >
              {CODE_MODEL_PRESETS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Vision API Key</span>
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

          <label>
            <span>Vision Model</span>
            <select
              value={project.visionModelId}
              onChange={(event) => updateProject({ visionModelId: event.target.value })}
            >
              {VISION_MODEL_PRESETS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          <label className="growLabel">
            <span>Requirement</span>
            <textarea
              className="requirementInput"
              value={project.requirement}
              onChange={(event) => updateProject({ requirement: event.target.value })}
              placeholder="A 120x80x40mm six-slot organizer with rounded corners..."
            />
          </label>

          <label>
            <span>Iteration Notes</span>
            <textarea
              className="iterationInput"
              value={iterationNotes}
              onChange={(event) => setIterationNotes(event.target.value)}
              placeholder="结合评审结果再次修改，例如：杯壁再薄一点，把手更大..."
            />
          </label>

          <div className="tokenPanel">
            <div>
              <span>LLM tokens</span>
              <strong>{tokenUsage.llmTokens}</strong>
            </div>
            <div>
              <span>Vision tokens</span>
              <strong>{tokenUsage.visionTokens}</strong>
            </div>
          </div>

          <div className="buttonGrid">
            <button disabled={isBusy} onClick={handleGenerate}>
              <Send size={16} />
              Generate
            </button>
            <button disabled={isBusy} onClick={handleCompile}>
              <Play size={16} />
              Compile
            </button>
            <button disabled={isBusy} onClick={handleReview}>
              <Eye size={16} />
              Review
            </button>
            <button disabled={isBusy} onClick={handleIterateAgain}>
              <RefreshCw size={16} />
              Iterate Again
            </button>
            <button disabled={isBusy} onClick={handleHighPrecisionExport}>
              <Download size={16} />
              Final Export
            </button>
          </div>

          <Status busy={busy} error={error} />
        </aside>

        <section className="panel codePanel">
          <PromptTracePanel entries={project.promptTrace} />
          <section className="codeBlock">
            <div className="panelHeader">
              <h2>
                <Code2 size={18} />
                OpenSCAD
              </h2>
              <span className="precisionBadge">Draft preview uses low precision</span>
            </div>
            <textarea
              className="codeEditor"
              spellCheck={false}
              value={project.currentCode}
              onChange={(event) => updateProject({ currentCode: event.target.value })}
            />
          </section>
          {project.proposedCode ? (
            <div className="revisionArea">
              <div className="panelHeader compact">
                <h2>Proposed Revision</h2>
                <div className="inlineActions">
                  <button
                    className="smallButton success"
                    onClick={() => setProject((current) => acceptRevision(current))}
                  >
                    <Check size={15} />
                    Accept
                  </button>
                  <button
                    className="smallButton"
                    onClick={() => setProject((current) => rejectRevision(current))}
                  >
                    <X size={15} />
                    Reject
                  </button>
                </div>
              </div>
              <textarea
                className="codeEditor proposed"
                spellCheck={false}
                value={project.proposedCode}
                onChange={(event) => updateProject({ proposedCode: event.target.value })}
              />
            </div>
          ) : null}
        </section>

        <aside className="panel resultPanel">
          <div className="panelHeader">
            <h2>Views</h2>
          </div>
          <div className="viewGrid">
            <ViewImage label="Front" src={project.views.front} />
            <ViewImage label="Top" src={project.views.top} />
            <ViewImage label="Right" src={project.views.right} />
          </div>

          <section className="outputBlock">
            <h3>Compiler</h3>
            <pre>{project.compilerOutput || "No compile output yet."}</pre>
          </section>

          <section className="outputBlock">
            <h3>Review</h3>
            {project.review ? (
              <>
                <p>{project.review.summary}</p>
                <ul>
                  {project.review.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
                <p className="confidence">
                  Confidence {Math.round(project.review.confidence * 100)}%
                </p>
              </>
            ) : (
              <p>No review yet.</p>
            )}
          </section>

          <section className="outputBlock historyBlock">
            <h3>History</h3>
            <ol>
              {project.iterations.slice(-8).map((iteration) => (
                <li key={iteration.id}>
                  <span>{iteration.status}</span>
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

function Status(props: { busy: BusyState; error: string }) {
  if (props.error) {
    return <p className="status error">{props.error}</p>;
  }
  if (props.busy !== "idle") {
    return <p className="status">Working: {props.busy}</p>;
  }
  return <p className="status">Ready</p>;
}

function PromptTracePanel(props: { entries: PromptTraceEntry[] }) {
  const entries = props.entries.slice(-6).reverse();
  return (
    <section className="promptTrace" aria-label="AI prompt trace">
      <div className="panelHeader">
        <h2>AI Prompt Trace</h2>
        <span>{props.entries.length} events</span>
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
              <TraceBlock title="System" value={entry.systemPrompt} />
              <TraceBlock title="User" value={entry.userPrompt} />
              {entry.response ? <TraceBlock title="Response" value={entry.response} /> : null}
            </details>
          ))}
        </div>
      ) : (
        <p className="emptyTrace">Generate, compile, or review to see prompts here.</p>
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
