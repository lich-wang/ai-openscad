import { describe, expect, it } from "vitest";
import { VIEW_CAPTURE_SPECS } from "./capture";

function normalize([x, y, z]: [number, number, number]): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

describe("view capture specs", () => {
  it("defines six orthographic and eight isometric camera directions in stable order", () => {
    const expectedSpecs = [
      { key: "front", direction: [0, -1, 0], up: [0, 0, 1] },
      { key: "back", direction: [0, 1, 0], up: [0, 0, 1] },
      { key: "left", direction: [-1, 0, 0], up: [0, 0, 1] },
      { key: "right", direction: [1, 0, 0], up: [0, 0, 1] },
      { key: "top", direction: [0, 0, 1], up: [0, 1, 0] },
      { key: "bottom", direction: [0, 0, -1], up: [0, 1, 0] },
      { key: "isoFrontRightTop", direction: normalize([1, -1, 0.75]), up: [0, 0, 1] },
      { key: "isoFrontLeftTop", direction: normalize([-1, -1, 0.75]), up: [0, 0, 1] },
      { key: "isoBackRightTop", direction: normalize([1, 1, 0.75]), up: [0, 0, 1] },
      { key: "isoBackLeftTop", direction: normalize([-1, 1, 0.75]), up: [0, 0, 1] },
      {
        key: "isoFrontRightBottom",
        direction: normalize([1, -1, -0.75]),
        up: [0, 0, 1]
      },
      {
        key: "isoFrontLeftBottom",
        direction: normalize([-1, -1, -0.75]),
        up: [0, 0, 1]
      },
      {
        key: "isoBackRightBottom",
        direction: normalize([1, 1, -0.75]),
        up: [0, 0, 1]
      },
      {
        key: "isoBackLeftBottom",
        direction: normalize([-1, 1, -0.75]),
        up: [0, 0, 1]
      }
    ] as const;

    expect(VIEW_CAPTURE_SPECS.map((spec) => spec.key)).toEqual(
      expectedSpecs.map((spec) => spec.key)
    );
    expect(VIEW_CAPTURE_SPECS).toHaveLength(14);
    VIEW_CAPTURE_SPECS.forEach((actual, index) => {
      const expected = expectedSpecs[index];
      expect(actual.key).toBe(expected.key);
      expect(actual.up).toEqual(expected.up);
      actual.direction.forEach((component, componentIndex) => {
        expect(component).toBeCloseTo(expected.direction[componentIndex], 6);
      });
    });
  });
});
