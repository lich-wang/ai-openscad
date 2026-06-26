import { createModelRequest } from "./models";
import {
  buildCodeSystemPrompt,
  buildRevisionPrompt,
  buildVisionSystemPrompt,
  buildVisionUserPrompt
} from "./openscadSkills";
import type { VisionReview } from "./project";

interface GatewayResponse {
  content: string;
}

export async function generateOpenScad(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
}): Promise<string> {
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "code",
    systemPrompt: buildCodeSystemPrompt(),
    userPrompt: input.requirement
  });
  return stripCodeFence(await sendGatewayRequest(request));
}

export async function reviewViews(input: {
  apiKey: string;
  requirement: string;
  code: string;
  images: string[];
}): Promise<VisionReview> {
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: "mimo-v2.5",
    mode: "vision",
    systemPrompt: buildVisionSystemPrompt(),
    userPrompt: buildVisionUserPrompt(input.requirement, input.code),
    images: input.images,
    responseFormat: "json"
  });
  const content = await sendGatewayRequest(request);
  return parseReview(content);
}

export async function proposeRevision(input: {
  apiKey: string;
  modelId: string;
  requirement: string;
  code: string;
  review: VisionReview;
}): Promise<string> {
  const request = createModelRequest({
    apiKey: input.apiKey,
    modelId: input.modelId,
    mode: "code",
    systemPrompt: buildCodeSystemPrompt(),
    userPrompt: buildRevisionPrompt({
      requirement: input.requirement,
      code: input.code,
      reviewSummary: input.review.summary,
      issues: input.review.issues
    })
  });
  return stripCodeFence(await sendGatewayRequest(request));
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
