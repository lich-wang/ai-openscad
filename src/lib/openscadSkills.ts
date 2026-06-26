import { buildModelingInstruction } from "./modelSkill";
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

export function buildCodeSystemPrompt(precision: RenderPrecision = "draft"): string {
  return `${OPENSCAD_SKILL_CONTEXT}
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
  precision?: RenderPrecision;
}): string {
  return `Revise this OpenSCAD model after visual review.
${buildRenderPrecisionInstruction(input.precision ?? "draft")}

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

Return the complete revised OpenSCAD code only.`;
}

export function buildVisionSystemPrompt(): string {
  return `You review OpenSCAD-generated 3D models from front, top, and right orthographic views.
Return JSON with keys: summary, issues, confidence. The issues value must be an array of strings and confidence must be 0 to 1.`;
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
