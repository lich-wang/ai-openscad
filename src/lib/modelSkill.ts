export const OPENSCAD_MODELING_SKILL = `
3D model skill:
- Use the built-in lich-3D/SCAD printable modeling skill as the house style for practical parts.
- Model in millimeters.
- Start from the physical use case: what the part touches, holds, clears, hinges, drains, clips onto, screws into, or must fit.
- Define named parameters at the top for dimensions and tolerances, including thin/wall, gap, rounding, hole sizes, and any printer bed limit.
- Use stable constructive solid geometry with clear module boundaries.
- Prefer practical modules such as base(), outer_shape(), hollow_shape(), hole_pattern(), stand(), frame(), door(), hinge_*(), assembly(), and final_model().
- Prefer official OpenSCAD primitives and transforms for portability.
- BOSL2 may be used with include <BOSL2/std.scad> when it simplifies geometry; prefer cuboid(), cyl(), regular_prism(), torus(), spheroid(), and rounded/chamfered BOSL2 solids for printable shapes.
- Use include <BOSL2/hinges.scad> and knuckle_hinge() for hinged boxes when a hinge is requested.
- Use difference() for hollowing, slots, and holes; make cutters protrude through target solids by eps = 0.01 to avoid coplanar boolean faces.
- Use hull() for strong handles, bracket roots, and smooth joins; use linear_extrude() or rotate_extrude() for flat patterns, trays, bowls, rings, tokens, and stamps.
- Preserve wall thickness and assembly clearance: start with gap = 0.3 to 0.4 mm for sliding fits, larger for rough printers or large parts.
- Avoid unknown external files, non-manifold geometry, coplanar boolean faces, floating internal surfaces, and zero-thickness walls.
- Add fillets, chamfers, or rounding to stress points on hooks, handles, clips, hinge arms, and bracket roots.
- Prefer a broad flat print face, mention print orientation in comments when relevant, and avoid unsupported overhangs beyond about 45 degrees unless supports are expected.
- Split oversized or support-heavy parts into printable pieces with alignment features when needed.
- Echo derived critical dimensions for panels, slots, hinge counts, and clearances when helpful.
- Design the model so front, top, and right orthographic views reveal the requested features.
`;

export function buildModelingInstruction(): string {
  return OPENSCAD_MODELING_SKILL.trim();
}
