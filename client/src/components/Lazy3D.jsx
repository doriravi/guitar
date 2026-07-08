import { Suspense, lazy, useMemo } from 'react';
import { should3D } from '../lib/gpu';

// Reusable gate + code-split wrapper for every heavy Three.js surface.
//
//   <Lazy3D load={() => import('./Neck3D')} fallback={<FretboardDiagram .../>}
//           componentProps={{ notes }} />
//
// Two jobs:
//  1. Capability gate — if should3D() is false (reduced-motion, user opted out,
//     no GPU), render `fallback` and NEVER call `load`, so the three-vendor
//     chunk is never fetched on devices that won't use it.
//  2. Code-split — `load` is a `() => import('./X')` whose specifier MUST be a
//     static string literal at each call site, so Vite/Rollup can split it into
//     the shared three-vendor chunk. React.lazy + Suspense mount it on demand,
//     showing `fallback` while the chunk downloads.
//
// `load` must resolve to a module whose default export is the 3D component.
// `componentProps` are spread onto that component. `fallback` doubles as the
// Suspense fallback and the gated-off replacement (usually the 2D/SVG version).
export default function Lazy3D({ load, fallback = null, componentProps = {} }) {
  const allow = should3D();

  // Build the lazy component once per `load` identity. Callers should pass a
  // stable `load` (module-scope or useCallback) so this isn't recreated each
  // render — recreating a lazy() would refetch/remount the chunk.
  const Comp = useMemo(() => (allow ? lazy(load) : null), [allow, load]);

  if (!allow || !Comp) return fallback;

  return <Suspense fallback={fallback}><Comp {...componentProps} /></Suspense>;
}
