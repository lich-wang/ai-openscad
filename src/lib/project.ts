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

export type PromptTracePhase =
  | "code-generation"
  | "compile"
  | "vision-review"
  | "revision"
  | "final-export";

export interface PromptTraceEntry {
  id: string;
  createdAt: string;
  phase: PromptTracePhase;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  response: string;
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
  stl: string;
  views: {
    front: string;
    top: string;
    right: string;
  };
  iterations: ProjectIteration[];
  promptTrace: PromptTraceEntry[];
  updatedAt: string;
}

const API_KEY_STORAGE_KEY = "ai-openscad.api-key";
const LLM_API_KEY_STORAGE_KEY = "ai-openscad.llm-api-key";
const VISION_API_KEY_STORAGE_KEY = "ai-openscad.vision-api-key";
const PROJECT_STORAGE_KEY = "ai-openscad.project";
const PROJECTS_STORAGE_KEY = "ai-openscad.projects";
const ACTIVE_PROJECT_ID_STORAGE_KEY = "ai-openscad.active-project-id";

export interface ProjectWorkspace {
  activeProject: ProjectState;
  projects: ProjectState[];
}

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
    stl: "",
    views: {
      front: "",
      top: "",
      right: ""
    },
    iterations: [],
    promptTrace: [],
    updatedAt: new Date().toISOString()
  };
}

export function saveApiKey(apiKey: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
}

export function loadApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
}

export function saveLlmApiKey(apiKey: string): void {
  localStorage.setItem(LLM_API_KEY_STORAGE_KEY, apiKey);
}

export function loadLlmApiKey(): string {
  return localStorage.getItem(LLM_API_KEY_STORAGE_KEY) ?? loadApiKey();
}

export function saveVisionApiKey(apiKey: string): void {
  localStorage.setItem(VISION_API_KEY_STORAGE_KEY, apiKey);
}

export function loadVisionApiKey(): string {
  return localStorage.getItem(VISION_API_KEY_STORAGE_KEY) ?? loadApiKey();
}

export function saveProject(project: ProjectState): void {
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
  const projects = upsertProjectList(loadStoredProjects(), project);
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  localStorage.setItem(ACTIVE_PROJECT_ID_STORAGE_KEY, project.id);
}

export function loadProject(): ProjectState {
  return loadProjectWorkspace().activeProject;
}

export function loadProjectWorkspace(): ProjectWorkspace {
  const projects = loadStoredProjects();
  const activeProjectId = localStorage.getItem(ACTIVE_PROJECT_ID_STORAGE_KEY) ?? "";
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? projects[0];

  if (activeProject) {
    return {
      activeProject,
      projects: sortProjects(projects)
    };
  }

  const legacy = loadLegacyProject();
  if (legacy) {
    return {
      activeProject: legacy,
      projects: [legacy]
    };
  }

  const empty = createEmptyProject();
  return {
    activeProject: empty,
    projects: [empty]
  };
}

export function upsertProjectList(
  projects: ProjectState[],
  project: ProjectState
): ProjectState[] {
  const imported = importProject(JSON.stringify(project));
  const next = projects.filter((item) => item.id !== imported.id);
  return sortProjects([imported, ...next]);
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
    stl: parsed.stl ?? "",
    iterations: parsed.iterations ?? [],
    promptTrace: parsed.promptTrace ?? []
  };
}

function loadStoredProjects(): ProjectState[] {
  const storedProjects = localStorage.getItem(PROJECTS_STORAGE_KEY);
  if (storedProjects) {
    try {
      const parsed = JSON.parse(storedProjects) as unknown[];
      if (Array.isArray(parsed)) {
        return sortProjects(
          parsed.map((item) => importProject(JSON.stringify(item)))
        );
      }
    } catch {
      return [];
    }
  }

  const legacy = loadLegacyProject();
  return legacy ? [legacy] : [];
}

function loadLegacyProject(): ProjectState | null {
  const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  try {
    return importProject(stored);
  } catch {
    return null;
  }
}

function sortProjects(projects: ProjectState[]): ProjectState[] {
  return [...projects].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}
