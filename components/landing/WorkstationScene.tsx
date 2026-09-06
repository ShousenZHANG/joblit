"use client";

import { createRoot, extend, unmountComponentAtNode, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { useReducedMotion, type MotionValue } from "framer-motion";
import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import * as THREE from "three";
import {
  CanvasTexture,
  CubicBezierCurve3,
  Group,
  MathUtils,
  Mesh,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";

type WorkstationSceneProps = {
  progress: MotionValue<number>;
  paused: boolean;
  dark?: boolean;
  onReady?: () => void;
  onUnavailable?: () => void;
};

const palette = {
  ink: "#172338",
  paper: "#eaf0f7",
  silver: "#c3cfdf",
  green: "#10b981",
};

const surfaces = {
  light: {
    panel: "#f3f6fc", ink: "#172338", muted: "#65748d", border: "#bac8da",
    chip: "#e6edf7", divider: "#cbd5e1", accent: "#047857", badge: "#d1fae5",
    connector: "#059669",
  },
  dark: {
    panel: "#101b30", ink: "#edf3ff", muted: "#a0b1cb", border: "#3b4d69",
    chip: "#21314b", divider: "#30435f", accent: "#34d399", badge: "#123c36",
    connector: "#34d399",
  },
};

/** All artwork is local, illustrative UI; no model, font, or HDR downloads. */
function makeArtwork(kind: "resume" | "letter" | "engineer" | "analyst", dark = false) {
  const surface = dark ? surfaces.dark : surfaces.light;
  const documentCard = kind === "resume" || kind === "letter";
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = documentCard ? 1056 : 448;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The workstation artwork requires a 2D canvas.");
  const width = canvas.width;
  const height = canvas.height;

  const rect = (x: number, y: number, w: number, h: number, radius: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
  };
  const text = (content: string, x: number, y: number, size: number, color: string, weight = 500) => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
    ctx.fillText(content, x, y);
  };
  const line = (x: number, y: number, w: number, color: string, h = 5) => rect(x, y, w, h, h / 2, color);

  rect(0, 0, width, height, 24, documentCard ? palette.paper : surface.panel);

  if (documentCard) {
    rect(48, 48, 58, 58, 17, palette.ink);
    text("J", 67, 89, 38, palette.green, 700);
    text("JOBLIT / APPLICATION STUDIO", 124, 83, 19, "#536a89", 700);
    text(kind === "resume" ? "ALEX" : "ALEX MORGAN", 50, 190, kind === "resume" ? 56 : 44, palette.ink, 700);
    text(kind === "resume" ? "MORGAN" : "COVER LETTER", 50, 250, kind === "resume" ? 56 : 42, palette.ink, 700);
    text(kind === "resume" ? "SOFTWARE ENGINEER" : "SOFTWARE ENGINEERING ROLE", 52, 305, 23, "#344867", 700);
    text("Software engineer  /  Sydney, AU", 52, 345, 18, "#657895");
    line(52, 375, 664, "#c3cfdf", 2);

    if (kind === "resume") {
      text("PROFILE", 52, 420, 20, "#536a89", 700);
      [650, 605, 445].forEach((w, i) => line(52, 443 + i * 21, w, "#bac8da"));
      text("SELECTED EXPERIENCE", 52, 550, 20, "#536a89", 700);
      rect(52, 572, 5, 131, 2, palette.green);
      text("Software engineering", 75, 596, 23, palette.ink, 700);
      [592, 541, 604, 380].forEach((w, i) => line(75, 622 + i * 21, w, "#bac8da"));
      text("TOOLS & TECHNOLOGIES", 52, 763, 20, "#536a89", 700);
      ["TypeScript", "React", "Node.js"].forEach((label, i) => {
        rect(52 + i * 213, 784, 191, 49, 12, "#e4ebf5");
        text(label, 68 + i * 213, 815, 22, "#344867", 600);
      });
      text("EDUCATION", 52, 890, 20, "#536a89", 700);
      line(52, 918, 520, "#bac8da");
      line(52, 941, 339, "#c9d4e3");
    } else {
      text("Dear hiring team,", 52, 430, 24, palette.ink, 600);
      [630, 648, 558, 603, 321].forEach((w, i) => line(52, 463 + i * 23, w, "#bac8da"));
      [648, 616, 659, 560, 397].forEach((w, i) => line(52, 616 + i * 23, w, "#bac8da"));
      [641, 573, 433].forEach((w, i) => line(52, 771 + i * 23, w, "#bac8da"));
      text("Alex Morgan", 52, 914, 26, "#344867", 600);
    }
    text("ILLUSTRATIVE DOCUMENT", 52, 1008, 14, "#657895");
    text("01", 690, 1008, 16, "#657895", 700);
  } else {
    const titles = { engineer: "Software Engineer", analyst: "Data Analyst" };
    const places = { engineer: "Sydney, NSW", analyst: "Melbourne, VIC" };
    rect(36, 34, 69, 69, 18, surface.chip);
    text(kind === "engineer" ? "</>" : "Aa", 46, 78, 26, surface.accent, 700);
    text("SAMPLE ROLE", 127, 58, 19, surface.muted, 600);
    text("AUSTRALIA", 127, 89, 19, surface.ink, 600);
    rect(632, 44, 95, 34, 17, surface.badge);
    text("NEW", 656, 67, 19, surface.accent, 700);
    text(titles[kind], 37, 164, 44, surface.ink, 600);
    text(`${places[kind]}  /  Full time`, 39, 207, 24, surface.muted);
    line(38, 236, 690, surface.divider, 2);
    text("ROLE REQUIREMENTS", 39, 277, 19, surface.muted, 700);
    const chips = kind === "engineer" ? ["TypeScript", "React", "APIs"] : ["SQL", "Python", "Insights"];
    chips.forEach((label, i) => {
      rect(38 + i * 215, 301, 195, 45, 12, surface.chip);
      text(label, 52 + i * 215, 330, 23, surface.ink, 500);
    });
    text("View original requirements", 39, 398, 22, surface.muted);
    text("→", 690, 403, 34, surface.accent);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function ArtworkPanel({
  artwork,
  width,
  height,
  paper = false,
  dark = false,
}: {
  artwork: CanvasTexture;
  width: number;
  height: number;
  paper?: boolean;
  dark?: boolean;
}) {
  return (
    <group>
      <RoundedBox args={[width + 0.04, height + 0.04, paper ? 0.055 : 0.09]} radius={0.075} smoothness={3}>
        <meshStandardMaterial
          color={paper ? palette.silver : dark ? surfaces.dark.border : surfaces.light.border}
          metalness={paper ? 0.2 : 0.4}
          roughness={0.43}
        />
      </RoundedBox>
      <mesh position={[0, 0, paper ? 0.03 : 0.048]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={artwork} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

function Studio({
  progress,
  active,
  dark,
  pointer,
  onReady,
  onUnavailable,
}: {
  progress: MotionValue<number>;
  active: boolean;
  dark: boolean;
  pointer: RefObject<Vector2>;
  onReady?: () => void;
  onUnavailable?: () => void;
}) {
  const root = useRef<Group>(null);
  const resume = useRef<Group>(null);
  const cover = useRef<Group>(null);
  const role = useRef<Group>(null);
  const secondary = useRef<Group>(null);
  const flowDot = useRef<Mesh>(null);
  const presented = useRef(false);
  const elapsed = useRef(0);
  const smoothed = useRef(progress.get());
  const { invalidate, viewport } = useThree();
  const callbacks = useRef({ onReady, onUnavailable });
  useEffect(() => { callbacks.current = { onReady, onUnavailable }; }, [onReady, onUnavailable]);

  const documents = useMemo(() => ({
    resume: makeArtwork("resume"),
    letter: makeArtwork("letter"),
  }), []);
  const roles = useMemo(() => ({
    engineer: makeArtwork("engineer", dark),
    analyst: makeArtwork("analyst", dark),
  }), [dark]);
  useEffect(() => () => Object.values(documents).forEach((texture) => texture.dispose()), [documents]);
  useEffect(() => () => Object.values(roles).forEach((texture) => texture.dispose()), [roles]);
  const artwork = { ...documents, ...roles };
  const surface = dark ? surfaces.dark : surfaces.light;
  const connection = useMemo(() => {
    const positions = new Float32Array(37 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    return { line, positions, point: new Vector3(), curve: new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3()) };
  }, []);
  const connectionRef = useRef(connection);
  useEffect(() => () => {
    connection.line.geometry.dispose();
    connection.line.material.dispose();
  }, [connection]);
  useEffect(() => { connection.line.material.color.set(surface.connector); }, [connection, surface.connector]);

  useEffect(() => {
    invalidate();
    return progress.on("change", () => invalidate());
  }, [progress, active, invalidate]);

  useFrame((_state, delta) => {
    if (!root.current || !resume.current || !role.current || !cover.current || !secondary.current) return;
    const dt = Math.min(delta, 0.05);
    if (active) elapsed.current += dt;
    const time = elapsed.current;
    const target = MathUtils.clamp(progress.get(), 0, 1);
    smoothed.current = active ? MathUtils.damp(smoothed.current, target, 7, dt) : target;
    const p = smoothed.current;
    const gathered = MathUtils.smoothstep(p, 0.04, 0.45);
    const completed = MathUtils.smoothstep(p, 0.53, 0.96);
    const sway = Math.sin(time * 0.52) * 0.024;

    root.current.scale.setScalar(0.93 * Math.min(1, viewport.width / 6.7));
    root.current.position.x = 0.32 - completed * 0.82;
    root.current.rotation.x = MathUtils.damp(root.current.rotation.x, active ? -pointer.current.y * 0.035 : 0, 5, dt);
    root.current.rotation.y = MathUtils.damp(root.current.rotation.y, active ? pointer.current.x * 0.055 : 0, 5, dt);

    resume.current.position.set(1.16 - gathered * 0.08 - completed * 1.7, 0.12 + sway + completed * 0.06, 0.1 + gathered * 0.28);
    resume.current.rotation.set(-0.025, -0.14 + completed * 0.18, -0.035 + completed * 0.07);
    resume.current.scale.setScalar(1 - completed * 0.06);

    role.current.position.set(-1.84 + gathered * 0.08 + completed * 1.14, 0.72 + Math.sin(time * 0.44 + 1) * 0.026, 0.58 - completed * 1.55);
    role.current.rotation.set(0.025, 0.1, -0.05 + gathered * 0.04);
    role.current.scale.setScalar(1 - completed * 0.38);
    role.current.visible = completed < 0.995;

    secondary.current.position.set(-1.48 - gathered * 0.2, -1.02 + gathered * 1.73 + sway * 0.5, -0.3 - gathered * 0.8);
    secondary.current.rotation.set(0.035, 0.14, 0.035);
    secondary.current.scale.setScalar(0.74 - gathered * 0.1);
    secondary.current.visible = gathered < 0.995;

    cover.current.visible = completed > 0.005;
    cover.current.position.set(0.98 + completed * 0.86, -0.14 - sway, -0.6 + completed * 1.1);
    cover.current.rotation.set(-0.02, -0.12, -0.045);
    cover.current.scale.setScalar(0.9 + completed * 0.05);

    // Both endpoints follow real panel edges in their common parent's space.
    // Reuse the curve and vertex buffer instead of allocating geometry per frame.
    role.current.updateMatrix();
    resume.current.updateMatrix();
    const { curve, positions, point, line } = connectionRef.current;
    curve.v0.set(0.9, -0.94, 0.055).applyMatrix4(role.current.matrix);
    curve.v3.set(-1.29, -0.56, 0.04).applyMatrix4(resume.current.matrix);
    curve.v1.copy(curve.v0).lerp(curve.v3, 0.35); curve.v1.y -= 0.24; curve.v1.z += 0.08;
    curve.v2.copy(curve.v0).lerp(curve.v3, 0.7); curve.v2.y -= 0.2; curve.v2.z += 0.08;
    for (let i = 0; i <= 36; i++) {
      curve.getPoint(i / 36, point);
      point.toArray(positions, i * 3);
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.visible = completed < 0.82;
    line.material.opacity = (0.28 + gathered * 0.2) * (1 - completed);

    if (flowDot.current) {
      flowDot.current.visible = line.visible;
      curve.getPoint((time * 0.17) % 1, flowDot.current.position);
    }

    // Demand rendering stops here when paused, offscreen, or motion is reduced.
    if (active) invalidate();
    if (!presented.current) {
      presented.current = true;
      queueMicrotask(() => callbacks.current.onReady?.());
    }
  });

  return (
    <>
      <ambientLight intensity={dark ? 0.55 : 0.7} />
      <directionalLight position={[1, 5, 6]} intensity={1.3} color="#eef4ff" />
      <pointLight position={[-3, 0.3, 3]} intensity={dark ? 3 : 1.5} color={palette.green} distance={10} decay={2} />
      <Environment frames={1} resolution={128}>
        <Lightformer color="#f3f7ff" intensity={1.6} position={[0, 5, 2]} scale={[10, 5, 1]} rotation={[-Math.PI / 2, 0, 0]} />
        <Lightformer color="#a6c3ee" intensity={0.75} position={[-4, 1, 3]} scale={[3, 7, 1]} rotation={[0, Math.PI / 3, 0]} />
        <Lightformer color="#dbe7fa" intensity={1.25} position={[4, 2, 1]} scale={[3, 8, 1]} rotation={[0, -Math.PI / 3, 0]} />
      </Environment>

      <group ref={root}>
        <primitive object={connection.line} />
        <mesh ref={flowDot}>
          <sphereGeometry args={[0.025, 10, 10]} />
          <meshBasicMaterial color={dark ? "#a7f3d0" : "#059669"} toneMapped={false} />
        </mesh>

        <group ref={secondary}>
          <ArtworkPanel artwork={artwork.analyst} width={2.9} height={1.69} dark={dark} />
        </group>
        <group ref={role}>
          <ArtworkPanel artwork={artwork.engineer} width={3.24} height={1.89} dark={dark} />
        </group>
        <group ref={resume}>
          <group position={[0.065, -0.045, -0.048]}>
            <RoundedBox args={[2.58, 3.55, 0.04]} radius={0.06} smoothness={3}>
              <meshStandardMaterial color="#8b9bb4" metalness={0.2} roughness={0.5} />
            </RoundedBox>
          </group>
          <ArtworkPanel artwork={artwork.resume} width={2.58} height={3.55} paper />
        </group>
        <group ref={cover}>
          <ArtworkPanel artwork={artwork.letter} width={2.44} height={3.355} paper />
        </group>
      </group>
    </>
  );
}

class SceneBoundary extends Component<{
  children: ReactNode;
  onUnavailable?: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onUnavailable?.(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Own initialization so renderer/configuration failures have a caught path.
 * Canvas's HTML fallback is always mounted, including on supported browsers. */
function SceneCanvas({ children, onUnavailable }: { children: ReactNode; onUnavailable?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRoot = useRef<ReturnType<typeof createRoot> | null>(null);
  const current = useRef({ children, onUnavailable });

  useEffect(() => {
    current.current = { children, onUnavailable };
    sceneRoot.current?.render(children);
  }, [children, onUnavailable]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    // Each mount owns its canvas, including React's development remount check.
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
    canvas.textContent = "An illustrative 3D job-search workstation.";
    container.appendChild(canvas);
    let stopped = false;
    let failed = false;
    let teardownStarted = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let root: ReturnType<typeof createRoot> | undefined;
    const release = () => {
      if (teardownStarted) return;
      teardownStarted = true;
      if (root) {
        // Environment's FBO cleanup needs the renderer's resource table. R3F
        // unmount is asynchronous and releases the context itself. Dispose the
        // renderer only after it finishes, without losing the context twice.
        unmountComponentAtNode(canvas, () => {
          renderer?.dispose();
        });
      } else {
        renderer?.dispose();
        renderer?.forceContextLoss();
      }
    };
    const unavailable = () => {
      if (stopped || failed) return;
      failed = true;
      sceneRoot.current = null;
      release();
      current.current.onUnavailable?.();
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      unavailable();
    };
    canvas.addEventListener("webglcontextlost", contextLost);

    let resizeObserver: ResizeObserver | undefined;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
      extend({
        Group: THREE.Group,
        Mesh: THREE.Mesh,
        AmbientLight: THREE.AmbientLight,
        DirectionalLight: THREE.DirectionalLight,
        PointLight: THREE.PointLight,
        CubeCamera: THREE.CubeCamera,
        ExtrudeGeometry: THREE.ExtrudeGeometry,
        PlaneGeometry: THREE.PlaneGeometry,
        SphereGeometry: THREE.SphereGeometry,
        MeshBasicMaterial: THREE.MeshBasicMaterial,
        MeshStandardMaterial: THREE.MeshStandardMaterial,
      });
      root = createRoot(canvas);
      const mountedRoot = root;
      const gl = renderer;
      let configuration = Promise.resolve();
      const resize = () => {
        const { width, height, top, left } = container.getBoundingClientRect();
        if (width <= 0 || height <= 0 || stopped || failed) return;
        // Serialize resize configurations; never leave a rejected initializer.
        configuration = configuration.then(async () => {
          if (stopped || failed) return;
          await mountedRoot.configure({
            gl,
            size: { width, height, top, left },
            camera: { position: [0, 0.8, 9.6], rotation: [-0.083, 0, 0], fov: 34, near: 0.1, far: 40 },
            dpr: [1, 1.5],
            frameloop: "demand",
          });
          if (stopped || failed) return;
          sceneRoot.current = mountedRoot;
          mountedRoot.render(current.current.children);
        }).catch(unavailable);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();
    } catch {
      unavailable();
    }

    return () => {
      stopped = true;
      sceneRoot.current = null;
      resizeObserver?.disconnect();
      canvas.removeEventListener("webglcontextlost", contextLost);
      release();
      canvas.remove();
    };
  }, []);

  return <div ref={host} style={{ width: "100%", height: "100%" }} />;
}

/** Decorative canvas. Its surrounding HTML supplies the story and controls. */
export default function WorkstationScene({ progress, paused, dark = false, onReady, onUnavailable }: WorkstationSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const pointer = useRef(new Vector2());
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [foreground, setForeground] = useState(true);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "80px" });
    observer.observe(element);
    const visibilityChanged = () => setForeground(!document.hidden);
    visibilityChanged();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);

  const active = !paused && !reducedMotion && visible && foreground;

  return (
    <div
      ref={host}
      aria-hidden="true"
      style={{ width: "100%", height: "100%", touchAction: "pan-y" }}
      onPointerMove={(event) => {
        if (!active || event.pointerType === "touch") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        pointer.current.set(
          ((event.clientX - bounds.left) / bounds.width - 0.5) * 2,
          ((event.clientY - bounds.top) / bounds.height - 0.5) * 2,
        );
      }}
      onPointerLeave={() => pointer.current.set(0, 0)}
    >
      <SceneBoundary onUnavailable={onUnavailable}>
        <SceneCanvas onUnavailable={onUnavailable}>
          <SceneBoundary onUnavailable={onUnavailable}>
            <Suspense fallback={null}>
              <Studio progress={progress} active={active} dark={dark} pointer={pointer} onReady={onReady} onUnavailable={onUnavailable} />
            </Suspense>
          </SceneBoundary>
        </SceneCanvas>
      </SceneBoundary>
    </div>
  );
}
