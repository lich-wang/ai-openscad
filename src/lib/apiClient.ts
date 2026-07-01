import { createModelRequest } from "./models";
import {
  buildCodeSystemPrompt,
  buildPromptOptimizationSystemPrompt,
  buildPromptOptimizationUserPrompt,
  buildReferenceImageSystemPrompt,
  buildReferenceImageUserPrompt,
  buildRevisionPrompt,
  buildVisionSystemPrompt,
  buildVisionUserPrompt
} from "./openscadSkills";
import type { PromptTraceEntry, RenderEvidence, VisionReview } from "./project";
import { createPromptTraceEntry } from "./promptTrace";
import type { RenderPrecision } from "./renderSkill";
import { readOpenAiStream } from "./streaming";

interface GatewayResponse {
  content: string;
}

const MAX_VISION_PAYLOAD_BYTES = 7_500_000;
type VisionPayloadContext =
  | "review"
  | "retained-reference-review"
  | "selected-reference-draft";

export async function generateOpenScad(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
  precision?: RenderPrecision;
  onToken?: (code: string) => void;
}): Promise<{ code: string; trace: PromptTraceEntry }> {
  const request = buildGenerationRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    requirement: input.requirement,
    precision: input.precision ?? "draft",
    stream: Boolean(input.onToken)
  });
  const response = input.onToken
    ? await sendGatewayStream(request, input.onToken)
    : await sendGatewayRequest(request);
  const code = stripCodeFence(response);
  return {
    code,
    trace: createPromptTraceEntry({
      phase: input.precision === "final" ? "final-export" : "code-generation",
      modelId: input.modelId,
      systemPrompt: String(request.body.messages[0].content),
      userPrompt: input.requirement,
      response: code,
      apiKey: input.apiKey
    })
  };
}

export async function reviewViews(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
  code: string;
  renderedImages: string[];
  referenceImages?: string[];
  renderEvidence?: RenderEvidence | null;
  strictConfidence?: boolean;
}): Promise<{ review: VisionReview; trace: PromptTraceEntry }> {
  const referenceImages = input.referenceImages ?? [];
  const systemPrompt = buildVisionSystemPrompt(input.requirement);
  const userPrompt = buildVisionUserPrompt(
    input.requirement,
    input.code,
    input.renderEvidence,
    referenceImages.length
  );
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "vision",
    systemPrompt,
    userPrompt,
    images: [...input.renderedImages, ...referenceImages],
    responseFormat: "json"
  });
  const payloadContext =
    referenceImages.length > 0 && visionPayloadBytes(request) > MAX_VISION_PAYLOAD_BYTES
      ? reviewPayloadContextWithoutReferences({
          apiKey: input.apiKey,
          modelId: input.modelId,
          systemPrompt,
          requirement: input.requirement,
          code: input.code,
          renderEvidence: input.renderEvidence,
          renderedImages: input.renderedImages
        })
      : "review";
  assertVisionPayloadWithinBudget(request, payloadContext);
  const content = await sendGatewayRequest(request);
  const review = parseReview(content, input.requirement, Boolean(input.strictConfidence));
  return {
    review,
    trace: createPromptTraceEntry({
      phase: "vision-review",
      modelId: input.modelId,
      systemPrompt,
      userPrompt,
      response: content,
      apiKey: input.apiKey
    })
  };
}

export async function describeReferenceImages(input: {
  apiKey: string;
  modelId: string;
  images: string[];
}): Promise<{ prompt: string; trace: PromptTraceEntry }> {
  const systemPrompt = buildReferenceImageSystemPrompt();
  const userPrompt = buildReferenceImageUserPrompt(input.images.length);
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "vision",
    systemPrompt,
    userPrompt,
    images: input.images,
    responseFormat: "json"
  });
  assertVisionPayloadWithinBudget(request, "selected-reference-draft");
  const content = await sendGatewayRequest(request);
  const prompt = parseReferenceImagePrompt(content);
  return {
    prompt,
    trace: createPromptTraceEntry({
      phase: "reference-image-draft",
      modelId: input.modelId,
      systemPrompt,
      userPrompt,
      response: prompt,
      apiKey: input.apiKey
    })
  };
}

export async function optimizePrompt(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
}): Promise<{ prompt: string; trace: PromptTraceEntry }> {
  const systemPrompt = buildPromptOptimizationSystemPrompt(input.requirement);
  const userPrompt = buildPromptOptimizationUserPrompt(input.requirement);
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "code",
    systemPrompt,
    userPrompt,
    responseFormat: "json"
  });
  const content = await sendGatewayRequest(request);
  const prompt = parsePromptText(content, "Prompt optimization response is empty.");
  return {
    prompt,
    trace: createPromptTraceEntry({
      phase: "prompt-optimization",
      modelId: input.modelId,
      systemPrompt,
      userPrompt,
      response: prompt,
      apiKey: input.apiKey
    })
  };
}

export async function proposeRevision(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
  code: string;
  review: VisionReview;
  userNotes?: string;
  precision?: RenderPrecision;
  renderEvidence?: RenderEvidence | null;
  onToken?: (code: string) => void;
}): Promise<{ code: string; trace: PromptTraceEntry }> {
  const request = buildRevisionRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    requirement: input.requirement,
    code: input.code,
    review: input.review,
    userNotes: input.userNotes,
    precision: input.precision ?? "draft",
    renderEvidence: input.renderEvidence,
    stream: Boolean(input.onToken)
  });
  const response = input.onToken
    ? await sendGatewayStream(request, input.onToken)
    : await sendGatewayRequest(request);
  const code = stripCodeFence(response);
  return {
    code,
    trace: createPromptTraceEntry({
      phase: input.precision === "final" ? "final-export" : "revision",
      modelId: input.modelId,
      systemPrompt: String(request.body.messages[0].content),
      userPrompt: String(request.body.messages[1].content),
      response: code,
      apiKey: input.apiKey
    })
  };
}

export function buildGenerationRequest(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
  precision?: RenderPrecision;
  stream?: boolean;
}) {
  return createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "code",
    systemPrompt: buildCodeSystemPrompt(input.precision ?? "draft", input.requirement),
    userPrompt: input.requirement,
    stream: input.stream
  });
}

export function buildRevisionRequest(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
  code: string;
  review: VisionReview;
  userNotes?: string;
  precision?: RenderPrecision;
  renderEvidence?: RenderEvidence | null;
  stream?: boolean;
}) {
  return createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "code",
    systemPrompt: buildCodeSystemPrompt(
      input.precision ?? "draft",
      `${input.requirement}\n${input.userNotes ?? ""}`
    ),
    userPrompt: buildRevisionPrompt({
      requirement: input.requirement,
      code: input.code,
      reviewSummary: input.review.summary,
      issues: input.review.issues,
      userNotes: input.userNotes,
      precision: input.precision ?? "draft",
      renderEvidence: input.renderEvidence
    }),
    stream: input.stream
  });
}

export function estimateTokenUsage(input: {
  llmText: string;
  visionText: string;
  imageCount: number;
}) {
  const estimateTextTokens = (text: string) => Math.ceil(text.length / 3.2);
  return {
    llmTokens: estimateTextTokens(input.llmText),
    visionTokens: estimateTextTokens(input.visionText) + input.imageCount * 1100,
    imageCount: input.imageCount
  };
}

function reviewPayloadContextWithoutReferences(input: {
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  requirement: string;
  code: string;
  renderEvidence?: RenderEvidence | null;
  renderedImages: string[];
}): VisionPayloadContext {
  const renderedOnlyRequest = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "vision",
    systemPrompt: input.systemPrompt,
    userPrompt: buildVisionUserPrompt(
      input.requirement,
      input.code,
      input.renderEvidence,
      0
    ),
    images: input.renderedImages,
    responseFormat: "json"
  });
  return visionPayloadBytes(renderedOnlyRequest) <= MAX_VISION_PAYLOAD_BYTES
    ? "retained-reference-review"
    : "review";
}

function assertVisionPayloadWithinBudget(
  request: ReturnType<typeof createModelRequest>,
  context: VisionPayloadContext = "review"
) {
  if (request.endpoint !== "/api/vision") {
    return;
  }
  const payloadBytes = visionPayloadBytes(request);
  if (payloadBytes <= MAX_VISION_PAYLOAD_BYTES) {
    return;
  }
  throw new Error(visionPayloadTooLargeMessage(context, payloadBytes));
}

function visionPayloadBytes(request: ReturnType<typeof createModelRequest>): number {
  if (request.endpoint !== "/api/vision") {
    return 0;
  }
  return new TextEncoder().encode(JSON.stringify(request.body)).byteLength;
}

function visionPayloadTooLargeMessage(
  context: VisionPayloadContext,
  payloadBytes: number
): string {
  const sizeText = `${formatBytes(payloadBytes)} > ${formatBytes(MAX_VISION_PAYLOAD_BYTES)}`;
  if (context === "retained-reference-review") {
    return `Retained reference images are too large for review (${sizeText}). Use the Reference images button with smaller reference images, or start/import a project without retained references before reviewing.`;
  }
  if (context === "selected-reference-draft") {
    return `Selected reference images are too large to analyze (${sizeText}). Choose smaller reference images and try again.`;
  }
  return `Vision payload is too large for review (${sizeText}). Rerender with bounded captures before reviewing.`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function sendGatewayRequest(request: ReturnType<typeof createModelRequest>) {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body)
  });
  const data = (await response.json()) as Partial<GatewayResponse> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with ${response.status}`);
  }
  return data.content ?? "";
}

async function sendGatewayStream(
  request: ReturnType<typeof createModelRequest>,
  onToken: (code: string) => void
) {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body)
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed with ${response.status}`);
  }
  if (!response.body) {
    return "";
  }
  let accumulated = "";
  return readOpenAiStream(response.body, (delta) => {
    accumulated += delta;
    onToken(stripCodeFence(accumulated));
  });
}

function stripCodeFence(content: string): string {
  const match = content.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  return (match?.[1] ?? content).trim();
}

function parseReferenceImagePrompt(content: string): string {
  return parsePromptText(content, "Reference image prompt is empty.");
}

function parsePromptText(content: string, emptyMessage: string): string {
  const trimmed = stripCodeFence(content);
  try {
    const parsed = JSON.parse(trimmed) as { prompt?: unknown };
    if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
      return parsed.prompt.trim();
    }
    throw new Error(emptyMessage);
  } catch (caught) {
    if (!(caught instanceof SyntaxError)) {
      throw caught;
    }
    if (trimmed) {
      return trimmed;
    }
  }
  if (!trimmed) {
    throw new Error(emptyMessage);
  }
  return trimmed;
}

function parseReview(content: string, requirement = "", strictConfidence = false): VisionReview {
  try {
    const parsed = JSON.parse(content) as Partial<VisionReview>;
    const summary = String(parsed.summary ?? "Review completed.");
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(String)
      : ["The model returned review text without an issues array."];
    const confidence = normalizeReviewConfidence(parsed.confidence, strictConfidence);
    return {
      summary,
      issues,
      correctionPrompt: buildFallbackCorrectionPrompt(
        summary,
        issues,
        parsed.correctionPrompt,
        requirement
      ),
      confidence
    };
  } catch {
    if (strictConfidence) {
      throw new Error("Review confidence is missing or invalid.");
    }
    return {
      summary: content,
      issues: ["The model returned non-JSON review text."],
      correctionPrompt: buildFallbackCorrectionPrompt(content, [
        "The model returned non-JSON review text."
      ], undefined, requirement),
      confidence: 0.5
    };
  }
}

function normalizeReviewConfidence(value: unknown, strict: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    if (strict) {
      throw new Error("Review confidence is missing or invalid.");
    }
    return 0.5;
  }
  if (value < 0 || value > 1) {
    if (strict) {
      throw new Error("Review confidence is missing or invalid.");
    }
    return Math.min(1, Math.max(0, value));
  }
  return value;
}

function buildFallbackCorrectionPrompt(
  summary: string,
  issues: string[],
  correctionPrompt?: unknown,
  requirement = ""
): string {
  if (
    typeof correctionPrompt === "string" &&
    correctionPrompt.trim() &&
    !isVagueCorrectionPrompt(correctionPrompt)
  ) {
    return correctionPrompt.trim();
  }
  return [
    "Revise the current OpenSCAD model according to this visual review.",
    `Original requirement: ${requirement || "Preserve the original user requirement."}`,
    `Review summary: ${summary}`,
    `Observed visual issues: ${issues.join("; ") || "No specific issues."}`,
    "Target the affected OpenSCAD modules or geometry relationships that likely control those visible areas.",
    "Preserve dimensions, printable geometry, and any requirement details not mentioned by the review.",
    "Add sizing, placement, or proportion changes only where they directly address the observed issues.",
    "Preserve the original user requirement and return a complete updated OpenSCAD source file."
  ].join("\n");
}

function isVagueCorrectionPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (text.length < 24) {
    return true;
  }
  const genericPhrases = [
    "改好一点",
    "优化一下",
    "make it better",
    "improve it",
    "fix it"
  ];
  return genericPhrases.some((phrase) => text.toLowerCase().includes(phrase));
}
