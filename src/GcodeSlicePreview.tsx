import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GCODE_SEGMENT_COLORS, type GcodeSegmentType, type GcodeToolpath } from "./lib/gcodeParse";
import { type Locale, t } from "./lib/i18n";

type PreviewState = "empty" | "ready" | "error";

interface GcodeSlicePreviewProps {
  label: string;
  locale: Locale;
  toolpath: GcodeToolpath | null;
}

const LEGEND_TYPES: GcodeSegmentType[] = ["wall", "skin", "fill", "support", "skirt"];

export function GcodeSlicePreview({ label, locale, toolpath }: GcodeSlicePreviewProps) {
  const tr = (key: Parameters<typeof t>[1]) => t(locale, key);
  const mountRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const wakeRef = useRef<() => void>(() => undefined);
  const [previewState, setPreviewState] = useState<PreviewState>("empty");
  const [layer, setLayer] = useState(0);

  useEffect(() => {
    setLayer(toolpath?.layerCount ?? 0);
  }, [toolpath]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    while (mount.firstChild) {
      mount.removeChild(mount.firstChild);
    }
    geometryRef.current = null;

    if (!toolpath || toolpath.segmentCount === 0) {
      setPreviewState("empty");
      return;
    }

    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.LineBasicMaterial | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let animationFrame = 0;

    try {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(toolpath.positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(toolpath.colors, 3));
      geometry.computeBoundingBox();
      const box = geometry.boundingBox ?? new THREE.Box3();
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);
      geometryRef.current = geometry;

      const maxDimension = Math.max(size.x, size.y, size.z, 1);
      const scene = new THREE.Scene();

      material = new THREE.LineBasicMaterial({ vertexColors: true });
      scene.add(new THREE.LineSegments(geometry, material));

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

      const DAMPING_DECAY_MS = 800;
      let lastActivity = 0;
      const renderLoop = () => {
        if (!renderer || !controls) {
          animationFrame = 0;
          return;
        }
        controls.update();
        renderer.render(scene, camera);
        if (performance.now() - lastActivity < DAMPING_DECAY_MS) {
          animationFrame = window.requestAnimationFrame(renderLoop);
        } else {
          animationFrame = 0;
        }
      };
      const wake = () => {
        lastActivity = performance.now();
        if (!animationFrame) {
          animationFrame = window.requestAnimationFrame(renderLoop);
        }
      };
      wakeRef.current = wake;
      controls.addEventListener("start", wake);
      controls.addEventListener("change", wake);

      resizeObserver = new ResizeObserver(() => {
        resize();
        wake();
      });
      resizeObserver.observe(mount);
      resize();
      wake();
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
      geometryRef.current = null;
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
      geometryRef.current = null;
    };
  }, [toolpath]);

  useEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry || !toolpath) {
      return;
    }
    const upToLayer = Math.max(0, Math.min(layer, toolpath.layerCount));
    const vertexCount =
      upToLayer === 0 ? 0 : 2 * toolpath.layerEndSegment[upToLayer - 1];
    geometry.setDrawRange(0, vertexCount);
    wakeRef.current();
  }, [layer, toolpath]);

  if (!toolpath || toolpath.segmentCount === 0) {
    return (
      <div aria-label={label} className="gcodeSlicePreview" data-state="empty">
        <p className="printabilityEmpty">{tr("sliceNoGcode")}</p>
      </div>
    );
  }

  return (
    <div aria-label={label} className="gcodeSlicePreview" data-state={previewState}>
      <div className="interactivePreviewSurface" ref={mountRef} />
      <div className="gcodeLayerControl">
        <input
          max={toolpath.layerCount}
          min={0}
          onChange={(event) => setLayer(Number(event.target.value))}
          type="range"
          value={layer}
        />
        <span>
          {tr("sliceLayerSlider")}: {layer}/{toolpath.layerCount}
        </span>
      </div>
      <ul className="gcodeLegend">
        {LEGEND_TYPES.map((type) => (
          <li key={type}>
            <span
              className="gcodeLegendSwatch"
              style={{ background: colorToCss(GCODE_SEGMENT_COLORS[type]) }}
            />
            {tr(LEGEND_LABEL_KEYS[type])}
          </li>
        ))}
      </ul>
    </div>
  );
}

const LEGEND_LABEL_KEYS: Record<GcodeSegmentType, Parameters<typeof t>[1]> = {
  wall: "sliceLegendWall",
  skin: "sliceLegendSkin",
  fill: "sliceLegendFill",
  support: "sliceLegendSupport",
  skirt: "sliceLegendSkirt",
  other: "sliceLegendFill"
};

function colorToCss([r, g, b]: [number, number, number]): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
