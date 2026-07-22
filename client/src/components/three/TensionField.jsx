import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, uv, vec2, vec3, vec4, time, mx_noise_float, float, uniform, mix, smoothstep } from 'three/tsl';
import { makeWebGPURenderer } from '../../lib/makeWebGPURenderer';
import { hasRealWebGPU } from '../../lib/gpu';

// A TSL "tension field" behind the Chord-change strip. The transition score (the
// intellectual core of the tab — chord CHANGES, not static shapes, are the real
// difficulty) drives a flow-field: an easy change (low score) is a calm, barely
// moving green wash; a hard change (high score) turns turbulent and runs the ramp
// through gold to a fraught red. It turns an abstract 1–10 into a FELT texture.
// The numeric badges stay ground-truth on top; this is a whisper underneath.
//
// Same cheapest-possible fragment-only quad as AmbientBackground. Showcase-only:
// gated on hasRealWebGPU() (MaterialX noise floods to a flat wash on software
// WebGL) and lazy-loaded via Lazy3D (which also gates should3D() → reduced-motion
// / user-opt-out / no-GPU never mount it). Score fed in as a uniform, eased each
// frame — no React re-render per frame.

function cssColor(name, fallback) {
  let hex = fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) hex = v;
  } catch { /* SSR / test */ }
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

function FieldPlane({ score }) {
  // Difficulty 0..1 (score/10), eased toward its target each frame via a uniform.
  const diff = useRef(uniform(0));
  const targetRef = useRef(0);
  targetRef.current = Math.max(0, Math.min(1, (score || 0) / 10));

  const material = useMemo(() => {
    const base = vec3(...cssColor('--color-surface-900', '#111111'));
    // green → gold → red, matching transitionColor()'s tiers.
    const calm = vec3(...cssColor('--color-success', '#4ade80'));
    const mid = vec3(...cssColor('--color-caution', '#eab308'));
    const hot = vec3(...cssColor('--color-danger', '#f87171'));

    const colorNode = Fn(() => {
      const d = diff.current;                 // 0..1 difficulty
      const p = uv().mul(vec2(3.2, 1.5));     // wide, short band
      // Turbulence: calm advection when easy, faster + wider when hard.
      const speed = float(0.02).add(d.mul(0.12));
      const t = time.mul(speed);
      const amp = float(1.0).add(d.mul(1.4)); // harder → the field churns more

      const n1 = mx_noise_float(vec3(p.x.add(t).mul(amp), p.y.sub(t), t)).mul(0.5).add(0.5);
      const n2 = mx_noise_float(vec3(p.x.mul(1.9).sub(t), p.y.mul(1.9).add(t).mul(amp), t.mul(1.3)))
        .mul(0.5).add(0.5);

      // Ramp the tint color by difficulty: green (≤0.3) → gold (~0.6) → red (>0.8),
      // mirroring transitionColor's 3/6/8-of-10 thresholds.
      const lowMid = mix(calm, mid, smoothstep(float(0.3), float(0.6), d));
      const tint = mix(lowMid, hot, smoothstep(float(0.6), float(0.85), d));

      // Intensity also grows with difficulty, but always a whisper so badges stay
      // legible (≤ ~9% at the hottest, biased dark so only noise peaks show).
      const strength = float(0.02).add(d.mul(0.07));
      let col = base;
      col = col.mix(tint, n1.pow(float(2.0)).mul(strength));
      col = col.mix(tint, n2.pow(float(3.0)).mul(strength).mul(0.7));
      return vec4(col, float(1.0));
    })();

    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = colorNode;
    return mat;
  }, []);

  // Ease the difficulty uniform toward its target each frame (no React re-render).
  useEffect(() => {
    let raf;
    const step = () => {
      const u = diff.current;
      u.value += (targetRef.current - u.value) * 0.05;
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

export default function TensionField({ score = 0 }) {
  // Only on a REAL WebGPU adapter — the noise degrades to a flat flood on the
  // software-WebGL fallback, so we'd rather show nothing (the plain strip bg).
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
      <FieldPlane score={score} />
    </Canvas>
  );
}
