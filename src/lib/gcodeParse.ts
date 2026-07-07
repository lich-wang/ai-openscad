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
  // One entry per segment (index into SEGMENT_TYPE_ORDER), matching `positions`/2.
  segmentTypes: Uint8Array;
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

const SEGMENT_TYPE_ORDER: GcodeSegmentType[] = ["wall", "skin", "fill", "support", "skirt", "other"];
const SUPPORT_TYPE_CODE = SEGMENT_TYPE_ORDER.indexOf("support");

export function parseGcodeToolpath(gcode: string): GcodeToolpath {
  const positions: number[] = [];
  const colors: number[] = [];
  const segmentTypes: number[] = [];
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
      segmentTypes.push(SEGMENT_TYPE_ORDER.indexOf(currentType));
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
    segmentTypes: new Uint8Array(segmentTypes),
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

const Z_BAND_LABELS = ["bottom third", "middle third", "top third"] as const;

// Buckets support segments by Z-third x XY-quadrant (relative to the
// toolpath's own bounding box) so a correction prompt can name a rough
// location ("upper third, +X/+Y side") instead of just a bare percentage.
export function describeSupportLocations(toolpath: GcodeToolpath, maxBuckets = 3): string[] {
  if (toolpath.supportSegmentCount === 0) {
    return [];
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < toolpath.positions.length; i += 3) {
    const px = toolpath.positions[i];
    const py = toolpath.positions[i + 1];
    const pz = toolpath.positions[i + 2];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const zSpan = Math.max(maxZ - minZ, 1e-6);

  const buckets = new Map<string, number>();
  for (let segment = 0; segment < toolpath.segmentCount; segment += 1) {
    if (toolpath.segmentTypes[segment] !== SUPPORT_TYPE_CODE) {
      continue;
    }
    const base = segment * 6;
    const midX = (toolpath.positions[base] + toolpath.positions[base + 3]) / 2;
    const midY = (toolpath.positions[base + 1] + toolpath.positions[base + 4]) / 2;
    const midZ = (toolpath.positions[base + 2] + toolpath.positions[base + 5]) / 2;

    const zFraction = (midZ - minZ) / zSpan;
    const zBand = Z_BAND_LABELS[Math.min(2, Math.floor(zFraction * 3))];
    const quadrant = `${midX >= centerX ? "+X" : "-X"}/${midY >= centerY ? "+Y" : "-Y"}`;
    const key = `${zBand}, ${quadrant} side`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxBuckets)
    .map(([label, count]) => {
      const percent = Math.round((count / toolpath.supportSegmentCount) * 100);
      return `${label}: ~${percent}% of support material`;
    });
}

export interface SliceProgressStages {
  usedSupportRange: boolean;
  // 1-based layer numbers, matching the "up to layer N" convention used by
  // layerEndSegment/the interactive layer slider (N=layerCount reveals
  // everything).
  startLayer: number;
  middleLayer: number;
  endLayer: number;
}

// Finds the layer range worth screenshotting: the first/middle/last layer
// that actually contains support material, so a viewer can see support
// begin, peak, and finish. Falls back to the whole print's start/middle/end
// when there's no support at all, so the concept still applies.
export function findSliceProgressStages(toolpath: GcodeToolpath): SliceProgressStages {
  if (toolpath.layerCount === 0) {
    return { usedSupportRange: false, startLayer: 0, middleLayer: 0, endLayer: 0 };
  }

  if (toolpath.supportSegmentCount > 0) {
    let firstSupportLayer: number | null = null;
    let lastSupportLayer: number | null = null;
    let segmentStart = 0;
    for (let layer = 0; layer < toolpath.layerCount; layer += 1) {
      const segmentEnd = toolpath.layerEndSegment[layer];
      for (let segment = segmentStart; segment < segmentEnd; segment += 1) {
        if (toolpath.segmentTypes[segment] === SUPPORT_TYPE_CODE) {
          if (firstSupportLayer === null) {
            firstSupportLayer = layer;
          }
          lastSupportLayer = layer;
          break;
        }
      }
      segmentStart = segmentEnd;
    }
    if (firstSupportLayer !== null && lastSupportLayer !== null) {
      const middleSupportLayer = Math.round((firstSupportLayer + lastSupportLayer) / 2);
      return {
        usedSupportRange: true,
        startLayer: firstSupportLayer + 1,
        middleLayer: middleSupportLayer + 1,
        endLayer: lastSupportLayer + 1
      };
    }
  }

  return {
    usedSupportRange: false,
    startLayer: 1,
    middleLayer: Math.max(1, Math.round(toolpath.layerCount / 2)),
    endLayer: toolpath.layerCount
  };
}
