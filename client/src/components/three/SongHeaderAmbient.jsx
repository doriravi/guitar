import { useMemo, useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, uv, vec2, vec3, vec4, time, mx_noise_float, float, uniform } from 'three/tsl';
import { makeWebGPURenderer } from '../../lib/makeWebGPURenderer';
import { hasRealWebGPU } from '../../lib/gpu';

// A confined ambient TSL wash for the opened-song lyrics header — the tab's "now
// playing" moment. Same cheapest-possible fragment-only quad as AmbientBackground,
// but warmer (gold-leaning) and scoped to a ~64px band behind the song controls,
// giving the opened song a boutique glow. The lyrics themselves sit on their own
// opaque surface, so text never overlaps the noise.
//
// Intensity is STATE-keyed, not FFT-driven: the synth playback path's analyser
// isn't wired into this R3F context, so we gently swell the gold while the song is
// actually playing (the `playing` prop) — a token-true "it's alive" cue tied to
// state, animated smoothly on the GPU via a uniform.
//
// Showcase-only: gated on hasRealWebGPU() (the MaterialX noise floods to a flat
// wash on software WebGL), lazy-loaded via Lazy3D (which also gates should3D() —
// reduced-motion / user-opt-out / no-GPU → this never mounts).

function cssColor(name, fallback) {
  let hex = fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) hex = v;
  } catch { /* SSR / test */ }
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

function HeaderPlane({ playing }) {
  // A uniform we ramp toward 1 while playing / 0 while idle, smoothed each frame
  // so the swell eases rather than snaps.
  const swell = useRef(uniform(0));
  const targetRef = useRef(0);
  targetRef.current = playing ? 1 : 0;

  const material = useMemo(() => {
    const base = vec3(...cssColor('--color-surface-base', '#0f0f0f'));
    const brand = vec3(...cssColor('--color-brand', '#e9c46a'));
    const violet = vec3(...cssColor('--color-violet', '#c084fc'));

    const colorNode = Fn(() => {
      const p = uv().mul(vec2(3.0, 1.4)); // wide, short band → stretch horizontally
      const t = time.mul(0.04);

      // Warm brass field (the dominant tone) + a cooler violet accent field.
      const n1 = mx_noise_float(vec3(p.x.add(t), p.y.sub(t), t)).mul(0.5).add(0.5);
      const n2 = mx_noise_float(vec3(p.x.mul(1.8).sub(t), p.y.mul(1.8).add(t), t.mul(1.3)))
        .mul(0.5).add(0.5);

      // Base intensity is a whisper; `swell` (0..1 while playing) lifts the gold a
      // touch more. Kept well under a wash so the controls stay legible.
      const boost = float(1.0).add(swell.current.mul(float(0.8)));
      let col = base;
      col = col.mix(violet, n2.pow(float(2.5)).mul(float(0.03)));            // ≤3% violet
      col = col.mix(brand, n1.pow(float(2.0)).mul(float(0.045)).mul(boost)); // ≤4.5% brass, swells while playing
      return vec4(col, float(1.0));
    })();

    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = colorNode;
    return mat;
  }, []);

  // Ease the swell uniform toward its target each frame (no React re-render).
  useEffect(() => {
    let raf;
    const step = () => {
      const u = swell.current;
      u.value += (targetRef.current - u.value) * 0.06;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <mesh material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

export default function SongHeaderAmbient({ playing = false }) {
  // Only on a REAL WebGPU adapter — the noise degrades to a flat flood on the
  // software-WebGL fallback, so we'd rather show nothing (the plain header).
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    hasRealWebGPU().then(v => { if (live) setOk(v); });
    return () => { live = false; };
  }, []);

  if (!ok) return null;

  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 1], zoom: 1, left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 10 }}
      dpr={[1, 1.5]}
      frameloop="always"
      gl={makeWebGPURenderer({ alpha: true })}
      style={{ width: '100%', height: '100%' }}
    >
      <HeaderPlane playing={playing} />
    </Canvas>
  );
}
