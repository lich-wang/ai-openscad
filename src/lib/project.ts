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
    iterations: parsed.iterations ?? [],
    promptTrace: parsed.promptTrace ?? []
  };
}
