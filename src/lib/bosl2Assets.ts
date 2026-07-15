// Vendored BOSL2 std-closure. MakerWorld preloads BOSL2, so generated models
// rely on `include <BOSL2/std.scad>` directly; bundling the library lets the
// in-browser openscad-wasm preview resolve the same include locally. This
// module is imported lazily from the render path so the ~3 MB of library source
// stays in its own chunk instead of the main app bundle.
const modules = import.meta.glob("./bosl2/*.scad", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

// Key by bare filename so they can be written under /BOSL2/<name> in the wasm FS.
export const BOSL2_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, content]) => [
    path.slice(path.lastIndexOf("/") + 1),
    content
  ])
);
