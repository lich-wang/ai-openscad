interface GatewayMessage {
  role: "system" | "user" | "assistant";
  content: unknown;
}

interface GatewayBody {
  provider: "mimo" | "deepseek";
  model: string;
  messages: GatewayMessage[];
  temperature?: number;
  responseFormat?: "json";
  stream?: boolean;
}

const providers: Record<
  GatewayBody["provider"],
  {
    baseUrl: string;
    models: Record<string, string>;
    authHeader(apiKey: string): Record<string, string>;
  }
> = {
  mimo: {
    baseUrl: "https://api.xiaomimimo.com/v1",
    models: {},
    authHeader(apiKey: string) {
      return {
        Authorization: `Bearer ${apiKey}`,
        "api-key": apiKey
      };
    }
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    models: {
      "deepseek-v4": "deepseek-v4-pro"
    },
    authHeader(apiKey: string) {
      return {
        Authorization: `Bearer ${apiKey}`
      };
    }
  }
} as const;

export async function proxyModelRequest(request: Request): Promise<Response> {
  const apiKey = readBearerToken(request);
  if (!apiKey) {
    return normalizedError("Missing Authorization bearer token.", 401);
  }

  let body: GatewayBody;
  try {
    body = (await request.json()) as GatewayBody;
  } catch {
    return normalizedError("Request body must be valid JSON.", 400);
  }

  const provider = providers[body.provider];
  if (!provider) {
    return normalizedError(`Unsupported provider: ${body.provider}`, 400);
  }

  const upstreamModel = provider.models[body.model] ?? body.model;

  const upstreamBody: Record<string, unknown> = {
    model: upstreamModel,
    messages: body.messages,
    temperature: body.temperature ?? 0.3,
    stream: body.stream === true
  };

  if (body.responseFormat === "json") {
    upstreamBody.response_format = { type: "json_object" };
  }

  const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...provider.authHeader(apiKey)
    },
    body: JSON.stringify(upstreamBody)
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return normalizedError(summarizeUpstreamError(text), upstream.status);
  }

  if (body.stream === true) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache"
      }
    });
  }

  const text = await upstream.text();
  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return normalizedError("Provider returned invalid JSON.", 502);
  }

  const content = parsed.choices?.[0]?.message?.content ?? "";
  return new Response(
    JSON.stringify({
      content,
      raw: parsed
    }),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

function readBearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function summarizeUpstreamError(text: string): string {
  if (!text) {
    return "Provider request failed.";
  }
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message ?? parsed.message ?? "Provider request failed.";
  } catch {
    return text.slice(0, 500);
  }
}

function normalizedError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      error: message
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
