// Edge-adjacency manifold/watertight check against raw triangle-soup
// positions (as produced by STLLoader's non-indexed BufferGeometry).
// A closed, printable mesh has every edge shared by exactly two triangles;
// this needs no WASM and runs instantly, unlike the real slice attempt.

export interface PrintabilityResult {
  triangleCount: number;
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
  degenerateTriangleCount: number;
  watertight: boolean;
  manifold: boolean;
}

const VERTEX_EPSILON = 1e-5;
const DEGENERATE_AREA_THRESHOLD = 1e-9;

export function checkPrintability(positions: ArrayLike<number>): PrintabilityResult {
  const triangleCount = Math.floor(positions.length / 9);
  const edgeCounts = new Map<string, number>();
  let degenerateTriangleCount = 0;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = triangle * 9;
    const ax = positions[base];
    const ay = positions[base + 1];
    const az = positions[base + 2];
    const bx = positions[base + 3];
    const by = positions[base + 4];
    const bz = positions[base + 5];
    const cx = positions[base + 6];
    const cy = positions[base + 7];
    const cz = positions[base + 8];

    if (triangleArea(ax, ay, az, bx, by, bz, cx, cy, cz) < DEGENERATE_AREA_THRESHOLD) {
      degenerateTriangleCount += 1;
      continue;
    }

    const va = vertexKey(ax, ay, az);
    const vb = vertexKey(bx, by, bz);
    const vc = vertexKey(cx, cy, cz);
    addEdge(edgeCounts, va, vb);
    addEdge(edgeCounts, vb, vc);
    addEdge(edgeCounts, vc, va);
  }

  let openEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) {
      openEdgeCount += 1;
    } else if (count !== 2) {
      nonManifoldEdgeCount += 1;
    }
  }

  return {
    triangleCount,
    openEdgeCount,
    nonManifoldEdgeCount,
    degenerateTriangleCount,
    watertight: openEdgeCount === 0,
    manifold: openEdgeCount === 0 && nonManifoldEdgeCount === 0
  };
}

function triangleArea(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): number {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const crossX = uy * vz - uz * vy;
  const crossY = uz * vx - ux * vz;
  const crossZ = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
}

function vertexKey(x: number, y: number, z: number): string {
  const scale = 1 / VERTEX_EPSILON;
  return `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`;
}

function addEdge(edgeCounts: Map<string, number>, a: string, b: string): void {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
}
