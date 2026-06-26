import { describe, expect, it, vi } from "vitest";
import {
  buildGenerationRequest,
  buildRevisionRequest,
  estimateTokenUsage
} from "./apiClient";

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
        confidence: 0.8
      },
      userNotes: "把把手再大一点",
      precision: "draft",
      stream: true
    });

    const userPrompt = String(request.body.messages[1].content);
    expect(userPrompt).toContain("杯口太厚");
    expect(userPrompt).toContain("把杯壁调薄");
    expect(userPrompt).toContain("把把手再大一点");
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
