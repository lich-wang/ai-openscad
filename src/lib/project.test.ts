import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyProject,
  exportProject,
  importProject,
  loadProjectWorkspace,
  saveApiKey,
  saveProject
} from "./project";

const emptyViews = {
  front: "",
  back: "",
  left: "",
  right: "",
  top: "",
  bottom: "",
  isoFrontRightTop: "",
  isoFrontLeftTop: "",
  isoBackRightTop: "",
  isoBackLeftTop: "",
  isoFrontRightBottom: "",
  isoFrontLeftBottom: "",
  isoBackRightBottom: "",
  isoBackLeftBottom: ""
};

describe("project persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("exports all project state except API keys", () => {
    const project = createEmptyProject();
    project.requirement = "rounded organizer";
    project.originalRequirement = "rounded organizer";
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
      originalRequirement: "rounded organizer",
      currentCode: "cube([10, 10, 10]);",
      stl: "solid organizer\nendsolid organizer",
      runEvents: []
    });
  });

  it("initializes durable workflow fields for iteration and chat records", () => {
    const project = createEmptyProject();

    expect(project).toMatchObject({
      originalRequirement: "",
      views: emptyViews,
      runEvents: []
    });
  });

  it("imports legacy three-view projects with empty fourteen-view slots", () => {
    const project = importProject(
      JSON.stringify({
        requirement: "legacy cup",
        views: {
          front: "data:image/png;base64,front",
          top: "data:image/png;base64,top",
          right: "data:image/png;base64,right"
        }
      })
    );

    expect(project.views).toEqual({
      ...emptyViews,
      front: "data:image/png;base64,front",
      right: "data:image/png;base64,right",
      top: "data:image/png;base64,top"
    });
  });

  it("imports legacy six-view projects while preserving the old isometric direction", () => {
    const project = importProject(
      JSON.stringify({
        requirement: "legacy six-view cup",
        views: {
          front: "data:image/png;base64,front",
          back: "data:image/png;base64,back",
          left: "data:image/png;base64,left",
          right: "data:image/png;base64,right",
          top: "data:image/png;base64,top",
          isometric: "data:image/png;base64,isometric"
        }
      })
    );

    expect(project.views).toEqual({
      ...emptyViews,
      front: "data:image/png;base64,front",
      back: "data:image/png;base64,back",
      left: "data:image/png;base64,left",
      right: "data:image/png;base64,right",
      top: "data:image/png;base64,top",
      isoFrontRightTop: "data:image/png;base64,isometric"
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

  it("keeps the page saveable when rendered STL exceeds local storage quota", () => {
    const project = createEmptyProject();
    project.id = "large-render";
    project.currentCode = "water_cup();";
    project.stl = "solid large\nfacet normal 0 0 1\nendsolid large";
    for (const key of Object.keys(project.views) as Array<keyof typeof project.views>) {
      project.views[key] = `data:image/png;base64,${key}`;
    }

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function setItemWithQuota(key, value) {
        if (String(value).includes("solid large")) {
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      });

    saveProject(project);

    const stored = JSON.parse(
      localStorage.getItem("ai-openscad.project") ?? "{}"
    ) as typeof project;
    expect(stored.id).toBe("large-render");
    expect(stored.stl).toBe("");
    expect(stored.views).toEqual(project.views);
    expect(localStorage.getItem("ai-openscad.active-project-id")).toBe("large-render");
    expect(setItem).toHaveBeenCalledWith(
      "ai-openscad.project",
      expect.stringContaining("solid large")
    );
    expect(setItem).toHaveBeenLastCalledWith(
      "ai-openscad.active-project-id",
      "large-render"
    );
  });
});
