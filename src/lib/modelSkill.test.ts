import { describe, expect, it } from "vitest";
import { buildModelingInstruction } from "./modelSkill";

describe("buildModelingInstruction (MakerWorld PMM conformance)", () => {
  const instruction = buildModelingInstruction();

  it("targets the MakerWorld Parametric Model Maker and OpenSCAD 2021", () => {
    expect(instruction).toContain("MakerWorld Parametric Model Maker");
    expect(instruction).toContain("OpenSCAD 2021");
  });

  it("is BOSL2-first and forbids re-implementing what BOSL2 provides", () => {
    expect(instruction).toContain("include <BOSL2/std.scad>");
    expect(instruction).toContain("do not re-implement");
  });

  it("documents the Customizer magic-comment widgets that PMM renders", () => {
    // slider
    expect(instruction).toContain("[min:max]");
    expect(instruction).toContain("[min:step:max]");
    // dropdown, checkbox, and text field (with maxlength) for personalization
    expect(instruction.toLowerCase()).toContain("dropdown");
    expect(instruction.toLowerCase()).toContain("checkbox");
    expect(instruction.toLowerCase()).toContain("text field");
    expect(instruction.toLowerCase()).toContain("maxlength");
    // MakerWorld color/font extensions
    expect(instruction).toContain("// color");
    expect(instruction).toContain("// font");
    // grouping and hidden sections
    expect(instruction).toContain("/* [Group] */");
    expect(instruction).toContain("/* [Hidden] */");
  });

  it("requires all parameters and constants in a single top block", () => {
    expect(instruction).toContain("at the very top");
    // Code after the parameter block must not introduce new params/constants.
    expect(instruction.toLowerCase()).toContain(
      "must not declare new parameters or constants"
    );
  });

  it("asks for a usable customizer: readable names, descriptions, sensible ranges", () => {
    expect(instruction).toContain("descriptive");
    expect(instruction.toLowerCase()).toContain("description comment");
    expect(instruction.toLowerCase()).toContain("sensible");
    expect(instruction.toLowerCase()).toContain("default value");
  });
});
