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

const promptFieldKeys = [
  "objectTarget",
  "useCase",
  "knownDetails",
  "geometry",
  "keyDimensions",
  "printabilityConstraints",
  "detailsToConfirm"
];

function expectNoPromptFieldState(projectLike: Record<string, unknown>) {
  expect(projectLike.promptFieldEditor).toBeUndefined();
  expect(projectLike.promptFields).toBeUndefined();
  expect(projectLike.promptFieldDraft).toBeUndefined();
  for (const key of promptFieldKeys) {
    expect(Object.prototype.hasOwnProperty.call(projectLike, key)).toBe(false);
  }
}

describe("project persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("exports shareable project state except API keys and retained references", () => {
    const project = createEmptyProject();
    project.requirement = "rounded organizer";
    project.originalRequirement = "rounded organizer";
    project.currentCode = "cube([10, 10, 10]);";
    project.stl = "solid organizer\nendsolid organizer";
    project.views.front = "data:image/png;base64,front";
    project.referenceImages = ["data:image/png;base64,retained-reference-secret"];
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
    expect(exported).not.toContain("retained-reference-secret");
    expect(importProject(exported)).toMatchObject({
      requirement: "rounded organizer",
      originalRequirement: "rounded organizer",
      currentCode: "cube([10, 10, 10]);",
      stl: "solid organizer\nendsolid organizer",
      runEvents: [],
      referenceImages: []
    });
  });

  it("initializes durable workflow fields for iteration and chat records", () => {
    const project = createEmptyProject();

    expect(project).toMatchObject({
      originalRequirement: "",
      views: emptyViews,
      runEvents: [],
      referenceImages: []
    });
  });

  it("strips retained reference images from user-imported project JSON", () => {
    const imported = importProject(
      JSON.stringify({
        requirement: "imported bracket",
        referenceImages: ["data:image/png;base64,imported-secret"]
      })
    );

    expect(imported.requirement).toBe("imported bracket");
    expect(imported.referenceImages).toEqual([]);
    expect(JSON.stringify(imported)).not.toContain("imported-secret");
  });

  it("strips transient prompt field state on import, export, and workspace hydration", () => {
    const staleProject = {
      ...createEmptyProject(),
      requirement: "structured prompt text",
      promptFieldEditor: true,
      promptFields: { objectTarget: "stale object" },
      promptFieldDraft: { objectTarget: "stale draft" },
      objectTarget: "stale object",
      useCase: "stale use",
      knownDetails: ["stale detail"],
      geometry: ["stale geometry"],
      keyDimensions: ["stale dimension"],
      printabilityConstraints: ["stale printability"],
      detailsToConfirm: ["stale confirmation"]
    };

    const imported = importProject(JSON.stringify(staleProject));
    expect(imported.requirement).toBe("structured prompt text");
    expectNoPromptFieldState(imported as unknown as Record<string, unknown>);
    expect(JSON.stringify(imported)).not.toContain("stale object");

    const exported = exportProject(
      staleProject as unknown as ReturnType<typeof createEmptyProject>
    );
    expect(exported).toContain("structured prompt text");
    expect(exported).not.toContain("promptFields");
    expect(exported).not.toContain("stale object");
    expectNoPromptFieldState(JSON.parse(exported) as Record<string, unknown>);

    localStorage.setItem("ai-openscad.project", JSON.stringify(staleProject));
    localStorage.setItem("ai-openscad.projects", JSON.stringify([staleProject]));
    localStorage.setItem("ai-openscad.active-project-id", staleProject.id);
    const workspace = loadProjectWorkspace();
    expectNoPromptFieldState(workspace.activeProject as unknown as Record<string, unknown>);
    for (const project of workspace.projects) {
      expectNoPromptFieldState(project as unknown as Record<string, unknown>);
    }
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
    first.referenceImages = ["data:image/png;base64,first-reference"];
    first.updatedAt = "2026-06-26T00:00:00.000Z";
    const second = createEmptyProject();
    second.id = "second";
    second.requirement = "第二个模型";
    second.referenceImages = ["data:image/png;base64,second-reference"];
    second.updatedAt = "2026-06-26T01:00:00.000Z";

    localStorage.setItem("ai-openscad.projects", JSON.stringify([first, second]));
    localStorage.setItem("ai-openscad.active-project-id", "first");

    const workspace = loadProjectWorkspace();

    expect(workspace.activeProject.id).toBe("first");
    expect(workspace.activeProject.referenceImages).toEqual([
      "data:image/png;base64,first-reference"
    ]);
    expect(workspace.projects.map((project) => project.id)).toEqual(["second", "first"]);
    expect(workspace.projects[0].referenceImages).toEqual([
      "data:image/png;base64,second-reference"
    ]);
  });

  it("preserves retained reference images through normal save and load", () => {
    const project = createEmptyProject();
    project.id = "saved-reference-project";
    project.requirement = "reference based model";
    project.referenceImages = ["data:image/png;base64,saved-reference"];

    saveProject(project);
    const workspace = loadProjectWorkspace();

    expect(workspace.activeProject.id).toBe("saved-reference-project");
    expect(workspace.activeProject.referenceImages).toEqual([
      "data:image/png;base64,saved-reference"
    ]);
    const storedProjects = JSON.parse(
      localStorage.getItem("ai-openscad.projects") ?? "[]"
    ) as Array<typeof project>;
    expect(storedProjects).toHaveLength(1);
    expect(storedProjects[0].referenceImages).toEqual([
      "data:image/png;base64,saved-reference"
    ]);
  });

  it("drops retained reference images before generated views during quota compaction", () => {
    const project = createEmptyProject();
    project.id = "large-reference";
    project.currentCode = "holder();";
    project.referenceImages = ["data:image/png;base64,reference-secret"];
    for (const key of Object.keys(project.views) as Array<keyof typeof project.views>) {
      project.views[key] = `data:image/png;base64,${key}`;
    }

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function setItemWithQuota(key, value) {
        if (String(value).includes("reference-secret")) {
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      });

    saveProject(project);

    const stored = JSON.parse(
      localStorage.getItem("ai-openscad.project") ?? "{}"
    ) as typeof project;
    expect(stored.id).toBe("large-reference");
    expect(stored.referenceImages).toEqual([]);
    expect(stored.views).toEqual(project.views);
    expect(JSON.stringify(stored)).not.toContain("reference-secret");
    expect(setItem).toHaveBeenCalledWith(
      "ai-openscad.project",
      expect.stringContaining("reference-secret")
    );
    expect(setItem).toHaveBeenLastCalledWith(
      "ai-openscad.active-project-id",
      "large-reference"
    );
  });

  it("drops retained reference images from stored project list during quota compaction", () => {
    const oldProject = createEmptyProject();
    oldProject.id = "old-reference-heavy";
    oldProject.requirement = "old heavy reference";
    oldProject.updatedAt = "2026-06-26T00:00:00.000Z";
    oldProject.referenceImages = ["data:image/png;base64,old-reference-secret"];
    const activeProject = createEmptyProject();
    activeProject.id = "new-active";
    activeProject.requirement = "new active model";
    activeProject.updatedAt = "2026-06-26T01:00:00.000Z";

    localStorage.setItem("ai-openscad.projects", JSON.stringify([oldProject]));
    localStorage.setItem("ai-openscad.active-project-id", oldProject.id);

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItemWithQuota(key, value) {
      if (String(value).includes("old-reference-secret")) {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    saveProject(activeProject);

    const storedProjects = JSON.parse(
      localStorage.getItem("ai-openscad.projects") ?? "[]"
    ) as Array<typeof activeProject>;
    expect(localStorage.getItem("ai-openscad.active-project-id")).toBe("new-active");
    expect(storedProjects.map((project) => project.id)).toEqual([
      "new-active",
      "old-reference-heavy"
    ]);
    expect(storedProjects[0].referenceImages).toEqual([]);
    expect(storedProjects[1].referenceImages).toEqual([]);
    expect(JSON.stringify(storedProjects)).not.toContain("old-reference-secret");
  });

  it("coerces malformed imported fields instead of crashing later renders", () => {
    const imported = importProject(
      JSON.stringify({
        title: { nested: "object" },
        requirement: 42,
        updatedAt: 1234,
        review: { summary: 7, issues: ["ok", { bad: true }], confidence: "high" },
        runEvents: [
          { id: "good", title: "Generation", content: "cube", role: "assistant" },
          { id: 12, title: "bad id" },
          { title: "missing id" },
          "not an object"
        ],
        iterations: [{ id: "it-1", status: "bogus", code: 9 }, null],
        promptTrace: [{ id: "pt-1", phase: "unknown-phase" }, []]
      })
    );

    expect(imported.title).toBe("Untitled OpenSCAD Project");
    expect(imported.requirement).toBe("");
    expect(typeof imported.updatedAt).toBe("string");
    expect(imported.review).toEqual({
      summary: "",
      issues: ["ok"],
      correctionPrompt: "",
      confidence: 0
    });
    expect(imported.runEvents).toHaveLength(1);
    expect(imported.runEvents[0].id).toBe("good");
    expect(imported.iterations).toEqual([
      expect.objectContaining({ id: "it-1", status: "generated", code: "" })
    ]);
    expect(imported.promptTrace).toEqual([
      expect.objectContaining({ id: "pt-1", phase: "code-generation" })
    ]);
  });

  it("rejects project files that are not JSON objects", () => {
    expect(() => importProject("null")).toThrow();
    expect(() => importProject("[1,2]")).toThrow();
    expect(() => importProject("\"text\"")).toThrow();
  });

  it("keeps readable projects when the stored list holds a broken entry", () => {
    const good = createEmptyProject();
    good.id = "good";
    good.requirement = "survivor";
    localStorage.setItem(
      "ai-openscad.projects",
      JSON.stringify([good, "garbage-entry", { title: 3 }])
    );
    localStorage.setItem("ai-openscad.active-project-id", "good");

    const workspace = loadProjectWorkspace();

    expect(workspace.activeProject.id).toBe("good");
    expect(workspace.activeProject.requirement).toBe("survivor");
  });

  it("backs up an unparseable project list instead of silently discarding it", () => {
    localStorage.setItem("ai-openscad.projects", "{not json");

    const workspace = loadProjectWorkspace();

    expect(workspace.projects).toHaveLength(1);
    expect(localStorage.getItem("ai-openscad.projects.corrupt")).toBe("{not json");
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
