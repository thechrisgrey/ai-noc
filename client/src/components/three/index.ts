/**
 * Barrel for the decorative Three.js layer.
 *
 * IMPORTANT: never import this from eagerly-loaded modules. Both components
 * are default exports in their own files so they stay lazy-splittable:
 *
 *   const SignalField = React.lazy(() => import("@/components/three/SignalField"));
 *   const SignalGlobe = React.lazy(() => import("@/components/three/SignalGlobe"));
 */
export { default as SignalField } from "./SignalField";
export { default as SignalGlobe } from "./SignalGlobe";
export { useWebGL, usePageVisible } from "./useWebGL";
