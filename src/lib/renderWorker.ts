import { createOpenSCAD, type OpenSCADInstance } from "openscad-wasm";
import {
  buildRenderFailureDiagnostics,
  buildRenderSuccessDiagnostics,
  renderOpenScadToStlWithBackend,
  type RenderResult
} from "./render";

interface RenderWorkerRequest {
  kind?: "compile" | "warmup";
  id: string;
  code?: string;
}

interface RenderWorkerDependencies {
  createOpenSCAD: typeof createOpenSCAD;
  postMessage: (message: { id: string; result: RenderResult }) => void;
}

interface PreparedOpenScad {
  instance: OpenSCADInstance;
  logs: string[];
}

export function createRenderWorkerHandler(dependencies: RenderWorkerDependencies) {
  let nextPrepared: Promise<PreparedOpenScad> | null = null;
  const startOpenScad = () => {
    // Each instance captures into its own log array so overlapping jobs (or
    // the prewarmed next instance) cannot corrupt another job's diagnostics.
    const logs: string[] = [];
    const capture = (text: unknown) => {
      logs.push(String(text));
    };
    const promise = dependencies
      .createOpenSCAD({
        print: capture,
        printErr: capture
      })
      .then((instance) => ({ instance, logs }))
      .catch((error) => {
        if (nextPrepared === promise) {
          nextPrepared = null;
        }
        throw error;
      });
    nextPrepared = promise;
    return promise;
  };
  const getPrepared = () => {
    if (!nextPrepared) {
      return startOpenScad();
    }
    return nextPrepared;
  };
  const consumePrepared = async () => {
    const prepared = await getPrepared();
    nextPrepared = null;
    return prepared;
  };
  const prewarmNextOpenScad = () => {
    if (!nextPrepared) {
      void startOpenScad();
    }
  };

  return async (event: MessageEvent<RenderWorkerRequest>) => {
    const { id, code, kind = "compile" } = event.data;
    let jobLogs: string[] = [];
    try {
      if (kind === "warmup") {
        await getPrepared();
        dependencies.postMessage({
          id,
          result: {
            ok: true,
            diagnostics: "OpenSCAD worker warmed."
          }
        });
        return;
      }
      if (!code) {
        throw new Error("OpenSCAD code is required.");
      }
      const { instance, logs } = await consumePrepared();
      jobLogs = logs;
      let stl = "";
      let backend = "web-default";
      try {
        const rendered = await renderOpenScadToStlWithBackend(instance, code);
        stl = rendered.stl;
        backend = rendered.backend;
      } finally {
        cleanupConsumedOpenScad(instance);
        prewarmNextOpenScad();
      }
      dependencies.postMessage({
        id,
        result: {
          ok: true,
          stl,
          backend,
          diagnostics: buildRenderSuccessDiagnostics(jobLogs)
        }
      });
    } catch (error) {
      prewarmNextOpenScad();
      dependencies.postMessage({
        id,
        result: {
          ok: false,
          diagnostics: buildRenderFailureDiagnostics(error, jobLogs)
        }
      });
    }
  };
}

function cleanupConsumedOpenScad(instance: OpenSCADInstance): void {
  try {
    const fs = instance.getInstance?.().FS as { quit?: () => void } | undefined;
    fs?.quit?.();
  } catch {
    // openscad-wasm does not expose a public dispose API; FS cleanup is best effort.
  }
}

const handleRenderWorkerMessage = createRenderWorkerHandler({
  createOpenSCAD,
  postMessage: (message) => {
    self.postMessage(message);
  }
});

self.addEventListener("message", handleRenderWorkerMessage);
