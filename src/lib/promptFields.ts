import { detectUserLanguage, type UserLanguage } from "./languageSkill";

export type PromptFieldArrayKey =
  | "knownDetails"
  | "geometry"
  | "keyDimensions"
  | "printabilityConstraints"
  | "detailsToConfirm";

export interface PromptFields {
  objectTarget: string;
  useCase: string;
  knownDetails: string[];
  geometry: string[];
  keyDimensions: string[];
  printabilityConstraints: string[];
  detailsToConfirm: string[];
}

export interface NormalizedPromptFields {
  fields: PromptFields;
  language: UserLanguage;
  prompt: string;
}

export const PROMPT_FIELD_KEYS = [
  "objectTarget",
  "useCase",
  "knownDetails",
  "geometry",
  "keyDimensions",
  "printabilityConstraints",
  "detailsToConfirm"
] as const;

const ARRAY_FIELD_KEYS: PromptFieldArrayKey[] = [
  "knownDetails",
  "geometry",
  "keyDimensions",
  "printabilityConstraints",
  "detailsToConfirm"
];

const EN_LABELS = {
  objectTarget: "Object / target",
  useCase: "Use case",
  knownDetails: "Known details",
  geometry: "Geometry / structure",
  keyDimensions: "Key dimensions",
  printabilityConstraints: "Printability constraints",
  detailsToConfirm: "Details to confirm"
};

const ZH_LABELS = {
  objectTarget: "目标对象",
  useCase: "使用场景",
  knownDetails: "已知细节",
  geometry: "几何结构",
  keyDimensions: "关键尺寸",
  printabilityConstraints: "打印约束",
  detailsToConfirm: "待确认细节"
};

const EN_PLACEHOLDERS: PromptFields = {
  objectTarget: "[fill in target object]",
  useCase: "[fill in intended use]",
  knownDetails: ["[fill in known details]"],
  geometry: ["[fill in geometry or structure]"],
  keyDimensions: ["[fill in key dimensions]"],
  printabilityConstraints: ["[fill in printability constraints]"],
  detailsToConfirm: ["[fill in important missing modeling details]"]
};

const ZH_PLACEHOLDERS: PromptFields = {
  objectTarget: "[请填写目标模型]",
  useCase: "[请填写使用场景]",
  knownDetails: ["[请填写已知细节]"],
  geometry: ["[请填写几何结构]"],
  keyDimensions: ["[请填写关键尺寸]"],
  printabilityConstraints: ["[请填写打印约束]"],
  detailsToConfirm: ["[请填写需要确认的建模细节]"]
};

export function promptFieldLabels(language: UserLanguage) {
  return language === "zh" ? ZH_LABELS : EN_LABELS;
}

export function promptFieldsToText(
  fields: PromptFields,
  language: UserLanguage
): string {
  const labels = promptFieldLabels(language);
  if (language === "zh") {
    return [
      `${labels.objectTarget}：${fields.objectTarget}`,
      `${labels.useCase}：${fields.useCase}`,
      `${labels.knownDetails}：`,
      ...formatList(fields.knownDetails),
      `${labels.geometry}：`,
      ...formatList(fields.geometry),
      `${labels.keyDimensions}：`,
      ...formatList(fields.keyDimensions),
      `${labels.printabilityConstraints}：`,
      ...formatList(fields.printabilityConstraints),
      `${labels.detailsToConfirm}：`,
      ...formatList(fields.detailsToConfirm)
    ].join("\n");
  }
  return [
    `${labels.objectTarget}: ${fields.objectTarget}`,
    `${labels.useCase}: ${fields.useCase}`,
    `${labels.knownDetails}:`,
    ...formatList(fields.knownDetails),
    `${labels.geometry}:`,
    ...formatList(fields.geometry),
    `${labels.keyDimensions}:`,
    ...formatList(fields.keyDimensions),
    `${labels.printabilityConstraints}:`,
    ...formatList(fields.printabilityConstraints),
    `${labels.detailsToConfirm}:`,
    ...formatList(fields.detailsToConfirm)
  ].join("\n");
}

export function normalizePromptFieldsResponse(input: {
  content: string;
  emptyMessage: string;
  sourceText?: string;
}): NormalizedPromptFields {
  const trimmed = stripCodeFence(input.content);
  if (!trimmed) {
    throw new Error(input.emptyMessage);
  }

  const parsed = parseJsonObject(trimmed);
  if (parsed) {
    if (hasPromptFieldPayload(parsed)) {
      return normalizeFromObject(parsed, input.sourceText ?? "", trimmed);
    }
    const legacyPrompt = stringValue(parsed.prompt);
    if (legacyPrompt) {
      return normalizeFromText(legacyPrompt, input.sourceText ?? "");
    }
    if ("prompt" in parsed) {
      throw new Error(input.emptyMessage);
    }
  }

  return normalizeFromText(trimmed, input.sourceText ?? "");
}

function normalizeFromObject(
  payload: Record<string, unknown>,
  sourceText: string,
  rawText: string
): NormalizedPromptFields {
  const language = detectPromptLanguage(sourceText, objectText(payload) || rawText);
  const placeholders = placeholdersFor(language);
  const objectTarget =
    stringValue(payload.objectTarget) ||
    (sourceText.trim() ? sourceText.trim() : placeholders.objectTarget);
  const fields: PromptFields = {
    objectTarget,
    useCase: stringValue(payload.useCase) || placeholders.useCase,
    knownDetails: normalizeArrayField(payload.knownDetails, "knownDetails", language),
    geometry: normalizeArrayField(payload.geometry, "geometry", language),
    keyDimensions: normalizeArrayField(payload.keyDimensions, "keyDimensions", language),
    printabilityConstraints: normalizeArrayField(
      payload.printabilityConstraints,
      "printabilityConstraints",
      language
    ),
    detailsToConfirm: normalizeArrayField(
      payload.detailsToConfirm,
      "detailsToConfirm",
      language
    )
  };
  return {
    fields,
    language,
    prompt: promptFieldsToText(fields, language)
  };
}

function normalizeFromText(text: string, sourceText: string): NormalizedPromptFields {
  const language = detectPromptLanguage(sourceText, text);
  const placeholders = placeholdersFor(language);
  const objectTarget = fallbackTextForLanguage(text, sourceText, language) ||
    sourceText.trim() ||
    placeholders.objectTarget;
  const fields: PromptFields = {
    objectTarget,
    useCase: placeholders.useCase,
    knownDetails: [objectTarget],
    geometry: placeholders.geometry,
    keyDimensions: placeholders.keyDimensions,
    printabilityConstraints: placeholders.printabilityConstraints,
    detailsToConfirm: placeholders.detailsToConfirm
  };
  return {
    fields,
    language,
    prompt: promptFieldsToText(fields, language)
  };
}

function normalizeArrayField(
  value: unknown,
  key: PromptFieldArrayKey,
  language: UserLanguage
): string[] {
  const values = Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : splitStringList(stringValue(value));
  return values.length ? values : [...placeholdersFor(language)[key]];
}

function splitStringList(value: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\n|;|；|、|,/)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasPromptFieldPayload(payload: Record<string, unknown>): boolean {
  return PROMPT_FIELD_KEYS.some((key) => key in payload);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stripCodeFence(content: string): string {
  const match = content.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  return (match?.[1] ?? content).trim();
}

function placeholdersFor(language: UserLanguage): PromptFields {
  return language === "zh" ? ZH_PLACEHOLDERS : EN_PLACEHOLDERS;
}

function detectPromptLanguage(sourceText: string, fallbackText: string): UserLanguage {
  return detectUserLanguage(sourceText.trim() || fallbackText);
}

function fallbackTextForLanguage(
  text: string,
  sourceText: string,
  language: UserLanguage
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  if (!sourceText.trim()) {
    return trimmed;
  }
  if (detectUserLanguage(trimmed) !== language) {
    return "";
  }
  if (language === "zh" && hasEnglishTemplateResidue(trimmed)) {
    return "";
  }
  if (language === "en" && hasChineseTemplateResidue(trimmed)) {
    return "";
  }
  return trimmed;
}

function hasEnglishTemplateResidue(text: string): boolean {
  return /Object\s*\/?\s*target\s*:|Use case\s*:|Known details\s*:|Key dimensions\s*:|Details to confirm\s*:|\[fill in[^\]]*\]/i.test(
    text
  );
}

function hasChineseTemplateResidue(text: string): boolean {
  return /目标对象\s*[:：]|使用场景\s*[:：]|已知细节\s*[:：]|关键尺寸\s*[:：]|待确认细节\s*[:：]|\[请填写[^\]]*\]/.test(
    text
  );
}

function objectText(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of PROMPT_FIELD_KEYS) {
    const value = payload[key];
    if (Array.isArray(value)) {
      parts.push(...value.map(stringValue).filter(Boolean));
    } else {
      const text = stringValue(value);
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join("\n");
}

function formatList(values: string[]): string[] {
  return values.map((value) => `- ${value}`);
}
