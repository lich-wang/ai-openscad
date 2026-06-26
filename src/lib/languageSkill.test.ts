import { describe, expect, it } from "vitest";
import {
  buildLanguageInstruction,
  detectUserLanguage
} from "./languageSkill";

describe("languageSkill", () => {
  it("detects Chinese requirements", () => {
    expect(detectUserLanguage("生成一个30ML的杯子模型")).toBe("zh");
  });

  it("asks for Chinese natural-language output for Chinese users", () => {
    expect(buildLanguageInstruction("生成一个杯子")).toContain("中文");
    expect(buildLanguageInstruction("Generate a cup")).toContain("English");
  });
});
