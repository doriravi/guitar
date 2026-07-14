---
name: fretboard-measures
description: Generates a self-contained interactive "Classical Guitar Fretboard Distance & Chord Visualizer" React component — a physically-accurate, tapered fretboard (Rule-of-18 spacing, proportional string widths) that lets the user place finger nodes, load chord/interval presets, and read live horizontal / vertical / diagonal hand-stretch distances in millimeters with musical-interval names, plus a classical-vs-electric dimension comparison and a small/average/large-hand strain rating.
disable-model-invocation: false
user-invocable: true
---

# Role and objective

You are an expert frontend engineer **and** music theorist. When invoked, you produce a single, highly-polished, interactive React component — the **Interactive Classical Guitar Fretboard Distance & Chord Visualizer** — plus wire it into the app so the user can open it.

The component visualizes the exact physical and musical geometry of a standard 4/4 classical guitar fretboard and measures vertical, horizontal, and diagonal hand-stretch distances between multiple points. It is **self-contained**: it carries its own physical-constants config (the spec below), so it does not depend on the app's reach engine. It uses **Tailwind CSS** (the app's styling system) and **inline SVG** for the fretboard (no Canvas, no chart lib needed — Recharts is unnecessary here; use SVG). Lucide icons are optional — the app does not currently bundle `lucide-react`, so prefer inline emoji/SVG glyphs unless the user asks to add the dependency.

## Where it goes in this project (reuse-first)

- Component file: **`client/src/components/FretboardMeasures.jsx`**.
- Mount it as a tab in [client/src/App.jsx](client/src/App.jsx): add to `getTabs(tr)` an entry `{ id: 'fbmeasure', label: tr.tabFretboardMeasures || 'Fretboard Measures', icon: '📏', side: true }` (side-menu, like `levelplan`), a `TAB_HELP.fbmeasure` one-liner, and render `{activeTab === 'fbmeasure' && <FretboardMeasures lang={lang} />}`.
- Reuse `useLang()`/`LangContext` for translation and the `tr.*` fallback pattern (`tr.key || 'English default'`) exactly like every other component. Add only `tabFretboardMeasures` (English) to [client/src/lib/i18n.js](client/src/lib/i18n.js); leave the other 9 languages to fall back.
- **CLAUDE.md chord-hover rule still applies:** any place this component prints a chord *name* (the presets list) must show the chord's shape on hover via the existing `ChordTip`/`FretboardDiagram` tooltip. The fretboard nodes themselves ARE the shape, so nodes are exempt; the preset buttons are not — wrap their names in `ChordTip`.
- Do NOT modify [client/src/lib/fretboard.js](client/src/lib/fretboard.js). This tool uses its own constants (below). If you want the reach *score* alongside the mm reading, you MAY import `calcDifficulty` from `fretboard.js` and show it as a secondary badge — but the primary readout is the physical mm math defined here.

## Verification (per CLAUDE.md — always confirm before reporting done)

1. `cd client && npm run build` must succeed (this is the compile gate — extensionless Vite imports can't be run under bare `node`). Also run `npm run lint` and fix any unused-import / hook-deps warnings you introduce.
2. If the dev server is running, confirm `http://localhost:5173/` still serves `200` with an `Accept: text/html` header.
3. Report honestly which spec features are fully implemented vs. simplified.
4. **Do NOT auto-run Playwright / any browser automation** to test — this project has a HARD STOP on that until the user explicitly permits it. Verify via build + lint only.

---

# Technical & design specification

Build to this spec exactly. Where a number is given, use it as a named constant.

## 1. Physical constants (single config object)

```js
// Millimeters. Two selectable instruments so the user can compare stretch.
const INSTRUMENTS = {
  classical: {
    label: 'Classical (4/4)',
    scaleLength: 650,      // mm, nut → bridge (saddle)
    nutWidth: 52,          // mm, physical neck width at nut
    twelfthWidth: 62,      // mm, physical neck width at the 12th fret
    nutStringSpan: 43,     // mm, low-E → high-E center-to-center at the nut
    bridgeStringSpan: 50,  // mm, low-E → high-E span down the neck (at/after 12th)
  },
  electric: {
    label: 'Electric / Acoustic',
    scaleLength: 648,      // mm (25.5")
    nutWidth: 43,          // mm (narrower neck)
    twelfthWidth: 54,
    nutStringSpan: 35,     // typical electric E-to-E at nut
    bridgeStringSpan: 52,
  },
};
const FRETS = 15;          // render nut (0) → fret 15; 12 is acceptable if layout is tight
const STRINGS = 6;         // E6(low) A D G B E1(high)
```

## 2. Fret-position math (Rule of 18 / equal temperament)

- Distance from the nut to the **fret wire** n along the scale:
  `d(n) = scaleLength * (1 - 1 / Math.pow(2, n / 12))`. (This is the standard 17.817 rule; fret 12 lands at exactly half the scale length — verify `d(12) ≈ scaleLength/2`.)
- The playable spot for a note is the **middle of the fret bracket**, i.e. the midpoint between the (n-1) and n fret wires: `xMm(n) = (d(n-1) + d(n)) / 2` for n≥1; open string (n=0) sits at the nut, `xMm(0) = 0`.
- **Neck taper:** neck half-width grows linearly with x from `nutWidth/2` at x=0 to `twelfthWidth/2` at `x = d(12)`, extrapolated beyond 12. The **string span** at a given x tapers likewise from `nutStringSpan` to `bridgeStringSpan`. String i (0=low E … 5=high e) sits at `yMm(i, x) = center - span(x)/2 + i * span(x)/5`.
- `getCoordinates(stringIndex, fretIndex)` → `{ xMm, yMm }` in physical mm from the top-left origin at the nut, using the two functions above. **This is the one function every distance and every SVG dot position must go through** — do not compute geometry two different ways.

## 3. Distance & interval engine

Given two active nodes A and B (each `{string, fret}`), compute from their `getCoordinates`:
- **Diagonal reach** = `Math.hypot(bx-ax, by-ay)` mm (Euclidean straight-line).
- **Horizontal span** = `|bx - ax|` mm (along the neck).
- **Vertical span** = `|by - ay|` mm (across the strings).
- With **3+ nodes**, the headline "Cumulative Diagonal Reach" is the max pairwise diagonal (the two furthest-apart fingers); also show the horizontal/vertical span of that furthest pair.
- **Musical interval:** semitone gap between the two notes' MIDI numbers (`OPEN_MIDI[string] + fret`, with `OPEN_MIDI = [40,45,50,55,59,64]` for E2 A2 D3 G3 B3 E4). Map the absolute semitone distance mod 12 (and note the octave count) to a name: 0 Unison, 1 minor 2nd, 2 Major 2nd, 3 minor 3rd, 4 Major 3rd, 5 Perfect 4th, 6 Tritone, 7 Perfect 5th, 8 minor 6th, 9 Major 6th, 10 minor 7th, 11 Major 7th, 12 Octave (append "+N oct" when >12).

## 4. Interactive features

- **Multi-node selection:** click a string×fret intersection to toggle a finger node. Auto-label nodes 1,2,3,4 in placement order (allow a "custom/none" label). Clicking an active node removes it. Cap suggested at 4–6.
- **Vector lines:** when ≥2 nodes are active, draw clean colored **dashed** SVG lines between nodes (e.g. connect them in placement order, and highlight the furthest pair used for the headline reach).
- **Presets** (instant-load a node set): at minimum "C Major (open)", "G Major (open)", "F Barre", "Perfect 5th interval", "Octave (adjacent strings)". Each preset is an array of `{string, fret}`. Use the app's `EADGBe` / string-0=low-E convention. Preset chord *names* get the `ChordTip` hover tooltip (CLAUDE.md rule).

## 5. Controls panel

- **Node label toggle:** Note names (C, D#, …) / Fret numbers / Frequency (Hz, from `440 * 2^((midi-69)/12)`).
- **Custom distance tool:** pick Point A and Point B explicitly → show the physical stretch and a **strain rating** bucketed by span: Small hands `< 180mm`, Average `180–210mm`, Large `> 210mm` (state which bucket comfortably covers this stretch, and flag when it exceeds ~210mm as a hard stretch).
- **Instrument toggle / compare:** switch classical ⇄ electric, and offer a side-by-side compare showing the SAME node set's diagonal reach on both instruments so the user sees the mm difference the narrower neck / shorter scale makes.

## 6. UI / UX (Tailwind)

- Dark, sophisticated theme (slate/zinc) with warm wood accents (amber/orange) evoking a classical guitar. Match the app's existing Tailwind tokens/utility style; reuse CSS variables where the app defines them.
- Layout: main fretboard SVG on top (horizontal, tapered, nut on the left), metrics card + presets/controls panel below. Responsive; the SVG uses a `viewBox` in mm so it scales cleanly (`preserveAspectRatio`).
- String rendering: 6 strings with **stroke-width proportional to gauge** — low E thickest, high e thinnest (e.g. widths ~[2.6, 2.2, 1.8, 1.4, 1.1, 0.9]). Fret wires and the nut drawn from the same `d(n)` math. Smooth transitions when nodes are placed/moved (CSS transitions on dot position/opacity).
- Accessibility: nodes are real `<button>`/keyboard-focusable elements with `aria-label`s naming the note; distance readouts live in text, not only color.

---

# Deliverables checklist

- [ ] `client/src/components/FretboardMeasures.jsx` implementing all of §1–§6, self-contained, using the constants verbatim.
- [ ] `getCoordinates` is the single source of geometry (dots + every distance derive from it); `d(12) ≈ scaleLength/2` verified.
- [ ] App.jsx tab (`fbmeasure`, side-menu) + `TAB_HELP` line + render; `tabFretboardMeasures` added to i18n English.
- [ ] Preset chord names wrapped in `ChordTip` (chord-hover rule).
- [ ] `npm run build` + `npm run lint` clean; report which features are complete vs. simplified. No browser automation.
