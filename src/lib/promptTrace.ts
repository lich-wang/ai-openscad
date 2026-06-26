import type { ProjectState, PromptTraceEntry, PromptTracePhase } from "./project";

export function createPromptTraceEntry(input: {
  phase: PromptTracePhase;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  response?: string;
  apiKey?: string;
}): PromptTraceEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    phase: input.phase,
    modelId: input.modelId,
    systemPrompt: redactSecret(input.systemPrompt, input.apiKey),
    userPrompt: redactSecret(input.userPrompt, input.apiKey),
    response: input.response ? redactSecret(input.response, input.apiKey) : ""
  };
}

export function appendPromptTrace(
  project: ProjectState,
  entry: PromptTraceEntry
): ProjectState {
  return {
    ...project,
    promptTrace: [...project.promptTrace, entry],
    updatedAt: new Date().toISOString()
  };
}

function redactSecret(value: string, secret = ""): string {
  return secret ? value.split(secret).join("[redacted]") : value;
}
