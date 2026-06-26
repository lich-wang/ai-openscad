import { describe, expect, it } from "vitest";
import {
  CODE_MODEL_PRESETS,
  VISION_MODEL_PRESETS,
  createModelRequest
} from "./models";

describe("model presets", () => {
  it("defaults MiMo V2.5 for code and vision while allowing DeepSeek V4 for code", () => {
    expect(CODE_MODEL_PRESETS.map((model) => model.id)).toEqual([
      "mimo-v2.5",
      "deepseek-v4"
    ]);
    expect(VISION_MODEL_PRESETS.map((model) => model.id)).toEqual(["mimo-v2.5"]);
    expect(CODE_MODEL_PRESETS[0]).toMatchObject({
      id: "mimo-v2.5",
      provider: "mimo",
      capability: "code"
    });
  });

  it("normalizes a code generation request to the provider model without storing the user key in messages", () => {
    const request = createModelRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      mode: "code",
      userPrompt: "make a six-slot box",
      systemPrompt: "write valid OpenSCAD"
    });

    expect(request.endpoint).toBe("/api/llm");
    expect(request.headers.Authorization).toBe("Bearer sk-user");
    expect(JSON.stringify(request.body.messages)).not.toContain("sk-user");
    expect(request.body.model).toBe("mimo-v2.5-pro");
    expect(request.body.messages[0].role).toBe("system");
    expect(request.body.messages[1]).toEqual({
      role: "user",
      content: "make a six-slot box"
    });
  });

  it("keeps MiMo image review on the multimodal model instead of the pro coding model", () => {
    const request = createModelRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      mode: "vision",
      userPrompt: "review the three views",
      systemPrompt: "return JSON",
      images: ["data:image/png;base64,front"]
    });

    expect(request.endpoint).toBe("/api/vision");
    expect(request.body.model).toBe("mimo-v2.5");
    expect(request.body.messages[1].content).toEqual([
      { type: "text", text: "review the three views" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,front" }
      }
    ]);
  });
});
