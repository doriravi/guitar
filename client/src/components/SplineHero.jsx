import { Suspense, lazy } from 'react';
import { should3D } from '../lib/gpu';

// Decorative Spline 3D scene for the Composer header. Spline is a no-code 3D
// designer: the scene itself is authored at spline.design and loaded here as a
// `.splinecode` file. It reacts to the CURSOR (Spline's only runtime input) —
// it does NOT react to audio/notes (Spline can't; that's what the Three.js/TSL
// surfaces are for).
//
// The <Spline> component + its runtime are heavy, so we lazy-load them (kept out
// of the main bundle, like every other 3D surface) and gate on should3D() so
// reduced-motion / no-GPU / opted-out users just get the fallback.
//
// SCENE SOURCE: `scene` may be a remote URL (prod.spline.design/…/scene.splinecode)
// or a LOCAL path under public/ (e.g. '/spline/composer.splinecode') for an
// offline-friendly, self-hosted PWA. To self-host: export your scene from Spline,
// drop the .splinecode into client/public/spline/, and pass that path.
const Spline = lazy(() => import('@splinetool/react-spline'));

export default function SplineHero({ scene, className, style, fallback = null }) {
  if (!should3D() || !scene) return fallback;
  return (
    <Suspense fallback={fallback}>
      <Spline scene={scene} className={className} style={style} />
    </Suspense>
  );
}
