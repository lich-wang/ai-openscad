export const OPENSCAD_MODELING_SKILL = `
3D model skill:
- Use the built-in lich-3D/SCAD printable modeling skill as the house style for practical parts.
- Model in millimeters.
- Start from the physical use case: what the part touches, holds, clears, hinges, drains, clips onto, screws into, or must fit.

MakerWorld Parametric Model Maker (PMM) conformance:
- Generated code must run on the official OpenSCAD 2021 release; do not use development-only syntax or features.
- Use only libraries MakerWorld preloads. BOSL2 is the primary library: begin the file with include <BOSL2/std.scad>. Do not include unknown external libraries or reference unknown external asset files.
- Expose every user-tunable value as a top-level variable annotated with an OpenSCAD Customizer magic comment so PMM renders real controls:
  - slider: value // [min:max] or, with a step, value // [min:step:max]
  - dropdown: value // [option1, option2] or labelled value // [raw1:Label 1, raw2:Label 2]
  - checkbox: a true/false value renders as a checkbox
  - text field: a string value renders as a text box; bound personalized names or labels with value // [maxlength]. The // [maxlength] form is for string values only; a numeric value needs // [min:max] instead.
  - // color turns a "#rrggbb" string into a MakerWorld color picker; // font turns a font-name string into a MakerWorld font picker
  - group related parameters under a /* [Group] */ header, and keep internal-only values in the top block under a /* [Hidden] */ header
- Make the customizer usable: give parameters descriptive, human-readable names, put a short description comment on the line directly above each user-facing parameter, and choose realistic bounded ranges, sensible steps, and a good default value so the default render is already a valid model. The Customizer shows the raw variable name as the control label (it does not prettify it), so the readable name plus the description comment are what the user actually sees. Each description comment must start at the left margin (column 0, no indentation) or the Customizer silently ignores it.

Parameter placement:
- Declare all parameters and named constants once, in a single block at the very top of the file (including any values kept under /* [Hidden] */, such as a small epsilon used to avoid coplanar faces).
- MakerWorld PMM auto-exposes every top-level variable as an editable field, so any top-level value that is not meant to be user-tuned must be placed under a /* [Hidden] */ header to keep the customizer clean.
- Code after that block (modules and the final assembly) must not declare new parameters or constants; it only consumes the top-level parameters and computes derived values as locals inside modules or functions rather than as new top-level constants.

BOSL2-first geometry:
- Prefer BOSL2 primitives, attachables, and operations - cuboid(), cyl(), regular_prism(), spheroid(), torus(), rounded and chamfered solids, attach(), and BOSL2 rounding, threading, and hinges - and do not re-implement shapes, transforms, rounding, threading, or hinges that BOSL2 already provides.
- Use include <BOSL2/hinges.scad> and knuckle_hinge() for hinged boxes when a hinge is requested.
- Use stable constructive solid geometry with clear module boundaries; prefer practical modules such as base(), outer_shape(), hollow_shape(), hole_pattern(), stand(), frame(), door(), hinge_*(), assembly(), and final_model().
- Use difference() for hollowing, slots, and holes; make cutters protrude through target solids by the small epsilon parameter to avoid coplanar boolean faces.
- Use hull() for strong handles, bracket roots, and smooth joins; use linear_extrude() or rotate_extrude() for flat patterns, trays, bowls, rings, tokens, and stamps.

Printability:
- Preserve wall thickness and assembly clearance: start with a sliding-fit gap around 0.3 to 0.4 mm, larger for rough printers or large parts.
- Avoid unknown external files, non-manifold geometry, coplanar boolean faces, floating internal surfaces, and zero-thickness walls.
- Add fillets, chamfers, or rounding to stress points on hooks, handles, clips, hinge arms, and bracket roots.
- Prefer a broad flat print face, mention print orientation in comments when relevant, and avoid unsupported overhangs beyond about 45-50 degrees from vertical.
- Minimizing support material is an explicit design goal, not just avoiding outright failure: convert blunt horizontal overhangs, shelves, and bridges into chamfered or sloped self-supporting geometry wherever the design intent allows it; round the underside of cantilevers instead of leaving a flat 90-degree ledge; prefer teardrop or vertically-elongated cross-sections over circular ones for horizontal holes.
- Split oversized or support-heavy parts into printable pieces with alignment features when needed.
- Echo derived critical dimensions for panels, slots, hinge counts, and clearances when helpful.
- Design the model so front, top, and right orthographic views reveal the requested features.
`;

export function buildModelingInstruction(): string {
  return OPENSCAD_MODELING_SKILL.trim();
}
