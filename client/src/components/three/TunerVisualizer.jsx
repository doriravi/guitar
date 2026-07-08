import { useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uv, vec2, vec3, vec4, float, texture, uniform,
  abs, smoothstep, mix, clamp,
} from 'three/tsl';
import { makeWebGPURenderer } from '../../lib/makeWebGPURenderer';

// GPU oscilloscope for the tuner. A full-screen quad whose fragment shader draws
// the live waveform as a glowing horizontal trace, tinted green→gold→red by how
// far off-pitch the note is, brightening with input volume.
//
// It does NOT own any audio. The parent (OscilloscopeTuner) keeps its single
// AnalyserNode + rAF loop and just fills two PLAIN refs each frame:
//   • dataRef.current  — a Float32Array of time-domain samples (-1..1)
//   • metaRef.current  — { cents, volume }
// This component owns the GPU-side DataTexture + uniforms and copies from those
// refs on every render. Crucially, all `three`/`three/tsl` imports live HERE (a
// lazily-loaded chunk) so the statically-imported tuner never pulls three into
// the main bundle.

const TEX_W = 512; // waveform resolution (downsampled from the 4096-sample buffer)

// Palette — matches centColor() thresholds in OscilloscopeTuner.
const GREEN = vec3(0.29, 0.87, 0.50); // in tune  (#4ade80)
const GOLD = vec3(0.79, 0.66, 0.43);  // close    (#c9a96e)
const RED = vec3(0.97, 0.44, 0.44);   // far off  (#f87171)

function Scope({ dataRef, metaRef }) {
  // GPU resources created once. The DataTexture stores the waveform in the red
  // channel (RedFormat, float); the uniforms carry the scalar drivers.
  const { waveTex, buf, uCents, uVolume, material } = useMemo(() => {
    const buf = new Float32Array(TEX_W);
    const waveTex = new THREE.DataTexture(buf, TEX_W, 1, THREE.RedFormat, THREE.FloatType);
    waveTex.minFilter = THREE.LinearFilter;
    waveTex.magFilter = THREE.LinearFilter;
    waveTex.needsUpdate = true;

    const uCents = uniform(0);
    const uVolume = uniform(0);

    const colorNode = Fn(() => {
      const p = uv();
      const sample = texture(waveTex, vec2(p.x, float(0.5))).r; // already -1..1
      const traceY = sample.mul(0.42).add(0.5);

      const d = abs(p.y.sub(traceY));
      const line = smoothstep(float(0.02), float(0.0), d);
      const glow = smoothstep(float(0.14), float(0.0), d).mul(0.35);

      const off = clamp(abs(uCents).div(float(50.0)), float(0.0), float(1.0));
      const near = mix(GREEN, GOLD, smoothstep(float(0.1), float(0.5), off));
      const traceCol = mix(near, RED, smoothstep(float(0.5), float(1.0), off));

      const mid = smoothstep(float(0.004), float(0.0), abs(p.y.sub(0.5))).mul(0.12);

      const intensity = line.add(glow).mul(uVolume.mul(0.8).add(0.2));
      const col = traceCol.mul(intensity).add(vec3(0.11, 0.14, 0.30).mul(mid));
      return vec4(col, float(1.0));
    })();

    const material = new MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    return { waveTex, buf, uCents, uVolume, material };
  }, []);

  // Each frame: downsample the parent's waveform into our texture buffer and
  // copy the scalar drivers. Reuses `buf` — no per-frame allocation.
  useFrame(() => {
    const src = dataRef.current;
    if (src && src.length) {
      const step = src.length / TEX_W;
      for (let i = 0; i < TEX_W; i++) buf[i] = src[Math.floor(i * step)] || 0;
      waveTex.needsUpdate = true;
    }
    const meta = metaRef.current;
    if (meta) {
      uCents.value = meta.cents || 0;
      uVolume.value = meta.volume || 0;
    }
  });

  return (
    <mesh material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

// dataRef: React ref to a Float32Array (time-domain samples, filled by the
// parent's analyser loop). metaRef: React ref to { cents, volume }.
export default function TunerVisualizer({ dataRef, metaRef }) {
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 1], zoom: 1, left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 10 }}
      dpr={[1, 2]}
      frameloop="always"
      gl={makeWebGPURenderer({ alpha: false })}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <Scope dataRef={dataRef} metaRef={metaRef} />
    </Canvas>
  );
}
