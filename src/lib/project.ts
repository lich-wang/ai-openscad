import type { SliceStage, SliceStageImage } from "./capture";
import { CODE_MODEL_PRESETS, VISION_MODEL_PRESETS } from "./models";
import {
  createEmptyViewSet,
  normalizeViewSet,
  VIEW_KEYS,
  type ViewSet
} from "./viewSpecs";

export interface VisionReview {
  summary: string;
  issues: string[];
  correctionPrompt: string;
  confidence: number;
}

export interface SliceMetadata {
  layerCount: number | null;
  printTimeSeconds: number | null;
  filamentVolumeMm3: number | null;
  supportSegmentRatio: number | null;
}

export interface SliceStageViews {
  usedSupportRange: boolean;
  images: SliceStageImage[];
}

export interface RenderEvidence {
  compileStatus: "success" | "failure";
  diagnostics: string;
  renderPrecision: "draft" | "final";
  backend: string;
  viewCount: number;
  repairable?: boolean;
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

export type RunEventRole = "user" | "assistant" | "tool" | "review" | "error";
export type RunEventStatus = "active" | "complete" | "error";
export type RunEventKind =
  | "requirement"
  | "generation"
  | "compile"
  | "repair"
  | "review-started"
  | "review"
  | "correction-prompt"
  | "revision"
  | "notice";

export interface RunEvent {
  id: string;
  createdAt: string;
  role: RunEventRole;
  title: string;
  content: string;
  status: RunEventStatus;
  kind?: RunEventKind;
  code?: string;
  thinking?: string;
  thinkingCollapsed?: boolean;
  review?: VisionReview;
}

export type PromptTracePhase =
  | "code-generation"
  | "compile"
  | "prompt-optimization"
  | "reference-image-draft"
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
  originalRequirement: string;
  codeModelId: string;
  visionModelId: string;
  currentCode: string;
  compilerOutput: string;
  renderEvidence: RenderEvidence | null;
  review: VisionReview | null;
  sliceMetadata: SliceMetadata | null;
  sliceStageViews: SliceStageViews | null;
  stl: string;
  views: ViewSet;
  referenceImages: string[];
  runEvents: RunEvent[];
  iterations: ProjectIteration[];
  promptTrace: PromptTraceEntry[];
  updatedAt: string;
}

const API_KEY_STORAGE_KEY = "ai-openscad.api-key";
const LLM_API_KEY_STORAGE_KEY = "ai-openscad.llm-api-key";
const VISION_API_KEY_STORAGE_KEY = "ai-openscad.vision-api-key";
const CODE_MODEL_PREF_KEY = "ai-openscad.preferred-code-model";
const VISION_MODEL_PREF_KEY = "ai-openscad.preferred-vision-model";
const DEFAULT_CODE_MODEL = "mimo-v2.5";
const DEFAULT_VISION_MODEL = "mimo-v2.5";
const PROJECT_STORAGE_KEY = "ai-openscad.project";
const PROJECTS_STORAGE_KEY = "ai-openscad.projects";
const CORRUPT_PROJECTS_BACKUP_KEY = "ai-openscad.projects.corrupt";
const ACTIVE_PROJECT_ID_STORAGE_KEY = "ai-openscad.active-project-id";

export interface ProjectWorkspace {
  activeProject: ProjectState;
  projects: ProjectState[];
}

function isKnownModelId(id: string, presets: { id: string }[]): boolean {
  return presets.some((preset) => preset.id === id);
}

// The user's last model choice is remembered so a new model keeps using it
// (e.g. pick DeepSeek once, and new models default to DeepSeek).
export function savePreferredCodeModel(modelId: string): void {
  if (isKnownModelId(modelId, CODE_MODEL_PRESETS)) {
    localStorage.setItem(CODE_MODEL_PREF_KEY, modelId);
  }
}

export function loadPreferredCodeModel(): string {
  const stored = localStorage.getItem(CODE_MODEL_PREF_KEY) ?? "";
  return isKnownModelId(stored, CODE_MODEL_PRESETS) ? stored : DEFAULT_CODE_MODEL;
}

export function savePreferredVisionModel(modelId: string): void {
  if (isKnownModelId(modelId, VISION_MODEL_PRESETS)) {
    localStorage.setItem(VISION_MODEL_PREF_KEY, modelId);
  }
}

export function loadPreferredVisionModel(): string {
  const stored = localStorage.getItem(VISION_MODEL_PREF_KEY) ?? "";
  return isKnownModelId(stored, VISION_MODEL_PRESETS) ? stored : DEFAULT_VISION_MODEL;
}

export function createEmptyProject(): ProjectState {
  return {
    id: crypto.randomUUID(),
    title: "Untitled OpenSCAD Project",
    requirement: "",
    originalRequirement: "",
    codeModelId: loadPreferredCodeModel(),
    visionModelId: loadPreferredVisionModel(),
    currentCode: "",
    compilerOutput: "",
    renderEvidence: null,
    review: null,
    sliceMetadata: null,
    sliceStageViews: null,
    stl: "",
    views: createEmptyViewSet(),
    referenceImages: [],
    runEvents: [],
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
  const storedProjects = loadStoredProjects();
  const projects = upsertProjectList(storedProjects, project);
  if (trySaveProjectWorkspace(project, projects)) {
    return;
  }

  const referenceCompactProject = compactProjectForStorage(project, {
    keepReferenceImages: false,
    keepStl: true,
    keepViews: true
  });
  const referenceCompactProjects = upsertProjectList(
    compactProjectListForStorage(storedProjects, {
      keepReferenceImages: false,
      keepStl: true,
      keepViews: true
    }),
    referenceCompactProject
  );
  if (trySaveProjectWorkspace(referenceCompactProject, referenceCompactProjects)) {
    return;
  }

  const compactProject = compactProjectForStorage(project, {
    keepReferenceImages: false,
    keepStl: false,
    keepViews: true
  });
  const compactProjects = upsertProjectList(
    compactProjectListForStorage(storedProjects, {
      keepReferenceImages: false,
      keepStl: false,
      keepViews: true
    }),
    compactProject
  );
  if (trySaveProjectWorkspace(compactProject, compactProjects)) {
    return;
  }

  const minimalProject = compactProjectForStorage(project, {
    keepReferenceImages: false,
    keepStl: false,
    keepViews: false
  });
  const minimalProjects = upsertProjectList(
    compactProjectListForStorage(storedProjects, {
      keepReferenceImages: false,
      keepStl: false,
      keepViews: false
    }),
    minimalProject
  );
  if (!trySaveProjectWorkspace(minimalProject, minimalProjects)) {
    console.warn(
      "ai-openscad: saving failed even after dropping images, STL, and views; the latest change was not persisted."
    );
  }
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
  const imported = hydrateProject(project);
  const next = projects.filter((item) => item.id !== imported.id);
  return sortProjects([imported, ...next]);
}

export function exportProject(project: ProjectState): string {
  const { referenceImages: _referenceImages, ...exportableProject } = hydrateProject(
    project,
    { keepReferenceImages: false }
  );
  return JSON.stringify(
    {
      ...exportableProject,
      updatedAt: new Date().toISOString()
    },
    null,
    2
  );
}

export function importProject(serialized: string): ProjectState {
  const parsed = JSON.parse(serialized) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Project file must contain a JSON object.");
  }
  return hydrateProject(parsed as Partial<ProjectState>, {
    keepReferenceImages: false
  });
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeReview(value: unknown): VisionReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const review = value as Partial<VisionReview>;
  return {
    summary: asString(review.summary),
    issues: asStringArray(review.issues),
    correctionPrompt: asString(review.correctionPrompt),
    confidence: asFiniteNumber(review.confidence, 0)
  };
}

function normalizeSliceMetadata(value: unknown): SliceMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const metadata = value as Partial<SliceMetadata>;
  return {
    layerCount: asFiniteNumberOrNull(metadata.layerCount),
    printTimeSeconds: asFiniteNumberOrNull(metadata.printTimeSeconds),
    filamentVolumeMm3: asFiniteNumberOrNull(metadata.filamentVolumeMm3),
    supportSegmentRatio: asFiniteNumberOrNull(metadata.supportSegmentRatio)
  };
}

function asFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const SLICE_STAGES = new Set<SliceStage>(["start", "middle", "end"]);
const VIEW_KEY_SET = new Set(VIEW_KEYS);

function normalizeSliceStageViews(value: unknown): SliceStageViews | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const stageViews = value as Partial<SliceStageViews>;
  if (!Array.isArray(stageViews.images)) {
    return null;
  }
  const images: SliceStageImage[] = [];
  for (const item of stageViews.images) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const image = item as Partial<SliceStageImage>;
    if (
      !SLICE_STAGES.has(image.stage as SliceStage) ||
      typeof image.viewKey !== "string" ||
      !VIEW_KEY_SET.has(image.viewKey as (typeof VIEW_KEYS)[number]) ||
      typeof image.dataUrl !== "string"
    ) {
      continue;
    }
    images.push({
      stage: image.stage as SliceStage,
      viewKey: image.viewKey as SliceStageImage["viewKey"],
      dataUrl: image.dataUrl
    });
  }
  return {
    usedSupportRange: stageViews.usedSupportRange === true,
    images
  };
}

function normalizeRenderEvidence(value: unknown): RenderEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const evidence = value as Partial<RenderEvidence>;
  return {
    compileStatus: evidence.compileStatus === "failure" ? "failure" : "success",
    diagnostics: asString(evidence.diagnostics),
    renderPrecision: evidence.renderPrecision === "final" ? "final" : "draft",
    backend: asString(evidence.backend),
    viewCount: asFiniteNumber(evidence.viewCount, 0),
    repairable: typeof evidence.repairable === "boolean" ? evidence.repairable : undefined
  };
}

const runEventRoles = new Set<RunEventRole>([
  "user",
  "assistant",
  "tool",
  "review",
  "error"
]);
const runEventStatuses = new Set<RunEventStatus>(["active", "complete", "error"]);
const runEventKinds = new Set<RunEventKind>([
  "requirement",
  "generation",
  "compile",
  "repair",
  "review-started",
  "review",
  "correction-prompt",
  "revision",
  "notice"
]);

function normalizeRunEvents(value: unknown): RunEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const events: RunEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const event = item as Partial<RunEvent>;
    if (typeof event.id !== "string" || typeof event.title !== "string") {
      continue;
    }
    events.push({
      id: event.id,
      createdAt: asString(event.createdAt),
      role: runEventRoles.has(event.role as RunEventRole)
        ? (event.role as RunEventRole)
        : "assistant",
      title: event.title,
      content: asString(event.content),
      status: runEventStatuses.has(event.status as RunEventStatus)
        ? (event.status as RunEventStatus)
        : "complete",
      kind: runEventKinds.has(event.kind as RunEventKind)
        ? (event.kind as RunEventKind)
        : undefined,
      code: asOptionalString(event.code),
      thinking: asOptionalString(event.thinking),
      thinkingCollapsed:
        typeof event.thinkingCollapsed === "boolean"
          ? event.thinkingCollapsed
          : undefined,
      review: normalizeReview(event.review) ?? undefined
    });
  }
  return events;
}

const iterationStatuses = new Set<ProjectIteration["status"]>([
  "generated",
  "compiled",
  "reviewed",
  "accepted",
  "rejected",
  "error"
]);

function normalizeIterations(value: unknown): ProjectIteration[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const iterations: ProjectIteration[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const iteration = item as Partial<ProjectIteration>;
    if (typeof iteration.id !== "string") {
      continue;
    }
    iterations.push({
      id: iteration.id,
      createdAt: asString(iteration.createdAt),
      requirement: asString(iteration.requirement),
      code: asString(iteration.code),
      modelId: asString(iteration.modelId),
      status: iterationStatuses.has(iteration.status as ProjectIteration["status"])
        ? (iteration.status as ProjectIteration["status"])
        : "generated",
      reviewSummary: asOptionalString(iteration.reviewSummary)
    });
  }
  return iterations;
}

const promptTracePhases = new Set<PromptTracePhase>([
  "code-generation",
  "compile",
  "prompt-optimization",
  "reference-image-draft",
  "vision-review",
  "revision",
  "final-export"
]);

function normalizePromptTrace(value: unknown): PromptTraceEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: PromptTraceEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const entry = item as Partial<PromptTraceEntry>;
    if (typeof entry.id !== "string") {
      continue;
    }
    entries.push({
      id: entry.id,
      createdAt: asString(entry.createdAt),
      phase: promptTracePhases.has(entry.phase as PromptTracePhase)
        ? (entry.phase as PromptTracePhase)
        : "code-generation",
      modelId: asString(entry.modelId),
      systemPrompt: asString(entry.systemPrompt),
      userPrompt: asString(entry.userPrompt),
      response: asString(entry.response)
    });
  }
  return entries;
}

function hydrateProject(
  parsed: Partial<ProjectState>,
  options: { keepReferenceImages?: boolean } = { keepReferenceImages: true }
): ProjectState {
  const empty = createEmptyProject();
  const source =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : ({} as Partial<ProjectState>);
  const requirement = asString(source.requirement);
  const referenceImages =
    options.keepReferenceImages === false
      ? []
      : asStringArray(source.referenceImages);
  return {
    id: asString(source.id) || empty.id,
    title: asString(source.title, empty.title),
    requirement,
    // An empty string is a meaningful value here; fall back to the
    // requirement only when the field is missing entirely.
    originalRequirement:
      typeof source.originalRequirement === "string"
        ? source.originalRequirement
        : requirement,
    codeModelId: asString(source.codeModelId) || empty.codeModelId,
    visionModelId: asString(source.visionModelId) || empty.visionModelId,
    currentCode: asString(source.currentCode),
    compilerOutput: asString(source.compilerOutput),
    renderEvidence: normalizeRenderEvidence(source.renderEvidence),
    review: normalizeReview(source.review),
    sliceMetadata: normalizeSliceMetadata(source.sliceMetadata),
    sliceStageViews: normalizeSliceStageViews(source.sliceStageViews),
    stl: asString(source.stl),
    views: normalizeViewSet(source.views as Parameters<typeof normalizeViewSet>[0]),
    referenceImages,
    runEvents: normalizeRunEvents(source.runEvents),
    iterations: normalizeIterations(source.iterations),
    promptTrace: normalizePromptTrace(source.promptTrace),
    updatedAt: asString(source.updatedAt) || empty.updatedAt
  };
}

let cachedProjectsRaw: string | null = null;
let cachedProjects: ProjectState[] | null = null;

function loadStoredProjects(): ProjectState[] {
  const storedProjects = localStorage.getItem(PROJECTS_STORAGE_KEY);
  if (storedProjects) {
    if (storedProjects === cachedProjectsRaw && cachedProjects) {
      return cachedProjects;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(storedProjects);
    } catch {
      backupCorruptProjects(storedProjects);
      return [];
    }
    if (!Array.isArray(parsed)) {
      backupCorruptProjects(storedProjects);
      return [];
    }
    const projects: ProjectState[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      try {
        projects.push(hydrateProject(item as Partial<ProjectState>));
      } catch {
        // Drop the unreadable entry but keep the rest of the workspace.
      }
    }
    const sorted = sortProjects(projects);
    cachedProjectsRaw = storedProjects;
    cachedProjects = sorted;
    return sorted;
  }

  const legacy = loadLegacyProject();
  return legacy ? [legacy] : [];
}

function backupCorruptProjects(raw: string): void {
  console.warn(
    "ai-openscad: stored projects were unreadable; keeping a backup under " +
      CORRUPT_PROJECTS_BACKUP_KEY
  );
  try {
    localStorage.setItem(CORRUPT_PROJECTS_BACKUP_KEY, raw);
  } catch {
    // Best effort only.
  }
}

function loadLegacyProject(): ProjectState | null {
  const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  try {
    return hydrateProject(JSON.parse(stored) as Partial<ProjectState>);
  } catch {
    return null;
  }
}

function sortProjects(projects: ProjectState[]): ProjectState[] {
  return [...projects].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function trySaveProjectWorkspace(
  project: ProjectState,
  projects: ProjectState[]
): boolean {
  try {
    const serializedProjects = JSON.stringify(projects);
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
    localStorage.setItem(PROJECTS_STORAGE_KEY, serializedProjects);
    localStorage.setItem(ACTIVE_PROJECT_ID_STORAGE_KEY, project.id);
    cachedProjectsRaw = serializedProjects;
    cachedProjects = projects;
    return true;
  } catch (error) {
    if (!isStorageQuotaError(error)) {
      throw error;
    }
    return false;
  }
}

function compactProjectForStorage(
  project: ProjectState,
  options: {
    keepReferenceImages: boolean;
    keepStl: boolean;
    keepViews: boolean;
  }
): ProjectState {
  return {
    ...project,
    referenceImages: options.keepReferenceImages
      ? [...project.referenceImages]
      : [],
    stl: options.keepStl ? project.stl : "",
    views: options.keepViews
      ? { ...project.views }
      : createEmptyViewSet()
  };
}

function compactProjectListForStorage(
  projects: ProjectState[],
  options: {
    keepReferenceImages: boolean;
    keepStl: boolean;
    keepViews: boolean;
  }
): ProjectState[] {
  return projects.map((project) => compactProjectForStorage(project, options));
}

function isStorageQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}
