import { createModelRequest } from "./models";
import {
  buildCodeSystemPrompt,
  buildRevisionPrompt,
  buildVisionSystemPrompt,
  buildVisionUserPrompt
} from "./openscadSkills";
import type { PromptTraceEntry, VisionReview } from "./project";
import { createPromptTraceEntry } from "./promptTrace";
import type { RenderPrecision } from "./renderSkill";

interface GatewayResponse {
  content: string;
}

export async function generateOpenScad(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
  precision?: RenderPrecision;
}): Promise<{ code: string; trace: PromptTraceEntry }> {
  const systemPrompt = buildCodeSystemPrompt(input.precision ?? "draft");
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "code",
    systemPrompt,
    userPrompt: input.requirement
  });
  const response = await sendGatewayRequest(request);
  const code = stripCodeFence(response);
  return {
    code,
    trace: createPromptTraceEntry({
      phase: input.precision === "final" ? "final-export" : "code-generation",
      modelId: input.modelId,
      systemPrompt,
      userPrompt: input.requirement,
      response: code,
      apiKey: input.apiKey
    })
  };
}

export async function reviewViews(input: {
  apiKey: string;
  requirement: string;
  code: string;
  images: string[];
}): Promise<{ review: VisionReview; trace: PromptTraceEntry }> {
  const systemPrompt = buildVisionSystemPrompt();
  const userPrompt = buildVisionUserPrompt(input.requirement, input.code);
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: "mimo-v2.5",
    mode: "vision",
    systemPrompt,
    userPrompt,
    images: input.images,
    responseFormat: "json"
  });
  const content = await sendGatewayRequest(request);
  const review = parseReview(content);
  return {
    review,
    trace: createPromptTraceEntry({
      phase: "vision-review",
      modelId: "mimo-v2.5",
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
  precision?: RenderPrecision;
}): Promise<{ code: string; trace: PromptTraceEntry }> {
  const systemPrompt = buildCodeSystemPrompt(input.precision ?? "draft");
  const userPrompt = buildRevisionPrompt({
    requirement: input.requirement,
    code: input.code,
    reviewSummary: input.review.summary,
    issues: input.review.issues,
    precision: input.precision ?? "draft"
  });
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "code",
    systemPrompt,
    userPrompt
  });
  const response = await sendGatewayRequest(request);
  const code = stripCodeFence(response);
  return {
    code,
    trace: createPromptTraceEntry({
      phase: input.precision === "final" ? "final-export" : "revision",
      modelId: input.modelId,
      systemPrompt,
      userPrompt,
      response: code,
      apiKey: input.apiKey
    })
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

function stripCodeFence(content: string): string {
  const match = content.match(/```(?:openscad|scad)?\s*([\s\S]*?)```/i);
  return (match?.[1] ?? content).trim();
}

function parseReview(content: string): VisionReview {
  try {
    const parsed = JSON.parse(content) as Partial<VisionReview>;
    return {
      summary: String(parsed.summary ?? "Review completed."),
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map(String)
        : ["The model returned review text without an issues array."],
      confidence:
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.5
    };
  } catch {
    return {
      summary: content,
      issues: ["The model returned non-JSON review text."],
      confidence: 0.5
    };
  }
}
