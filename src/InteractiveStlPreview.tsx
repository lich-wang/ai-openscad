import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

type PreviewState = "empty" | "ready" | "error";

interface InteractiveStlPreviewProps {
  label: string;
  stl: string;
}

export function InteractiveStlPreview({ label, stl }: InteractiveStlPreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [previewState, setPreviewState] = useState<PreviewState>(
    stl.trim() ? "ready" : "empty"
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    while (mount.firstChild) {
      mount.removeChild(mount.firstChild);
    }

    if (!stl.trim()) {
      setPreviewState("empty");
      return;
    }

    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.MeshStandardMaterial | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let animationFrame = 0;

    try {
      const loader = new STLLoader();
      const bytes = new TextEncoder().encode(stl);
      geometry = loader.parse(bytes.buffer);
      const position = geometry.getAttribute("position");
      if (!position || position.count === 0) {
        throw new Error("STL contains no triangles");
      }

      geometry.computeBoundingBox();
      geometry.computeVertexNormals();
      const box = geometry.boundingBox ?? new THREE.Box3();
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);

      const maxDimension = Math.max(size.x, size.y, size.z, 1);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7280, 2.4));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
      keyLight.position.set(4, 5, 6);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xd7f4ef, 1.1);
      fillLight.position.set(-3, -4, 5);
      scene.add(fillLight);

      material = new THREE.MeshStandardMaterial({
        color: 0x2f8f83,
        roughness: 0.62,
        metalness: 0.05
      });
      scene.add(new THREE.Mesh(geometry, material));

      const camera = new THREE.PerspectiveCamera(
        42,
        1,
        Math.max(maxDimension / 100, 0.1),
        maxDimension * 30
      );
      camera.position.set(maxDimension * 1.45, -maxDimension * 1.85, maxDimension * 1.2);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      });
      renderer.setClearColor(0xf8fafc, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.setAttribute("aria-hidden", "true");
      mount.appendChild(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.enableZoom = true;
      controls.target.set(0, 0, 0);
      controls.update();

      const resize = () => {
        if (!renderer) {
          return;
        }
        const rect = mount.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      const animate = () => {
        if (!renderer || !controls) {
          return;
        }
        controls.update();
        renderer.render(scene, camera);
        animationFrame = window.requestAnimationFrame(animate);
      };

      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount);
      resize();
      animate();
      setPreviewState("ready");
    } catch {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      controls?.dispose();
      geometry?.dispose();
      material?.dispose();
      if (renderer) {
        const canvas = renderer.domElement;
        renderer.dispose();
        renderer.forceContextLoss();
        if (canvas.parentElement === mount) {
          mount.removeChild(canvas);
        }
      }
      animationFrame = 0;
      resizeObserver = null;
      controls = null;
      geometry = null;
      material = null;
      renderer = null;
      setPreviewState("error");
    }

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      controls?.dispose();
      geometry?.dispose();
      material?.dispose();
      if (renderer) {
        const canvas = renderer.domElement;
        renderer.dispose();
        renderer.forceContextLoss();
        if (canvas.parentElement === mount) {
          mount.removeChild(canvas);
        }
      }
    };
  }, [stl]);

  return (
    <div
      aria-label={label}
      className="interactivePreview"
      data-state={previewState}
      role="img"
    >
      <div className="interactivePreviewSurface" ref={mountRef} />
    </div>
  );
}
