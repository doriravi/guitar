// Interactive Classical Guitar Fretboard Distance & Chord Visualizer.
//
// A self-contained physics + measurement tool: it renders a physically
// accurate, TAPERED fretboard (Rule-of-18 fret spacing, neck + string-span
// taper, gauge-proportional strings) and lets you place finger nodes, load
// chord / interval presets, and read live horizontal / vertical / diagonal
// hand-stretch distances in millimetres with musical-interval names.
//
// It shares its geometry with the app's reach engine (lib/geometry.js, consumed
// by lib/fretboard.js): every dot position AND every distance derives from the
// single makeGeometry().coord() function, so the picture the user sees and the
// difficulty scores the app computes are the same physics and can never disagree.
// The panel also shows the engine's own 1–10 reach score for the placed shape.

import { useMemo, useState, useCallback } from 'react';
import { useT } from '../lib/i18n';
import { INSTRUMENTS, makeGeometry } from '../lib/geometry';
import { calcDifficulty } from '../lib/fretboard';
import { CHORDS } from '../lib/chords';
import { useHandProfile } from '../App';
import {
  DEFAULT_PROFILE, recommendedMaxDifficulty, isWithinReach,
  abilityLabel, flexibilityLabel,
} from '../lib/handProfile';
import ChordTip from './ChordTip';

// Physical constants and geometry are shared with the reach engine
// (lib/geometry.js → lib/fretboard.js), so the distances this tool DRAWS and
// the difficulty scores the app COMPUTES are the same physics.
const FRETS = 15;          // render nut (0) → fret 15
const STRINGS = 6;         // 0 = low E … 5 = high e

// MIDI of each open string, string 0 = low E2 … 5 = high E4.
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Visual gauge — low E thickest, high e thinnest (mm stroke in the mm viewBox).
const STRING_GAUGE = [2.6, 2.2, 1.8, 1.4, 1.1, 0.9];

// Geometry comes from lib/geometry.js (makeGeometry) — the SAME helper the reach
// engine measures with. lastWireX (right edge of the rendered neck) is derived
// from it per instrument for the SVG layout.

// ── 3. Distance & interval engine ─────────────────────────────────────────────
function midiOf(node) { return OPEN_MIDI[node.string] + node.fret; }
function noteName(node) { return NOTE_NAMES[midiOf(node) % 12]; }
function freqOf(node) { return 440 * Math.pow(2, (midiOf(node) - 69) / 12); }

const INTERVAL_NAMES = [
  'Unison', 'minor 2nd', 'Major 2nd', 'minor 3rd', 'Major 3rd', 'Perfect 4th',
  'Tritone', 'Perfect 5th', 'minor 6th', 'Major 6th', 'minor 7th', 'Major 7th',
];
function intervalName(a, b) {
  const semis = Math.abs(midiOf(a) - midiOf(b));
  const octaves = Math.floor(semis / 12);
  const base = semis === 0 ? 'Unison' : semis % 12 === 0 ? 'Octave' : INTERVAL_NAMES[semis % 12];
  const oct = semis > 12 ? ` +${octaves} oct` : '';
  return { semis, name: base + oct };
}

// Straight-line / axis distances between two nodes, in mm, via geometry.coord.
function pairDistances(geo, a, b) {
  const pa = geo.coord(a.string, a.fret);
  const pb = geo.coord(b.string, b.fret);
  const dx = Math.abs(pb.xMm - pa.xMm);
  const dy = Math.abs(pb.yMm - pa.yMm);
  return { diagonal: Math.hypot(dx, dy), horizontal: dx, vertical: dy };
}

// Furthest-apart pair across a node set (drives the headline "cumulative reach").
function furthestPair(geo, nodes) {
  let best = null;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = pairDistances(geo, nodes[i], nodes[j]);
      if (!best || d.diagonal > best.diagonal) best = { ...d, a: nodes[i], b: nodes[j] };
    }
  }
  return best;
}

// Strain bucket for a physical span (mm), per the spec's hand-size thresholds.
function strainForSpan(mm) {
  if (mm < 180) return { label: 'Comfortable for small hands', tone: 'ok', hint: '< 180 mm' };
  if (mm <= 210) return { label: 'Needs an average hand', tone: 'warn', hint: '180–210 mm' };
  return { label: 'Hard stretch — large hands only', tone: 'hard', hint: '> 210 mm' };
}

// ── Presets — chord shapes pulled straight from the app's chord library (so they
// are always correct & match the rest of the app) plus a few named intervals.
// Nodes are fretted-only {string(0=lowE), fret}. Chord names carry a ChordTip.

// Find a library voicing by name (+ optional type) and return its fretted notes.
function libNodes(name, type) {
  const v = CHORDS.find(c => c.name === name && (type ? c.type === type : true));
  return v ? v.notes.map(n => ({ string: n.string, fret: n.fret })) : null;
}
// Build a chord preset from the library; skipped (null) if the voicing is absent.
function chordPreset(id, name, type, label) {
  const nodes = libNodes(name, type);
  return nodes ? { id, name, label: label || name, chord: true, nodes } : null;
}

const PRESET_GROUPS = [
  {
    id: 'open', title: 'Open chords',
    presets: [
      chordPreset('C', 'C', 'Major', 'C'),
      chordPreset('A', 'A', 'Major', 'A'),
      chordPreset('G', 'G', 'Major', 'G'),
      chordPreset('E', 'E', 'Major', 'E'),
      chordPreset('D', 'D', 'Major', 'D'),
      chordPreset('Am', 'Am', 'Minor', 'Am'),
      chordPreset('Em', 'Em', 'Minor', 'Em'),
      chordPreset('Dm', 'Dm', 'Minor', 'Dm'),
    ].filter(Boolean),
  },
  {
    id: 'barre', title: 'Barre chords',
    presets: [
      chordPreset('Fbar', 'F', 'Major (barre)', 'F barre'),
      chordPreset('Bbar', 'B', 'Major (barre)', 'B barre'),
      chordPreset('Bmbar', 'Bm', 'Minor (barre)', 'Bm barre'),
      chordPreset('Cbar', 'C', 'Major (barre)', 'C barre'),
      chordPreset('Dbar', 'D', 'Major (barre)', 'D barre'),
      chordPreset('Feasy', 'F', 'Major (easy)', 'F (easy)'),
    ].filter(Boolean),
  },
  {
    id: 'sevenths', title: '7ths & colour',
    presets: [
      chordPreset('G7', 'G7', 'Dom 7', 'G7'),
      chordPreset('C7', 'C7', 'Dom 7', 'C7'),
      chordPreset('E7', 'E7', 'Dom 7', 'E7'),
      chordPreset('A7', 'A7', 'Dom 7', 'A7'),
      chordPreset('D7', 'D7', 'Dom 7', 'D7'),
      chordPreset('Dmaj7', 'Dmaj7', 'Maj 7', 'Dmaj7'),
      chordPreset('Amaj7', 'Amaj7', 'Maj 7', 'Amaj7'),
      chordPreset('Cadd9', 'Cadd9', 'Add9', 'Cadd9'),
      chordPreset('Asus4', 'Asus4', 'Sus4', 'Asus4'),
      chordPreset('Dsus2', 'Dsus2', 'Sus2', 'Dsus2'),
    ].filter(Boolean),
  },
  {
    id: 'intervals', title: 'Intervals',
    presets: [
      { id: 'p5', label: 'Perfect 5th', chord: false,
        nodes: [{ string: 0, fret: 3 }, { string: 2, fret: 0 }] },
      { id: 'oct', label: 'Octave (adj. strings)', chord: false,
        nodes: [{ string: 3, fret: 5 }, { string: 5, fret: 5 }] },
      { id: 'oct2', label: 'Octave (skip string)', chord: false,
        nodes: [{ string: 0, fret: 5 }, { string: 2, fret: 7 }] },
      { id: 'maj3', label: 'Major 3rd', chord: false,
        nodes: [{ string: 2, fret: 2 }, { string: 3, fret: 1 }] },
      { id: 'p4', label: 'Perfect 4th', chord: false,
        nodes: [{ string: 0, fret: 3 }, { string: 1, fret: 3 }] },
      { id: 'stretch', label: 'Wide 4-fret stretch', chord: false,
        nodes: [{ string: 0, fret: 1 }, { string: 5, fret: 5 }] },
    ],
  },
];

// Node colors by placement order.
const NODE_COLORS = ['#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fbbf24'];

// ── Hand-size presets (cm finger spans, splayed flat) ─────────────────────────
// Same four measurements the app's hand profile uses. "Average" == DEFAULT_PROFILE.
// The 'saved' entry is filled at runtime from the user's measured profile.
const HAND_PRESETS = [
  { id: 'small',   label: 'Small',   profile: { thumbToIndex: 5.6, indexToMiddle: 3.4, middleToRing: 2.6, ringToLittle: 4.1 } },
  { id: 'average', label: 'Average', profile: DEFAULT_PROFILE },
  { id: 'large',   label: 'Large',   profile: { thumbToIndex: 9.0, indexToMiddle: 5.5, middleToRing: 4.3, ringToLittle: 6.6 } },
];

// The single whole-hand span the user tunes: the index→pinky spread (the three
// finger-splay gaps), in mm. Scales the four cm gaps proportionally so a custom
// span still feeds the per-finger reach model the engine scores from.
function splayMm(profile) {
  return (profile.indexToMiddle + profile.middleToRing + profile.ringToLittle) * 10;
}

// The comfortable diagonal REACH RADIUS (mm) this hand can stretch from an
// anchored finger. It's the index→pinky splay (how far the fingers open) with a
// small allowance for the wrist/anchor finger contributing a little more spread
// than the raw finger gaps — kept simple and proportional so the drawn circle
// grows and shrinks directly with the hand-span slider.
function reachRadiusMm(profile) {
  return splayMm(profile) * 1.15;
}
function profileFromSplayMm(mm) {
  const baseMm = splayMm(DEFAULT_PROFILE);
  const k = mm / baseMm;
  return {
    thumbToIndex: DEFAULT_PROFILE.thumbToIndex * k,
    indexToMiddle: DEFAULT_PROFILE.indexToMiddle * k,
    middleToRing: DEFAULT_PROFILE.middleToRing * k,
    ringToLittle: DEFAULT_PROFILE.ringToLittle * k,
  };
}

const keyOf = (n) => `${n.string}:${n.fret}`;

export default function FretboardMeasures() {
  const tr = useT();
  const savedProfile = useHandProfile();
  const [instKey, setInstKey] = useState('classical');
  const [nodes, setNodes] = useState([]);          // ordered [{string, fret}]
  const [labelMode, setLabelMode] = useState('note'); // note | fret | hz
  const [pointA, setPointA] = useState(0);         // indices into `nodes`
  const [pointB, setPointB] = useState(1);

  // Hand size the limits are checked against. Starts from the user's SAVED
  // measured profile so the tool reflects their real hand out of the box; they
  // can switch to a preset or drag the span slider to explore.
  const [handSpanMm, setHandSpanMm] = useState(() => Math.round(splayMm(savedProfile)));
  // The active hand profile: proportionally scaled to the chosen span. Keeps the
  // saved hand's SHAPE when the span still matches it, else scales the default.
  const handProfile = useMemo(() => {
    if (Math.round(splayMm(savedProfile)) === handSpanMm) return savedProfile;
    return profileFromSplayMm(handSpanMm);
  }, [savedProfile, handSpanMm]);

  const handAbility = abilityLabel(handProfile);
  const handFlex = flexibilityLabel(handProfile);
  const reachCeiling = recommendedMaxDifficulty(handProfile);   // comfortable 1–10 ceiling

  const inst = INSTRUMENTS[instKey];
  const geo = useMemo(() => makeGeometry(inst), [inst]);
  const other = instKey === 'classical' ? INSTRUMENTS.electric : INSTRUMENTS.classical;
  const geoOther = useMemo(() => makeGeometry(other), [other]);
  // Right edge of the rendered neck (fret wire FRETS) — for the SVG layout.
  const lastWireX = geo.fretWireMm(FRETS);

  const toggleNode = useCallback((string, fret) => {
    setNodes((prev) => {
      const k = keyOf({ string, fret });
      const idx = prev.findIndex((n) => keyOf(n) === k);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      if (prev.length >= 6) return prev;            // cap at 6
      return [...prev, { string, fret }];
    });
  }, []);

  const loadPreset = useCallback((preset) => {
    setNodes(preset.nodes.map((n) => ({ ...n })));
    setPointA(0);
    setPointB(Math.min(1, preset.nodes.length - 1));
  }, []);

  const clearNodes = useCallback(() => setNodes([]), []);

  // Headline metrics: furthest pair on the current instrument.
  const headline = useMemo(() => (nodes.length >= 2 ? furthestPair(geo, nodes) : null), [geo, nodes]);
  const headlineOther = useMemo(() => (nodes.length >= 2 ? furthestPair(geoOther, nodes) : null), [geoOther, nodes]);

  // Custom A→B tool.
  const a = nodes[pointA];
  const b = nodes[pointB];
  const custom = a && b && pointA !== pointB ? {
    dist: pairDistances(geo, a, b),
    interval: intervalName(a, b),
    strain: strainForSpan(pairDistances(geo, a, b).diagonal),
  } : null;

  // ── Within THIS hand's limits? Uses the SAME engine as "limit to my reach":
  // the shape's personalized difficulty vs. this hand's comfortable ceiling.
  // Only meaningful on the classical neck (what calcDifficulty measures).
  const handCheck = useMemo(() => {
    if (nodes.length < 2 || instKey !== 'classical') return null;
    const personal = calcDifficulty(nodes, handProfile);   // 1–10 for THIS hand
    const avg = calcDifficulty(nodes);                     // population average
    return {
      personal,
      avg,
      within: isWithinReach(avg, handProfile),
      ceiling: reachCeiling,
    };
  }, [nodes, instKey, handProfile, reachCeiling]);

  // ── Visual reach overlay ─────────────────────────────────────────────────────
  // A circle of this hand's comfortable reach radius (mm), centred on the ANCHOR
  // finger — the lowest-fret placed node, or (with none placed) the index at
  // fret 1 on the low-E so the user still sees their span on the empty neck.
  const [showReach, setShowReach] = useState(true);
  const reachRadius = reachRadiusMm(handProfile);          // mm, same units as the SVG
  const anchor = useMemo(() => {
    if (nodes.length) {
      return nodes.reduce((lo, n) => (n.fret > 0 && (!lo || n.fret < lo.fret) ? n : lo), null)
        || nodes[0];
    }
    return { string: 0, fret: 1 };   // demo anchor on the empty neck
  }, [nodes]);
  // Is a given intersection within the anchor's comfortable reach?
  const withinReachOf = useCallback((s, f) => {
    const pa = geo.coord(anchor.string, anchor.fret);
    const p = geo.coord(s, f);
    return Math.hypot(p.xMm - pa.xMm, p.yMm - pa.yMm) <= reachRadius;
  }, [geo, anchor, reachRadius]);

  // ── SVG geometry in mm (viewBox) ────────────────────────────────────────────
  const PAD = 10;
  const boardW = lastWireX + 28;               // room for open-string dots left of nut
  const boardH = geo.halfWidthAt(lastWireX) * 2 + 20;
  const vbW = boardW + PAD * 2;
  const vbH = boardH + PAD * 2;
  // shift so open-string column (x=0) has room on its left
  const OX = PAD + 18;
  const OY = PAD;

  const labelFor = (node) => {
    if (labelMode === 'fret') return String(node.fret);
    if (labelMode === 'hz') return Math.round(freqOf(node));
    return noteName(node);
  };

  const nodeIndex = (string, fret) => nodes.findIndex((n) => n.string === string && n.fret === fret);

  return (
    <div className="max-w-6xl mx-auto px-3 py-4" style={{ color: 'var(--color-ink)' }}>
      <header className="mb-4">
        <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--color-ink)' }}>
          <span>📏</span>{tr.tabFretboardMeasures || 'Fretboard Measures'}
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--color-ink-muted)' }}>
          Place fingers on the neck to measure the exact physical stretch — horizontal, vertical, and
          diagonal — between them, in millimetres, with the musical interval.
        </p>
      </header>

      {/* Instrument toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {Object.entries(INSTRUMENTS).map(([k, v]) => (
          <button key={k} onClick={() => setInstKey(k)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: instKey === k ? 'var(--color-brand)' : 'var(--color-surface-700)',
              color: instKey === k ? '#1a1205' : 'var(--color-ink-muted)',
              border: '1px solid var(--color-surface-550)',
            }}>
            {v.label}
          </button>
        ))}
        <span className="text-xs ml-1" style={{ color: 'var(--color-ink-faint)' }}>
          {inst.scaleLength} mm scale · {inst.nutWidth} mm nut
        </span>
      </div>

      {/* ── Fretboard SVG ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-3 mb-4 overflow-x-auto"
        style={{ background: 'linear-gradient(180deg, var(--color-surface-800), var(--color-surface-900))', border: '1px solid var(--color-surface-600)' }}>
        <svg viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet"
          className="w-full" style={{ minWidth: 640, height: 'auto' }} role="img"
          aria-label="Interactive guitar fretboard">
          {/* wood */}
          <defs>
            <linearGradient id="fbm-wood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a2817" />
              <stop offset="1" stopColor="#241809" />
            </linearGradient>
          </defs>
          {/* fretboard body (tapered polygon) */}
          {(() => {
            const topAt = (x) => OY + (geo.halfWidthAt(0) + 4) - geo.halfWidthAt(x);
            const botAt = (x) => OY + (geo.halfWidthAt(0) + 4) + geo.halfWidthAt(x);
            const x0 = 0, x1 = lastWireX;
            return (
              <polygon
                points={`${OX + x0},${topAt(x0)} ${OX + x1},${topAt(x1)} ${OX + x1},${botAt(x1)} ${OX + x0},${botAt(x0)}`}
                fill="url(#fbm-wood)" stroke="#5a4326" strokeWidth="0.6" />
            );
          })()}

          {/* fret wires */}
          {Array.from({ length: FRETS + 1 }, (_, n) => {
            const x = OX + geo.fretWireMm(n);
            const half = geo.halfWidthAt(geo.fretWireMm(n));
            const cy = OY + geo.halfWidthAt(0) + 4;
            const isNut = n === 0;
            return (
              <g key={`w${n}`}>
                <line x1={x} y1={cy - half} x2={x} y2={cy + half}
                  stroke={isNut ? '#e8dcc8' : '#9a9a9a'} strokeWidth={isNut ? 2 : 0.8} />
                {/* fret number */}
                {n > 0 && (
                  <text x={x - geo.fretWireMm(n) / 1} y={vbH - 2} fontSize="3.2" fill="var(--color-ink-faint)"
                    textAnchor="middle" style={{ display: 'none' }}>{n}</text>
                )}
              </g>
            );
          })}
          {/* fret numbers under the board */}
          {Array.from({ length: FRETS }, (_, i) => {
            const n = i + 1;
            const x = OX + geo.noteX(n);
            return (
              <text key={`fn${n}`} x={x} y={vbH - 1.5} fontSize="3.4" fill="var(--color-ink-faint)"
                textAnchor="middle">{n}</text>
            );
          })}
          {/* position inlays */}
          {[3, 5, 7, 9, 12, 15].filter((f) => f <= FRETS).map((f) => {
            const x = OX + geo.noteX(f);
            const cy = OY + geo.halfWidthAt(0) + 4;
            return f === 12
              ? <g key={`in${f}`}>
                  <circle cx={x} cy={cy - 8} r="1.4" fill="#c9a96e" opacity="0.6" />
                  <circle cx={x} cy={cy + 8} r="1.4" fill="#c9a96e" opacity="0.6" />
                </g>
              : <circle key={`in${f}`} cx={x} cy={cy} r="1.6" fill="#c9a96e" opacity="0.5" />;
          })}

          {/* strings (gauge-proportional) */}
          {Array.from({ length: STRINGS }, (_, s) => {
            const p0 = geo.coord(s, 0);
            const p1 = geo.coord(s, FRETS + 0.5);
            return (
              <line key={`s${s}`} x1={OX + p0.xMm} y1={OY + p0.yMm} x2={OX + lastWireX} y2={OY + p1.yMm}
                stroke="#d8d2c4" strokeWidth={STRING_GAUGE[s]} strokeLinecap="round" opacity="0.85" />
            );
          })}

          {/* vector lines between nodes (placement order) */}
          {nodes.length >= 2 && nodes.slice(1).map((n, i) => {
            const p0 = geo.coord(nodes[i].string, nodes[i].fret);
            const p1 = geo.coord(n.string, n.fret);
            return (
              <line key={`v${i}`} x1={OX + p0.xMm} y1={OY + p0.yMm} x2={OX + p1.xMm} y2={OY + p1.yMm}
                stroke="#f59e0b" strokeWidth="0.7" strokeDasharray="2 1.5" opacity="0.75" />
            );
          })}
          {/* highlight the furthest pair (headline reach) */}
          {headline && (
            <line
              x1={OX + geo.coord(headline.a.string, headline.a.fret).xMm}
              y1={OY + geo.coord(headline.a.string, headline.a.fret).yMm}
              x2={OX + geo.coord(headline.b.string, headline.b.fret).xMm}
              y2={OY + geo.coord(headline.b.string, headline.b.fret).yMm}
              stroke="#f472b6" strokeWidth="1" strokeDasharray="3 2" opacity="0.95" />
          )}

          {/* ── VISUAL REACH: this hand's comfortable stretch from the anchor ── */}
          {showReach && instKey === 'classical' && (() => {
            const pa = geo.coord(anchor.string, anchor.fret);
            return (
              <g style={{ pointerEvents: 'none' }}>
                <circle cx={OX + pa.xMm} cy={OY + pa.yMm} r={reachRadius}
                  fill="rgba(52,211,153,0.10)" stroke="rgba(52,211,153,0.55)"
                  strokeWidth="0.7" strokeDasharray="2.5 2"
                  style={{ transition: 'r 150ms ease' }} />
                {/* anchor marker */}
                <circle cx={OX + pa.xMm} cy={OY + pa.yMm} r="1.2" fill="rgba(52,211,153,0.9)" />
              </g>
            );
          })()}

          {/* clickable intersections — every string × fret */}
          {Array.from({ length: STRINGS }, (_, s) =>
            Array.from({ length: FRETS + 1 }, (_, f) => {
              const p = geo.coord(s, f);
              const idx = nodeIndex(s, f);
              const active = idx >= 0;
              const node = { string: s, fret: f };
              const reachable = showReach && instKey === 'classical' && withinReachOf(s, f);
              return (
                <g key={`n${s}-${f}`}>
                  {/* faint reachability marker on empty intersections */}
                  {!active && showReach && instKey === 'classical' && (
                    <circle cx={OX + p.xMm} cy={OY + p.yMm} r={reachable ? 0.9 : 0.5}
                      fill={reachable ? 'rgba(52,211,153,0.75)' : 'rgba(216,210,196,0.18)'}
                      style={{ pointerEvents: 'none', transition: 'all 120ms ease' }} />
                  )}
                  {/* hit target (larger, transparent) */}
                  <circle cx={OX + p.xMm} cy={OY + p.yMm} r="3.6" fill="transparent"
                    style={{ cursor: 'pointer' }}
                    tabIndex={0} role="button"
                    aria-label={`String ${STRINGS - s}, fret ${f}, note ${noteName(node)}${active ? ', selected' : ''}${reachable ? ', within your reach' : ''}`}
                    onClick={() => toggleNode(s, f)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNode(s, f); } }} />
                  {active && (
                    <>
                      <circle cx={OX + p.xMm} cy={OY + p.yMm} r="3.2"
                        fill={NODE_COLORS[idx % NODE_COLORS.length]} stroke="#1a1205" strokeWidth="0.5"
                        style={{ transition: 'all 120ms ease', pointerEvents: 'none' }} />
                      <text x={OX + p.xMm} y={OY + p.yMm + 1.1} fontSize="2.8" fontWeight="700"
                        fill="#1a1205" textAnchor="middle" style={{ pointerEvents: 'none' }}>
                        {labelFor(node)}
                      </text>
                    </>
                  )}
                </g>
              );
            })
          )}
        </svg>
      </div>

      {/* ── Your hand — the lens the limits below are checked against ──────────── */}
      <div className="rounded-2xl p-4 mb-4"
        style={{ background: 'var(--color-surface-800)', border: '1px solid var(--color-surface-600)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>✋ Your hand — check your limits</h3>
          {Math.round(splayMm(savedProfile)) === handSpanMm && savedProfile !== DEFAULT_PROFILE && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(201,169,110,0.15)', color: 'var(--color-brand)' }}>
              from your saved measurements
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
          {/* size presets + custom span */}
          <div className="sm:col-span-2">
            <div className="flex flex-wrap gap-2 mb-3">
              {HAND_PRESETS.map((h) => {
                const active = Math.round(splayMm(h.profile)) === handSpanMm;
                return (
                  <button key={h.id} onClick={() => setHandSpanMm(Math.round(splayMm(h.profile)))}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      background: active ? 'var(--color-brand)' : 'var(--color-surface-700)',
                      color: active ? '#1a1205' : 'var(--color-ink-muted)',
                      border: '1px solid var(--color-surface-550)',
                    }}>
                    {h.label}
                  </button>
                );
              })}
              {savedProfile !== DEFAULT_PROFILE && (
                <button onClick={() => setHandSpanMm(Math.round(splayMm(savedProfile)))}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium"
                  style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
                  My saved hand
                </button>
              )}
            </div>
            <label className="block text-xs" style={{ color: 'var(--color-ink-faint)' }}>
              Index→pinky span: <strong style={{ color: 'var(--color-ink)' }}>{handSpanMm} mm</strong>
              <input type="range" min="90" max="200" value={handSpanMm}
                onChange={(e) => setHandSpanMm(Number(e.target.value))}
                className="w-full mt-1" aria-label="Hand span in millimetres" />
            </label>
            <label className="flex items-center gap-2 mt-3 text-xs cursor-pointer" style={{ color: 'var(--color-ink-muted)' }}>
              <input type="checkbox" checked={showReach} onChange={(e) => setShowReach(e.target.checked)} />
              Show my reach on the fretboard
              <span style={{ color: 'var(--color-ink-faint)' }}>
                — the green ring is how far you comfortably stretch from your{' '}
                {nodes.length ? 'lowest finger' : 'index finger (fret 1)'}
              </span>
            </label>
          </div>

          {/* ability read-out */}
          <div className="text-sm">
            <div className="mb-1">
              <span style={{ color: 'var(--color-ink-faint)' }}>Reach: </span>
              <strong className={handAbility.color}>{handAbility.label}</strong>
            </div>
            <div className="mb-1">
              <span style={{ color: 'var(--color-ink-faint)' }}>Flexibility: </span>
              <strong className={handFlex.color}>{handFlex.label}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--color-ink-faint)' }}>Comfortable ceiling: </span>
              <strong style={{ color: 'var(--color-brand)' }}>{reachCeiling}/10</strong>
            </div>
          </div>
        </div>

        {/* per-shape verdict */}
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-surface-600)' }}>
          {!handCheck ? (
            <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
              {instKey === 'classical'
                ? 'Place a shape on the neck to see whether it is within your reach.'
                : 'Switch to the Classical neck to check a shape against your hand.'}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="px-3 py-1.5 rounded-lg text-sm font-semibold"
                style={{
                  background: handCheck.within ? 'rgba(52,211,153,0.15)' : 'rgba(244,63,94,0.15)',
                  color: handCheck.within ? '#34d399' : '#f87171',
                  border: '1px solid var(--color-surface-550)',
                }}>
                {handCheck.within ? '✓ Within your reach' : '✕ Beyond your comfortable reach'}
              </span>
              <span className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                For your hand this shape scores{' '}
                <strong style={{ color: 'var(--color-ink)' }}>{handCheck.personal.toFixed(1)}/10</strong>
                {handCheck.personal !== handCheck.avg && (
                  <> (avg hand {handCheck.avg.toFixed(1)})</>
                )} · your ceiling {handCheck.ceiling}/10
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Presets (full width, browsable by category) ───────────────────────── */}
      <div className="rounded-2xl p-4 mb-4"
        style={{ background: 'var(--color-surface-800)', border: '1px solid var(--color-surface-600)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Presets — load a shape</h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-xs mr-1" style={{ color: 'var(--color-ink-faint)' }}>Labels</span>
              {[['note', 'Notes'], ['fret', 'Frets'], ['hz', 'Hz']].map(([k, lbl]) => (
                <button key={k} onClick={() => setLabelMode(k)}
                  className="px-2 py-1 rounded-md text-xs"
                  style={{
                    background: labelMode === k ? 'var(--color-brand)' : 'var(--color-surface-700)',
                    color: labelMode === k ? '#1a1205' : 'var(--color-ink-muted)',
                    border: '1px solid var(--color-surface-550)',
                  }}>
                  {lbl}
                </button>
              ))}
            </div>
            <button onClick={clearNodes}
              className="px-2.5 py-1 rounded-lg text-xs font-medium"
              style={{ background: 'transparent', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink-muted)' }}>
              Clear
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {PRESET_GROUPS.map((group) => (
            <div key={group.id}>
              <div className="text-[11px] font-medium mb-1.5 uppercase tracking-wide"
                style={{ color: 'var(--color-ink-faint)' }}>{group.title}</div>
              <div className="flex flex-wrap gap-2">
                {group.presets.map((p) => {
                  // Preview each shape's difficulty so the user can compare stretches.
                  const diff = calcDifficulty(p.nodes);
                  return (
                    <button key={p.id} onClick={() => loadPreset(p)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                      style={{ background: 'var(--color-surface-700)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}>
                      {p.chord
                        ? <ChordTip name={p.name}><span className="underline decoration-dotted">{p.label}</span></ChordTip>
                        : <span>{p.label}</span>}
                      <span className="tabular-nums text-[10px] px-1 rounded"
                        style={{ background: 'var(--color-surface-900)', color: 'var(--color-brand)' }}>{diff.toFixed(1)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Controls + metrics grid ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Headline metrics */}
        <Panel title="Reach">
          {!headline ? (
            <p className="text-sm" style={{ color: 'var(--color-ink-faint)' }}>
              Place two or more fingers on the neck to measure the stretch.
            </p>
          ) : (
            <>
              <Metric label="Cumulative diagonal reach" value={`${headline.diagonal.toFixed(1)} mm`} big
                sub={`furthest pair: ${noteName(headline.a)} → ${noteName(headline.b)}`} />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Metric label="Horizontal span" value={`${headline.horizontal.toFixed(1)} mm`} />
                <Metric label="Vertical span" value={`${headline.vertical.toFixed(1)} mm`} />
              </div>
              {/* The app's own 1–10 reach score for this shape — computed by the
                  reach engine from THIS SAME geometry (classical neck). */}
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-surface-600)' }}>
                <Metric label="App reach difficulty (1–10)"
                  value={instKey === 'classical' ? calcDifficulty(nodes).toFixed(1) : '—'}
                  sub={instKey === 'classical'
                    ? 'same physics as the chord scores across the app'
                    : 'switch to Classical to match the app score'} />
              </div>
              {headlineOther && (
                <div className="mt-3 pt-3 text-xs" style={{ borderTop: '1px solid var(--color-surface-600)', color: 'var(--color-ink-muted)' }}>
                  Same shape on <strong style={{ color: 'var(--color-ink)' }}>{other.label}</strong>:{' '}
                  <strong style={{ color: 'var(--color-brand)' }}>{headlineOther.diagonal.toFixed(1)} mm</strong>{' '}
                  ({(headlineOther.diagonal - headline.diagonal >= 0 ? '+' : '')}{(headlineOther.diagonal - headline.diagonal).toFixed(1)} mm)
                </div>
              )}
            </>
          )}
        </Panel>

        {/* Custom A→B distance tool */}
        <Panel title="Custom distance (A → B)">
          {nodes.length < 2 ? (
            <p className="text-sm" style={{ color: 'var(--color-ink-faint)' }}>
              Add at least two nodes, then pick point A and point B.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <NodePicker label="Point A" nodes={nodes} value={pointA} onChange={setPointA} />
                <NodePicker label="Point B" nodes={nodes} value={pointB} onChange={setPointB} />
              </div>
              {custom && (
                <>
                  <Metric label="Diagonal stretch" value={`${custom.dist.diagonal.toFixed(1)} mm`} big />
                  <div className="grid grid-cols-2 gap-2 mt-2 mb-2">
                    <Metric label="Horizontal" value={`${custom.dist.horizontal.toFixed(1)} mm`} />
                    <Metric label="Vertical" value={`${custom.dist.vertical.toFixed(1)} mm`} />
                  </div>
                  <Metric label="Interval" value={custom.interval.name} sub={`${custom.interval.semis} semitones`} />
                  <div className="mt-2 rounded-lg px-2.5 py-2 text-xs"
                    style={{
                      background: custom.strain.tone === 'ok' ? 'rgba(52,211,153,0.12)'
                        : custom.strain.tone === 'warn' ? 'rgba(251,146,60,0.12)' : 'rgba(244,63,94,0.14)',
                      color: custom.strain.tone === 'ok' ? '#34d399'
                        : custom.strain.tone === 'warn' ? '#fb923c' : '#f87171',
                      border: '1px solid var(--color-surface-550)',
                    }}>
                    <strong>{custom.strain.label}</strong> · {custom.strain.hint}
                  </div>
                </>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── small presentational helpers ──────────────────────────────────────────────
function Panel({ title, children }) {
  return (
    <section className="rounded-2xl p-4"
      style={{ background: 'var(--color-surface-800)', border: '1px solid var(--color-surface-600)' }}>
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-ink)' }}>{title}</h3>
      {children}
    </section>
  );
}

function Metric({ label, value, sub, big }) {
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>{label}</div>
      <div className={big ? 'text-2xl font-bold' : 'text-base font-semibold'}
        style={{ color: big ? 'var(--color-brand)' : 'var(--color-ink)' }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>{sub}</div>}
    </div>
  );
}

function NodePicker({ label, nodes, value, onChange }) {
  return (
    <label className="block text-xs" style={{ color: 'var(--color-ink-faint)' }}>
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md px-2 py-1 text-xs"
        style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink)', border: '1px solid var(--color-surface-550)' }}>
        {nodes.map((n, i) => (
          <option key={i} value={i}>
            #{i + 1} · {NOTE_NAMES[(OPEN_MIDI[n.string] + n.fret) % 12]} (str {6 - n.string}, fret {n.fret})
          </option>
        ))}
      </select>
    </label>
  );
}
