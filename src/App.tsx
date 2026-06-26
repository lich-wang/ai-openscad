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
import { generateOpenScad, proposeRevision, reviewViews } from "./lib/apiClient";
import { captureOrthographicViews, downloadText } from "./lib/capture";
import { CODE_MODEL_PRESETS } from "./lib/models";
import {
  createEmptyProject,
  exportProject,
  importProject,
  loadApiKey,
  loadProject,
  saveApiKey,
  saveProject,
  type ProjectState
} from "./lib/project";
import { BrowserOpenScadAdapter } from "./lib/render";
import { acceptRevision, rejectRevision, setProposedRevision } from "./lib/workflow";

type BusyState = "idle" | "generating" | "compiling" | "reviewing";

export default function App() {
  const [project, setProject] = useState<ProjectState>(() => loadProject());
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState("");

  const adapter = useMemo(() => new BrowserOpenScadAdapter(), []);
  const isBusy = busy !== "idle";

  useEffect(() => {
    saveProject(project);
  }, [project]);

  useEffect(() => {
    saveApiKey(apiKey);
  }, [apiKey]);

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

  function requireApiKey() {
    if (!apiKey.trim()) {
      throw new Error("API key is required.");
    }
  }

  async function handleGenerate() {
    await runSafely("generating", async () => {
      requireApiKey();
      if (!project.requirement.trim()) {
        throw new Error("Requirement is required.");
      }
      const code = await generateOpenScad({
        apiKey,
        modelId: project.codeModelId,
        requirement: project.requirement
      });
      setProject((current) => ({
        ...current,
        currentCode: code,
        proposedCode: "",
        compilerOutput: "Generated OpenSCAD code.",
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
      const result = await adapter.compile(project.currentCode);
      if (!result.ok || !result.stl) {
        setProject((current) => ({
          ...current,
          compilerOutput: result.diagnostics,
          updatedAt: new Date().toISOString()
        }));
        throw new Error(result.diagnostics);
      }
      const views = await captureOrthographicViews(result.stl);
      setProject((current) => ({
        ...current,
        views,
        compilerOutput: result.diagnostics,
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
      requireApiKey();
      if (!project.views.front || !project.views.top || !project.views.right) {
        throw new Error("Compile the model before review.");
      }
      const review = await reviewViews({
        apiKey,
        requirement: project.requirement,
        code: project.currentCode,
        images: [project.views.front, project.views.top, project.views.right]
      });
      const proposedCode = await proposeRevision({
        apiKey,
        modelId: project.codeModelId,
        requirement: project.requirement,
        code: project.currentCode,
        review
      });
      setProject((current) => setProposedRevision(current, proposedCode, review));
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
            <span>API Key</span>
            <div className="keyInput">
              <KeyRound size={16} />
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
                type="password"
              />
            </div>
          </label>

          <label>
            <span>Code Model</span>
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

          <label className="growLabel">
            <span>Requirement</span>
            <textarea
              className="requirementInput"
              value={project.requirement}
              onChange={(event) => updateProject({ requirement: event.target.value })}
              placeholder="A 120x80x40mm six-slot organizer with rounded corners..."
            />
          </label>

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
          </div>

          <Status busy={busy} error={error} />
        </aside>

        <section className="panel codePanel">
          <div className="panelHeader">
            <h2>
              <Code2 size={18} />
              OpenSCAD
            </h2>
          </div>
          <textarea
            className="codeEditor"
            spellCheck={false}
            value={project.currentCode}
            onChange={(event) => updateProject({ currentCode: event.target.value })}
          />
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

function ViewImage(props: { label: string; src: string }) {
  return (
    <figure className="viewTile">
      {props.src ? <img alt={`${props.label} view`} src={props.src} /> : <div />}
      <figcaption>{props.label}</figcaption>
    </figure>
  );
}
