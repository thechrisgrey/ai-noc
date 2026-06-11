import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePageVisible, useWebGL } from "./useWebGL";

const SHELL_COUNT = 350;
const NODE_COUNT = 12;
const RADIUS = 2;
const LIME: [number, number, number] = [0.72, 0.95, 0.3];

function pointsMaterial(opts: THREE.PointsMaterialParameters): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    transparent: true, depthWrite: false, sizeAttenuation: true, ...opts,
  });
}

/** Even points-on-sphere shell via fibonacci-sphere distribution. */
function buildShellGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(SHELL_COUNT * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < SHELL_COUNT; i++) {
    const y = 1 - (i / (SHELL_COUNT - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    positions[i * 3] = Math.cos(theta) * ring * RADIUS;
    positions[i * 3 + 1] = y * RADIUS;
    positions[i * 3 + 2] = Math.sin(theta) * ring * RADIUS;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/** "Active source" nodes scattered uniformly over the sphere surface. */
function buildNodeField(): { geometry: THREE.BufferGeometry; phases: number[] } {
  const positions = new Float32Array(NODE_COUNT * 3);
  const colors = new Float32Array(NODE_COUNT * 3);
  const phases: number[] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * (RADIUS + 0.02);
    positions[i * 3 + 1] = Math.cos(phi) * (RADIUS + 0.02);
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * (RADIUS + 0.02);
    colors.set(LIME, i * 3);
    phases.push(Math.random() * Math.PI * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return { geometry, phases };
}

function Globe({ animate }: { animate: boolean }) {
  const globeRef = useRef<THREE.Group>(null);
  const visibleRef = usePageVisible();

  const shellGeometry = useMemo(buildShellGeometry, []);
  const shellMaterial = useMemo(
    () => pointsMaterial({ color: new THREE.Color(0.85, 0.85, 0.78), size: 0.05, opacity: 0.7 }),
    [],
  );
  const { geometry: nodeGeometry, phases } = useMemo(buildNodeField, []);
  const nodeMaterial = useMemo(
    () =>
      pointsMaterial({
        size: 0.14,
        opacity: 0.95,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const ringGeometry = useMemo(() => new THREE.TorusGeometry(2.6, 0.006, 8, 96), []);
  const ringMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(68 / 360, 0.96, 0.58), // acid lime
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    [],
  );

  useFrame((state, delta) => {
    if (!animate || !visibleRef.current) return;
    const globe = globeRef.current;
    if (!globe) return;
    globe.rotation.y += delta * 0.06;
    // Staggered pulse: under additive blending, color intensity reads as opacity.
    const nodeColors = nodeGeometry.getAttribute("color") as THREE.BufferAttribute;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < NODE_COUNT; i++) {
      const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.4 + phases[i]));
      nodeColors.setXYZ(i, LIME[0] * pulse, LIME[1] * pulse, LIME[2] * pulse);
    }
    nodeColors.needsUpdate = true;
  });

  return (
    <>
      <group ref={globeRef} rotation={[0.3, 0, -0.12]}>
        <points geometry={shellGeometry} material={shellMaterial} />
        <points geometry={nodeGeometry} material={nodeMaterial} />
      </group>
      <mesh
        geometry={ringGeometry}
        material={ringMaterial}
        rotation={[Math.PI / 2 - THREE.MathUtils.degToRad(20), 0, 0]}
      />
    </>
  );
}

/** With frameloop="never", paint exactly one static frame. */
function StaticFrame({ active }: { active: boolean }) {
  const advance = useThree((state) => state.advance);
  useEffect(() => {
    if (active) advance(performance.now());
  }, [active, advance]);
  return null;
}

/** Decorative source-globe for the intel rail; size the wrapper via className (~180-220px square). */
export default function SignalGlobe({ className }: { className?: string }) {
  const { supported, reducedMotion } = useWebGL();
  if (!supported) return null;
  return (
    <div
      aria-hidden="true"
      className={["pointer-events-none select-none", className ?? "h-full w-full"].join(" ")}
    >
      <Canvas
        dpr={[1, 1.5]}
        frameloop={reducedMotion ? "never" : "always"}
        gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0, 6.2], fov: 45 }}
        style={{ width: "100%", height: "100%" }}
      >
        <Globe animate={!reducedMotion} />
        <StaticFrame active={reducedMotion} />
      </Canvas>
    </div>
  );
}
