import { describe, expect, it } from "vitest";
import {
  buildRenderPrecisionInstruction,
  normalizeOpenScadPrecision
} from "./renderSkill";

describe("renderSkill", () => {
  it("uses low precision for draft compile and review", () => {
    const instruction = buildRenderPrecisionInstruction("draft");

    expect(instruction).toContain("$fn <= 36");
    expect(instruction).toContain("fast visual review");
  });

  it("uses high precision only for final export", () => {
    const instruction = buildRenderPrecisionInstruction("final");

    expect(instruction).toContain("$fn >= 96");
    expect(instruction).toContain("final export");
  });

  it("can lower top-level $fn for draft rendering", () => {
    expect(normalizeOpenScadPrecision("$fn = 120;\ncylinder(r=5,h=10);", "draft")).toContain(
      "$fn = 32;"
    );
  });
});
