import { describe, expect, it, vi } from "vitest";
import { createRenderWorkerHandler } from "./renderWorker";

describe("renderWorker", () => {
  it("keeps the worker alive but uses each prewarmed OpenSCAD instance for one compile", async () => {
    let createdInstances = 0;
    const renderToStlCalls: string[] = [];
    const createOpenSCAD = vi.fn(async () => {
      createdInstances += 1;
      const instanceId = createdInstances;
      let compileCalls = 0;
      return {
        renderToStl: async (code: string) => {
          compileCalls += 1;
          if (compileCalls > 1) {
            throw 1140584;
          }
          renderToStlCalls.push(`${instanceId}:${code}`);
          return `solid instance-${instanceId}\nendsolid instance-${instanceId}`;
        }
      };
    });
    const posted: unknown[] = [];
    const handler = createRenderWorkerHandler({
      createOpenSCAD,
      postMessage: (message) => posted.push(message)
    });

    await handler({ data: { id: "warm", kind: "warmup" } } as MessageEvent);
    await handler({ data: { id: "first", kind: "compile", code: "cube(10);" } } as MessageEvent);
    await handler({ data: { id: "second", kind: "compile", code: "sphere(5);" } } as MessageEvent);

    expect(createOpenSCAD).toHaveBeenCalledTimes(3);
    expect(renderToStlCalls).toEqual(["1:cube(10);", "2:sphere(5);"]);
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
          stl: "solid instance-1\nendsolid instance-1",
          diagnostics: "Compiled to STL in browser."
        }
      },
      {
        id: "second",
        result: {
          ok: true,
          stl: "solid instance-2\nendsolid instance-2",
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
      .mockResolvedValueOnce({ renderToStl })
      .mockResolvedValueOnce({ renderToStl: vi.fn() });
    const posted: unknown[] = [];
    const handler = createRenderWorkerHandler({
      createOpenSCAD,
      postMessage: (message) => posted.push(message)
    });

    await handler({ data: { id: "warm", kind: "warmup" } } as MessageEvent);
    await handler({ data: { id: "compile", kind: "compile", code: "cube(10);" } } as MessageEvent);

    expect(createOpenSCAD).toHaveBeenCalledTimes(3);
    expect(renderToStl).toHaveBeenCalledWith("cube(10);");
    expect(posted[0]).toMatchObject({
      id: "warm",
      result: {
        ok: false,
        diagnostics: expect.stringContaining("wasm init failed")
      }
    });
    expect(posted[1]).toEqual({
      id: "compile",
      result: {
        ok: true,
        stl: "solid recovered\nendsolid recovered",
        diagnostics: "Compiled to STL in browser."
      }
    });
  });

  it("returns readable OpenSCAD diagnostics when compilation throws a numeric code", async () => {
    const createOpenSCAD = vi.fn(async (options?: { printErr?: (text: string) => void }) => ({
      renderToStl: async () => {
        options?.printErr?.("WARNING: Can't open include file 'BOSL2/std.scad'.");
        options?.printErr?.("WARNING: Ignoring unknown module 'ellipse'.");
        throw 1371176;
      }
    }));
    const posted: Array<{
      id: string;
      result: {
        ok: boolean;
        diagnostics: string;
      };
    }> = [];
    const handler = createRenderWorkerHandler({
      createOpenSCAD,
      postMessage: (message) => posted.push(message)
    });

    await handler({ data: { id: "compile", kind: "compile", code: "ellipse();" } } as MessageEvent);

    expect(posted).toHaveLength(1);
    expect(posted[0].result.ok).toBe(false);
    expect(posted[0].result.diagnostics).toContain("OpenSCAD render failed");
    expect(posted[0].result.diagnostics).toContain("non-text error code: 1371176");
    expect(posted[0].result.diagnostics).toContain("BOSL2/std.scad");
    expect(posted[0].result.diagnostics).toContain("unknown module 'ellipse'");
  });

  it("cleans up consumed OpenSCAD instances after each compile", async () => {
    let createdInstances = 0;
    const cleanedInstances: number[] = [];
    const createOpenSCAD = vi.fn(async () => {
      createdInstances += 1;
      const instanceId = createdInstances;
      const files = new Map<string, string>();
      return {
        renderToStl: async () => {
          throw new Error("direct callMain path should run");
        },
        getInstance: () => ({
          callMain: () => {
            files.set("/output.stl", `solid instance-${instanceId}\nendsolid instance-${instanceId}`);
            return 0;
          },
          FS: {
            writeFile: (path: string, contents: string) => files.set(path, contents),
            readFile: (path: string) => files.get(path) ?? "",
            unlink: (path: string) => files.delete(path),
            quit: () => cleanedInstances.push(instanceId)
          }
        })
      };
    });
    const posted: unknown[] = [];
    const handler = createRenderWorkerHandler({
      createOpenSCAD,
      postMessage: (message) => posted.push(message)
    });

    await handler({ data: { id: "first", kind: "compile", code: "cube(10);" } } as MessageEvent);
    await handler({ data: { id: "second", kind: "compile", code: "sphere(5);" } } as MessageEvent);

    expect(createOpenSCAD).toHaveBeenCalledTimes(3);
    expect(cleanedInstances).toEqual([1, 2]);
    expect(posted).toEqual([
      {
        id: "first",
        result: {
          ok: true,
          stl: "solid instance-1\nendsolid instance-1",
          diagnostics: "Compiled to STL in browser."
        }
      },
      {
        id: "second",
        result: {
          ok: true,
          stl: "solid instance-2\nendsolid instance-2",
          diagnostics: "Compiled to STL in browser."
        }
      }
    ]);
  });
});
