import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  createEmptyViewSet,
  type ViewKey,
  type ViewSet
} from "./viewSpecs";

export type { ViewSet } from "./viewSpecs";

export type ViewCaptureStage = ViewKey;

export interface ViewCaptureSpec {
  key: ViewKey;
  direction: [number, number, number];
  up: [number, number, number];
}

export const VIEW_CAPTURE_SPECS: ViewCaptureSpec[] = [
  { key: "front", direction: [0, -1, 0], up: [0, 0, 1] },
  { key: "back", direction: [0, 1, 0], up: [0, 0, 1] },
  { key: "left", direction: [-1, 0, 0], up: [0, 0, 1] },
  { key: "right", direction: [1, 0, 0], up: [0, 0, 1] },
  { key: "top", direction: [0, 0, 1], up: [0, 1, 0] },
  { key: "bottom", direction: [0, 0, -1], up: [0, 1, 0] },
  { key: "isoFrontRightTop", direction: normalizeDirection([1, -1, 0.75]), up: [0, 0, 1] },
  { key: "isoFrontLeftTop", direction: normalizeDirection([-1, -1, 0.75]), up: [0, 0, 1] },
  { key: "isoBackRightTop", direction: normalizeDirection([1, 1, 0.75]), up: [0, 0, 1] },
  { key: "isoBackLeftTop", direction: normalizeDirection([-1, 1, 0.75]), up: [0, 0, 1] },
  { key: "isoFrontRightBottom", direction: normalizeDirection([1, -1, -0.75]), up: [0, 0, 1] },
  { key: "isoFrontLeftBottom", direction: normalizeDirection([-1, -1, -0.75]), up: [0, 0, 1] },
  { key: "isoBackRightBottom", direction: normalizeDirection([1, 1, -0.75]), up: [0, 0, 1] },
  { key: "isoBackLeftBottom", direction: normalizeDirection([-1, 1, -0.75]), up: [0, 0, 1] }
];

// Browsers cap the number of live WebGL contexts (~16) and evict the oldest,
// which can kill the interactive preview during long auto-iterate sessions.
// Reuse one hidden renderer for every capture instead of leaking a context
// per call.
let sharedRenderer: THREE.WebGLRenderer | null = null;

function getCaptureRenderer(): THREE.WebGLRenderer {
  if (sharedRenderer && sharedRenderer.getContext().isContextLost()) {
    sharedRenderer.dispose();
    sharedRenderer.forceContextLoss();
    sharedRenderer = null;
  }
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true
    });
    sharedRenderer.setSize(640, 480);
    sharedRenderer.setPixelRatio(1);
  }
  return sharedRenderer;
}

export async function captureOrthographicViews(
  stl: string,
  options: { onProgress?: (stage: ViewCaptureStage) => Promise<void> | void } = {}
): Promise<ViewSet> {
  const loader = new STLLoader();
  const bytes = new TextEncoder().encode(stl);
  const geometry = loader.parse(bytes.buffer);
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();

  const box = geometry.boundingBox ?? new THREE.Box3();
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);

  const renderer = getCaptureRenderer();
  renderer.setClearColor(0xf8fafc, 1);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7280, 2.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(4, 5, 6);
  scene.add(key);

  const material = new THREE.MeshStandardMaterial({
    color: 0x2f8f83,
    roughness: 0.62,
    metalness: 0.05
  });
  scene.add(new THREE.Mesh(geometry, material));

  const maxDimension = Math.max(size.x, size.y, size.z, 20);
  const camera = new THREE.OrthographicCamera(
    -maxDimension,
    maxDimension,
    maxDimension * 0.75,
    -maxDimension * 0.75,
    0.1,
    maxDimension * 8
  );

  const render = (spec: ViewCaptureSpec) => {
    camera.up.set(...spec.up);
    camera.position
      .set(...spec.direction)
      .multiplyScalar(maxDimension * 2.5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  };

  const views = createEmptyViewSet();
  try {
    for (const spec of VIEW_CAPTURE_SPECS) {
      await options.onProgress?.(spec.key);
      views[spec.key] = render(spec);
    }
  } finally {
    // The renderer is shared; only per-capture GPU resources are released.
    geometry.dispose();
    material.dispose();
  }
  return views;
}

function normalizeDirection(direction: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...direction);
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

export function downloadText(
  filename: string,
  content: string,
  type = "application/json;charset=utf-8"
): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
