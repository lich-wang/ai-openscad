import { describe, expect, it } from "vitest";
import { appendPromptTrace, createPromptTraceEntry } from "./promptTrace";
import { createEmptyProject } from "./project";

describe("promptTrace", () => {
  it("records model traffic without API keys", () => {
    const entry = createPromptTraceEntry({
      phase: "code-generation",
      modelId: "mimo-v2.5",
      systemPrompt: "system prompt",
      userPrompt: "user prompt with sk-secret",
      response: "OpenSCAD code",
      apiKey: "sk-secret"
    });

    expect(entry.phase).toBe("code-generation");
    expect(entry.modelId).toBe("mimo-v2.5");
    expect(entry.systemPrompt).toBe("system prompt");
    expect(entry.userPrompt).toBe("user prompt with [redacted]");
    expect(entry.response).toBe("OpenSCAD code");
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("appends prompt trace entries to the project", () => {
    const project = createEmptyProject();
    const entry = createPromptTraceEntry({
      phase: "vision-review",
      modelId: "mimo-v2.5",
      systemPrompt: "review system",
      userPrompt: "review user"
    });

    const next = appendPromptTrace(project, entry);

    expect(project.promptTrace).toHaveLength(0);
    expect(next.promptTrace).toEqual([entry]);
  });
});
