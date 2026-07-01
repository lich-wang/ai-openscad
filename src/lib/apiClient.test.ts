import { describe, expect, it, vi } from "vitest";
import {
  describeReferenceImages,
  buildGenerationRequest,
  buildRevisionRequest,
  estimateTokenUsage,
  optimizePrompt,
  reviewViews
} from "./apiClient";
import { buildVisionSystemPrompt } from "./openscadSkills";

const reviewImages = [
  "data:image/png;base64,front",
  "data:image/png;base64,back",
  "data:image/png;base64,left",
  "data:image/png;base64,right",
  "data:image/png;base64,top",
  "data:image/png;base64,bottom",
  "data:image/png;base64,iso-front-right-top",
  "data:image/png;base64,iso-front-left-top",
  "data:image/png;base64,iso-back-right-top",
  "data:image/png;base64,iso-back-left-top",
  "data:image/png;base64,iso-front-right-bottom",
  "data:image/png;base64,iso-front-left-bottom",
  "data:image/png;base64,iso-back-right-bottom",
  "data:image/png;base64,iso-back-left-bottom"
];
const uploadedReferenceImagePayload =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQAFAAH/AnH9zAAAAABJRU5ErkJggg==";

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

  it("injects the lich printable modeling skill into generation prompts", () => {
    const request = buildGenerationRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "生成一个带铰链的小盒子",
      precision: "draft"
    });

    const systemPrompt = String(request.body.messages[0].content);
    expect(systemPrompt).toContain("lich-3D/SCAD");
    expect(systemPrompt).toContain("BOSL2");
    expect(systemPrompt).toContain("gap");
    expect(systemPrompt).toContain("print orientation");
    expect(systemPrompt).toContain("knuckle_hinge");
  });

  it("adds the draft render complexity budget to generation prompts", () => {
    const request = buildGenerationRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "生成一个20cm高的波浪形圆形水杯",
      precision: "draft"
    });

    const systemPrompt = String(request.body.messages[0].content);
    expect(systemPrompt).toContain("browser render complexity budget");
    expect(systemPrompt).toContain("many-layer stacked extrusions");
    expect(systemPrompt).toContain("per-layer boolean operations");
    expect(systemPrompt).toContain("wavy surfaces");
    expect(systemPrompt).toContain("coarse, inspectable approximations");
  });

  it("optimizes composer text into a structured CAD-ready prompt without extra project context", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          prompt: [
            "Object: 30 ml printable cup.",
            "Known details: cylindrical body, rounded rim, handle.",
            "Details to confirm: exact height, wall thickness, handle clearance."
          ].join("\n")
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const { prompt, trace } = await optimizePrompt({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "做一个30ml杯子"
    });

    expect(prompt).toContain("Object: 30 ml printable cup");
    expect(prompt).toContain("Details to confirm");
    expect(trace).toMatchObject({
      phase: "prompt-optimization",
      modelId: "mimo-v2.5",
      userPrompt: expect.stringContaining("做一个30ml杯子"),
      response: expect.stringContaining("Details to confirm")
    });

    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("/api/llm");
    const body = JSON.parse(String(request[1]?.body)) as {
      messages: Array<{ content: unknown }>;
    };
    const systemPrompt = String(body.messages[0].content);
    const userPrompt = String(body.messages[1].content);
    const serializedBody = JSON.stringify(body);
    expect(systemPrompt).toMatch(/CAD-ready|text-to-CAD|structured/i);
    expect(systemPrompt).toMatch(/Details to confirm|missing details/i);
    expect(userPrompt).toContain("做一个30ml杯子");
    expect(serializedBody).not.toContain("data:image");
    expect(serializedBody).not.toContain("OpenSCAD code");
    expect(serializedBody).not.toContain("Render evidence");
    expect(serializedBody).not.toContain("promptTrace");
    expect(serializedBody).not.toContain("solid ");

    vi.unstubAllGlobals();
  });

  it("accepts plain text prompt optimization responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: "Object: wall hook\nDetails to confirm: screw diameter."
        })
      })
    );

    const { prompt } = await optimizePrompt({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "hook"
    });

    expect(prompt).toBe("Object: wall hook\nDetails to confirm: screw diameter.");
    vi.unstubAllGlobals();
  });

  it("rejects malformed JSON prompt optimization responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: JSON.stringify({ prompt: "" })
        })
      })
    );

    await expect(
      optimizePrompt({
        apiKey: "sk-user",
        modelId: "mimo-v2.5",
        requirement: "hook"
      })
    ).rejects.toThrow("Prompt optimization response is empty.");
    vi.unstubAllGlobals();
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

  it("omits review confidence and target thresholds from revision prompts", () => {
    const request = buildRevisionRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "Make a desk hook",
      code: "cube(10);",
      review: {
        summary: "Hook silhouette is too shallow.",
        issues: ["Increase the hook depth."],
        correctionPrompt: "Keep the clamp gap and make the hook deeper.",
        confidence: 0.41
      },
      userNotes: "Keep it printable.",
      precision: "draft"
    });

    const userPrompt = String(request.body.messages[1].content);
    expect(userPrompt).toContain("Hook silhouette is too shallow.");
    expect(userPrompt).toContain("Increase the hook depth.");
    expect(userPrompt).not.toMatch(/confidence/i);
    expect(userPrompt).not.toContain("0.41");
    expect(userPrompt).not.toContain("41%");
    expect(userPrompt).not.toContain("85");
    expect(userPrompt).not.toMatch(/target/i);
    expect(userPrompt).not.toMatch(/threshold/i);
  });

  it("adds the draft render complexity budget to revision prompts", () => {
    const request = buildRevisionRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "生成一个20cm高的波浪形圆形水杯",
      code: "module water_cup() { water_cup(); }",
      review: {
        summary: "渲染超时，波浪外壁过于复杂",
        issues: ["避免逐层挤出波浪纹理"],
        correctionPrompt: "保留波浪杯外观，但用更低复杂度的可检查草稿几何。",
        confidence: 0.7
      },
      precision: "draft"
    });

    const userPrompt = String(request.body.messages[1].content);
    expect(userPrompt).toContain("browser render complexity budget");
    expect(userPrompt).toContain("many-layer stacked extrusions");
    expect(userPrompt).toContain("per-layer boolean operations");
    expect(userPrompt).toContain("coarse, inspectable approximations");
  });

  it("keeps the lich printable modeling skill in revision system prompts", () => {
    const request = buildRevisionRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "生成一个桌边挂架",
      code: "cube(10);",
      review: {
        summary: "挂钩太薄",
        issues: ["加厚承重根部"],
        correctionPrompt: "保持桌边夹持间隙，加厚挂钩根部。",
        confidence: 0.8
      },
      precision: "draft"
    });

    const systemPrompt = String(request.body.messages[0].content);
    expect(systemPrompt).toContain("lich-3D/SCAD");
    expect(systemPrompt).toContain("wall thickness");
    expect(systemPrompt).toContain("assembly clearance");
    expect(systemPrompt).toContain("BOSL2");
  });

  it("asks the vision model for a correction prompt instead of revised code", () => {
    const prompt = buildVisionSystemPrompt("生成一个杯子");

    expect(prompt).toContain("correctionPrompt");
    expect(prompt).toContain("front, back, left, right, top, bottom");
    expect(prompt).toContain("isoFrontRightTop");
    expect(prompt).toContain("isoBackLeftBottom");
    expect(prompt).toContain("avoid returning OpenSCAD code");
    expect(prompt).toContain("affected OpenSCAD modules");
    expect(prompt).toContain("sizing, placement, or proportion guidance");
  });

  it("includes bounded render evidence in vision review prompts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          summary: "Rendered correctly.",
          issues: [],
          correctionPrompt: "No change needed.",
          confidence: 0.9
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await reviewViews({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "Make a printable box",
      code: "cube(10);",
      renderedImages: reviewImages,
      renderEvidence: {
        compileStatus: "success",
        diagnostics: "Compiled to STL in browser.",
        renderPrecision: "draft",
        backend: "web-manifold",
        viewCount: 14,
        stl: "solid secret\nendsolid secret",
        promptTrace: "hidden prompt trace",
        extraScreenshot: "data:image/png;base64,hidden"
      } as never
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ content: unknown }>;
    };
    const userPrompt = JSON.stringify(body.messages[1].content);
    expect(userPrompt).toContain("Render evidence");
    expect(userPrompt).toContain("compileStatus: success");
    expect(userPrompt).toContain("Compiled to STL in browser.");
    expect(userPrompt).toContain("renderPrecision: draft");
    expect(userPrompt).toContain("backend: web-manifold");
    expect(userPrompt).toContain("viewCount: 14");
    expect(userPrompt).not.toContain("solid secret");
    expect(userPrompt).not.toContain("hidden prompt trace");
    expect(userPrompt).not.toContain("extraScreenshot");
    expect(userPrompt).not.toContain("data:image/png;base64,hidden");

    vi.unstubAllGlobals();
  });

  it("appends retained reference images after rendered views and labels shape-only review", async () => {
    const retainedReferenceImages = [
      `data:image/png;base64,${uploadedReferenceImagePayload}`,
      "data:image/jpeg;base64,retained-reference-side"
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          summary: "Shape mostly matches the retained references.",
          issues: [],
          correctionPrompt: "No shape change needed.",
          confidence: 0.9
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await reviewViews({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "Make the bracket from the reference images",
      code: "cube(10);",
      renderedImages: reviewImages,
      referenceImages: retainedReferenceImages
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ content: unknown }>;
    };
    const userContent = body.messages[1].content;
    const parts = Array.isArray(userContent) ? userContent : [];
    const text = JSON.stringify(parts[0]);
    const imageUrls = parts
      .filter(
        (part): part is { type: "image_url"; image_url: { url: string } } =>
          Boolean(
            part &&
              typeof part === "object" &&
              "type" in part &&
              part.type === "image_url" &&
              "image_url" in part
          )
      )
      .map((part) => part.image_url.url);

    expect(imageUrls).toEqual([...reviewImages, ...retainedReferenceImages]);
    expect(text).toContain("Rendered model views: 14");
    expect(text).toContain("Original reference images: 2");
    expect(text).toMatch(/shape|structure/i);
    expect(text).toMatch(/ignore.*color/i);
    expect(text).toMatch(/printed graphics|decals|surface patterns/i);

    vi.unstubAllGlobals();
  });

  it("rejects oversized fourteen-view payloads before calling the vision endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reviewViews({
        apiKey: "sk-user",
        modelId: "mimo-v2.5",
        requirement: "Make a printable box",
        code: "cube(10);",
        renderedImages: reviewImages.map((image) => `${image}${"A".repeat(600_000)}`),
        renderEvidence: {
          compileStatus: "success",
          diagnostics: "Compiled to STL in browser.",
          renderPrecision: "draft",
          backend: "web-manifold",
          viewCount: 14
        }
      })
    ).rejects.toThrow(/vision payload/i);

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects retained-reference review payloads over budget before calling vision", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reviewViews({
        apiKey: "sk-user",
        modelId: "mimo-v2.5",
        requirement: "Make a printable box from references",
        code: "cube(10);",
        renderedImages: reviewImages,
        referenceImages: [
          `data:image/png;base64,${"A".repeat(7_500_000)}`
        ]
      })
    ).rejects.toThrow(/retained reference images are too large/i);

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects oversized reference-image drafts before calling vision", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      describeReferenceImages({
        apiKey: "sk-user",
        modelId: "mimo-v2.5",
        images: [`data:image/png;base64,${"A".repeat(7_500_000)}`]
      })
    ).rejects.toThrow(/selected reference images are too large/i);

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("drafts a target prompt from reference images without saving image payloads in trace", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          prompt:
            "A printable wall-mounted cup holder with a rounded cradle, screw holes, and 80mm height."
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const { prompt, trace } = await describeReferenceImages({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      images: [
        `data:image/png;base64,${uploadedReferenceImagePayload}`,
        `data:image/jpeg;base64,${uploadedReferenceImagePayload}`
      ]
    });

    expect(prompt).toContain("wall-mounted cup holder");
    expect(trace).toMatchObject({
      phase: "reference-image-draft",
      modelId: "mimo-v2.5",
      response: expect.stringContaining("wall-mounted cup holder")
    });
    expect(trace.userPrompt).toContain("2 reference images");
    const serializedTrace = JSON.stringify(trace);
    expect(serializedTrace).not.toContain("data:image");
    expect(serializedTrace).not.toContain("blob:");
    expect(serializedTrace).not.toContain(uploadedReferenceImagePayload);
    expect(serializedTrace).not.toContain("referenceImages");

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ content: unknown }>;
    };
    const systemPrompt = JSON.stringify(body.messages[0].content);
    const userContent = JSON.stringify(body.messages[1].content);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/vision");
    expect(
      Array.isArray(body.messages[1].content)
        ? body.messages[1].content.filter(
            (part): part is { type: "image_url"; image_url: { url: string } } =>
              Boolean(
                part &&
                  typeof part === "object" &&
                  "type" in part &&
                  part.type === "image_url" &&
                  "image_url" in part
              )
          )
        : []
    ).toHaveLength(2);
    expect(userContent).toContain(uploadedReferenceImagePayload);
    expect(userContent).toContain("target model prompt");
    expect(userContent).toMatch(/shape|geometry/i);
    expect(userContent).toMatch(/ignore.*color/i);
    expect(userContent).toMatch(/printed graphics|decals|surface patterns/i);
    expect(systemPrompt).toMatch(/subject.*shape/i);
    expect(systemPrompt).toMatch(/ignore.*color/i);
    expect(systemPrompt).toMatch(/printed.*graphics|decals|surface patterns/i);
    expect(userContent).not.toContain("cube(10)");
    expect(userContent).not.toContain("Render evidence");
    expect(userContent).not.toContain("promptTrace");
    expect(userContent).not.toContain("solid ");

    vi.unstubAllGlobals();
  });

  it("accepts plain text reference-image prompt drafts when the vision model skips JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content:
            "Create a printable desk stand with two rounded support fins and a shallow front lip."
        })
      })
    );

    const { prompt } = await describeReferenceImages({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      images: ["data:image/png;base64,reference"]
    });

    expect(prompt).toBe(
      "Create a printable desk stand with two rounded support fins and a shallow front lip."
    );
    vi.unstubAllGlobals();
  });

  it("includes compile diagnostics in user-triggered revision prompts", () => {
    const request = buildRevisionRequest({
      apiKey: "sk-user",
      modelId: "mimo-v2.5",
      requirement: "Make a printable cup",
      code: "module cup() { cylinder(h=40, r=20);",
      review: {
        summary: "Compile failed before visual review.",
        issues: ["OpenSCAD parser reported a missing closing brace."],
        correctionPrompt: "Fix the OpenSCAD syntax error and preserve the cup requirement.",
        confidence: 0.2
      },
      userNotes: "Fix the current compile error.",
      renderEvidence: {
        compileStatus: "failure",
        diagnostics: "Parser error: syntax error in file input.scad, line 1",
        renderPrecision: "draft",
        backend: "web-manifold",
        viewCount: 0
      },
      precision: "draft"
    });

    const userPrompt = String(request.body.messages[1].content);
    expect(userPrompt).toContain("Render evidence");
    expect(userPrompt).toContain("compileStatus: failure");
    expect(userPrompt).toContain("Parser error: syntax error");
    expect(userPrompt).toContain("viewCount: 0");
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
      renderedImages: reviewImages
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
