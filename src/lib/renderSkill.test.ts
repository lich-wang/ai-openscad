import { describe, expect, it } from "vitest";
import {
  buildRenderPrecisionInstruction,
  normalizeOpenScadPrecision
} from "./renderSkill";

describe("renderSkill", () => {
  it("uses low precision for draft compile and review", () => {
    const instruction = buildRenderPrecisionInstruction("draft");

    expect(instruction).toContain("$fn <= 32");
    expect(instruction).toContain("fast visual review");
  });

  it("sets a draft browser render complexity budget for textured models", () => {
    const instruction = buildRenderPrecisionInstruction("draft");

    expect(instruction).toContain("browser render complexity budget");
    expect(instruction).toContain("many-layer stacked extrusions");
    expect(instruction).toContain("dense decorative arrays");
    expect(instruction).toContain("per-layer boolean operations");
    expect(instruction).toContain("high segment counts");
    expect(instruction).toContain("wavy surfaces");
    expect(instruction).toContain("coarse, inspectable approximations");
  });

  it("uses high precision only for final export", () => {
    const instruction = buildRenderPrecisionInstruction("final");

    expect(instruction).toContain("$fn >= 96");
    expect(instruction).toContain("final export");
    expect(instruction).not.toContain("browser render complexity budget");
  });

  it("can lower top-level $fn for draft rendering", () => {
    expect(normalizeOpenScadPrecision("$fn = 120;\ncylinder(r=5,h=10);", "draft")).toContain(
      "$fn = 32;"
    );
  });

  it("adds draft $fn when generated code does not define one", () => {
    expect(normalizeOpenScadPrecision("cylinder(r=5,h=10);", "draft")).toMatch(
      /^\$fn = 32;\n/
    );
  });

  it("rewrites every top-level $fn so a later assignment cannot win", () => {
    const code = [
      "$fn = 16;",
      "module rim() { cylinder(r=5, h=2); }",
      "$fn = 128.0;",
      "rim();"
    ].join("\n");

    const normalized = normalizeOpenScadPrecision(code, "draft");

    expect(normalized).not.toContain("$fn = 16;");
    expect(normalized).not.toContain("$fn = 128.0;");
    expect(normalized.match(/\$fn = 32;/g)).toHaveLength(2);
  });

  it("keeps final export normalization high precision", () => {
    expect(normalizeOpenScadPrecision("$fn = 32;\ncylinder(r=5,h=10);", "final")).toContain(
      "$fn = 128;"
    );
  });
});
