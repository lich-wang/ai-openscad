import { describe, expect, it } from "vitest";
import { createRenderMcp, WebRenderMcpAdapter } from "./render";

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

  it("runs browser compilation through a worker and terminates it after completion", async () => {
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
    expect(worker.postedMessage?.code).toBe("cube(10);");
    expect(worker.terminated).toBe(true);
  });

  it("renders OpenSCAD source to STL and three orthographic view images", async () => {
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
        await options.onProgress?.("top");
        await options.onProgress?.("right");
        return {
          front: `front:${stl}`,
          top: `top:${stl}`,
          right: `right:${stl}`
        };
      },
      timeoutMs: 1_000
    });
    const stages: string[] = [];

    const result = await adapter.render({
      source: "cube(10);",
      onProgress: (stage) => stages.push(stage)
    });

    expect(worker.postedMessage?.code).toBe("cube(10);");
    expect(result.ok).toBe(true);
    expect(result.stl).toBe("solid cup\nendsolid cup");
    expect(result.views).toEqual({
      front: "front:solid cup\nendsolid cup",
      top: "top:solid cup\nendsolid cup",
      right: "right:solid cup\nendsolid cup"
    });
    expect(stages).toEqual(["compile", "front", "top", "right"]);
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

  it("terminates the worker when asynchronous compilation times out", async () => {
    const worker = new FakeRenderWorker(() => undefined);
    const adapter = new WebRenderMcpAdapter({
      createWorker: () => worker.asWorker(),
      timeoutMs: 10
    });

    const result = await adapter.compile("cube(");

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContain("timed out");
    expect(result.diagnostics).toContain("reduce model complexity");
    expect(result.diagnostics).not.toContain("browser draft render complexity budget");
    expect(worker.terminated).toBe(true);
  });

  it("creates the current render MCP in web provider mode", () => {
    const adapter = createRenderMcp("web");

    expect(adapter).toBeInstanceOf(WebRenderMcpAdapter);
  });
});

interface FakeRenderMessage {
  id: string;
  code: string;
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
  postedMessage?: FakeRenderMessage;
  terminated = false;
  private messageListener?: (event: MessageEvent<FakeRenderResponse>) => void;
  private errorListener?: (event: ErrorEvent) => void;

  constructor(
    private readonly respond: (message: FakeRenderMessage) => FakeRenderResponse | undefined
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
        this.postedMessage = message;
        const response = this.respond(message);
        if (!response) {
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
