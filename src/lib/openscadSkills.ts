import { buildModelingInstruction } from "./modelSkill";
import { buildLanguageInstruction } from "./languageSkill";
import {
  buildRenderPrecisionInstruction,
  type RenderPrecision
} from "./renderSkill";

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

Return the complete revised OpenSCAD code only.`;
}

export function buildVisionSystemPrompt(requirement = ""): string {
  return `You review OpenSCAD-generated 3D models from front, top, and right orthographic views.
${buildLanguageInstruction(requirement)}
Return JSON with keys: summary, issues, correctionPrompt, confidence.
- issues must be an array of strings.
- confidence must be 0 to 1.
- correctionPrompt must be a concise, user-editable prompt for the text LLM to revise the current OpenSCAD model. It should preserve the original requirement, mention the specific visual issues to fix, and avoid returning OpenSCAD code.`;
}

export function buildVisionUserPrompt(requirement: string, code: string): string {
  return `Original user requirement:
${requirement}

Current OpenSCAD code:
\`\`\`scad
${code}
\`\`\`

Review whether the rendered views satisfy the requirement. Focus on geometry, missing features, proportions, and obvious modeling defects.`;
}
