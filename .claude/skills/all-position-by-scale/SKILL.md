---
name: all-position-by-scale
description: Generates a self-contained interactive "Guitar Scale Position & Mode Map Generator" React component — dynamically computes and draws EVERY position/shape of a scale (Minor/Major Pentatonic, Dorian, Aeolian, Ionian, Mixolydian) across the whole fretboard in any key, as CAGED box shapes (5 positions) or 3-notes-per-string (7 positions), with root/interval highlighting, an active-position window that dims the rest of the neck, note-name↔interval and note-solo toggles, a classical(52mm)↔electric(43mm) neck-width aspect toggle, and a theory sidebar (spelling, step formula, position character).
disable-model-invocation: false
user-invocable: true
---

# Role and objective

You are a **principal frontend engineer and music theorist**. When invoked, produce a single, highly-polished, interactive React component — the **Interactive Guitar Scale Position & Mode Map Generator** — and wire it into the app as its own tab so the user can open it.

The component dynamically calculates and displays **every shape/position** of a scale (Pentatonic, Diatonic, or Modal) across the entire fretboard, letting a guitarist see how the positions interlock. It is **self-contained** in its music theory (it carries the interval database below) but **reuses the app's shared physical geometry** for the neck-width toggle. Styling is **Tailwind CSS** (the app's system) with **inline SVG** for the fretboard. **Lucide icons:** the app does not currently bundle `lucide-react`; the spec asks for Lucide, so **add `lucide-react` as a dependency** (`cd client && npm install lucide-react`) and import the handful of icons you use — this is the one dependency this skill is allowed to add. If the install fails for any reason, fall back to inline emoji/SVG glyphs and say so in the report.

## Where it goes in this project (reuse-first)

- Component file: **`client/src/components/ScalePositionMap.jsx`**.
- Mount it as a tab in [client/src/App.jsx](client/src/App.jsx): add to `getTabs(tr)` an entry `{ id: 'scalemap', label: tr.tabScaleMap || 'Scale Map', icon: '🗺️', side: true }` (side-menu, the same `side: true` shape as `scale`/`levelplan`), add a `TAB_HELP.scalemap` one-liner, and render `{activeTab === 'scalemap' && <ScalePositionMap lang={lang} />}`.
- Reuse `useT(lang)` / the `tr.key || 'English default'` fallback pattern exactly like every other component. Add only `tabScaleMap` (English) to [client/src/lib/i18n.js](client/src/lib/i18n.js); leave the other 9 languages to fall back. Any other user-facing copy uses the same `tr.x || '...'` pattern.

## Reuse these existing modules (import — do NOT reinvent)

- **Neck geometry / instrument widths** — [client/src/lib/geometry.js](client/src/lib/geometry.js):
  - `INSTRUMENTS` (has `classical` nutWidth **52**, `electric` nutWidth **43** — the spec's two nut widths), `makeGeometry(inst)` → `{ coord(string, fret) }`, and `fretWireMm`. Use `coord()`/`fretWireMm` so the fretboard's fret spacing and the classical↔electric vertical string-span both come from the ONE shared geometry (never hand-roll a second geometry).
- **Note/pitch constants** — re-export or mirror from [client/src/components/GuitarStrings.jsx](client/src/components/GuitarStrings.jsx) (already `export`ed there):
  - `NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']`, `OPEN_MIDI = [40,45,50,55,59,64]` (E2 A2 D3 G3 B3 E4). Prefer importing these from `GuitarStrings.jsx` over redefining. **String index 0 = low E … 5 = high e** (the app-wide convention — keep it).
- **Chord-hover rule (CLAUDE.md):** the fretboard note dots are the scale shape and are exempt. BUT the theory sidebar's "chord-tonal targets" line names **chords** (e.g. "target the Am / C / Em tones"). Every chord *name* rendered there MUST show its shape on hover via [client/src/components/ChordTip.jsx](client/src/components/ChordTip.jsx) — wrap those names in `<ChordTip name="Am">…</ChordTip>`. If a target chord isn't in `chords.js`, add a playable voicing to it (CLAUDE.md chord-library rule).

## Verification (per CLAUDE.md — always confirm before reporting done)

1. `cd client && npm run build` must succeed — this is the compile gate (extensionless Vite imports can't run under bare `node`). Also run `npm run lint` and fix any unused-import / hook-deps warnings you introduce (note: if `npm run lint` is unavailable in the environment, say so and rely on `npm run build`).
2. If the dev server is running, confirm `http://localhost:5173/` still serves `200` with an `Accept: text/html` header.
3. Spot-check the theory math by hand for one case: **A Dorian** must spell `A B C D E F# G` with steps `W H W W W H W`; **A minor pentatonic** position 1 must start at fret 5 on the low E. If the generator disagrees, fix the generator.
4. Report honestly which spec features are fully implemented vs. simplified.
5. **Do NOT auto-run Playwright / any browser automation** — HARD STOP until the user explicitly permits it. Verify via build + lint + the hand spot-check only.

---

# Technical & design specification

Build to this spec exactly. Where a number is given, use it as a named constant.

## 1. Scale engine data structure

```js
// Semitones from the root. label + degree spelling drive the sidebar & interval labels.
const SCALES = {
  minorPentatonic: { label: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10],        degrees: ['1','b3','4','5','b7'],            system: 'pentatonic' },
  majorPentatonic: { label: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9],         degrees: ['1','2','3','5','6'],              system: 'pentatonic' },
  dorian:          { label: 'Dorian',           intervals: [0, 2, 3, 5, 7, 9, 10],  degrees: ['1','2','b3','4','5','6','b7'],     system: 'diatonic' },
  aeolian:         { label: 'Natural Minor',    intervals: [0, 2, 3, 5, 7, 8, 10],  degrees: ['1','2','b3','4','5','b6','b7'],    system: 'diatonic' },
  ionian:          { label: 'Major',            intervals: [0, 2, 4, 5, 7, 9, 11],  degrees: ['1','2','3','4','5','6','7'],       system: 'diatonic' },
  mixolydian:      { label: 'Mixolydian',       intervals: [0, 2, 4, 5, 7, 9, 10],  degrees: ['1','2','3','4','5','6','b7'],      system: 'diatonic' },
};
const ROOTS = ['A','A#','B','C','C#','D','D#','E','F','F#','G','G#']; // selectable key (use NOTE_NAMES pc indexing under the hood)
const TUNING_MIDI = [40, 45, 50, 55, 59, 64]; // = OPEN_MIDI; string 0 = low E … 5 = high e
const FRETS = 17;   // render fret 0 (nut) → 17
const STRINGS = 6;
```

- The set of pitch classes in the scale = `intervals.map(i => (rootPc + i) % 12)`. A fret's pitch class = `(TUNING_MIDI[string] + fret) % 12`. A fret is **in scale** when its pc is in that set; it is a **root** when its pc === rootPc.
- Degree label for an in-scale note = the `degrees[k]` whose interval matches `((TUNING_MIDI[string]+fret) - rootPc) mod 12`.

## 2. The positions generator (the heart of the tool)

Two systems, chosen by a **Layout** toggle. For diatonic/modal scales BOTH are offered; for pentatonic only the 5-box system applies (hide the 3-NPS toggle, or disable it, when a pentatonic scale is selected).

- **Pentatonic — 5 CAGED box positions.** The canonical 5 interlocking boxes. Anchor Position 1 at the root on the low-E string: find the lowest fret ≥ 0 on string 0 whose pc === rootPc (wrap to the 12-fret-higher octave if needed to stay on the neck), and lay the 5 boxes ascending from there. Each position spans ~4 frets across all 6 strings. Represent a position as the concrete set of `{string, fret}` scale notes that fall inside that position's fret window on each string (the standard 2-notes-per-string pentatonic fingering).
- **Diatonic/Modal — CAGED box shapes (5 positions).** Same anchoring idea as pentatonic but with the full 7-note scale; ~4–5 fret windows that overlap by shared notes.
- **Diatonic/Modal — 3-notes-per-string (7 positions).** The 7 three-note-per-string shapes, one per scale degree as the starting note on the low-E string. Each position = exactly 3 scale notes on every string (18 notes), climbing the neck. Position k starts from the k-th scale degree.
- For **each** position, compute its active fret range **dynamically from the chosen key** (e.g. Am pentatonic Position 1 ⇒ frets 5–8; C major Position 1 shifts accordingly). Expose `position.minFret` / `position.maxFret` and the concrete note list. Positions must recompute whenever key, scale, or layout changes (derive them with `useMemo`).

> Implementation guidance: generate positions algorithmically from the interval set + tuning — do NOT hardcode per-key fret tables. A robust approach: walk each string, collect in-scale frets in a rolling window; for 3-NPS pick exactly the 3 consecutive scale tones per string starting from the position's degree; for boxes, slice the neck into overlapping ~4-fret windows anchored at each root/box start. Verify against the A-minor-pentatonic-fret-5 and A-Dorian spot-checks in Verification.

## 3. Fretboard rendering component (inline SVG)

- Horizontal fretboard, **nut on the left**, frets 0 → 17. Use `fretWireMm`/`makeGeometry(inst).coord()` from `geometry.js` for fret x-spacing and per-string y so spacing is physically real (higher frets visibly tighter) and the **neck-width toggle** changes the vertical string span (classical 52mm nut ⇒ taller/wider spacing, electric 43mm ⇒ tighter). Drive the SVG with a mm `viewBox` + `preserveAspectRatio` so it scales cleanly.
- Draw: nut (thick), fret wires, 6 strings (stroke-width proportional to gauge, low-E thickest ~2.6 → high-e thinnest ~0.9), and standard **fret markers** (single dot 3/5/7/9, double dot 12, and 15/17).
- For every string×fret with an in-scale pc, render a note dot:
  - **Root notes** — distinct emerald/teal fill, bold ring/outline, label **"R"** (or the root note name). Highest visual priority.
  - **Regular scale notes** — amber/indigo fill, labeled by Note Name **or** Interval Degree per the toggle.
  - **Out-of-position notes** — when a single position is active, notes outside the active position render **dimmed/greyed** (low opacity) so the active box stands out; in "Show entire fretboard" mode all in-scale notes are shown at full strength but the active position still gets a highlighted translucent **window band** behind it.
- Notes are real keyboard-focusable `<button>`/`<g role="button">` elements with `aria-label` naming string+fret+note+degree. Smooth CSS transitions on opacity when the active position shifts.

## 4. User controls panel

- **Dropdowns:** Select Key (12 roots), Select Scale/Mode (the 6 scales), Select Layout (3-NPS ⇄ CAGED Box) — Layout disabled/hidden for pentatonic.
- **Interactive Position Selector:** a horizontal step-indicator / tab row labeled **"Position 1 … Position 5"** (or "… Position 7" in 3-NPS). Clicking a position instantly shifts the highlighted active window on the fretboard (state: `activePosition`). Include a "◀ / ▶" stepper and an "All positions" option that lights every position.
- **Show/Hide toggles:**
  - Note **Names** (A, C, D) ⇄ Interval **Degrees** (1, b3, 4).
  - **"Show entire fretboard"** ⇄ **"Solo active position only"** (the latter hides out-of-position notes entirely rather than just dimming them).
  - **Neck width**: Classical (52 mm) ⇄ Electric/Acoustic (43 mm) — a toggle or slider that **dynamically changes the fretboard's vertical aspect ratio** via the geometry instrument. Label it with the mm value.

## 5. Theory guide panel (below the fretboard)

- **Scale spelling** for the current key+scale, spelled with correct letter names (e.g. "A Dorian: A – B – C – D – E – F# – G"). Derive note names from `NOTE_NAMES` by pitch class; sharps are acceptable (enharmonic-perfect spelling is a nice-to-have, not required — if you keep it simple, say so).
- **Step formula** — the W/H (whole/half) pattern between consecutive scale tones (e.g. Major = "W W H W W W H"; Dorian = "W H W W W H W"). Compute from the interval gaps (2⇒W, 1⇒H).
- **Current position character** — a short description of the active position's sonic role and its **chord-tonal targets** (which chord tones/arpeggio to lean on over that box). Any chord *name* here is wrapped in `<ChordTip>` (chord-hover rule).

## 6. Design style & UI (Tailwind)

- **Theme:** clean modern dark mode — `slate-900` background, high-contrast premium palette: **Emerald/Teal for roots**, **Amber/Indigo for other scale tones**, muted slate for out-of-position/dimmed notes. Match the app's existing Tailwind tokens/CSS variables where defined.
- **Responsiveness:** the horizontal fretboard must stay readable on small screens — wrap it in an `overflow-x-auto` container (horizontal scroll) and/or let the mm-`viewBox` SVG scale down cleanly. Controls reflow to stack on narrow widths. No horizontal scroll on the page body itself — only inside the fretboard's own scroller.
- Lucide icons (if installed) for control affordances (e.g. `Music`, `Guitar`, `ChevronLeft/Right`, `Eye`/`EyeOff`, `Ruler`); otherwise emoji fallbacks.

---

# Deliverables checklist

- [ ] `client/src/components/ScalePositionMap.jsx` implementing all of §1–§6, with the `SCALES` database verbatim, positions generated **algorithmically** (no per-key hardcoded fret tables).
- [ ] Geometry (fret spacing + classical/electric string span) comes from `geometry.js` (`makeGeometry`/`fretWireMm`/`INSTRUMENTS`); note pcs from `NOTE_NAMES`/`OPEN_MIDI`. No second geometry, no re-declared note table if it can be imported.
- [ ] Both position systems work: pentatonic 5-box; diatonic/modal 5-box AND 7×3-NPS via the Layout toggle. Active-position window dims/solos the rest of the neck. Position tabs/stepper shift it live.
- [ ] Name⇄Degree toggle, Entire⇄Solo toggle, and Classical(52mm)⇄Electric(43mm) width toggle all functional; width toggle visibly changes vertical aspect.
- [ ] Theory panel: spelling + W/H formula + position character; any chord name wrapped in `ChordTip`; missing target chords added to `chords.js`.
- [ ] App.jsx tab (`scalemap`, side-menu) + `TAB_HELP.scalemap` + render; `tabScaleMap` added to i18n English. `lucide-react` installed (or documented fallback).
- [ ] `npm run build` (+ `npm run lint` if available) clean; A-Dorian spelling and Am-pentatonic-fret-5 spot-checks pass; report complete-vs-simplified honestly. **No browser automation.**
