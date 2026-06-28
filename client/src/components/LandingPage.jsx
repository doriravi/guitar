import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import './LandingPage.css';

// 3D neck hero is heavy (Three.js) — load it only when we actually render it.
const Neck3D = lazy(() => import('./Neck3D'));

// Cheap capability check: WebGL available + user hasn't asked for reduced motion.
function can3D() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

// ─── Fretboard primitives ─────────────────────────────────────────────────────
// A compact SVG fretboard used by the hero and the F-chord demo. Strings run
// horizontally (low E at top), frets vertical. `dots` = [{string,fret,finger,muted}].

const STRINGS = ['E', 'A', 'D', 'G', 'B', 'e'];

function Fretboard({ dots = [], startFret = 1, frets = 4, barre = null, accent = '#c9a96e', width = 260 }) {
  const padX = 30, padTop = 26, padBottom = 18;
  const fbW = width - padX * 2;
  const rowH = 30;
  const fbH = rowH * (STRINGS.length - 1);
  const colW = fbW / frets;
  const sx = (s) => padTop + s * rowH;            // y for string index (0=low E top)
  const fx = (f) => padX + (f - startFret + 0.5) * colW; // x center of a fret cell

  return (
    <svg viewBox={`0 0 ${width} ${padTop + fbH + padBottom}`} className="lp-fb" role="img" aria-hidden>
      {/* nut / position label */}
      {startFret === 1
        ? <rect x={padX - 3} y={padTop - 2} width={4} height={fbH + 4} rx={1} fill="#3a3a40" />
        : <text x={padX - 10} y={padTop + 6} className="lp-fb-pos" textAnchor="end">{startFret}fr</text>}

      {/* fret lines */}
      {Array.from({ length: frets + 1 }, (_, i) => (
        <line key={i} x1={padX + i * colW} y1={padTop} x2={padX + i * colW} y2={padTop + fbH}
          stroke="#26262c" strokeWidth="1" />
      ))}
      {/* strings */}
      {STRINGS.map((label, s) => (
        <g key={s}>
          <line x1={padX} y1={sx(s)} x2={padX + fbW} y2={sx(s)} stroke="#33333a" strokeWidth={1 + s * 0.18} />
          <text x={padX - 12} y={sx(s) + 3} className="lp-fb-str" textAnchor="middle">{label}</text>
        </g>
      ))}

      {/* barre */}
      {barre && (
        <rect x={fx(barre.fret) - 11} y={sx(barre.from) - 9} width={22} height={(barre.to - barre.from) * rowH + 18}
          rx={11} fill={accent} opacity="0.9" className="lp-barre" />
      )}

      {/* finger dots */}
      {dots.map((d, i) => d.muted ? (
        <text key={i} x={padX - 12} y={sx(d.string) + 3} className="lp-fb-x" textAnchor="middle">×</text>
      ) : d.fret === 0 ? (
        <circle key={i} cx={padX - 12} cy={sx(d.string)} r="5" fill="none" stroke="#6a6a72" strokeWidth="1.4" />
      ) : (
        <g key={i} className="lp-dot" style={{ transition: 'all .6s cubic-bezier(.5,.1,.2,1)' }}>
          <circle cx={fx(d.fret)} cy={sx(d.string)} r="10" fill={d.color || accent} />
          {d.finger && <text x={fx(d.fret)} y={sx(d.string) + 3.5} className="lp-fb-fing" textAnchor="middle">{d.finger}</text>}
        </g>
      ))}
    </svg>
  );
}

// Difficulty pill 1–10.
function Diff({ score, label }) {
  const c = score <= 3 ? '#4ade80' : score <= 6 ? '#eab308' : score <= 8 ? '#f97316' : '#f87171';
  return (
    <div className="lp-diff">
      <span className="lp-diff-num" style={{ color: c }}>{score.toFixed(1)}</span>
      <span className="lp-diff-lbl">{label}</span>
    </div>
  );
}

// ─── Hero: hand-size drives difficulty, live ──────────────────────────────────
// The thesis. A single slider ("your reach") re-scores a chord and nudges the
// shape, so the core promise is interactive in the first viewport.

// Animated count toward a target (for the difficulty number).
function useCountTo(target, ms = 700) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now(); const a = from.current;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      setV(a + (target - a) * e);
      if (t < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// 2D fallback shapes mirroring the 3D neck (used when WebGL/motion unavailable).
const F_BARRE_2D = {
  barre: { fret: 1, from: 0, to: 5 },
  dots: [
    { string: 1, fret: 3, finger: 3, color: '#f87171' },
    { string: 2, fret: 3, finger: 4, color: '#f87171' },
    { string: 3, fret: 2, finger: 2, color: '#f87171' },
  ],
};
const F_EASY_2D = {
  barre: null,
  dots: [
    { string: 2, fret: 3, finger: 3, color: '#4ade80' },
    { string: 3, fret: 2, finger: 2, color: '#4ade80' },
    { string: 4, fret: 1, finger: 1, color: '#4ade80' },
    { string: 0, muted: true }, { string: 1, muted: true }, { string: 5, fret: 0 },
  ],
};

function HeroDemo() {
  const [easy, setEasy] = useState(false);
  const [use3D] = useState(can3D);
  const score = useCountTo(easy ? 3.4 : 9.2);
  const c = score <= 3.5 ? '#4ade80' : score <= 6 ? '#eab308' : score <= 8 ? '#f97316' : '#f87171';

  // Auto play the F→easy morph once after the hero settles, then user-controlled.
  useEffect(() => {
    const t = setTimeout(() => setEasy(true), 2600);
    return () => clearTimeout(t);
  }, []);

  const shape2D = easy ? F_EASY_2D : F_BARRE_2D;

  return (
    <div className="lp-hero-demo">
      <div className="lp-hero-3d">
        {use3D ? (
          <Suspense fallback={<div className="lp-3d-loading">loading the neck…</div>}>
            <Neck3D easy={easy} />
          </Suspense>
        ) : (
          <div className="lp-hero-fb"><Fretboard dots={shape2D.dots} barre={shape2D.barre} width={300}
            accent={easy ? '#4ade80' : '#f87171'} /></div>
        )}
      </div>

      <div className="lp-hero-ctrl">
        <div className="lp-diff">
          <span className="lp-diff-num" style={{ color: c }}>{score.toFixed(1)}</span>
          <span className="lp-diff-lbl">{easy ? 'playable — same chord' : 'the F-barre wall'}</span>
        </div>
        <button className="lp-toggle lp-hero-toggle" onClick={() => setEasy(v => !v)}>
          {easy ? '↺ Show the barre' : 'Make the F easy →'}
        </button>
        <p className="lp-hero-note">
          {use3D ? <>Drag the neck to look around. </> : null}
          Same chord, re-fingered for <em>your</em> hand.
        </p>
      </div>
    </div>
  );
}

// ─── F-chord morph: hard barre → easy shape ───────────────────────────────────

const F_BARRE = {
  barre: { fret: 1, from: 0, to: 5 },
  dots: [
    { string: 1, fret: 3, finger: 3, color: '#f87171' },
    { string: 2, fret: 3, finger: 4, color: '#f87171' },
    { string: 3, fret: 2, finger: 2, color: '#f87171' },
  ],
  diff: 9.2, name: 'F — full barre',
};
const F_EASY = {
  barre: null,
  dots: [
    { string: 2, fret: 3, finger: 3, color: '#4ade80' },
    { string: 3, fret: 2, finger: 2, color: '#4ade80' },
    { string: 4, fret: 1, finger: 1, color: '#4ade80' },
    { string: 0, muted: true }, { string: 1, muted: true }, { string: 5, fret: 0 },
  ],
  diff: 3.4, name: 'F — easy voicing',
};

function FMorphDemo() {
  const [easy, setEasy] = useState(false);
  const ref = useRef(null);

  // Auto-toggle once on first scroll-into-view, then leave it user-controlled.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setTimeout(() => setEasy(true), 700); io.disconnect(); }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const shape = easy ? F_EASY : F_BARRE;
  return (
    <div className="lp-morph" ref={ref}>
      <div className={`lp-morph-board ${easy ? 'is-easy' : 'is-hard'}`}>
        <Fretboard dots={shape.dots} barre={shape.barre} width={300}
          accent={easy ? '#4ade80' : '#f87171'} />
      </div>
      <div className="lp-morph-side">
        <div className="lp-morph-name" style={{ color: easy ? '#4ade80' : '#f87171' }}>{shape.name}</div>
        <Diff score={shape.diff} label={easy ? 'playable' : 'a wall for short fingers'} />
        <button className="lp-toggle" onClick={() => setEasy(v => !v)}>
          {easy ? 'Show the barre' : 'Make it easy →'}
        </button>
      </div>
    </div>
  );
}

// ─── Audio → Tab: waveform resolves to tab ────────────────────────────────────

function AudioTabDemo() {
  const [on, setOn] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el); return () => io.disconnect();
  }, []);
  const bars = Array.from({ length: 40 }, (_, i) => 8 + Math.abs(Math.sin(i * 0.7) * 26) + (i % 3) * 4);
  return (
    <div className="lp-audiotab" ref={ref}>
      <div className={`lp-wave ${on ? 'on' : ''}`}>
        {bars.map((h, i) => (
          <span key={i} style={{ height: `${h}px`, animationDelay: `${i * 22}ms` }} />
        ))}
      </div>
      <div className={`lp-tab ${on ? 'on' : ''}`}>
        <pre>{`e|--0---3---2---0--|
B|--1---0---3---1--|
G|--0---0---2---0--|
D|--2---0---0---2--|
A|--3---2-------3--|
E|------3----------|`}</pre>
      </div>
    </div>
  );
}

// ─── Song cards: filtered by your hand ────────────────────────────────────────

const SONGS = [
  { t: 'Let It Be', a: 'The Beatles', d: 2.4 },
  { t: 'Knockin’ on Heaven’s Door', a: 'Bob Dylan', d: 1.9 },
  { t: 'Wonderwall', a: 'Oasis', d: 3.1 },
  { t: 'Hotel California', a: 'Eagles', d: 5.7 },
  { t: 'Johnny B. Goode', a: 'Chuck Berry', d: 4.2 },
  { t: 'Stand by Me', a: 'Ben E. King', d: 2.0 },
];

function SongWall() {
  return (
    <div className="lp-songs">
      {SONGS.map((s, i) => {
        const c = s.d <= 3 ? '#4ade80' : s.d <= 6 ? '#eab308' : '#f97316';
        return (
          <div className="lp-song" key={i} style={{ animationDelay: `${i * 60}ms` }}>
            <div className="lp-song-meta">
              <div className="lp-song-t">{s.t}</div>
              <div className="lp-song-a">{s.a}</div>
            </div>
            <span className="lp-song-d" style={{ color: c, borderColor: `${c}55`, background: `${c}14` }}>{s.d.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Landing page ─────────────────────────────────────────────────────────────

export default function LandingPage({ onGetStarted, langSlot }) {
  // Reveal sections on scroll.
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('lp-in'); });
    }, { threshold: 0.18 });
    document.querySelectorAll('.lp-reveal').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <div className="lp-root">
      {/* top bar */}
      <header className="lp-top">
        <div className="lp-brand"><span className="lp-brand-mark">◗</span> Guitar Reach</div>
        <div className="lp-top-right">
          {langSlot}
          <button className="lp-signin-link" onClick={onGetStarted}>Sign in</button>
        </div>
      </header>

      {/* hero */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">Difficulty, measured for your hand</p>
          <h1 className="lp-h1">
            The chord chart that<br /><span className="lp-h1-em">knows your hands.</span>
          </h1>
          <p className="lp-lede">
            Most charts assume everyone's reach is the same. Guitar Reach measures the
            distance between every note and scores each shape <em>for your hand</em> — so
            you practice what you can actually play.
          </p>
          <div className="lp-cta-row">
            <button className="lp-cta" onClick={onGetStarted}>Get started — it's free</button>
            <a className="lp-cta-ghost" href="#how">See how it works</a>
          </div>
        </div>
        <div className="lp-hero-stage"><HeroDemo /></div>
      </section>

      {/* F-chord moment */}
      <section className="lp-sec lp-reveal" id="how">
        <div className="lp-sec-head">
          <span className="lp-kicker">The F-chord wall</span>
          <h2 className="lp-h2">The chord that ends most beginners — re-fingered.</h2>
          <p className="lp-sub">The full barre is a 9.2 for short fingers. We find a voicing with the
            same sound that your hand can hold today, and show you exactly where each finger goes.</p>
        </div>
        <FMorphDemo />
      </section>

      {/* audio to tab */}
      <section className="lp-sec lp-reveal">
        <div className="lp-sec-head">
          <span className="lp-kicker">Audio → Tab</span>
          <h2 className="lp-h2">Hum it, play it, or drop a clip. We write the tab.</h2>
          <p className="lp-sub">Upload audio or paste a YouTube link. We transcribe it to tablature and
            score every detected shape against your reach.</p>
        </div>
        <AudioTabDemo />
      </section>

      {/* songs */}
      <section className="lp-sec lp-reveal">
        <div className="lp-sec-head">
          <span className="lp-kicker">Songs for your hand</span>
          <h2 className="lp-h2">Find songs you can actually finish.</h2>
          <p className="lp-sub">Every progression and song re-rated to your reach, with easier voicings
            and up-the-neck alternatives one tap away.</p>
        </div>
        <SongWall />
      </section>

      {/* final cta */}
      <section className="lp-final lp-reveal">
        <h2 className="lp-final-h">Measure your hand. Change what's playable.</h2>
        <p className="lp-final-sub">Takes about a minute. No app to install.</p>
        <button className="lp-cta lp-cta-lg" onClick={onGetStarted}>Get started</button>
      </section>

      <footer className="lp-foot">
        <span>◗ Guitar Reach</span>
        <button className="lp-signin-link" onClick={onGetStarted}>Sign in</button>
      </footer>
    </div>
  );
}
