import { createOpenSCAD } from "openscad-wasm";
import type { RenderResult } from "./render";

interface RenderWorkerRequest {
  id: string;
  code: string;
}

self.addEventListener("message", async (event: MessageEvent<RenderWorkerRequest>) => {
  const { id, code } = event.data;
  try {
    const instance = await createOpenSCAD();
    const stl = await instance.renderToStl(code);
    postResult(id, {
      ok: true,
      stl,
      diagnostics: "Compiled to STL in browser."
    });
  } catch (error) {
    postResult(id, {
      ok: false,
      diagnostics: error instanceof Error ? error.message : String(error)
    });
  }
});

function postResult(id: string, result: RenderResult): void {
  self.postMessage({ id, result });
}
