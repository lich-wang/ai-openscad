import { describe, expect, it } from "vitest";
import { resolveLocale, t } from "./i18n";

describe("i18n", () => {
  it("resolves Chinese browser locales to zh", () => {
    expect(resolveLocale(["zh-CN", "en-US"])).toBe("zh");
    expect(resolveLocale(["zh-Hans"])).toBe("zh");
  });

  it("resolves non-Chinese and missing browser locales to English", () => {
    expect(resolveLocale(["en-US"])).toBe("en");
    expect(resolveLocale(["ja-JP"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
  });

  it("translates core UI text", () => {
    expect(t("zh", "generate")).toBe("生成");
    expect(t("en", "generate")).toBe("Generate");
    expect(t("zh", "optimizePrompt")).toBe("优化提示词");
    expect(t("en", "optimizePrompt")).toBe("Optimize prompt");
    expect(t("zh", "browserLanguageTitle")).toBe("AI OpenSCAD");
  });
});
