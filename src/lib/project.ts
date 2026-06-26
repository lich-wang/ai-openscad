export interface VisionReview {
  summary: string;
  issues: string[];
  confidence: number;
}

export interface ProjectIteration {
  id: string;
  createdAt: string;
  requirement: string;
  code: string;
  modelId: string;
  status: "generated" | "compiled" | "reviewed" | "accepted" | "rejected" | "error";
  reviewSummary?: string;
}

export interface ProjectState {
  id: string;
  title: string;
  requirement: string;
  codeModelId: string;
  visionModelId: string;
  currentCode: string;
  proposedCode: string;
  compilerOutput: string;
  review: VisionReview | null;
  views: {
    front: string;
    top: string;
    right: string;
  };
  iterations: ProjectIteration[];
  updatedAt: string;
}

const API_KEY_STORAGE_KEY = "ai-openscad.api-key";
const PROJECT_STORAGE_KEY = "ai-openscad.project";

export function createEmptyProject(): ProjectState {
  return {
    id: crypto.randomUUID(),
    title: "Untitled OpenSCAD Project",
    requirement: "",
    codeModelId: "mimo-v2.5",
    visionModelId: "mimo-v2.5",
    currentCode: "",
    proposedCode: "",
    compilerOutput: "",
    review: null,
    views: {
      front: "",
      top: "",
      right: ""
    },
    iterations: [],
    updatedAt: new Date().toISOString()
  };
}

export function saveApiKey(apiKey: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
}

export function loadApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
}

export function saveProject(project: ProjectState): void {
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
}

export function loadProject(): ProjectState {
  const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
  if (!stored) {
    return createEmptyProject();
  }
  return importProject(stored);
}

export function exportProject(project: ProjectState): string {
  return JSON.stringify(
    {
      ...project,
      updatedAt: new Date().toISOString()
    },
    null,
    2
  );
}

export function importProject(serialized: string): ProjectState {
  const parsed = JSON.parse(serialized) as Partial<ProjectState>;
  return {
    ...createEmptyProject(),
    ...parsed,
    views: {
      front: parsed.views?.front ?? "",
      top: parsed.views?.top ?? "",
      right: parsed.views?.right ?? ""
    },
    iterations: parsed.iterations ?? []
  };
}
