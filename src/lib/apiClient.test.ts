import { describe, expect, it, vi } from "vitest";
import {
  buildGenerationRequest,
  buildRevisionRequest,
  estimateTokenUsage,
  reviewViews
} from "./apiClient";
import { buildVisionSystemPrompt } from "./openscadSkills";

describe("apiClient prompt assembly", () => {
  it("adds Chinese output instruction for Chinese requirements", () => {
    const request = buildGenerationRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "生成一个30ML的杯子模型",
      precision: "draft",
      stream: true
    });

    expect(String(request.body.messages[0].content)).toContain("中文");
    expect(request.body.stream).toBe(true);
  });

  it("revision prompt includes review feedback and user iteration notes", () => {
    const request = buildRevisionRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "生成一个杯子",
      code: "cube(10);",
      review: {
        summary: "杯口太厚",
        issues: ["把杯壁调薄"],
        correctionPrompt: "保持杯子容量，把杯壁调薄。",
        confidence: 0.8
      },
      userNotes: "把把手再大一点",
      precision: "draft",
      stream: true
    });

    const userPrompt = String(request.body.messages[1].content);
    expect(userPrompt).toContain("Original requirement:\n生成一个杯子");
    expect(userPrompt).toContain("Current OpenSCAD:");
    expect(userPrompt).toContain("cube(10);");
    expect(userPrompt).toContain("Review summary:\n杯口太厚");
    expect(userPrompt).toContain("User iteration notes:\n把把手再大一点");
    expect(userPrompt).toContain("杯口太厚");
    expect(userPrompt).toContain("把杯壁调薄");
    expect(userPrompt).toContain("把把手再大一点");
  });

  it("asks the vision model for a correction prompt instead of revised code", () => {
    const prompt = buildVisionSystemPrompt("生成一个杯子");

    expect(prompt).toContain("correctionPrompt");
    expect(prompt).toContain("avoid returning OpenSCAD code");
    expect(prompt).toContain("affected OpenSCAD modules");
    expect(prompt).toContain("sizing, placement, or proportion guidance");
  });

  it("builds a concrete fallback when vision returns a vague correction prompt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: JSON.stringify({
            summary: "杯口太厚，右侧看把手偏小。",
            issues: ["正视图杯口倒角不明显", "右视图把手偏小"],
            correctionPrompt: "改好一点。",
            confidence: 0.72
          })
        })
      })
    );

    const { review } = await reviewViews({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "生成一个30ML的杯子模型",
      code: "module cup() { cup(); }",
      images: ["data:image/png;base64,front", "data:image/png;base64,top"]
    });

    expect(review.correctionPrompt).toContain("Original requirement");
    expect(review.correctionPrompt).toContain("生成一个30ML的杯子模型");
    expect(review.correctionPrompt).toContain("Observed visual issues");
    expect(review.correctionPrompt).toContain("正视图杯口倒角不明显");
    expect(review.correctionPrompt).toContain("Target the affected OpenSCAD modules");
    expect(review.correctionPrompt).not.toBe("改好一点。");

    vi.unstubAllGlobals();
  });

  it("estimates LLM and vision tokens separately", () => {
    const usage = estimateTokenUsage({
      llmText: "abcd".repeat(100),
      visionText: "efgh".repeat(50),
      imageCount: 3
    });

    expect(usage.llmTokens).toBeGreaterThan(0);
    expect(usage.visionTokens).toBeGreaterThan(usage.llmTokens);
    expect(usage.imageCount).toBe(3);
  });
});
