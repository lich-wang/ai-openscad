import { describe, expect, it } from "vitest";
import { describeSupportLocations, findSliceProgressStages, parseGcodeToolpath } from "./gcodeParse";

const SAMPLE_GCODE = `
;LAYER:0
;TYPE:SKIRT
G0 F3600 X0 Y0
G1 F1500 X10 Y0 E1
;TYPE:WALL-OUTER
G1 X10 Y10 E2
;LAYER:1
;TYPE:SUPPORT
G1 X0 Y10 E3
G1 X0 Y0 E4
G92 E0
G1 X5 Y0 E0.5
`;

describe("parseGcodeToolpath", () => {
  it("counts one segment per extruding move and skips travel-only moves", () => {
    const toolpath = parseGcodeToolpath(SAMPLE_GCODE);
    // 4 extruding G1 moves before the G92 reset, plus 1 after it.
    expect(toolpath.segmentCount).toBe(5);
    expect(toolpath.positions.length).toBe(toolpath.segmentCount * 6);
    expect(toolpath.colors.length).toBe(toolpath.segmentCount * 6);
  });

  it("does not emit a segment for the non-extruding G0 travel move", () => {
    const toolpath = parseGcodeToolpath(";LAYER:0\n;TYPE:SKIRT\nG0 F3600 X10 Y0\n");
    expect(toolpath.segmentCount).toBe(0);
  });

  it("tags segments by the last seen TYPE comment", () => {
    const toolpath = parseGcodeToolpath(SAMPLE_GCODE);
    // The two support moves plus the post-G92 move, which stays tagged
    // SUPPORT since no TYPE comment follows it in the sample.
    expect(toolpath.supportSegmentCount).toBe(3);
    expect(toolpath.supportSegmentRatio).toBeCloseTo(3 / 5);
  });

  it("resets the extrusion baseline on G92 instead of treating it as retraction", () => {
    // Without a working G92 reset, E0.5 after E4 would look like a large
    // retraction (negative delta) and be skipped as a travel move.
    const toolpath = parseGcodeToolpath("G1 X1 Y0 E4\nG92 E0\nG1 X5 Y0 E0.5\n");
    expect(toolpath.segmentCount).toBe(2);
  });

  it("groups segments into layers via cumulative end offsets", () => {
    const toolpath = parseGcodeToolpath(SAMPLE_GCODE);
    expect(toolpath.layerCount).toBe(2);
    // Layer 0 has 2 extruding moves (the skirt G0 doesn't extrude).
    expect(toolpath.layerEndSegment[0]).toBe(2);
    expect(toolpath.layerEndSegment[1]).toBe(toolpath.segmentCount);
  });

  it("ignores retraction-only moves (E decreasing)", () => {
    const toolpath = parseGcodeToolpath("G1 X1 Y0 E4\nG1 X1 Y0 Z1 E3\n");
    // Only the initial extruding move counts; the Z-hop-with-retraction adds none.
    expect(toolpath.segmentCount).toBe(1);
  });
});

describe("describeSupportLocations", () => {
  it("returns an empty list when there is no support material", () => {
    const toolpath = parseGcodeToolpath(SAMPLE_GCODE.replace(";TYPE:SUPPORT", ";TYPE:FILL"));
    expect(describeSupportLocations(toolpath)).toEqual([]);
  });

  it("buckets support segments by Z-third and XY-quadrant, sorted by share", () => {
    // Three support moves clustered at the top, +X/+Y side (z~25-27, x~10, y~10),
    // and one at the bottom, -X/-Y side (z~5, x~-10, y~-10). Each move is
    // preceded by a non-extruding G0 travel so its start point is exact and
    // isolated from the previous segment's endpoint. Bounding box spans
    // Z 5-27, so thirds are roughly [5,12.3], [12.3,19.7], [19.7,27].
    const gcode = `
;TYPE:SUPPORT
G0 X9 Y10 Z25
G1 X11 Y10 Z25 E1
G0 X9 Y10 Z26
G1 X11 Y10 Z26 E2
G0 X9 Y10 Z27
G1 X11 Y10 Z27 E3
G0 X-11 Y-10 Z5
G1 X-9 Y-10 Z5 E4
`;
    const toolpath = parseGcodeToolpath(gcode);
    expect(toolpath.supportSegmentCount).toBe(4);

    const locations = describeSupportLocations(toolpath);
    expect(locations).toHaveLength(2);
    expect(locations[0]).toContain("top third");
    expect(locations[0]).toContain("+X/+Y side");
    expect(locations[0]).toContain("~75%");
    expect(locations[1]).toContain("bottom third");
    expect(locations[1]).toContain("-X/-Y side");
    expect(locations[1]).toContain("~25%");
  });

  it("caps the number of returned buckets at maxBuckets", () => {
    const gcode = `
;TYPE:SUPPORT
G0 X9 Y9 Z1
G1 X11 Y11 Z1 E1
G0 X9 Y-11 Z1
G1 X11 Y-9 Z1 E2
G0 X-11 Y9 Z9
G1 X-9 Y11 Z9 E3
G0 X-11 Y-11 Z9
G1 X-9 Y-9 Z9 E4
`;
    const toolpath = parseGcodeToolpath(gcode);
    expect(describeSupportLocations(toolpath, 1)).toHaveLength(1);
  });
});

describe("findSliceProgressStages", () => {
  it("returns all-zero, non-support stages for an empty toolpath", () => {
    const toolpath = parseGcodeToolpath("");
    expect(findSliceProgressStages(toolpath)).toEqual({
      usedSupportRange: false,
      startLayer: 0,
      middleLayer: 0,
      endLayer: 0
    });
  });

  it("locates the first, middle, and last layer containing support material", () => {
    // 6 layers (0-5); support appears on layers 1, 3, and 4 only.
    const gcode = `
;LAYER:0
;TYPE:FILL
G1 X1 Y0 E1
;LAYER:1
;TYPE:SUPPORT
G1 X1 Y1 E2
;LAYER:2
;TYPE:FILL
G1 X1 Y2 E3
;LAYER:3
;TYPE:SUPPORT
G1 X1 Y3 E4
;LAYER:4
;TYPE:SUPPORT
G1 X1 Y4 E5
;LAYER:5
;TYPE:FILL
G1 X1 Y5 E6
`;
    const toolpath = parseGcodeToolpath(gcode);
    expect(toolpath.layerCount).toBe(6);
    expect(findSliceProgressStages(toolpath)).toEqual({
      usedSupportRange: true,
      startLayer: 2, // 0-indexed layer 1 -> 1-based
      middleLayer: 4, // round((1 + 4) / 2) = 3 (0-indexed) -> 1-based
      endLayer: 5 // 0-indexed layer 4 -> 1-based
    });
  });

  it("falls back to overall print progress when there is no support material", () => {
    const gcode = `
;LAYER:0
;TYPE:FILL
G1 X1 Y0 E1
;LAYER:1
;TYPE:FILL
G1 X1 Y1 E2
;LAYER:2
;TYPE:FILL
G1 X1 Y2 E3
;LAYER:3
;TYPE:FILL
G1 X1 Y3 E4
`;
    const toolpath = parseGcodeToolpath(gcode);
    expect(toolpath.layerCount).toBe(4);
    expect(findSliceProgressStages(toolpath)).toEqual({
      usedSupportRange: false,
      startLayer: 1,
      middleLayer: 2,
      endLayer: 4
    });
  });
});
