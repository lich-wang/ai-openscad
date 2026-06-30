import { createOpenSCAD } from "openscad-wasm";
import { describe, expect, it } from "vitest";
import {
  createRenderMcp,
  renderOpenScadToStl,
  renderOpenScadToStlWithBackend,
  WebRenderMcpAdapter
} from "./render";

describe("WebRenderMcpAdapter", () => {
  it("returns a structured failure when the wasm runtime cannot load", async () => {
    const adapter = new WebRenderMcpAdapter(async () => {
      throw new Error("wasm unavailable");
    });

    const result = await adapter.compile("cube(10);");

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContain("wasm unavailable");
  });

  it("returns a structured timeout when OpenSCAD compilation never settles", async () => {
    const adapter = new WebRenderMcpAdapter({
      loadOpenScad: async () =>
        ({
          renderToStl: () => new Promise<string>(() => undefined)
        }) as never,
      timeoutMs: 10
    });

    const result = await adapter.compile("cube(");

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContain("timed out");
    expect(result.diagnostics).toContain("reduce model complexity");
    expect(result.diagnostics).not.toContain("browser draft render complexity budget");
  });

  it("runs browser compilation through a persistent worker", async () => {
    const worker = new FakeRenderWorker((message) => ({
      id: message.id,
      result: {
        ok: true,
        stl: "solid cube\nendsolid cube",
        diagnostics: "Compiled to STL in browser."
      }
    }));
    const adapter = new WebRenderMcpAdapter({
      createWorker: () => worker.asWorker(),
      timeoutMs: 1_000
    });

    const result = await adapter.compile("cube(10);");

    expect(result.ok).toBe(true);
    expect(result.stl).toContain("solid cube");
    expect(worker.postedMessages.at(-1)?.code).toBe("cube(10);");
    expect(worker.terminated).toBe(false);
  });

  it("reuses the same worker for subsequent successful compiles", async () => {
    const workers: FakeRenderWorker[] = [];
    const adapter = new WebRenderMcpAdapter({
      createWorker: () => {
        const worker = new FakeRenderWorker((message) => ({
          id: message.id,
          result: {
            ok: true,
            stl: `solid ${message.code}\nendsolid`,
            diagnostics: "Compiled to STL in browser."
          }
        }));
        workers.push(worker);
        return worker.asWorker();
      },
      timeoutMs: 1_000
    });

    const first = await adapter.compile("cube(10);");
    const second = await adapter.compile("sphere(5);");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(workers).toHaveLength(1);
    expect(workers[0].postedMessages.map((message) => message.code)).toEqual([
      "cube(10);",
      "sphere(5);"
    ]);
    expect(workers[0].terminated).toBe(false);
  });

  it("prewarms the persistent worker before a visible render", () => {
    const worker = new FakeRenderWorker((message) => ({
      id: message.id,
      result: {
        ok: true,
        diagnostics: "OpenSCAD worker warmed."
      }
    }));
    const adapter = new WebRenderMcpAdapter({
      createWorker: () => worker.asWorker(),
      timeoutMs: 1_000
    });

    adapter.prewarm();

    expect(worker.postedMessages).toHaveLength(1);
    expect(worker.postedMessages[0].kind).toBe("warmup");
  });

  it("renders OpenSCAD source to STL and six multi-angle view images", async () => {
    const worker = new FakeRenderWorker((message) => ({
      id: message.id,
      result: {
        ok: true,
        stl: "solid cup\nendsolid cup",
        diagnostics: "Compiled to STL in browser."
      }
    }));
    const adapter = new WebRenderMcpAdapter({
      createWorker: () => worker.asWorker(),
      captureViews: async (stl, options) => {
        await options.onProgress?.("front");
        await options.onProgress?.("back");
        await options.onProgress?.("left");
        await options.onProgress?.("right");
        await options.onProgress?.("top");
        await options.onProgress?.("isometric");
        return {
          front: `front:${stl}`,
          back: `back:${stl}`,
          left: `left:${stl}`,
          right: `right:${stl}`,
          top: `top:${stl}`,
          isometric: `isometric:${stl}`
        };
      },
      timeoutMs: 1_000
    });
    const stages: string[] = [];

    const result = await adapter.render({
      source: "cube(10);",
      onProgress: (stage) => stages.push(stage)
    });

    expect(worker.postedMessages.at(-1)?.code).toBe("cube(10);");
    expect(result.ok).toBe(true);
    expect(result.stl).toBe("solid cup\nendsolid cup");
    expect(result.views).toEqual({
      front: "front:solid cup\nendsolid cup",
      back: "back:solid cup\nendsolid cup",
      left: "left:solid cup\nendsolid cup",
      right: "right:solid cup\nendsolid cup",
      top: "top:solid cup\nendsolid cup",
      isometric: "isometric:solid cup\nendsolid cup"
    });
    expect(stages).toEqual(["compile", "front", "back", "left", "right", "top", "isometric"]);
  });

  it("does not capture views when OpenSCAD compilation fails", async () => {
    const adapter = new WebRenderMcpAdapter({
      loadOpenScad: async () =>
        ({
          renderToStl: async () => {
            throw new Error("syntax error");
          }
        }) as never,
      captureViews: async () => {
        throw new Error("should not capture");
      }
    });

    const result = await adapter.render({ source: "cube(" });

    expect(result.ok).toBe(false);
    expect(result.views).toBeUndefined();
    expect(result.diagnostics).toContain("syntax error");
  });

  it("returns readable diagnostics when view capture throws a numeric code", async () => {
    const worker = new FakeRenderWorker((message) => ({
      id: message.id,
      result: {
        ok: true,
        stl: "solid cup\nendsolid cup",
        backend: "web-manifold",
        diagnostics: [
          "Compiled to STL in browser.",
          "OpenSCAD diagnostics:",
          "WARNING: Ignoring unknown module 'ellipse'."
        ].join("\n")
      }
    }));
    const adapter = new WebRenderMcpAdapter({
      createWorker: () => worker.asWorker(),
      captureViews: async () => {
        throw 1114200;
      },
      timeoutMs: 1_000
    });

    const result = await adapter.render({ source: "ellipse();" });

    expect(result.ok).toBe(false);
    expect(result.stl).toBe("solid cup\nendsolid cup");
    expect(result.backend).toBe("web-manifold");
    expect(result.views).toBeUndefined();
    expect(result.diagnostics).toContain("OpenSCAD render failed");
    expect(result.diagnostics).toContain("non-text error code: 1114200");
    expect(result.diagnostics).toContain("unknown module 'ellipse'");
  });

  it("terminates and recreates the worker when asynchronous compilation times out", async () => {
    const firstWorker = new FakeRenderWorker(() => undefined);
    const secondWorker = new FakeRenderWorker((message) => ({
      id: message.id,
      result: {
        ok: true,
        stl: "solid recovered\nendsolid",
        diagnostics: "Compiled to STL in browser."
      }
    }));
    const workers = [firstWorker, secondWorker];
    const adapter = new WebRenderMcpAdapter({
      createWorker: () => workers.shift()?.asWorker() as Worker,
      timeoutMs: 10
    });

    const result = await adapter.compile("cube(");
    const recovered = await adapter.compile("cube(10);");

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContain("timed out");
    expect(result.diagnostics).toContain("reduce model complexity");
    expect(result.diagnostics).not.toContain("browser draft render complexity budget");
    expect(firstWorker.terminated).toBe(true);
    expect(recovered.ok).toBe(true);
    expect(secondWorker.postedMessages.at(-1)?.code).toBe("cube(10);");
  });

  it("creates the current render MCP in web provider mode", () => {
    const adapter = createRenderMcp("web");

    expect(adapter).toBeInstanceOf(WebRenderMcpAdapter);
  });

  it("prefers the Manifold backend when rendering STL through the OpenSCAD instance", async () => {
    const calls: string[][] = [];
    const files = new Map<string, string>();
    const instance = {
      renderToStl: async () => {
        throw new Error("default backend should not run");
      },
      getInstance: () => ({
        callMain: (args: string[]) => {
          calls.push(args);
          files.set("/output.stl", "solid manifold\nendsolid manifold");
          return 0;
        },
        FS: {
          writeFile: (path: string, contents: string) => files.set(path, contents),
          readFile: (path: string) => files.get(path) ?? "",
          unlink: (path: string) => files.delete(path)
        }
      })
    };

    const stl = await renderOpenScadToStl(instance as never, "cube(10);");
    const rendered = await renderOpenScadToStlWithBackend(instance as never, "cube(10);");

    expect(stl).toContain("solid manifold");
    expect(rendered.backend).toBe("web-manifold");
    expect(calls[0]).toEqual([
      "/input.scad",
      "--backend=manifold",
      "-o",
      "/output.stl"
    ]);
  });

  it("falls back to the default backend when Manifold rendering fails", async () => {
    const instance = {
      renderToStl: async () => "solid fallback\nendsolid fallback",
      getInstance: () => ({
        callMain: () => 1,
        FS: {
          writeFile: () => undefined,
          readFile: () => {
            throw new Error("missing output");
          },
          unlink: () => undefined
        }
      })
    };

    const stl = await renderOpenScadToStl(instance as never, "cube(10);");
    const rendered = await renderOpenScadToStlWithBackend(instance as never, "cube(10);");

    expect(stl).toContain("solid fallback");
    expect(rendered.backend).toBe("web-default");
  });

  it("accepts the real Manifold backend flag in the current wasm build", async () => {
    const errors: string[] = [];
    const instance = await createOpenSCAD({
      printErr: (text) => errors.push(text)
    });

    const stl = await renderOpenScadToStl(instance, "cube(10);");

    expect(stl).toContain("solid");
    expect(stl).toContain("endsolid");
    expect(errors.join("\n")).not.toContain("Unknown rendering backend 'manifold'");
    expect(errors.join("\n")).not.toContain("Ignoring request to enable unknown feature 'manifold'");
  }, 20_000);

  it("recreates the worker after a worker error event", async () => {
    const firstWorker = new FakeRenderWorker(() => new Error("worker crashed"));
    const secondWorker = new FakeRenderWorker((message) => ({
      id: message.id,
      result: {
        ok: true,
        stl: "solid recovered\nendsolid",
        diagnostics: "Compiled to STL in browser."
      }
    }));
    const workers = [firstWorker, secondWorker];
    const adapter = new WebRenderMcpAdapter({
      createWorker: () => workers.shift()?.asWorker() as Worker,
      timeoutMs: 1_000
    });

    const crashed = await adapter.compile("cube(");
    const recovered = await adapter.compile("cube(10);");

    expect(crashed.ok).toBe(false);
    expect(crashed.diagnostics).toContain("worker crashed");
    expect(firstWorker.terminated).toBe(true);
    expect(recovered.ok).toBe(true);
    expect(secondWorker.postedMessages.at(-1)?.code).toBe("cube(10);");
  });

  it("keeps a healthy worker after an ordinary OpenSCAD compile failure", async () => {
    let calls = 0;
    const worker = new FakeRenderWorker((message) => {
      calls += 1;
      if (calls === 1) {
        return {
          id: message.id,
          result: {
            ok: false,
            diagnostics: "syntax error"
          }
        };
      }
      return {
        id: message.id,
        result: {
          ok: true,
          stl: "solid fixed\nendsolid",
          diagnostics: "Compiled to STL in browser."
        }
      };
    });
    const adapter = new WebRenderMcpAdapter({
      createWorker: () => worker.asWorker(),
      timeoutMs: 1_000
    });

    const failed = await adapter.compile("cube(");
    const fixed = await adapter.compile("cube(10);");

    expect(failed.ok).toBe(false);
    expect(failed.diagnostics).toContain("syntax error");
    expect(fixed.ok).toBe(true);
    expect(worker.terminated).toBe(false);
    expect(worker.postedMessages.map((message) => message.code)).toEqual([
      "cube(",
      "cube(10);"
    ]);
  });
});

interface FakeRenderMessage {
  kind?: "compile" | "warmup";
  id: string;
  code?: string;
}

interface FakeRenderResponse {
  id: string;
  result: {
    ok: boolean;
    stl?: string;
    diagnostics: string;
  };
}

class FakeRenderWorker {
  postedMessages: FakeRenderMessage[] = [];
  terminated = false;
  private messageListener?: (event: MessageEvent<FakeRenderResponse>) => void;
  private errorListener?: (event: ErrorEvent) => void;

  constructor(
    private readonly respond: (
      message: FakeRenderMessage
    ) => FakeRenderResponse | Error | undefined
  ) {}

  asWorker(): Worker {
    return {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === "message") {
          this.messageListener = listener as (event: MessageEvent<FakeRenderResponse>) => void;
        }
        if (type === "error") {
          this.errorListener = listener as (event: ErrorEvent) => void;
        }
      },
      removeEventListener: (type: string) => {
        if (type === "message") {
          this.messageListener = undefined;
        }
        if (type === "error") {
          this.errorListener = undefined;
        }
      },
      postMessage: (message: FakeRenderMessage) => {
        this.postedMessages.push(message);
        const response = this.respond(message);
        if (!response) {
          return;
        }
        if (response instanceof Error) {
          setTimeout(() => {
            this.errorListener?.({ message: response.message } as ErrorEvent);
          }, 0);
          return;
        }
        setTimeout(() => {
          this.messageListener?.({ data: response } as MessageEvent<FakeRenderResponse>);
        }, 0);
      },
      terminate: () => {
        this.terminated = true;
      }
    } as Worker;
  }
}
