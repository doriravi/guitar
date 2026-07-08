import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, texture, uniform, attribute, positionLocal,
  sin, cos, mix, smoothstep, clamp,
} from 'three/tsl';
import { makeWebGPURenderer } from '../../lib/makeWebGPURenderer';
import { getComposerAnalyser } from '../GuitarStrings';

// Instanced GPU particle field for the Composer header that LISTENS TO THE MUSIC
// THE APP PLAYS (not the mic). It taps an AnalyserNode off the Composer's own
// audio bus (getComposerAnalyser) and drives thousands of points on the GPU:
//   • each particle owns a frequency BIN — it surges when that band has energy,
//     so bass notes push the low-band particles and high notes shimmer the top,
//     making the field "follow" the music instead of just pulsing uniformly;
//   • an overall level (RMS) adds a global swell + brightness on every strum.
//
// Pure TSL point material — position + color computed on the GPU from a spectrum
// DataTexture + two scalar uniforms updated each frame (no per-frame allocation).
// All `three`/`three/tsl` imports live here (a lazily-loaded chunk) so the Composer
// never pulls three into the main bundle. Gated on real WebGPU by the parent.

const COUNT = 2600;      // particles
const SPEC_W = 256;      // frequency bins we feed the shader (of the 512 available)

// Brand palette.
const GOLD = vec3(0.79, 0.66, 0.43);   // brass  (#c9a96e) — low band
const VIOLET = vec3(0.66, 0.55, 0.98); // accent (#a78bfa) — mid band
const TEAL = vec3(0.37, 0.92, 0.83);   // sensor (#5EEAD4) — high band

function Field() {
  const { geometry, material, specTex, spec, uLevel, uTime } = useMemo(() => {
    // ── Particle layout: a soft, wide slab drifting in the strip. Each particle
    //    gets a base position, a random seed (phase), and a frequency bin (0..1).
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    const bins = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // Spread across a landscape-ish volume that fills the 200px strip.
      positions[i * 3 + 0] = (Math.random() * 2 - 1) * 1.7;  // x
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * 0.62; // y
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * 0.6;  // z (parallax)
      seeds[i] = Math.random();
      // Bias bins toward the low/mid where guitar energy lives, but cover the range.
      bins[i] = Math.pow(Math.random(), 1.5); // 0..1, denser near 0 (bass/mids)
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aBin', new THREE.BufferAttribute(bins, 1));

    // ── Audio in: smoothed FFT magnitudes in the red channel of a 1-D texture.
    const spec = new Float32Array(SPEC_W);
    const specTex = new THREE.DataTexture(spec, SPEC_W, 1, THREE.RedFormat, THREE.FloatType);
    specTex.minFilter = THREE.LinearFilter;
    specTex.magFilter = THREE.LinearFilter;
    specTex.needsUpdate = true;

    const uLevel = uniform(0); // overall RMS 0..1
    const uTime = uniform(0);

    const seed = attribute('aSeed');
    const bin = attribute('aBin');

    // Energy in this particle's frequency band (0..1), read from the spectrum.
    const bandEnergy = texture(specTex, vec2(bin, float(0.5))).r;

    // ── Position: base + drift + audio-driven displacement along the particle's
    //    own random direction. Louder band ⇒ larger excursion + upward lift.
    const positionNode = Fn(() => {
      const p = positionLocal.toVar();
      const ph = seed.mul(float(6.2831));                 // per-particle phase
      const t = uTime;

      // Gentle idle drift so the field is alive even in silence.
      const driftX = sin(t.mul(0.3).add(ph)).mul(0.04);
      const driftY = cos(t.mul(0.24).add(ph.mul(1.7))).mul(0.04);

      // Audio push: this band's energy + a bit of global level, oscillating so it
      // ripples rather than snapping. Direction varies per particle via the seed.
      const drive = bandEnergy.mul(0.55).add(uLevel.mul(0.25));
      const wob = sin(t.mul(3.0).add(ph.mul(4.0))).mul(drive);
      p.x = p.x.add(driftX).add(wob.mul(cos(ph.mul(3.1)).mul(0.5)));
      p.y = p.y.add(driftY).add(drive.mul(0.5)).add(wob.mul(0.4)); // lift on energy
      p.z = p.z.add(sin(t.mul(0.5).add(ph)).mul(0.06));
      return p;
    })();

    // ── Point size: base + swell with this band's energy and global level.
    //    (Perspective attenuation is applied by PointsNodeMaterial when sizeAttenuation.)
    //    Slightly larger dots read with more presence against the dark panel.
    const sizeNode = float(2.8)
      .add(bandEnergy.mul(11.0))
      .add(uLevel.mul(3.5))
      .mul(seed.mul(0.6).add(0.7)); // size variety per particle

    // ── Color: gold→violet→teal across the frequency axis, brightened by energy.
    //    NOTE: no uv()/point-sprite sampling here — a THREE.Points geometry has no
    //    `uv` attribute, and referencing uv() makes the WebGL2 fallback drop the
    //    whole fragment (particles vanish). With AdditiveBlending the small square
    //    points read as soft glowing dots anyway, so per-sprite roundness isn't
    //    needed. Alpha is driven by energy only (valid texture/uniform inputs).
    const colorNode = Fn(() => {
      const lowMid = mix(GOLD, VIOLET, smoothstep(float(0.0), float(0.5), bin));
      const hue = mix(lowMid, TEAL, smoothstep(float(0.5), float(1.0), bin));
      // Higher base glow + energy gain so particles read with strong contrast
      // against the dark panel; peaks push into HDR (>1) for a bright bloom-y core.
      const bright = float(0.4).add(bandEnergy.mul(1.8)).add(uLevel.mul(0.55));
      const col = hue.mul(clamp(bright, float(0.0), float(2.2)));
      const alpha = clamp(bandEnergy.mul(2.4).add(0.6), float(0.35), float(1.0))
        .add(uLevel.mul(0.35));
      return vec4(col, clamp(alpha, float(0.0), float(1.0)));
    })();

    const material = new PointsNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
    material.sizeNode = sizeNode;
    material.sizeAttenuation = true;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return { geometry, material, specTex, spec, uLevel, uTime };
  }, []);

  // Analyser byte buffers reused every frame (no allocation in the loop).
  const analyserRef = useRef(null);
  const freqRef = useRef(null);
  const timeRef = useRef(null);

  useFrame((_, delta) => {
    uTime.value += delta;

    // Lazily grab the shared analyser once audio exists. Before the user plays
    // anything the context may not be built yet; getComposerAnalyser builds it.
    let a = analyserRef.current;
    if (!a) {
      try {
        a = getComposerAnalyser();
        analyserRef.current = a;
        freqRef.current = new Uint8Array(a.frequencyBinCount);
        timeRef.current = new Uint8Array(a.fftSize);
      } catch { /* audio not ready */ }
    }
    if (!a) return;

    const freq = freqRef.current;
    a.getByteFrequencyData(freq);

    // Copy the low SPEC_W bins into the texture (0..1), log-ish emphasis so quiet
    // partials still register. freq has frequencyBinCount(=512) bins; we take the
    // lower half where guitar + backing energy sits.
    for (let i = 0; i < SPEC_W; i++) {
      const v = freq[i] / 255;
      spec[i] = v * v * 0.6 + v * 0.4; // mild curve: lift mids, keep peaks punchy
    }
    specTex.needsUpdate = true;

    // Overall level (RMS of the time-domain signal) for the global swell.
    const td = timeRef.current;
    a.getByteTimeDomainData(td);
    let sum = 0;
    for (let i = 0; i < td.length; i++) {
      const s = (td[i] - 128) / 128;
      sum += s * s;
    }
    uLevel.value = Math.min(1, Math.sqrt(sum / td.length) * 3.2);
  });

  return <points geometry={geometry} material={material} />;
}

// Unlike the ambient/hero NOISE shaders (which wash out and so gate on real
// WebGPU), an additive POINT field renders correctly on the WebGL fallback too —
// so this only needs should3D() (applied by <Lazy3D> at the call site). The
// WebGPURenderer auto-falls back to WebGL and TSL compiles to GLSL there.
export default function ParticleField3D() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3], fov: 50, near: 0.1, far: 20 }}
      dpr={[1, 1.5]}
      frameloop="always"
      gl={makeWebGPURenderer({ alpha: true })}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <Field />
    </Canvas>
  );
}
