import { withTimeout } from "./render";

// cura-wasm inlines a real CuraEngine WASM build; loading it lazily keeps it
// out of the main bundle, same reasoning as openscad-wasm in render.ts.
// Unlike openscad-wasm, cura-wasm manages its own worker internally (via
// threads.js BlobWorker), so no dedicated *Worker.ts file is needed here.

export interface SliceBedSizeMm {
  x: number;
  y: number;
  z: number;
}

export interface SliceOptions {
  bedSizeMm?: SliceBedSizeMm;
  timeoutMs?: number;
  onProgress?: (percent: number) => void;
}

export interface SliceSuccess {
  ok: true;
  gcode: ArrayBuffer;
  layerCount: number | null;
  printTimeSeconds: number | null;
  filamentVolumeMm3: number | null;
}

export interface SliceFailure {
  ok: false;
  reason: string;
}

export type SliceResult = SliceSuccess | SliceFailure;

const DEFAULT_SLICE_TIMEOUT_MS = 90_000;
const DEFAULT_BED_SIZE_MM: SliceBedSizeMm = { x: 220, y: 220, z: 250 };

// cura-wasm's shipped .d.ts extends node's EventEmitter (unavailable without
// @types/node in this browser-only project) and mistypes slice()'s metadata
// as always `null`. This narrow local contract covers only what's actually
// used here instead of pulling in Node ambient types.
interface CuraSlicerHandle {
  on(event: "progress", listener: (percent: number) => void): void;
  slice(
    file: ArrayBuffer,
    extension: string
  ): Promise<{ gcode: ArrayBuffer; metadata: CuraSliceMetadata | null }>;
  destroy(): Promise<void>;
}

interface CuraSliceMetadata {
  printTime: number;
  filamentUsage: number;
}

export async function sliceStlForPrintability(
  stl: string,
  options: SliceOptions = {}
): Promise<SliceResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SLICE_TIMEOUT_MS;
  const bedSize = options.bedSizeMm ?? DEFAULT_BED_SIZE_MM;

  let slicer: CuraSlicerHandle | undefined;
  try {
    const [{ CuraWASM }, { resolveDefinition }] = await Promise.all([
      import("cura-wasm"),
      import("cura-wasm-definitions")
    ]);

    // Overrides intentionally omit `scope`: cura-wasm's CLI builder turns any
    // non-null scope into a `-<scope>` flag meant for extruder/group-level
    // settings (e.g. `-e0`); machine-wide settings must stay unscoped or
    // CuraEngine rejects the whole argument list (`Unknown option: -machine`).
    const config = {
      definition: resolveDefinition("ultimaker2"),
      overrides: [
        { key: "machine_gcode_flavor", value: "Marlin" },
        { key: "machine_width", value: String(bedSize.x) },
        { key: "machine_depth", value: String(bedSize.y) },
        { key: "machine_height", value: String(bedSize.z) },
        // Enabled unconditionally so the diagnostic reflects every overhang
        // that would need support, not just the subset a particular real
        // print profile happens to support; "everywhere" (vs. the default
        // "buildplate") also catches mid-air overhangs, which is the
        // worst-case signal we want for a printability check.
        { key: "support_enable", value: "true" },
        { key: "support_type", value: "everywhere" }
      ]
    };
    slicer = new CuraWASM(config as never) as unknown as CuraSlicerHandle;

    if (options.onProgress) {
      slicer.on("progress", options.onProgress);
    }

    const bytes = new TextEncoder().encode(stl);
    const { gcode, metadata } = await withTimeout(
      slicer.slice(bytes.buffer, "stl"),
      timeoutMs,
      sliceTimeoutMessage(timeoutMs)
    );

    return {
      ok: true,
      gcode,
      layerCount: countGcodeLayers(gcode),
      printTimeSeconds: metadata?.printTime ?? null,
      filamentVolumeMm3: metadata?.filamentUsage ?? null
    };
  } catch (error) {
    return {
      ok: false,
      reason: readableSliceError(error)
    };
  } finally {
    await slicer?.destroy().catch(() => undefined);
  }
}

function countGcodeLayers(gcode: ArrayBuffer): number | null {
  const text = new TextDecoder().decode(gcode);
  const matches = text.match(/^;LAYER:\d+/gm);
  return matches ? new Set(matches).size : null;
}

function readableSliceError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  const message = String(error).trim();
  return message || "Unknown slicing error.";
}

function sliceTimeoutMessage(timeoutMs: number): string {
  return `Slicing timed out after ${Math.round(timeoutMs / 1000)}s. The model may be too complex or non-manifold for the slicer.`;
}
