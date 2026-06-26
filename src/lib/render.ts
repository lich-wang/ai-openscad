import { createOpenSCAD, type OpenSCADInstance } from "openscad-wasm";

export interface RenderResult {
  ok: boolean;
  stl?: string;
  diagnostics: string;
}

export interface RenderAdapter {
  compile(code: string): Promise<RenderResult>;
}

export type OpenScadLoader = () => Promise<OpenSCADInstance>;

export class BrowserOpenScadAdapter implements RenderAdapter {
  constructor(private readonly loadOpenScad: OpenScadLoader = createOpenSCAD) {}

  async compile(code: string): Promise<RenderResult> {
    try {
      const diagnostics: string[] = [];
      const instance = await this.loadOpenScad();
      const stl = await instance.renderToStl(code);
      return {
        ok: true,
        stl,
        diagnostics: diagnostics.join("\n") || "Compiled to STL in browser."
      };
    } catch (error) {
      return {
        ok: false,
        diagnostics: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export class McpRenderAdapter implements RenderAdapter {
  async compile(): Promise<RenderResult> {
    return {
      ok: false,
      diagnostics: "MCP rendering is reserved for a future adapter."
    };
  }
}
