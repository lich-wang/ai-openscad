export type OpenAiStreamEvent =
  | { type: "content"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "error"; message: string };

export function extractOpenAiStreamEvents(chunk: string): OpenAiStreamEvent[] {
  const events: OpenAiStreamEvent[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const payload = trimmed.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as {
        error?: { message?: string } | string;
        choices?: Array<{
          delta?: {
            content?: string;
            reasoning_content?: string;
            reasoning?: string;
            thinking?: string;
          };
        }>;
      };
      if (parsed.error) {
        const message =
          typeof parsed.error === "string"
            ? parsed.error
            : parsed.error.message ?? "Provider reported a stream error.";
        events.push({ type: "error", message });
        continue;
      }
      const delta = parsed.choices?.[0]?.delta;
      const thinking = delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking;
      if (thinking) {
        events.push({ type: "thinking", delta: thinking });
      }
      const content = delta?.content;
      if (content) {
        events.push({ type: "content", delta: content });
      }
    } catch {
      // Ignore malformed keepalive or provider-specific events.
    }
  }
  return events;
}

export function extractOpenAiStreamDeltas(chunk: string): string[] {
  return extractOpenAiStreamEvents(chunk)
    .filter((event): event is { type: "content"; delta: string } => event.type === "content")
    .map((event) => event.delta);
}

export async function readOpenAiStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
  onThinkingDelta?: (delta: string) => void,
  options: { idleTimeoutMs?: number } = {}
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  const dispatch = (chunk: string) => {
    for (const event of extractOpenAiStreamEvents(chunk)) {
      if (event.type === "error") {
        throw new Error(event.message);
      }
      if (event.type === "thinking") {
        onThinkingDelta?.(event.delta);
      } else {
        fullText += event.delta;
        onDelta(event.delta);
      }
    }
  };

  try {
    while (true) {
      const { value, done } = options.idleTimeoutMs
        ? await readWithIdleTimeout(reader, options.idleTimeoutMs)
        : await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      dispatch(events.join("\n\n"));
    }

    if (buffer) {
      dispatch(buffer);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }

  return fullText;
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Model stream stalled: no data received from the provider."));
    }, idleTimeoutMs);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
