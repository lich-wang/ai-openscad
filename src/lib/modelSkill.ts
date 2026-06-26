export const OPENSCAD_MODELING_SKILL = `
3D model skill:
- Model in millimeters.
- Define named parameters at the top for dimensions and tolerances.
- Use stable constructive solid geometry with clear module boundaries.
- Prefer official OpenSCAD primitives and transforms.
- BOSL2 may be used with include <BOSL2/std.scad> when it simplifies geometry.
- Avoid unknown external files, non-manifold geometry, and zero-thickness walls.
- Design the model so front, top, and right orthographic views reveal the requested features.
`;

export function buildModelingInstruction(): string {
  return OPENSCAD_MODELING_SKILL.trim();
}
