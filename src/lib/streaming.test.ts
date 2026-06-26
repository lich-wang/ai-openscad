import { describe, expect, it } from "vitest";
import { extractOpenAiStreamDeltas } from "./streaming";

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
