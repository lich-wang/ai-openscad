import { createOpenSCAD } from "openscad-wasm";
import { renderOpenScadToStl, type RenderResult } from "./render";

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
  const getOpenScad = () => {
    if (!instancePromise) {
      instancePromise = dependencies.createOpenSCAD().catch((error) => {
        instancePromise = null;
        throw error;
      });
    }
    return instancePromise;
  };

  return async (event: MessageEvent<RenderWorkerRequest>) => {
    const { id, code, kind = "compile" } = event.data;
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
          diagnostics: "Compiled to STL in browser."
        }
      });
    } catch (error) {
      dependencies.postMessage({
        id,
        result: {
          ok: false,
          diagnostics: error instanceof Error ? error.message : String(error)
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
