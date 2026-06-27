export type RenderPrecision = "draft" | "final";

export function buildRenderPrecisionInstruction(precision: RenderPrecision): string {
  if (precision === "final") {
    return `Render skill: final export.
- Use high precision for curved surfaces: prefer $fn >= 96 where curves matter.
- Preserve the complete geometry and make the exported file inspectable.
- This mode is intended only after the user confirms high precision export.`;
  }

  return `Render skill: draft compile and fast visual review.
- Use low precision for generated preview geometry: prefer $fn <= 36.
- Keep the model visually faithful while making browser OpenSCAD compile fast.
- Treat the draft as bounded by a browser render complexity budget.
- Avoid many-layer stacked extrusions, dense decorative arrays, per-layer boolean operations, and high segment counts during normal iteration.
- For textured or wavy surfaces, use coarse, inspectable approximations with low segment counts instead of dense polygon rings or per-height slices.
- Preserve the main silhouette and printable dimensions; expensive decorative detail can be added only through explicit user edits or later accepted source changes.`;
}

export function normalizeOpenScadPrecision(
  code: string,
  precision: RenderPrecision
): string {
  const targetFn = precision === "final" ? 128 : 32;
  if (/^\s*\$fn\s*=\s*\d+\s*;/m.test(code)) {
    return code.replace(/^\s*\$fn\s*=\s*\d+\s*;/m, `$fn = ${targetFn};`);
  }
  return `$fn = ${targetFn};\n${code}`;
}
