import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  exportProject,
  importProject,
  saveApiKey
} from "./project";

describe("project persistence", () => {
  it("exports all project state except API keys", () => {
    const project = createEmptyProject();
    project.requirement = "rounded organizer";
    project.currentCode = "cube([10, 10, 10]);";
    project.views.front = "data:image/png;base64,front";
    project.iterations.push({
      id: "iteration-1",
      createdAt: "2026-06-26T00:00:00.000Z",
      requirement: project.requirement,
      code: project.currentCode,
      modelId: "mimo-v2.5",
      status: "compiled",
      reviewSummary: "Looks close"
    });

    saveApiKey("sk-secret");

    const exported = exportProject(project);

    expect(exported).toContain("rounded organizer");
    expect(exported).not.toContain("sk-secret");
    expect(importProject(exported)).toMatchObject({
      requirement: "rounded organizer",
      currentCode: "cube([10, 10, 10]);"
    });
  });
});
