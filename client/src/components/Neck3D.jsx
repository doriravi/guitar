import { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, RoundedBox, Environment, ContactShadows, Lightformer } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

// ─── Geometry constants ───────────────────────────────────────────────────────
// Neck lies along X. 6 strings along Z (low E z=+, high e z=-), frets across X.

const N_FRETS = 5;
const N_STRINGS = 6;
const FRET_W = 1.15;
const STRING_GAP = 0.46;
const NECK_LEN = N_FRETS * FRET_W + 0.8;
const NECK_WID = (N_STRINGS - 1) * STRING_GAP + 0.7;

const BRASS = '#c9a96e';
const JADE = '#4ade80';
const RED = '#f87171';

function notePos(string, fret) {
  const x = -NECK_LEN / 2 + (fret - 0.5) * FRET_W;
  const z = (string - (N_STRINGS - 1) / 2) * STRING_GAP;
  return [x, 0.18, z];
}

// ─── Procedural wood texture (canvas → CanvasTexture) ─────────────────────────
// Gives the fretboard real grain + a subtle roughness break-up, no asset files.
function useWoodTextures() {
  return useMemo(() => {
    const w = 512, h = 256;
    const make = (draw) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); draw(g);
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      return tex;
    };
    // colour map: dark rosewood with warm streaks
    const map = make((g) => {
      g.fillStyle = '#241a13'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const y = Math.random() * h;
        g.strokeStyle = `rgba(${60 + Math.random() * 40},${38 + Math.random() * 26},${24 + Math.random() * 18},${0.18 + Math.random() * 0.22})`;
        g.lineWidth = 0.6 + Math.random() * 2.2;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin((x + i * 30) * 0.02) * (3 + Math.random() * 5));
        g.stroke();
      }
    });
    // roughness map: grain makes some streaks shinier (lacquer pooling)
    const rough = make((g) => {
      g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) {
        const y = Math.random() * h;
        g.strokeStyle = `rgba(${Math.random() > 0.5 ? 60 : 200},${Math.random() * 255},${Math.random() * 255},0.35)`;
        g.lineWidth = 1 + Math.random() * 3;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= w; x += 18) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 4);
        g.stroke();
      }
    });
    return { map, rough };
  }, []);
}

// ─── Finger marker — glossy bead that blooms when active ──────────────────────
function Finger({ string, fret, color, visible }) {
  const ref = useRef();
  const matRef = useRef();
  const [x, y, z] = notePos(string, fret);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const target = visible ? 1 : 0.001;
    ref.current.scale.x += (target - ref.current.scale.x) * Math.min(1, dt * 7);
    ref.current.scale.y = ref.current.scale.z = ref.current.scale.x;
    if (matRef.current) matRef.current.emissiveIntensity = (visible ? 1.4 : 0) + Math.sin(performance.now() / 380) * 0.25;
  });
  return (
    <mesh ref={ref} position={[x, y + 0.17, z]} scale={0.001} castShadow>
      <sphereGeometry args={[0.16, 32, 32]} />
      <meshPhysicalMaterial ref={matRef} color={color} emissive={color} emissiveIntensity={1.2}
        roughness={0.18} metalness={0.1} clearcoat={1} clearcoatRoughness={0.15} />
    </mesh>
  );
}

// ─── Barre — glossy capsule that grows across the strings ─────────────────────
function Barre({ fret, color, visible }) {
  const ref = useRef();
  const matRef = useRef();
  const [x] = notePos(0, fret);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const t = visible ? 1 : 0.001;
    ref.current.scale.y += (t - ref.current.scale.y) * Math.min(1, dt * 7);
    if (matRef.current) matRef.current.emissiveIntensity = (visible ? 1.0 : 0) + Math.sin(performance.now() / 380) * 0.2;
  });
  return (
    <mesh ref={ref} position={[x, 0.35, 0]} rotation={[Math.PI / 2, 0, 0]} scale-y={0.001} castShadow>
      <capsuleGeometry args={[0.12, NECK_WID - 0.5, 12, 24]} />
      <meshPhysicalMaterial ref={matRef} color={color} emissive={color} emissiveIntensity={0.9}
        roughness={0.22} metalness={0.1} clearcoat={1} clearcoatRoughness={0.2} />
    </mesh>
  );
}

// ─── The neck ─────────────────────────────────────────────────────────────────
function Neck() {
  const { map, rough } = useWoodTextures();
  const strings = useMemo(() => Array.from({ length: N_STRINGS }, (_, s) => {
    const z = (s - (N_STRINGS - 1) / 2) * STRING_GAP;
    const gauge = 0.016 + (N_STRINGS - 1 - s) * 0.0058;
    const wound = s < 3; // low 3 strings are wound (slightly rougher, warmer)
    return { z, gauge, wound };
  }), []);
  const frets = useMemo(() => Array.from({ length: N_FRETS + 1 }, (_, f) => -NECK_LEN / 2 + f * FRET_W), []);
  const inlays = [3, 5];

  return (
    <group>
      {/* lacquered rosewood fretboard — clearcoat + grain map */}
      <RoundedBox args={[NECK_LEN, 0.3, NECK_WID]} radius={0.06} smoothness={5} castShadow receiveShadow>
        <meshPhysicalMaterial
          map={map} roughnessMap={rough} color="#3a2c20"
          roughness={0.55} metalness={0.0}
          clearcoat={0.6} clearcoatRoughness={0.35} reflectivity={0.4} />
      </RoundedBox>

      {/* maple-ish neck back peeking below (adds depth) */}
      <mesh position={[0, -0.22, 0]} receiveShadow>
        <boxGeometry args={[NECK_LEN, 0.16, NECK_WID - 0.12]} />
        <meshStandardMaterial color="#5a4632" roughness={0.7} />
      </mesh>

      {/* polished nickel-silver frets — high spec, real reflections from env */}
      {frets.map((x, i) => (
        <mesh key={i} position={[x, 0.165, 0]} castShadow>
          <boxGeometry args={[0.05, 0.06, NECK_WID]} />
          <meshStandardMaterial color="#e9e6df" metalness={1} roughness={0.18} />
        </mesh>
      ))}

      {/* pearloid inlays with a faint iridescent emissive */}
      {inlays.map((f, i) => {
        const x = -NECK_LEN / 2 + (f - 0.5) * FRET_W;
        return (
          <mesh key={i} position={[x, 0.151, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.085, 32]} />
            <meshPhysicalMaterial color="#f2efe6" roughness={0.25} clearcoat={1}
              iridescence={0.6} iridescenceIOR={1.3} />
          </mesh>
        );
      })}

      {/* strings — wound vs plain, true metal with env reflections */}
      {strings.map((s, i) => (
        <mesh key={i} position={[0, 0.27, s.z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[s.gauge, s.gauge, NECK_LEN + 0.4, 16]} />
          <meshStandardMaterial color={s.wound ? '#b8a98c' : '#d8d4ca'} metalness={1}
            roughness={s.wound ? 0.42 : 0.22} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Chord shapes ─────────────────────────────────────────────────────────────
const F_BARRE = {
  fingers: [{ string: 1, fret: 3 }, { string: 2, fret: 3 }, { string: 3, fret: 2 }],
};
const F_EASY = {
  fingers: [{ string: 2, fret: 3 }, { string: 3, fret: 2 }, { string: 4, fret: 1 }],
};

function Scene({ easy }) {
  const group = useRef();
  useFrame((state) => {
    if (group.current) {
      // slow cinematic drift
      group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.12) * 0.14;
      group.current.rotation.x = 0.34 + Math.sin(state.clock.elapsedTime * 0.09) * 0.02;
    }
  });
  return (
    <>
      {/* cinematic key + cool rim, env for reflections */}
      <ambientLight intensity={0.25} />
      <spotLight position={[5, 9, 5]} angle={0.5} penumbra={0.8} intensity={2.2}
        color="#fff3df" castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-7, 3, -5]} intensity={0.7} color="#7fa8ff" />

      {/* Self-contained studio environment (no CDN fetch) — soft light panels
          placed to draw cinematic highlights along the strings and frets. */}
      <Environment resolution={256} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={3} color="#fff1da" position={[3, 5, 4]}
          rotation={[-Math.PI / 3, 0, 0]} scale={[10, 6, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#cfe0ff" position={[-5, 2, -3]}
          rotation={[Math.PI / 2.4, 0, 0]} scale={[8, 4, 1]} />
        <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 4, -6]}
          rotation={[Math.PI / 2, 0, 0]} scale={[12, 3, 1]} />
        <Lightformer form="ring" intensity={1.2} color={BRASS} position={[6, 1, 2]} scale={3} />
      </Environment>

      <group ref={group} rotation={[0.34, 0, 0.03]}>
        <Neck />
        <Barre fret={1} color={RED} visible={!easy} />
        {F_BARRE.fingers.map((f, i) => <Finger key={`b${i}`} {...f} color={RED} visible={!easy} />)}
        {F_EASY.fingers.map((f, i) => <Finger key={`e${i}`} {...f} color={JADE} visible={easy} />)}
      </group>

      {/* soft grounding shadow */}
      <ContactShadows position={[0, -0.32, 0]} opacity={0.55} scale={12} blur={2.6} far={4} color="#000000" />

      {/* post: gentle bloom on the emissive chord + cinematic vignette */}
      <EffectComposer disableNormalPass>
        <Bloom intensity={0.7} luminanceThreshold={0.55} luminanceSmoothing={0.3} mipmapBlur />
        <Vignette eskil={false} offset={0.32} darkness={0.72} />
      </EffectComposer>
    </>
  );
}

export default function Neck3D({ easy }) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 3.0, 5.4], fov: 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      style={{ width: '100%', height: '100%' }}
    >
      <Scene easy={easy} />
      <OrbitControls enablePan={false} enableZoom={false}
        minPolarAngle={Math.PI / 4.5} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
