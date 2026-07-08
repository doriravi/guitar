import { useMemo, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, uv, vec3, vec4, time, mx_noise_float, float } from 'three/tsl';
import { makeWebGPURenderer } from '../../lib/makeWebGPURenderer';
import { hasRealWebGPU } from '../../lib/gpu';

// Subtle, app-wide 3D backdrop. A single full-screen quad with a fragment-only
// TSL shader — the cheapest possible GPU surface (no lights, no shadows, no
// geometry detail). Two octaves of slowly-drifting MaterialX noise tint the
// screen with the brand gold and a violet accent over the base surface color.
//
// It's mounted once behind everything (see App.jsx) and the app's cards are
// opaque, so the effect only reads in the gutters between content — kept at very
// low intensity so text is never affected. Runs on WebGPU, falls back to WebGL
// automatically via WebGPURenderer.

// Read a CSS custom property as an [r,g,b] 0..1 triple, with a fallback hex.
function cssColor(name, fallback) {
  let hex = fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) hex = v;
  } catch { /* SSR / test */ }
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

function AmbientPlane() {
  const material = useMemo(() => {
    const base = vec3(...cssColor('--color-surface-base', '#0f0f0f'));
    const brand = vec3(...cssColor('--color-brand', '#c9a96e'));
    const accent = vec3(...cssColor('--color-accent', '#a78bfa'));

    // Fragment color: drift two noise fields at different scales/speeds and use
    // them to blend the accent then the brand over the base, at low strength.
    const colorNode = Fn(() => {
      const p = uv().mul(2.2);
      const t = time.mul(0.03); // very slow

      // Large soft field → violet accent wash
      const n1 = mx_noise_float(vec3(p.x.add(t), p.y.sub(t), t)).mul(0.5).add(0.5);
      // Finer field → warm brass streaks
      const n2 = mx_noise_float(vec3(p.x.mul(2.0).sub(t), p.y.mul(2.0).add(t), t.mul(1.3)))
        .mul(0.5).add(0.5);

      // Very low intensities — verified against real renders, the effect must be
      // a whisper in the gutters, never a wash. Both fields biased dark (pow) so
      // only the brightest noise peaks tint at all.
      let col = base;
      col = col.mix(accent, n1.pow(float(2.0)).mul(float(0.035)));  // ≤3.5% accent
      col = col.mix(brand, n2.pow(float(3.0)).mul(float(0.035)));   // ≤3.5% brass, strongly dark-biased
      return vec4(col, float(1.0));
    })();

    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = colorNode;
    return mat;
  }, []);

  // A big quad that fills the orthographic view.
  return (
    <mesh material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

export default function AmbientBackground() {
  // Only render on a REAL WebGPU adapter. On the software-WebGL fallback the
  // MaterialX-noise shader degrades to a flat wash that floods the page, so we'd
  // rather show nothing (the plain surface background) than a broken backdrop.
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    hasRealWebGPU().then(v => { if (live) setOk(v); });
    return () => { live = false; };
  }, []);

  if (!ok) return null;

  return (
    <Canvas
      // Orthographic camera framing the [-1,1] quad exactly — no perspective
      // needed for a full-screen fragment effect.
      orthographic
      camera={{ position: [0, 0, 1], zoom: 1, left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 10 }}
      dpr={[1, 1.5]}
      frameloop="always"
      gl={makeWebGPURenderer({ alpha: true })}
      style={{ width: '100%', height: '100%' }}
    >
      <AmbientPlane />
    </Canvas>
  );
}
