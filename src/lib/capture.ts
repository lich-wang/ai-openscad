import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export interface ViewSet {
  front: string;
  top: string;
  right: string;
}

export type ViewCaptureStage = "front" | "top" | "right";

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

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true
  });
  renderer.setSize(640, 480);
  renderer.setPixelRatio(1);
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

  const render = (position: THREE.Vector3) => {
    camera.position.copy(position.multiplyScalar(maxDimension * 2.5));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  };

  await options.onProgress?.("front");
  const front = render(new THREE.Vector3(0, -1, 0));
  await options.onProgress?.("top");
  const top = render(new THREE.Vector3(0, 0, 1));
  await options.onProgress?.("right");
  const right = render(new THREE.Vector3(1, 0, 0));

  const views = { front, top, right };

  renderer.dispose();
  geometry.dispose();
  material.dispose();
  return views;
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
