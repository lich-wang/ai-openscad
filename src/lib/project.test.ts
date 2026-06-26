import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  exportProject,
  importProject,
  loadProjectWorkspace,
  saveApiKey
} from "./project";

describe("project persistence", () => {
  it("exports all project state except API keys", () => {
    const project = createEmptyProject();
    project.requirement = "rounded organizer";
    project.currentCode = "cube([10, 10, 10]);";
    project.stl = "solid organizer\nendsolid organizer";
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
      currentCode: "cube([10, 10, 10]);",
      stl: "solid organizer\nendsolid organizer"
    });
  });

  it("loads a workspace with multiple projects and the active project", () => {
    const first = createEmptyProject();
    first.id = "first";
    first.requirement = "第一个模型";
    first.updatedAt = "2026-06-26T00:00:00.000Z";
    const second = createEmptyProject();
    second.id = "second";
    second.requirement = "第二个模型";
    second.updatedAt = "2026-06-26T01:00:00.000Z";

    localStorage.setItem("ai-openscad.projects", JSON.stringify([first, second]));
    localStorage.setItem("ai-openscad.active-project-id", "first");

    const workspace = loadProjectWorkspace();

    expect(workspace.activeProject.id).toBe("first");
    expect(workspace.projects.map((project) => project.id)).toEqual(["second", "first"]);
  });
});
