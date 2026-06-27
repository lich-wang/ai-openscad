import { describe, expect, it, vi } from "vitest";
import { createRenderWorkerHandler } from "./renderWorker";

describe("renderWorker", () => {
  it("prewarms and reuses one initialized OpenSCAD instance across render jobs", async () => {
    const renderToStl = vi
      .fn()
      .mockResolvedValueOnce("solid first\nendsolid first")
      .mockResolvedValueOnce("solid second\nendsolid second");
    const createOpenSCAD = vi.fn().mockResolvedValue({ renderToStl });
    const posted: unknown[] = [];
    const handler = createRenderWorkerHandler({
      createOpenSCAD,
      postMessage: (message) => posted.push(message)
    });

    await handler({ data: { id: "warm", kind: "warmup" } } as MessageEvent);
    await handler({ data: { id: "first", kind: "compile", code: "cube(10);" } } as MessageEvent);
    await handler({ data: { id: "second", kind: "compile", code: "sphere(5);" } } as MessageEvent);

    expect(createOpenSCAD).toHaveBeenCalledTimes(1);
    expect(renderToStl).toHaveBeenCalledTimes(2);
    expect(renderToStl).toHaveBeenNthCalledWith(1, "cube(10);");
    expect(renderToStl).toHaveBeenNthCalledWith(2, "sphere(5);");
    expect(posted).toEqual([
      {
        id: "warm",
        result: {
          ok: true,
          diagnostics: "OpenSCAD worker warmed."
        }
      },
      {
        id: "first",
        result: {
          ok: true,
          stl: "solid first\nendsolid first",
          diagnostics: "Compiled to STL in browser."
        }
      },
      {
        id: "second",
        result: {
          ok: true,
          stl: "solid second\nendsolid second",
          diagnostics: "Compiled to STL in browser."
        }
      }
    ]);
  });

  it("retries OpenSCAD initialization after a failed warmup", async () => {
    const renderToStl = vi.fn().mockResolvedValue("solid recovered\nendsolid recovered");
    const createOpenSCAD = vi
      .fn()
      .mockRejectedValueOnce(new Error("wasm init failed"))
      .mockResolvedValueOnce({ renderToStl });
    const posted: unknown[] = [];
    const handler = createRenderWorkerHandler({
      createOpenSCAD,
      postMessage: (message) => posted.push(message)
    });

    await handler({ data: { id: "warm", kind: "warmup" } } as MessageEvent);
    await handler({ data: { id: "compile", kind: "compile", code: "cube(10);" } } as MessageEvent);

    expect(createOpenSCAD).toHaveBeenCalledTimes(2);
    expect(renderToStl).toHaveBeenCalledWith("cube(10);");
    expect(posted).toEqual([
      {
        id: "warm",
        result: {
          ok: false,
          diagnostics: "wasm init failed"
        }
      },
      {
        id: "compile",
        result: {
          ok: true,
          stl: "solid recovered\nendsolid recovered",
          diagnostics: "Compiled to STL in browser."
        }
      }
    ]);
  });
});
