export type ModelProvider = "mimo" | "deepseek";
export type ModelMode = "code" | "vision";

export interface ModelPreset {
  id: string;
  label: string;
  provider: ModelProvider;
  providerModel: string;
  capability: ModelMode;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

export interface GatewayBody {
  model: string;
  provider: ModelProvider;
  messages: ChatMessage[];
  temperature: number;
  responseFormat?: "json";
  stream?: boolean;
}

export interface GatewayRequest {
  endpoint: "/api/llm" | "/api/vision";
  headers: Record<string, string>;
  body: GatewayBody;
}

export const CODE_MODEL_PRESETS: ModelPreset[] = [
  {
    id: "mimo-v2.5",
    label: "MiMo V2.5",
    provider: "mimo",
    providerModel: "mimo-v2.5-pro",
    capability: "code"
  },
  {
    id: "deepseek-v4",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    providerModel: "deepseek-v4-pro",
    capability: "code"
  }
];

export const VISION_MODEL_PRESETS: ModelPreset[] = [
  {
    id: "mimo-v2.5",
    label: "MiMo V2.5",
    provider: "mimo",
    providerModel: "mimo-v2.5",
    capability: "vision"
  }
];

export function getModelPreset(modelId: string, mode: ModelMode): ModelPreset {
  const presets = mode === "vision" ? VISION_MODEL_PRESETS : CODE_MODEL_PRESETS;
  const preset = presets.find((candidate) => candidate.id === modelId);
  if (!preset) {
    throw new Error(`Unsupported ${mode} model: ${modelId}`);
  }
  return preset;
}

export function createModelRequest(input: {
  apiKey: string;
  modelId: string;
  mode: ModelMode;
  systemPrompt: string;
  userPrompt: string;
  images?: string[];
  responseFormat?: "json";
  stream?: boolean;
}): GatewayRequest {
  const preset = getModelPreset(input.modelId, input.mode);
  const content: ChatMessage["content"] = input.images?.length
    ? [
        { type: "text", text: input.userPrompt },
        ...input.images.map((url) => ({
          type: "image_url" as const,
          image_url: { url }
        }))
      ]
    : input.userPrompt;

  return {
    endpoint: input.mode === "vision" ? "/api/vision" : "/api/llm",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`
    },
    body: {
      model: preset.providerModel,
      provider: preset.provider,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content }
      ],
      temperature: input.mode === "vision" ? 0.2 : 0.35,
      responseFormat: input.responseFormat,
      stream: input.stream
    }
  };
}
