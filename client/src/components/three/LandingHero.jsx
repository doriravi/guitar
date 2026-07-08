import { useMemo, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uv, vec2, vec3, vec4, float, time,
  mx_noise_float, sin, abs, smoothstep, mix, clamp, length,
} from 'three/tsl';
import { makeWebGPURenderer } from '../../lib/makeWebGPURenderer';
import { hasRealWebGPU } from '../../lib/gpu';

// Landing-page hero: a full-bleed flowing "aurora" of light in the brand palette,
// the backmost layer behind the explainer film. Pure fragment-shader (TSL) — no
// geometry, lights, or shadows — so it's cheap enough to run on the pre-auth
// marketing page. It replaces the 2D ParticleField helix; ParticleField stays as
// the fallback for reduced-motion / no-GPU / low-end devices (see LandingPage).

// Deep base + three brand-aligned light hues.
const BG = vec3(0.043, 0.043, 0.055);   // near-black, cool
const GOLD = vec3(0.79, 0.66, 0.43);    // brand      (#c9a96e)
const VIOLET = vec3(0.66, 0.55, 0.98);  // accent     (#a78bfa)
const TEAL = vec3(0.37, 0.92, 0.83);    // explainer sensor (#5EEAD4)

function Aurora() {
  const material = useMemo(() => {
    const colorNode = Fn(() => {
      const p = uv();
      const t = time.mul(0.06);

      // Two flowing noise fields → soft moving bands of light.
      const flow = p.y.add(mx_noise_float(vec3(p.x.mul(1.6), p.y.mul(1.1).sub(t), t)).mul(0.35));
      const band1 = smoothstep(float(0.35), float(0.5), flow).mul(
        smoothstep(float(0.68), float(0.5), flow)); // a ribbon peaking mid-screen
      const n2 = mx_noise_float(vec3(p.x.mul(3.0).add(t), p.y.mul(2.0), t.mul(1.4)))
        .mul(0.5).add(0.5);

      // Horizontal shimmer to make the ribbon feel like light, not fog.
      const shimmer = sin(p.x.mul(9.0).add(time.mul(0.5))).mul(0.5).add(0.5);

      // Colour: violet→gold across the width, teal sparkle in the fine field.
      let col = BG;
      const ribbon = band1.mul(n2).mul(shimmer.mul(0.6).add(0.4));
      const hue = mix(VIOLET, GOLD, p.x);
      col = col.add(hue.mul(ribbon.mul(float(0.9))));
      col = col.add(TEAL.mul(smoothstep(float(0.82), float(1.0), n2).mul(band1).mul(0.5)));

      // Gentle vignette so edges fall to the base colour.
      const vig = clamp(float(1.2).sub(length(p.sub(vec2(0.5, 0.5)))), float(0.0), float(1.0));
      col = col.mul(vig.mul(0.6).add(0.4));

      return vec4(col, float(1.0));
    })();

    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = colorNode;
    return mat;
  }, []);

  return (
    <mesh material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

export default function LandingHero() {
  // Real WebGPU only — on software-WebGL the noise shader washes out. When
  // unavailable we render nothing here; the landing's film + SVG FX still carry
  // the page (and ParticleField remains the Lazy3D fallback when 3D is fully off).
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
      gl={makeWebGPURenderer({ alpha: false })}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <Aurora />
    </Canvas>
  );
}
