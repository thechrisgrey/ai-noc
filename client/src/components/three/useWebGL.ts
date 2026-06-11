import { useEffect, useRef, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let webglSupport: boolean | null = null;

function detectWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement("canvas");
    webglSupport = Boolean(
      canvas.getContext("webgl2") || canvas.getContext("webgl"),
    );
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/**
 * Reports WebGL capability (memoized module-wide) and the user's
 * prefers-reduced-motion setting, kept live via a media query listener.
 */
export function useWebGL(): { supported: boolean; reducedMotion: boolean } {
  const [supported] = useState(detectWebGL);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (event: MediaQueryListEvent) =>
      setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return { supported, reducedMotion };
}

/**
 * Ref that tracks document visibility without re-rendering. Consumed inside
 * useFrame loops so animation work pauses while the tab is hidden.
 */
export function usePageVisible(): React.MutableRefObject<boolean> {
  const visibleRef = useRef(true);

  useEffect(() => {
    const onVisibilityChange = () => {
      visibleRef.current = !document.hidden;
    };
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return visibleRef;
}
