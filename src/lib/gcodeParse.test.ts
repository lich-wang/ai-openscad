import { describe, expect, it } from "vitest";
import { parseGcodeToolpath } from "./gcodeParse";

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
