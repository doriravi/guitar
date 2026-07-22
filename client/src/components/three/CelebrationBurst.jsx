import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { Fn, vec3, vec4, float, uniform, attribute, positionLocal, clamp } from 'three/tsl';
import { makeWebGPURenderer } from '../../lib/makeWebGPURenderer';

// One-shot GPU particle burst for the big-win Celebration — an additive point
// spray in the brand gold/violet/teal that fires once, radiates from center over
// ~1.8s, then self-unmounts via onDone. Upgrades the flat 2D confetti for the
// app's highest-effort achievements (song complete, mastery crown).
//
// Reuses ParticleField3D's material recipe (PointsNodeMaterial + AdditiveBlending
// + the exact palette) but replaces its analyser-driven position with a single
// time-parameterized `uProgress` uniform — no audio, no per-frame allocation.
//
// WebGL2-safe: additive POINTS render on the WebGL fallback (unlike the noise
// shaders), so this only needs should3D() — applied by <Lazy3D> at the call site
// (reduced-motion / no-GPU / user-opt-out → never mounts). CRITICAL: never
// reference uv() in the color node — a THREE.Points geometry has no `uv`
// attribute and the WebGL2 fallback would drop the fragment (particles vanish);
// see ParticleField3D.jsx.

const COUNT = 900;

// Brand palette — identical to ParticleField3D.
const GOLD = vec3(0.79, 0.66, 0.43);   // #c9a96e
const VIOLET = vec3(0.66, 0.55, 0.98); // #a78bfa
const TEAL = vec3(0.37, 0.92, 0.83);   // #5EEAD4
const PALETTE = [GOLD, VIOLET, TEAL];

const DURATION = 1.8; // seconds

function Burst({ onDone }) {
  const { geometry, material, uProgress } = useMemo(() => {
    // Each particle: a random outward velocity direction/speed, a color pick, a
    // per-point size seed. Positions start at origin; the shader advances them by
    // velocity * progress with gravity, so the whole burst is one uniform.
    const positions = new Float32Array(COUNT * 3);   // all at origin
    const velocities = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    const colorIdx = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // Random direction on a sphere, biased slightly upward for a fountain feel.
      // Speeds are kept modest so the spray stays inside the banner (its container
      // is overflow-hidden — the visible frustum half-height at the plane is
      // ~tan(27.5°)·4 ≈ 2.1 world units, so max travel ~1.3 keeps most points in).
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 0.4 + Math.random() * 1.3;
      velocities[i * 3 + 0] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.cos(phi) * speed + 0.5; // gentle upward bias
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed * 0.6;
      seeds[i] = Math.random();
      colorIdx[i] = i % PALETTE.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aVel', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aColorIdx', new THREE.BufferAttribute(colorIdx, 1));

    const uProgress = uniform(0); // 0..1 over DURATION

    const vel = attribute('aVel');
    const seed = attribute('aSeed');
    const cIdx = attribute('aColorIdx');

    // Position: origin + velocity*prog − gravity*prog², so points arc out and fall.
    const positionNode = Fn(() => {
      const p = positionLocal.toVar();
      const prog = uProgress;
      p.x = p.x.add(vel.x.mul(prog));
      p.y = p.y.add(vel.y.mul(prog)).sub(prog.mul(prog).mul(float(1.1))); // gravity
      p.z = p.z.add(vel.z.mul(prog));
      return p;
    })();

    // Size: a seed-varied base that shrinks as the burst ages.
    const sizeNode = float(3.0)
      .add(seed.mul(4.0))
      .mul(clamp(float(1.0).sub(uProgress.mul(0.7)), float(0.15), float(1.0)));

    // Color: pick from the 3-color palette by index; fade alpha out over life.
    // No uv() — see the file header.
    const colorNode = Fn(() => {
      // mix() chain to select a palette color from the float index (0,1,2).
      const isViolet = clamp(float(1.0).sub(cIdx.sub(float(1.0)).abs()), float(0.0), float(1.0));
      const isTeal = clamp(float(1.0).sub(cIdx.sub(float(2.0)).abs()), float(0.0), float(1.0));
      const isGold = clamp(float(1.0).sub(cIdx.abs()), float(0.0), float(1.0));
      const col = GOLD.mul(isGold).add(VIOLET.mul(isViolet)).add(TEAL.mul(isTeal))
        .mul(float(1.4)); // push into HDR for a bright core under additive blending
      // Fade: bright for the first third, then ease to zero by the end.
      const alpha = clamp(float(1.0).sub(uProgress).mul(float(1.6)), float(0.0), float(1.0));
      return vec4(col, alpha);
    })();

    const material = new PointsNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
    material.sizeNode = sizeNode;
    material.sizeAttenuation = true;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return { geometry, material, uProgress };
  }, []);

  const elapsed = useRef(0);
  const doneRef = useRef(false);
  useFrame((_, delta) => {
    if (doneRef.current) return;
    elapsed.current += delta;
    const prog = Math.min(1, elapsed.current / DURATION);
    uProgress.value = prog;
    if (prog >= 1) {
      doneRef.current = true;
      onDone?.();   // ramp complete → parent unmounts us
    }
  });

  return <points geometry={geometry} material={material} />;
}

/**
 * @param {() => void} [onDone] called once when the ~1.8s burst finishes, so the
 *        parent can unmount this overlay (freeing the GPU context).
 */
export default function CelebrationBurst({ onDone }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 4], fov: 55, near: 0.1, far: 30 }}
      dpr={[1, 1.5]}
      frameloop="always"
      gl={makeWebGPURenderer({ alpha: true })}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <Burst onDone={onDone} />
    </Canvas>
  );
}
