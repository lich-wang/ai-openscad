export function extractOpenAiStreamDeltas(chunk: string): string[] {
  const deltas: string[] = [];
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
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const content = parsed.choices?.[0]?.delta?.content;
      if (content) {
        deltas.push(content);
      }
    } catch {
      // Ignore malformed keepalive or provider-specific events.
    }
  }
  return deltas;
}

export async function readOpenAiStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void
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
    for (const delta of extractOpenAiStreamDeltas(events.join("\n\n"))) {
      fullText += delta;
      onDelta(delta);
    }
  }

  if (buffer) {
    for (const delta of extractOpenAiStreamDeltas(buffer)) {
      fullText += delta;
      onDelta(delta);
    }
  }

  return fullText;
}
