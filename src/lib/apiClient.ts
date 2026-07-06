import { createModelRequest } from "./models";
import {
  buildCodeSystemPrompt,
  buildPromptOptimizationSystemPrompt,
  buildPromptOptimizationUserPrompt,
  buildReferenceImageSystemPrompt,
  buildReferenceImageUserPrompt,
  buildRevisionPrompt,
  buildSliceReviewSystemPrompt,
  buildSliceReviewUserPrompt,
  buildVisionSystemPrompt,
  buildVisionUserPrompt
} from "./openscadSkills";
import {
  normalizePromptFieldsResponse,
  type NormalizedPromptFields
} from "./promptFields";
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
  | "selected-reference-draft"
  | "slice-review";

export async function generateOpenScad(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
  precision?: RenderPrecision;
  onToken?: (code: string) => void;
  onThinkingToken?: (thinking: string) => void;
}): Promise<{ code: string; trace: PromptTraceEntry }> {
  const request = buildGenerationRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    requirement: input.requirement,
    precision: input.precision ?? "draft",
    stream: Boolean(input.onToken)
  });
  const response = input.onToken
    ? await sendGatewayStream(request, input.onToken, input.onThinkingToken)
    : await sendGatewayRequest(request);
  const code = stripCodeFence(response);
  if (!code) {
    throw new Error("The model returned an empty response.");
  }
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

export async function reviewSliceForPrintability(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
  code: string;
  toolpathImages: string[];
  supportPercent: number;
  layerCount: number | null;
  locationSummaries: string[];
}): Promise<{ review: VisionReview; trace: PromptTraceEntry }> {
  const systemPrompt = buildSliceReviewSystemPrompt(input.requirement);
  const userPrompt = buildSliceReviewUserPrompt({
    requirement: input.requirement,
    code: input.code,
    supportPercent: input.supportPercent,
    layerCount: input.layerCount,
    locationSummaries: input.locationSummaries,
    imageCount: input.toolpathImages.length
  });
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "vision",
    systemPrompt,
    userPrompt,
    images: input.toolpathImages,
    responseFormat: "json"
  });
  assertVisionPayloadWithinBudget(request, "slice-review");
  const content = await sendGatewayRequest(request);
  const review = parseReview(content, input.requirement, false);
  return {
    review,
    trace: createPromptTraceEntry({
      phase: "slice-review",
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
}): Promise<NormalizedPromptFields & { trace: PromptTraceEntry }> {
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
  const normalized = normalizePromptFieldsResponse({
    content,
    emptyMessage: "Reference image prompt is empty."
  });
  return {
    ...normalized,
    trace: createPromptTraceEntry({
      phase: "reference-image-draft",
      modelId: input.modelId,
      systemPrompt,
      userPrompt,
      response: normalized.prompt,
      apiKey: input.apiKey
    })
  };
}

export async function optimizePrompt(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
}): Promise<NormalizedPromptFields & { trace: PromptTraceEntry }> {
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
  const normalized = normalizePromptFieldsResponse({
    content,
    emptyMessage: "Prompt optimization response is empty.",
    sourceText: input.requirement
  });
  return {
    ...normalized,
    trace: createPromptTraceEntry({
      phase: "prompt-optimization",
      modelId: input.modelId,
      systemPrompt,
      userPrompt,
      response: normalized.prompt,
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
  onThinkingToken?: (thinking: string) => void;
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
    ? await sendGatewayStream(request, input.onToken, input.onThinkingToken)
    : await sendGatewayRequest(request);
  const code = stripCodeFence(response);
  if (!code) {
    throw new Error("The model returned an empty response.");
  }
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
  // CJK text tokenizes near one token per character; Latin text near 3.2 chars per token.
  const estimateTextTokens = (text: string) => {
    const cjkChars = text.match(/[\u3000-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
    return Math.ceil(cjkChars + (text.length - cjkChars) / 3.2);
  };
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
  if (context === "slice-review") {
    return `Slice toolpath renders are too large for review (${sizeText}). This shouldn't normally happen with the default view count; try slicing again.`;
  }
  return `Vision payload is too large for review (${sizeText}). Rerender with bounded captures before reviewing.`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const REQUEST_TIMEOUT_MS = 180_000;
const STREAM_IDLE_TIMEOUT_MS = 90_000;

async function sendGatewayRequest(request: ReturnType<typeof createModelRequest>) {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const data = (await response.json().catch(() => ({}))) as Partial<GatewayResponse> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with ${response.status}`);
  }
  return data.content ?? "";
}

async function sendGatewayStream(
  request: ReturnType<typeof createModelRequest>,
  onToken: (code: string) => void,
  onThinkingToken?: (thinking: string) => void
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
  let thinking = "";
  return readOpenAiStream(
    response.body,
    (delta) => {
      accumulated += delta;
      onToken(stripCodeFence(accumulated));
    },
    (delta) => {
      thinking += delta;
      onThinkingToken?.(thinking);
    },
    { idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS }
  );
}

function stripCodeFence(content: string): string {
  const match = content.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  if (match) {
    return match[1].trim();
  }
  const openFence = content.match(/^\s*```(?:[a-z0-9_-]+)?\s*([\s\S]*)$/i);
  return (openFence?.[1] ?? content).trim();
}

function parseReview(content: string, requirement = "", strictConfidence = false): VisionReview {
  let parsed: Partial<VisionReview>;
  try {
    parsed = JSON.parse(stripCodeFence(content)) as Partial<VisionReview>;
  } catch {
    if (strictConfidence) {
      throw new Error("Review response is not valid JSON.");
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
  const summary = String(parsed.summary ?? "Review completed.");
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((issue) =>
        typeof issue === "string" ? issue : JSON.stringify(issue)
      )
    : ["The model returned review text without an issues array."];
  // Confidence errors must keep their own message; a strict-mode failure
  // here is not a JSON parsing problem.
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
