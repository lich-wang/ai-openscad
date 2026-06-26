import { describe, expect, it } from "vitest";
import { BrowserOpenScadAdapter } from "./render";

describe("BrowserOpenScadAdapter", () => {
  it("returns a structured failure when the wasm runtime cannot load", async () => {
    const adapter = new BrowserOpenScadAdapter(async () => {
      throw new Error("wasm unavailable");
    });

    const result = await adapter.compile("cube(10);");

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContain("wasm unavailable");
  });
});
