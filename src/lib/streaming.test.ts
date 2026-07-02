import { describe, expect, it } from "vitest";
import {
  extractOpenAiStreamDeltas,
  extractOpenAiStreamEvents,
  readOpenAiStream
} from "./streaming";

describe("streaming", () => {
  it("extracts OpenAI-compatible SSE content deltas", () => {
    const chunk = [
      'data: {"choices":[{"delta":{"content":"module "}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"cup()"}}]}',
      "",
      "data: [DONE]",
      ""
    ].join("\n");

    expect(extractOpenAiStreamDeltas(chunk)).toEqual(["module ", "cup()"]);
  });

  it("extracts provider reasoning and thinking events separately from content", () => {
    const chunk = [
      'data: {"choices":[{"delta":{"reasoning_content":"Check proportions. "}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"module "}}]}',
      "",
      'data: {"choices":[{"delta":{"reasoning":"Keep walls printable. "}}]}',
      "",
      'data: {"choices":[{"delta":{"thinking":"Choose low segment counts."}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"cup()"}}]}',
      "",
      "data: [DONE]",
      ""
    ].join("\n");

    expect(extractOpenAiStreamEvents(chunk)).toEqual([
      { type: "thinking", delta: "Check proportions. " },
      { type: "content", delta: "module " },
      { type: "thinking", delta: "Keep walls printable. " },
      { type: "thinking", delta: "Choose low segment counts." },
      { type: "content", delta: "cup()" }
    ]);
    expect(extractOpenAiStreamDeltas(chunk)).toEqual(["module ", "cup()"]);
  });

  it("streams content and thinking callbacks without mixing thinking into final text", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"choices":[{"delta":{"reasoning_content":"Reason about the rim. "}}]}',
              "",
              'data: {"choices":[{"delta":{"content":"cube"}}]}',
              "",
              'data: {"choices":[{"delta":{"thinking":"Avoid unsupported handles."}}]}',
              "",
              'data: {"choices":[{"delta":{"content":"(10);"}}]}',
              "",
              "data: [DONE]",
              ""
            ].join("\n")
          )
        );
        controller.close();
      }
    });
    const contentDeltas: string[] = [];
    const thinkingDeltas: string[] = [];

    const finalText = await readOpenAiStream(
      stream,
      (delta) => contentDeltas.push(delta),
      (delta) => thinkingDeltas.push(delta)
    );

    expect(finalText).toBe("cube(10);");
    expect(contentDeltas).toEqual(["cube", "(10);"]);
    expect(thinkingDeltas).toEqual([
      "Reason about the rim. ",
      "Avoid unsupported handles."
    ]);
  });

  it("ignores partial or non-content events", () => {
    const chunk = [
      "event: ping",
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      "",
      "data: not-json",
      ""
    ].join("\n");

    expect(extractOpenAiStreamDeltas(chunk)).toEqual([]);
  });
});
