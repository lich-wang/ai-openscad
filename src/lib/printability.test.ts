import { describe, expect, it } from "vitest";
import { checkPrintability } from "./printability";

// Unit cube corners, indexed so each face is two triangles.
const CORNERS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1]
];

const CUBE_FACES: [number, number, number][][] = [
  [
    [0, 1, 2],
    [0, 2, 3]
  ], // bottom
  [
    [4, 6, 5],
    [4, 7, 6]
  ], // top
  [
    [0, 5, 1],
    [0, 4, 5]
  ], // front
  [
    [2, 7, 3],
    [2, 6, 7]
  ], // back
  [
    [0, 3, 7],
    [0, 7, 4]
  ], // left
  [
    [1, 5, 6],
    [1, 6, 2]
  ] // right
];

function trianglesToPositions(triangles: [number, number, number][]): Float32Array {
  const positions = new Float32Array(triangles.length * 9);
  triangles.forEach(([ia, ib, ic], triangleIndex) => {
    const base = triangleIndex * 9;
    positions.set(CORNERS[ia], base);
    positions.set(CORNERS[ib], base + 3);
    positions.set(CORNERS[ic], base + 6);
  });
  return positions;
}

describe("checkPrintability", () => {
  it("reports a closed cube as watertight and manifold", () => {
    const triangles = CUBE_FACES.flat();
    const result = checkPrintability(trianglesToPositions(triangles));

    expect(result.triangleCount).toBe(12);
    expect(result.openEdgeCount).toBe(0);
    expect(result.nonManifoldEdgeCount).toBe(0);
    expect(result.degenerateTriangleCount).toBe(0);
    expect(result.watertight).toBe(true);
    expect(result.manifold).toBe(true);
  });

  it("detects open edges when a face is missing", () => {
    // Drop the top face's two triangles, leaving a hole in the mesh.
    const triangles = CUBE_FACES.slice(1).flat();
    const result = checkPrintability(trianglesToPositions(triangles));

    expect(result.triangleCount).toBe(10);
    expect(result.openEdgeCount).toBeGreaterThan(0);
    expect(result.watertight).toBe(false);
    expect(result.manifold).toBe(false);
  });

  it("detects non-manifold edges when a triangle is duplicated", () => {
    const triangles = [...CUBE_FACES.flat(), ...CUBE_FACES[0]];
    const result = checkPrintability(trianglesToPositions(triangles));

    expect(result.nonManifoldEdgeCount).toBeGreaterThan(0);
    expect(result.manifold).toBe(false);
  });

  it("ignores degenerate zero-area triangles", () => {
    const degenerate: [number, number, number][] = [[0, 0, 1]];
    const triangles = [...CUBE_FACES.flat(), ...degenerate];
    const result = checkPrintability(trianglesToPositions(triangles));

    expect(result.degenerateTriangleCount).toBe(1);
    expect(result.watertight).toBe(true);
    expect(result.manifold).toBe(true);
  });
});
