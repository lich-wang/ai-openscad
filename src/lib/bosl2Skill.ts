/**
 * BOSL2 API Skill — provides LLM prompts with categorized BOSL2 module/function
 * reference so generated OpenSCAD code uses the library correctly.
 *
 * Built from the vendored BOSL2 v2.0.747 sources in src/lib/bosl2/.
 */

export const BOSL2_SKILL = `
BOSL2 v2.0 API — use these library modules and functions instead of re-implementing shapes, transforms, rounding, threading, screws, or hinges.

Include the standard library with: include <BOSL2/std.scad>

For hinged boxes, also include: include <BOSL2/hinges.scad>
For screws: include <BOSL2/screws.scad>
For threading: include <BOSL2/threading.scad>

=== 3D SHAPES (shapes3d.scad) ===
Core: cuboid(size, chamfer, rounding, edges, anchor, spin, orient) — rounded/chamfered box
  cyl(h|h=,r|r=,r1|r1=,r2|r2=,d|d=,d1|d1=,d2|d2=, chamfer, rounding, anchor, spin, orient) — rounded/chamfered cylinder
  sphere(r|d=, anchor, spin, orient) — sphere
  spheroid(r|d=, style="aligned"|"stagger"|"icosa", circum, anchor, spin, orient) — polyhedron sphere with configurable style
  torus(r|d=|d, r2|d2=|d2, anchor, spin, orient) — torus (donut)

More 3D shapes:
  cube(size, center, anchor, spin, orient) — axis-aligned cube (also function form)
  cylinder(h, r1, r2, center, r, d, d1, d2, anchor, spin, orient)
  wedge(size, center, anchor, spin, orient) — right-angled wedge
  octahedron(size, anchor, spin, orient)
  tube(h|height=, od|od=, id|id=, wall|wall=, or|or=, ir|ir=, r1|r1=, r2|r2=, center, anchor, spin, orient) — hollow cylinder
  rect_tube(h|height=, size|size=, isize|isize=, wall|wall=, ir|ir=, rounding, chamfer, anchor, spin, orient) — hollow rectangular tube
  pie_slice(ang|angle=, r|r=, d|d=, h|height=, anchor, spin, orient) — angular pie wedge
  teardrop(h, r, ang=45, cap_h, r1, r2, d, d1, d2, circum, realign, anchor, spin, orient) — teardrop cylinder
  onion(r, ang=45, cap_h, d, circum, realign, anchor, spin, orient) — double-teardrop profile
  prismoid(size1, size2, h|shift=|height=, anchor, spin, orient) — tapered rectangular prism
  regular_prism(n, h|height=, r|od=|or=|d=|id=|ir=|side=| rounding, chamfer, anchor, spin, orient) — regular n-sided prism
  text3d(text, h, size=10, font, spacing=1.0, anchor, spin, orient) — extruded 3D text
  path_text(path, text, font, size, thickness, letters=false) — 3D text along a path
  interior_fillet(l|h=, r|r=, d|d=, ang|angle=) — fillet between two faces
  fillet(r|r=, d|d=) — basic fillet
  textured_tile(size, tex, ...) — textured flat tile
  heightfield(data, size, h, ...) — heightfield surface
  cylindrical_heightfield(data, r, h, ...) — cylindrical heightfield
  ruler(length, width, thickness, labels, ...) — printable ruler

=== 2D SHAPES (shapes2d.scad) ===
  rect(size, rounding, chamfer, anchor) — rounded/chamfered rectangle
  square(size, center, anchor) — basic square
  circle(r|d=, anchor) — 2D circle
  ellipse(r|d=, anchor) — 2D ellipse
  regular_ngon(n, r|d=|or=|od=|ir=|id=|side=, rounding, realign, anchor) — regular n-gon
  pentagon(...), hexagon(...), octagon(...)
  right_triangle(size, anchor) — right triangle
  trapezoid(size1, size2, h, shift, anchor, spin)
  star(n, r|d=|or=|od=, ir|id=, step, realign, anchor) — star polygon
  teardrop2d(r|d=, ang=45, cap_h, anchor) — 2D teardrop
  egg(r, R, d, D, anchor) — egg shape
  ring(od|or=|r=, id|ir=, anchor) — 2D ring/annulus
  glued_circles(r|d=, spread, tangent, anchor) — two tangent circles
  squircle(size, style="fg"|"se", atype="box", anchor) — superellipse rectangle
  keyhole(l, r1, r2, anchor) — keyhole slot
  reuleaux_polygon(n, r|d=, anchor) — Reuleaux polygon
  supershape(n1, n2, n3, r|d=, m, step, anchor) — superformula shape
  text(text, size=10, font, spacing=1.0, ...) — 2D text
  round2d(r|d=) — 2D rounding
  shell2d(thickness, ...) — 2D shell/offset

=== TRANSFORMS (transforms.scad) ===
Positioning: move(v|p=) left(x) right(x) fwd(y) back(y) up(z) down(z)
Rotation: xrot(ang) yrot(ang) zrot(ang) skew(sxy,sxz,syx,syz,szx,szy)
Mirror: xflip() yflip() zflip() mirror_copy(v|normal=) xspread(spacing,n|l=) yspread(spacing,n|l=) zspread(spacing,n|l=)
Frame: frame_map(x,y,z) — map coordinate frames
Align: align(anchor,align=CENTER) position(at,pos=) — translate children to anchor
Copies: rot_copies(n,rots,r,delta,sa,ea,subrot) xcopies(spacing,n|l=,sp=) ycopies(spacing,n|l=,sp=) zcopies(spacing,n|l=,sp=)
  grid_copies(spacing,n|size=,stagger) — 2D grid
  arc_copies(n,r|d,sa,ea,rot) — copies along arc

=== ATTACHMENTS (attachments.scad) ===
All BOSL2 shapes support anchors. Key modules:
  attach(from, to, overlap, align, spin, norot, inset, shiftout, inside) — attach child to parent anchor
  position(at,from=) — position child at anchor
  orient(anchor, spin) — orient child to anchor direction
  tag(tag) tag_this(tag) force_tag(tag) tag_scope(scope) — tag children for diff/intersect
  diff(remove="remove", keep="keep") — subtract tagged children
  intersect(intersect="intersect",keep="keep") — intersect with tagged children
  conv_hull(keep="keep") — convex hull of tagged children  
  hide(tags) show_only(tags) show_all() — visibility control
  attachable(anchor, spin, orient, size, size2, r,r1,r2, d,d1,d2, l,h, vnf, path, region, extent, cp, offset, anchors, two_d, axis, override) — define custom attachable shape
  named_anchor(name, pos, orient, spin) — define a named anchor
  frame_ref() — display XYZ frame reference indicator

=== ROUNDING & CHAMFERS (rounding.scad) ===
  round_corners(path, method="circle"|"smooth", r|radius=, cut, joint, closed, ...)
  smooth_path(path, size|relsize, smoothing, method, closed, ...)
  offset_sweep(path, height|h|length|l, top, bot, offset="round"|"delta"|"chamfer", steps, ...)
  offset_stroke(path, width, closed, rounded=false, ...)
  convex_offset_extrude(region, height|h=, top=[], bot=[], ...) — offset extruded 2D region
  rounded_prism(bottom, top, joint_top, joint_bot, joint_sides, k, ...)
  bent_cutout_mask(path, thickness, radius, ...)
  join_prism(polygon, base, auxiliary, fillet, ...)
  prism_connector(profile, base_T, aux_T, fillet, ...)
  attach_prism(profile, anchor, fillet=0, rounding=0, l|h|length|height, ...)

=== MASKS (masks.scad) ===
  chamfer_mask(l|h=, chamfer|chamfer1|chamfer2=, ang, ...)
  rounding_mask(l|h=, r|r1|r2=, rounding|rounding1|rounding2=, ang, ...)
  teardrop_mask(r|d=, ang=45, ...)
  rounding_edge_mask(l, r, r1, r2, ang, ...)
  rounding_corner_mask(r, ang=90, d, style="octa", ...)
  rounding_angled_edge_mask(h, r, r1, r2, d, d1, d2, ang=90, ...)
  rounding_angled_corner_mask(r, ang=90, d, ...)
  rounding_cylinder_mask(r, rounding, d, ...)
  rounding_hole_mask(r, rounding, excess=0.1, d, ...)
  cylindrical_rounding_mask(r, rounding, ...)

=== THREADING (threading.scad) ===
  threaded_rod(d, l|length=, pitch, ...) — ISO metric threaded rod
  threaded_nut(nutwidth, id|od=, h|thickness=, pitch, shape="hex"|"square"|"knurl", ...) — nut
  ball_screw_rod(d, l, pitch, ball_diam=5, ball_arc=100, ...) — ball screw
  acme_threaded_rod(d, l, tpi|pitch=, ...) — Acme/trapezoidal threaded rod
  acme_threaded_nut(nutwidth, id, h, tpi|pitch=, ...) — Acme nut
  trapezoidal_threaded_rod(d, l, pitch, ...) — trapezoidal lead screw
  trapezoidal_threaded_nut(nutwidth, id, h, pitch, ...) — trapezoidal nut
  buttress_threaded_rod(d, l, pitch, ...) — buttress thread
  buttress_threaded_nut(nutwidth, id, h, pitch, ...) — buttress nut
  square_threaded_rod(d, l, pitch, ...) — square thread
  square_threaded_nut(nutwidth, id, h, pitch, ...) — square nut
  thread_specification(pitch, ...) — custom thread profile

=== SCREWS (screws.scad) ===
  screw(spec, head, drive, thread, drive_size, length|len=, ...) — complete screw model
  screw_hole(spec, length|len=, thread, oversize, ...) — hole for screw
  nut(spec, shape="hex", ...) — matching nut
  nut_trap_shoulder(spec, nut, width, thickness, ...) — captive nut trap (shoulder style)
  nut_trap_square_shoulder(...)
  nut_trap_side(...)
  screw_specification(name, head, drive, diameter, pitch, length, ...) — define custom screw

=== HINGES (hinges.scad) ===
  knuckle_hinge(size, offset=[0,0], spin=[0,0], knuckles=3, clearance=0.05, $slop, ...) — knuckle hinge
  leaf_hinge(size, leaf, pin, clearance, ...) — leaf hinge with configurable leaves
  living_hinge(size, thickness=1, gap=0.5, ...) — living/flex hinge
  snap_lock(thick, snap_width, socket_width, clearance, ...) — snap-fit lock
  apply_folding_hinges_and_snaps(thick, foldangle, hinges, snaps, sockets, ...) — folding assembly

=== SKIN & SWEEPS (skin.scad) ===
  skin(profiles, slices, refine, method="distance"|"tangent"|"reindex"|... , ...)
  linear_sweep(region, height|h=, twist, scale, slices, ...)
  rotational_sweep(region, angle, ...)
  spiral_sweep(region, h, turns, ...)
  path_sweep(shape, path, method="incremental"|"natural"|"manual", ...)
  path_sweep2d(shape, path, closed, ...)
  sweep(shape, path, ...)
  texture(tex, ...) — apply texture pattern
  associate_vertices(polygons, split, ...) — vertex correspondences for skinning

=== PATHS & 2D TOOLS (paths.scad, regions.scad) ===
  arc(N|n=, r|d=, angle, start, wedge, ...) — circular arc path
  circle_2d(r|d=) — circle as points  
  rect_path(size, ...) — rectangle as points
  star_2d(n, r, ir, ...) — star as points
  path_merge_collinear(path, ...) — simplify collinear segments  
  path_length(path, closed) — arc length of path
  region(area, ...) — define 2D region from paths
  union(), difference() — boolean ops on regions

=== VNF (Vertex-Normal-Face) (vnf.scad) ===
  vnf_polyhedron(vnf) — render a VNF
  vnf_vertex_array(points, cols, rows, ...) — grid-based VNF
  vnf_tri_array(points, ...) — triangle array VNF
  vnf_join(vnfs) — combine VNFs
  vnf_hull(points) — convex hull as VNF
  vnf_sheet(path, width, ...) — VNF from path + width
  vnf_bend(vnf, r|d=, axis="X"|"Y"|"Z") — bend a VNF around cylinder
  vnf_slice(vnf, dir, cuts, ...) — slice VNF on plane
  vnf_volume(vnf)
  vnf_area(vnf)
  vnf_halfspace(plane, closed)
  vnf_boundary(vnf)
  vnf_reverse_faces(vnf)

=== MATH (math.scad) ===
  quant(x, y) quantdn(x, y) quantup(x, y) — quantize to multiples
  lerp(a, b, u) — linear interpolation
  constrain(x, min, max) — clamp value
  sqr(x) — square
  hypot(x, y) — hypotenuse
  gaussian_rands(mean, sd, n)
  log(x) log2(x) log10(x) ln(x)
  sinh(x) cosh(x) tanh(x) asinh(x) acosh(x) atanh(x)
  mod(x, y) — modulo
  posmod(x, y) — positive modulo
  rad_to_deg(r) deg_to_rad(d)
  sum(v, ...) — sum of elements
  mean(v) — arithmetic mean
  factorial(x)

=== VECTORS (vectors.scad) ===
  vector_angle(v1, v2) — angle between vectors
  unit(v, error=true) — normalize to unit length
  norm(v) — Euclidean norm
  cross(u, v) — cross product
  point3d(v, fill=0) — promote 2D to 3D
  point2d(v) — project 3D to 2D
  rot(a, v, ...) — rotate vector
  project_plane(point, plane) — project onto plane
  closest_point(line_pt1, line_pt2, pt) — closest point on line
  line_normal(pts) — normal of line in 2D
  is_collinear(a, b, c, ...) — collinearity test

=== DISTRIBUTORS (distributors.scad) ===
  distribute(spacing, dir, sizes) — distribute children by size
  xdistribute(spacing, ...) ydistribute(spacing, ...)
  distribute_mirror(spacing, sizes) — distribute mirrored pairs
  mirror_copy(v|normal=) — mirror + original

=== COLOR (color.scad) ===
  recolor(c) — force color override
  rainbow(n, ...) — cycle children through rainbow
  ghost(a=0.3) — translucent
  highlight(c="red") — highlight wireframe

=== CONSTANTS (constants.scad) ===
Directions: LEFT, RIGHT, FRONT, FWD, BACK, BOTTOM, BOT, TOP, CENTER, CTR, CENTRE, UP, DOWN
Compound: LEFT+FRONT+TOP, CENTER, etc.
Unit vectors for transforms: UP=[0,0,1], DOWN=[0,0,-1], LEFT=[-1,0,0], RIGHT=[1,0,0], FWD=[0,-1,0], BACK=[0,1,0]
Identity: IDENT — 4x4 identity transform matrix
`;

export function buildBosl2SkillInstruction(): string {
  return BOSL2_SKILL.trim();
}
