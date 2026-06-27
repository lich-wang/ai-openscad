import { createOpenSCAD, type OpenSCADInstance } from "openscad-wasm";
import {
  captureOrthographicViews,
  type ViewCaptureStage,
  type ViewSet
} from "./capture";

export interface RenderResult {
  ok: boolean;
  stl?: string;
  diagnostics: string;
}

export interface RenderAdapter {
  compile(code: string): Promise<RenderResult>;
}

export type RenderMcpProvider = "web";
export type RenderMcpStage = "compile" | ViewCaptureStage;

export interface RenderMcpInput {
  source: string;
  onProgress?: (stage: RenderMcpStage) => Promise<void> | void;
}

export interface RenderMcpOutput extends RenderResult {
  views?: ViewSet;
}

export interface RenderMcpAdapter extends RenderAdapter {
  prewarm(): void;
  render(input: RenderMcpInput): Promise<RenderMcpOutput>;
}

export type OpenScadLoader = () => Promise<OpenSCADInstance>;
export type RenderWorkerFactory = () => Worker;
export type ViewCapture = typeof captureOrthographicViews;

export interface WebRenderMcpAdapterOptions {
  loadOpenScad?: OpenScadLoader;
  createWorker?: RenderWorkerFactory;
  captureViews?: ViewCapture;
  timeoutMs?: number;
}

interface RenderWorkerResponse {
  id: string;
  result: RenderResult;
}

interface RenderWorkerRequest {
  id: string;
  kind: "compile" | "warmup";
  code?: string;
}

const DEFAULT_RENDER_TIMEOUT_MS = 45_000;

export function createRenderMcp(provider: RenderMcpProvider = "web"): RenderMcpAdapter {
  if (provider === "web") {
    return new WebRenderMcpAdapter();
  }
  return assertNever(provider);
}

export class WebRenderMcpAdapter implements RenderMcpAdapter {
  readonly provider: RenderMcpProvider = "web";

  private readonly createWorker?: RenderWorkerFactory;
  private readonly loadOpenScad: OpenScadLoader;
  private readonly captureViews: ViewCapture;
  private readonly timeoutMs: number;
  private worker?: Worker;

  constructor(options: OpenScadLoader | WebRenderMcpAdapterOptions = {}) {
    if (typeof options === "function") {
      this.loadOpenScad = options;
      this.captureViews = captureOrthographicViews;
      this.timeoutMs = DEFAULT_RENDER_TIMEOUT_MS;
      return;
    }

    this.loadOpenScad = options.loadOpenScad ?? createOpenSCAD;
    this.captureViews = options.captureViews ?? captureOrthographicViews;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
    this.createWorker =
      options.createWorker ??
      (typeof Worker === "undefined"
        ? undefined
        : () => new Worker(new URL("./renderWorker.ts", import.meta.url), { type: "module" }));
  }

  async compile(code: string): Promise<RenderResult> {
    if (this.createWorker) {
      return this.compileInWorker(code);
    }
    return this.compileInCurrentContext(code);
  }

  prewarm(): void {
    if (!this.createWorker) {
      void this.loadOpenScad();
      return;
    }
    const worker = this.getWorker();
    const id = createRenderJobId();
    const cleanup = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };
    const handleMessage = (event: MessageEvent<RenderWorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }
      cleanup();
    };
    const handleError = () => {
      cleanup();
      this.resetWorker(worker);
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({ id, kind: "warmup" } satisfies RenderWorkerRequest);
  }

  async render(input: RenderMcpInput): Promise<RenderMcpOutput> {
    await input.onProgress?.("compile");
    const compiled = await this.compile(input.source);
    if (!compiled.ok || !compiled.stl) {
      return compiled;
    }

    const views = await this.captureViews(compiled.stl, {
      onProgress: input.onProgress
    });
    return {
      ...compiled,
      views
    };
  }

  private async compileInCurrentContext(code: string): Promise<RenderResult> {
    try {
      const instance = await this.loadOpenScad();
      const stl = await withTimeout(
        renderOpenScadToStl(instance, code),
        this.timeoutMs,
        renderTimeoutMessage(this.timeoutMs)
      );
      return {
        ok: true,
        stl,
        diagnostics: "Compiled to STL in browser."
      };
    } catch (error) {
      return {
        ok: false,
        diagnostics: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async compileInWorker(code: string): Promise<RenderResult> {
    const worker = this.getWorker();
    const id = createRenderJobId();

    return new Promise<RenderResult>((resolve) => {
      let settled = false;
      const finish = (result: RenderResult, resetWorker = false) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        if (resetWorker) {
          this.resetWorker(worker);
        }
        resolve(result);
      };
      const timeout = setTimeout(() => {
        finish({
          ok: false,
          diagnostics: renderTimeoutMessage(this.timeoutMs)
        }, true);
      }, this.timeoutMs);
      const handleMessage = (event: MessageEvent<RenderWorkerResponse>) => {
        if (event.data.id !== id) {
          return;
        }
        finish(event.data.result);
      };
      const handleError = (event: ErrorEvent) => {
        finish({
          ok: false,
          diagnostics: event.message || "OpenSCAD worker failed."
        }, true);
      };

      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleError);
      worker.postMessage({ id, kind: "compile", code } satisfies RenderWorkerRequest);
    });
  }

  private getWorker(): Worker {
    if (!this.createWorker) {
      throw new Error("Render worker is not available.");
    }
    if (!this.worker) {
      this.worker = this.createWorker();
    }
    return this.worker;
  }

  private resetWorker(worker: Worker): void {
    if (this.worker === worker) {
      this.worker = undefined;
    }
    worker.terminate();
  }
}

export const BrowserOpenScadAdapter = WebRenderMcpAdapter;

export async function renderOpenScadToStl(
  instance: OpenSCADInstance,
  code: string
): Promise<string> {
  const openscad = instance.getInstance?.();
  if (!openscad) {
    return instance.renderToStl(code);
  }

  try {
    openscad.FS.writeFile("/input.scad", code);
    const exitCode = openscad.callMain([
      "/input.scad",
      "--backend=manifold",
      "-o",
      "/output.stl"
    ]);
    if (exitCode !== 0) {
      throw new Error(`OpenSCAD Manifold backend exited with code ${exitCode}.`);
    }
    const result = openscad.FS.readFile("/output.stl", {
      encoding: "utf8"
    });
    return typeof result === "string" ? result : new TextDecoder().decode(result);
  } catch {
    return instance.renderToStl(code);
  } finally {
    try {
      openscad.FS.unlink("/input.scad");
    } catch {
      // The fallback path may have already cleaned it up.
    }
    try {
      openscad.FS.unlink("/output.stl");
    } catch {
      // Missing output is expected when Manifold failed before export.
    }
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function renderTimeoutMessage(timeoutMs: number): string {
  return `OpenSCAD render timed out after ${Math.round(timeoutMs / 1000)}s. Check the code for syntax errors or reduce model complexity.`;
}

function createRenderJobId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported render MCP provider: ${String(value)}`);
}
