import { createOpenSCAD } from "openscad-wasm";
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
  let instancePromise: ReturnType<typeof createOpenSCAD> | null = null;
  let openScadLogs: string[] = [];
  const captureOpenScadLog = (text: unknown) => {
    openScadLogs.push(String(text));
  };
  const getOpenScad = () => {
    if (!instancePromise) {
      instancePromise = dependencies
        .createOpenSCAD({
          print: captureOpenScadLog,
          printErr: captureOpenScadLog
        })
        .catch((error) => {
          instancePromise = null;
          throw error;
        });
    }
    return instancePromise;
  };

  return async (event: MessageEvent<RenderWorkerRequest>) => {
    const { id, code, kind = "compile" } = event.data;
    openScadLogs = [];
    try {
      const instance = await getOpenScad();
      if (kind === "warmup") {
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
      const stl = await renderOpenScadToStl(instance, code);
      dependencies.postMessage({
        id,
        result: {
          ok: true,
          stl,
          diagnostics: buildRenderSuccessDiagnostics(openScadLogs)
        }
      });
    } catch (error) {
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

const handleRenderWorkerMessage = createRenderWorkerHandler({
  createOpenSCAD,
  postMessage: (message) => {
    self.postMessage(message);
  }
});

self.addEventListener("message", handleRenderWorkerMessage);
