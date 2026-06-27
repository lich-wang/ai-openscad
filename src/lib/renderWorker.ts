import { createOpenSCAD, type OpenSCADInstance } from "openscad-wasm";
import {
  buildRenderFailureDiagnostics,
  buildRenderSuccessDiagnostics,
  renderOpenScadToStl,
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

export function createRenderWorkerHandler(dependencies: RenderWorkerDependencies) {
  let nextInstancePromise: ReturnType<typeof createOpenSCAD> | null = null;
  let openScadLogs: string[] = [];
  const captureOpenScadLog = (text: unknown) => {
    openScadLogs.push(String(text));
  };
  const startOpenScad = () => {
    const promise = dependencies
      .createOpenSCAD({
        print: captureOpenScadLog,
        printErr: captureOpenScadLog
      })
      .catch((error) => {
        if (nextInstancePromise === promise) {
          nextInstancePromise = null;
        }
        throw error;
      });
    nextInstancePromise = promise;
    return promise;
  };
  const getOpenScad = () => {
    if (!nextInstancePromise) {
      return startOpenScad();
    }
    return nextInstancePromise;
  };
  const consumeOpenScad = async () => {
    const instance = await getOpenScad();
    nextInstancePromise = null;
    return instance;
  };
  const prewarmNextOpenScad = () => {
    if (!nextInstancePromise) {
      void startOpenScad();
    }
  };

  return async (event: MessageEvent<RenderWorkerRequest>) => {
    const { id, code, kind = "compile" } = event.data;
    openScadLogs = [];
    try {
      if (kind === "warmup") {
        await getOpenScad();
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
      const instance = await consumeOpenScad();
      let stl = "";
      try {
        stl = await renderOpenScadToStl(instance, code);
      } finally {
        cleanupConsumedOpenScad(instance);
        prewarmNextOpenScad();
      }
      dependencies.postMessage({
        id,
        result: {
          ok: true,
          stl,
          diagnostics: buildRenderSuccessDiagnostics(openScadLogs)
        }
      });
    } catch (error) {
      prewarmNextOpenScad();
      dependencies.postMessage({
        id,
        result: {
          ok: false,
          diagnostics: buildRenderFailureDiagnostics(error, openScadLogs)
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
