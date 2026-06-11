import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePageVisible, useWebGL } from "./useWebGL";

const POINT_COUNT = 900;
const SPREAD_X = 30;
const SPREAD_Y = 18;
const SPREAD_Z = 14;

function buildFieldGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(POINT_COUNT * 3);
  const colors = new Float32Array(POINT_COUNT * 3);
  for (let i = 0; i < POINT_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * SPREAD_X;
    positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
    positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD_Z;
    const roll = Math.random();
    // 70% faint warm white, 20% lime, 10% amber
    let color: [number, number, number] = [0.55, 0.55, 0.5];
    if (roll < 0.1) color = [0.95, 0.65, 0.25];
    else if (roll < 0.3) color = [0.72, 0.95, 0.3];
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function Constellation({ animate }: { animate: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const visibleRef = usePageVisible();

  const geometry = useMemo(buildFieldGeometry, []);
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.045,
        transparent: true,
        opacity: 0.5,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    [],
  );

  // The canvas mounts behind the UI with pointer-events disabled, so track
  // the pointer at the window level for the parallax drift.
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  useFrame((state, delta) => {
    if (!animate || !visibleRef.current) return;
    const group = groupRef.current;
    const points = pointsRef.current;
    if (!group || !points) return;
    points.rotation.y += delta * 0.012;
    group.position.z = Math.sin(state.clock.elapsedTime * 0.1) * 0.5;
    const ease = Math.min(delta * 2.5, 1);
    group.rotation.x += (pointerRef.current.y * 0.03 - group.rotation.x) * ease;
    group.rotation.y += (pointerRef.current.x * 0.03 - group.rotation.y) * ease;
  });

  return (
    <group ref={groupRef}>
      <points ref={pointsRef} geometry={geometry} material={material} />
    </group>
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

/**
 * Ambient background constellation. Mount as a fixed, pointer-events-none,
 * z-0 layer behind the dashboard via React.lazy.
 */
export default function SignalField() {
  const { supported, reducedMotion } = useWebGL();
  if (!supported) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        frameloop={reducedMotion ? "never" : "always"}
        gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0, 14], fov: 50 }}
        style={{ position: "absolute", inset: 0 }}
      >
        <Constellation animate={!reducedMotion} />
        <StaticFrame active={reducedMotion} />
      </Canvas>
    </div>
  );
}
