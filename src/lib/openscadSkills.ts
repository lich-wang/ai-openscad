import { buildModelingInstruction } from "./modelSkill";
import { buildLanguageInstruction } from "./languageSkill";
import {
  buildRenderPrecisionInstruction,
  type RenderPrecision
} from "./renderSkill";
import type { RenderEvidence } from "./project";
import { VIEW_KEYS } from "./viewSpecs";

export const OPENSCAD_SKILL_CONTEXT = `
You generate production-quality OpenSCAD code.

Rules:
- Return only OpenSCAD code unless explicitly asked for explanation.
- Add $fn values for curved parts where needed.
- Keep code deterministic and self-contained.
`;

export function buildCodeSystemPrompt(
  precision: RenderPrecision = "draft",
  sourceText = ""
): string {
  return `${OPENSCAD_SKILL_CONTEXT}
${buildLanguageInstruction(sourceText)}
${buildModelingInstruction()}
${buildRenderPrecisionInstruction(precision)}

Output requirements:
- Produce valid OpenSCAD.
- Include concise comments for key modules.
- Make the model printable or inspectable by default.
`;
}

export function buildRevisionPrompt(input: {
  requirement: string;
  code: string;
  reviewSummary: string;
  issues: string[];
  userNotes?: string;
  precision?: RenderPrecision;
  renderEvidence?: RenderEvidence | null;
}): string {
  return `Revise this OpenSCAD model after visual review.
${buildRenderPrecisionInstruction(input.precision ?? "draft")}
${buildLanguageInstruction(`${input.requirement}\n${input.userNotes ?? ""}`)}

Original requirement:
${input.requirement}

Current OpenSCAD:
\`\`\`scad
${input.code}
\`\`\`

Review summary:
${input.reviewSummary}

Issues:
${input.issues.map((issue) => `- ${issue}`).join("\n") || "- No specific issues"}

User iteration notes:
${input.userNotes?.trim() || "No extra user notes."}

${formatRenderEvidence(input.renderEvidence)}

Return the complete revised OpenSCAD code only.`;
}

export function buildVisionSystemPrompt(requirement = ""): string {
  return `You review OpenSCAD-generated 3D models from these 14 views in order: ${VIEW_KEYS.join(", ")}.
${buildLanguageInstruction(requirement)}
Rendered model views are always provided first. If original reference images are also provided after the 14 rendered views, use them only to compare the subject model's physical shape and structure.
Return JSON with keys: summary, issues, correctionPrompt, confidence.
- issues must be an array of strings.
- confidence must be 0 to 1.
- correctionPrompt must be a concise, user-editable prompt for the text LLM to revise the current OpenSCAD model.
- correctionPrompt must preserve the original requirement, name the affected view or model area, describe observed mismatches, mention constraints to preserve, infer affected OpenSCAD modules or geometry relationships when possible, and include sizing, placement, or proportion guidance when available.
- Ignore colors, printed graphics, decals, surface patterns, photo lighting, and purely decorative image content unless the user explicitly asks to model a physical raised or engraved feature.
- correctionPrompt should refer to affected OpenSCAD modules or geometry relationships, but avoid returning OpenSCAD code.`;
}

export function buildVisionUserPrompt(
  requirement: string,
  code: string,
  renderEvidence?: RenderEvidence | null,
  referenceImageCount = 0
): string {
  return `Original user requirement:
${requirement}

Current OpenSCAD code:
\`\`\`scad
${code}
\`\`\`

${formatRenderEvidence(renderEvidence)}

Rendered model views: ${VIEW_KEYS.length}
Original reference images: ${referenceImageCount}

Review whether the rendered views satisfy the requirement. Focus on geometry, missing features, proportions, and obvious modeling defects.
If original reference images are provided, compare the generated model against their subject shape and structure. Ignore color, printed graphics, decals, surface patterns, and photo lighting unless the user explicitly asked for physical raised or engraved geometry.`;
}

export function buildReferenceImageSystemPrompt(): string {
  return `You draft target-model prompts for AI OpenSCAD from user-provided reference images.
${promptFieldJsonSchemaInstruction()}
- The prompt must describe the physical target model to generate, not the image file.
- Focus on the reference image subject model's shape, silhouette, proportions, openings, handles, holes, structural parts, and physical geometric details.
- Ignore colors, printed graphics, decals, surface patterns, photo lighting, and decorative image content unless the user explicitly asks to model a physical raised or engraved feature.
- Include object category, visible parts, approximate proportions, key dimensions when inferable, symmetry, openings, handles, holes, physical raised or engraved features when explicitly relevant, and constraints to preserve.
- Prefer printable, OpenSCAD-friendly geometric language.
- Do not return OpenSCAD code.
- Do not mention local file names or image metadata.`;
}

export function buildReferenceImageUserPrompt(imageCount: number): string {
  return `Draft a target model prompt from ${imageCount} reference images.
Write the prompt as a concise user-editable requirement for generating a 3D-printable OpenSCAD model.
Focus on the target object's physical shape, geometry, proportions, openings, handles, holes, and visible functional details.
Ignore color, printed graphics, decals, surface patterns, photo lighting, and purely decorative image content unless the user explicitly asked for physical raised or engraved geometry.
Return JSON-only using the required field schema.`;
}

export function buildPromptOptimizationSystemPrompt(requirement = ""): string {
  return `You optimize user-entered text-to-CAD prompts for AI OpenSCAD.
${buildLanguageInstruction(requirement)}
${promptFieldJsonSchemaInstruction()}
- Rewrite the user's existing input into a fillable CAD prompt template with clear labeled fields for a 3D-printable OpenSCAD model.
- Preserve all facts, dimensions, counts, constraints, and intent already provided by the user.
- Do not invent exact values, hidden requirements, code, render evidence, or project history.
- Return structured field values, not a prose paragraph.
- Prefill fields with details the user already gave.
- For missing values, keep explicit placeholders such as "[fill in exact height]" in English or "[请填写精确高度]" in Chinese.
- Include detailsToConfirm entries listing likely missing CAD details the user may want to fill in, such as exact dimensions, wall thickness, hole diameters, clearances, counts, fasteners, print orientation, tolerances, and strength constraints.
- If a detail is only a possibility, phrase it as something to confirm rather than a decided requirement.
- Do not return source code or CAD script.`;
}

export function buildPromptOptimizationUserPrompt(requirement: string): string {
  return `Optimize this user-entered prompt before OpenSCAD generation.

Current prompt:
${requirement}

Rewrite it into a fillable text-to-CAD prompt template with labeled fields, editable placeholders for missing values, and a Details to confirm section for important missing modeling information.
Return JSON-only using the required field schema.`;
}

export function formatRenderEvidence(evidence?: RenderEvidence | null): string {
  if (!evidence) {
    return "";
  }
  return [
    "Render evidence:",
    `compileStatus: ${evidence.compileStatus}`,
    `diagnostics: ${evidence.diagnostics}`,
    `renderPrecision: ${evidence.renderPrecision}`,
    `backend: ${evidence.backend}`,
    `viewCount: ${evidence.viewCount}`
  ].join("\n");
}

function promptFieldJsonSchemaInstruction(): string {
  return `Return JSON-only. Do not include prose before or after the JSON.
Required schema:
{
  "objectTarget": "objectTarget: string",
  "useCase": "useCase: string",
  "knownDetails": ["knownDetails: string[]"],
  "geometry": ["geometry: string[]"],
  "keyDimensions": ["keyDimensions: string[]"],
  "printabilityConstraints": ["printabilityConstraints: string[]"],
  "detailsToConfirm": ["detailsToConfirm: string[]"]
}
- objectTarget: string must name the target model.
- useCase: string describes the intended use or an editable placeholder.
- knownDetails: string[] lists facts already visible or provided.
- geometry: string[] lists shape, structure, openings, handles, holes, and major parts.
- keyDimensions: string[] lists given dimensions and placeholders for missing dimensions.
- printabilityConstraints: string[] lists 3D-printing constraints, wall strength, overhang, tolerances, and orientation notes.
- detailsToConfirm: string[] lists likely missing details the user should fill in.`;
}
