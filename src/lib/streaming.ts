export type OpenAiStreamEvent =
  | { type: "content"; delta: string }
  | { type: "thinking"; delta: string };

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
        choices?: Array<{
          delta?: {
            content?: string;
            reasoning_content?: string;
            reasoning?: string;
            thinking?: string;
          };
        }>;
      };
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
  onThinkingDelta?: (delta: string) => void
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() ?? "";
    for (const event of extractOpenAiStreamEvents(events.join("\n\n"))) {
      if (event.type === "thinking") {
        onThinkingDelta?.(event.delta);
      } else {
        fullText += event.delta;
        onDelta(event.delta);
      }
    }
  }

  if (buffer) {
    for (const event of extractOpenAiStreamEvents(buffer)) {
      if (event.type === "thinking") {
        onThinkingDelta?.(event.delta);
      } else {
        fullText += event.delta;
        onDelta(event.delta);
      }
    }
  }

  return fullText;
}
