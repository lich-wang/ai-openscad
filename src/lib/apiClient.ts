import { createModelRequest } from "./models";
import {
  buildCodeSystemPrompt,
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
  images: string[];
  renderEvidence?: RenderEvidence | null;
}): Promise<{ review: VisionReview; trace: PromptTraceEntry }> {
  const systemPrompt = buildVisionSystemPrompt(input.requirement);
  const userPrompt = buildVisionUserPrompt(
    input.requirement,
    input.code,
    input.renderEvidence
  );
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "vision",
    systemPrompt,
    userPrompt,
    images: input.images,
    responseFormat: "json"
  });
  const content = await sendGatewayRequest(request);
  const review = parseReview(content, input.requirement);
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
  const match = content.match(/```(?:openscad|scad)?\s*([\s\S]*?)```/i);
  return (match?.[1] ?? content).trim();
}

function parseReview(content: string, requirement = ""): VisionReview {
  try {
    const parsed = JSON.parse(content) as Partial<VisionReview>;
    const summary = String(parsed.summary ?? "Review completed.");
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(String)
      : ["The model returned review text without an issues array."];
    return {
      summary,
      issues,
      correctionPrompt: buildFallbackCorrectionPrompt(
        summary,
        issues,
        parsed.correctionPrompt,
        requirement
      ),
      confidence:
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.5
    };
  } catch {
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
