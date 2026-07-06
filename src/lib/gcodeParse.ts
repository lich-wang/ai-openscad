// Parses CuraEngine G-code (as produced by src/lib/slice.ts) into flat
// three.js-ready line-segment buffers, one segment per extruding move.
// Segments are tagged by the last ";TYPE:" comment CuraEngine emits before
// them (WALL-OUTER/WALL-INNER, SKIN, FILL, SUPPORT/SUPPORT-INTERFACE,
// SKIRT) and grouped by the last ";LAYER:" comment, so a viewer can color
// by type and reveal layers incrementally via BufferGeometry.setDrawRange.

export type GcodeSegmentType = "wall" | "skin" | "fill" | "support" | "skirt" | "other";

export const GCODE_SEGMENT_COLORS: Record<GcodeSegmentType, [number, number, number]> = {
  wall: [0x2f / 0xff, 0x8f / 0xff, 0x83 / 0xff],
  skin: [0x6b / 0xff, 0x72 / 0xff, 0x80 / 0xff],
  fill: [0x9a / 0xff, 0xa5 / 0xff, 0xb1 / 0xff],
  support: [0xe8 / 0xff, 0x59 / 0xff, 0x0c / 0xff],
  skirt: [0xc9 / 0xff, 0xd1 / 0xff, 0xdb / 0xff],
  other: [0x9a / 0xff, 0xa5 / 0xff, 0xb1 / 0xff]
};

export interface GcodeToolpath {
  // Two vertices (xyz) per line segment, flattened.
  positions: Float32Array;
  // Two vertices (rgb) per line segment, flattened, matching `positions`.
  colors: Float32Array;
  segmentCount: number;
  supportSegmentCount: number;
  supportSegmentRatio: number;
  layerCount: number;
  // layerEndSegment[i] = number of segments accumulated through the end of
  // layer i (0-indexed); use `2 * layerEndSegment[i]` as a BufferGeometry
  // draw-range vertex count to reveal layers 0..i.
  layerEndSegment: number[];
}

const TYPE_MAP: Record<string, GcodeSegmentType> = {
  "WALL-OUTER": "wall",
  "WALL-INNER": "wall",
  SKIN: "skin",
  FILL: "fill",
  SUPPORT: "support",
  "SUPPORT-INTERFACE": "support",
  SKIRT: "skirt"
};

export function parseGcodeToolpath(gcode: string): GcodeToolpath {
  const positions: number[] = [];
  const colors: number[] = [];
  const layerEndSegment: number[] = [];

  let currentType: GcodeSegmentType = "other";
  let currentLayerNumber: number | null = null;
  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let segmentCount = 0;
  let supportSegmentCount = 0;

  const lines = gcode.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith(";TYPE:")) {
      currentType = TYPE_MAP[line.slice(";TYPE:".length).trim()] ?? "other";
      continue;
    }

    if (line.startsWith(";LAYER:")) {
      const layerNumber = Number.parseInt(line.slice(";LAYER:".length).trim(), 10);
      if (Number.isFinite(layerNumber) && layerNumber !== currentLayerNumber) {
        if (currentLayerNumber !== null) {
          layerEndSegment.push(segmentCount);
        }
        currentLayerNumber = layerNumber;
      }
      continue;
    }

    if (line.startsWith(";")) {
      continue;
    }

    if (line.startsWith("G92")) {
      const resetE = matchAxis(line, "E");
      if (resetE !== null) {
        e = resetE;
      }
      continue;
    }

    if (!line.startsWith("G0") && !line.startsWith("G1")) {
      continue;
    }

    const nextX = matchAxis(line, "X") ?? x;
    const nextY = matchAxis(line, "Y") ?? y;
    const nextZ = matchAxis(line, "Z") ?? z;
    const nextE = matchAxis(line, "E");
    const isExtruding = nextE !== null && nextE > e;

    if (isExtruding && (nextX !== x || nextY !== y || nextZ !== z)) {
      positions.push(x, y, z, nextX, nextY, nextZ);
      const [r, g, b] = GCODE_SEGMENT_COLORS[currentType];
      colors.push(r, g, b, r, g, b);
      segmentCount += 1;
      if (currentType === "support") {
        supportSegmentCount += 1;
      }
    }

    x = nextX;
    y = nextY;
    z = nextZ;
    if (nextE !== null) {
      e = nextE;
    }
  }

  if (currentLayerNumber !== null) {
    layerEndSegment.push(segmentCount);
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    segmentCount,
    supportSegmentCount,
    supportSegmentRatio: segmentCount > 0 ? supportSegmentCount / segmentCount : 0,
    layerCount: layerEndSegment.length,
    layerEndSegment
  };
}

function matchAxis(line: string, axis: "X" | "Y" | "Z" | "E"): number | null {
  const match = line.match(new RegExp(`${axis}(-?[0-9]*\\.?[0-9]+)`));
  return match ? Number.parseFloat(match[1]) : null;
}
