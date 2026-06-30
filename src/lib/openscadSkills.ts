import { buildModelingInstruction } from "./modelSkill";
import { buildLanguageInstruction } from "./languageSkill";
import {
  buildRenderPrecisionInstruction,
  type RenderPrecision
} from "./renderSkill";
import type { RenderEvidence } from "./project";

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
  return `You review OpenSCAD-generated 3D models from front, back, left, right, top, and isometric views.
${buildLanguageInstruction(requirement)}
Return JSON with keys: summary, issues, correctionPrompt, confidence.
- issues must be an array of strings.
- confidence must be 0 to 1.
- correctionPrompt must be a concise, user-editable prompt for the text LLM to revise the current OpenSCAD model.
- correctionPrompt must preserve the original requirement, name the affected view or model area, describe observed mismatches, mention constraints to preserve, infer affected OpenSCAD modules or geometry relationships when possible, and include sizing, placement, or proportion guidance when available.
- correctionPrompt should refer to affected OpenSCAD modules or geometry relationships, but avoid returning OpenSCAD code.`;
}

export function buildVisionUserPrompt(
  requirement: string,
  code: string,
  renderEvidence?: RenderEvidence | null
): string {
  return `Original user requirement:
${requirement}

Current OpenSCAD code:
\`\`\`scad
${code}
\`\`\`

${formatRenderEvidence(renderEvidence)}

Review whether the rendered views satisfy the requirement. Focus on geometry, missing features, proportions, and obvious modeling defects.`;
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
