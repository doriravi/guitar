# Editor — Fretboard / Reach Transform Spec

Domain: chord & reach transforms applied to a **marked section** of a song inside the new per-song Editor.
Author: Fretboard Expert. Status: SPEC ONLY (no feature code yet).

This spec is grounded in the real code under `client/src/lib`. Every reused function below was read
from source; signatures are quoted verbatim so the integration agent can call them as-is. **There is
already a working engine for all three transforms** in `upperVoicings.js`, `triadVoicings.js`,
`substitutions.js`, and `lyricChords.js` — the Editor transforms are thin per-selection wrappers over
these, not new physics.

---

## 0. Shared data model & contracts

### 0.1 Note / voicing shapes (from `chords.js`, used everywhere)
```
note    = { string: 0..5, fret: 0..22 }     // string 0 = low E … 5 = high e
voicing = { name, type, notes: note[], tab: "EADGBe", score }   // score = raw calcDifficulty
```
`tab` is the 6-char `EADGBe` convention (`x`=muted, `0`=open). `upperVoicings`/`triadVoicings`
already emit `tab` via their private `notesToTab(notes)` helper, so any generated voicing matches the
static-library shape and renders in `FretboardDiagram` unchanged.

### 0.2 The marked selection — `MarkedChord[]`
The Editor marks a contiguous run of chords. From `ProgressionExplorer.jsx` (`songChordsWithVoicings`,
line ~608) the canonical per-chord object is `{ chordName, voicings, inProgression }`, where
`voicings = lookupVoicings(chordName).slice().sort((a,b)=>a.score-b.score)`. The transforms only need
the chord **name** plus its current best voicing, so the input contract is:

```js
/**
 * @typedef {Object} MarkedChord
 * @property {string}      chordName   e.g. "Bb", "F#m7", "G/B"
 * @property {voicing}     current     the voicing currently shown (voicings[0] = easiest)
 * @property {number}      index       position in the song (stable id for the UI to map results back)
 */
```
`marked: MarkedChord[]` is the slice the user highlighted (order preserved).

### 0.3 Scoring — `scoreFn` / before-after numbers (from `handProfile.js`)
All "reach number" displays use the personal scale. Build the scorer ONCE from the active profile and
pass it down — never bake `DEFAULT_PROFILE` in:

```js
import { calcDifficulty } from '../lib/fretboard';
import { personalDifficulty } from '../lib/handProfile';

const scoreFn = (notes) => personalDifficulty(calcDifficulty(notes), profile);
```
`profile` is the object from `useHandProfile()` (shape: `{ thumbToIndex, indexToMiddle, middleToRing,
ringToLittle }` in cm; `DEFAULT_PROFILE` is the logged-out default). `personalDifficulty(raw, profile)`
divides the raw 1–10 by `reachMultiplier(profile)` and clamps to 1–10, so a small hand sees a HIGHER
number for the same shape. **Every transform reports `personalScore`, not the raw `calcDifficulty`.**

### 0.4 Common result envelope
Each transform returns one entry per marked chord plus a roll-up:
```js
/**
 * @typedef {Object} ChordResult
 * @property {number}  index            // echoes MarkedChord.index
 * @property {string}  fromName         // original chord name
 * @property {voicing} fromVoicing      // original voicing (for before diagram)
 * @property {number}  fromScore        // personalDifficulty of fromVoicing
 * @property {string}  toName           // new chord name (may equal fromName)
 * @property {voicing|null} toVoicing   // null when no transform applies (see edge cases)
 * @property {number|null}  toScore     // personalDifficulty of toVoicing, or null
 * @property {number}  delta            // fromScore - toScore (>0 = easier; null toScore -> 0)
 * @property {boolean} changed          // true when a real replacement was produced
 * @property {string[]} warnings        // per-chord notes (see each transform)
 */
/**
 * @typedef {Object} TransformResult
 * @property {ChordResult[]} chords
 * @property {number}  beforeMax        // max fromScore over the selection
 * @property {number}  afterMax         // max toScore over the selection (toScore?? fromScore)
 * @property {number}  changedCount     // how many chords actually changed
 * @property {number|null} transitionBefore  // sum of transitionDifficulty over adjacent ORIGINAL pairs
 * @property {number|null} transitionAfter   // same over the NEW voicings (see §4)
 * @property {string[]} warnings        // selection-level warnings
 * }
 */
```
`beforeMax`/`afterMax` give the UI the headline "hardest reach 8.2 → 4.1" badge; the per-chord
`fromScore`/`toScore` drive before/after `DifficultyBadge`s on each diagram.

---

## 1. `transformMoveUpFrets(marked, profile, opts)` — "Move to upper frets"

Transpose the marked chords' VOICINGS up the neck as movable barre/CAGED shapes (open shapes → barre
forms higher up). Reuses the **existing** `upperVoicings.js` engine verbatim.

```js
/**
 * @param {MarkedChord[]} marked
 * @param {object} profile                       // hand profile for scoring
 * @param {object} [opts]
 * @param {number} [opts.minFret=1]              // forwarded to upperVoicing (MIN_UPPER_FRET)
 * @param {'barre'|'triad'} [opts.style='barre'] // barre = upperVoicing; triad = triadUpVoicing
 * @returns {TransformResult}
 */
```

**Reuses (read from source):**
- `upperVoicing(chordName, { minFret }) -> { name, shape:'E-shape'|'A-shape', barreFret, voicing }`
  (`upperVoicings.js:105`). `voicing` already has `{ name, type, notes, score, tab }`.
- `suggestUpperProgression(chords, opts) -> { perChord:(result|null)[], count }`
  (`upperVoicings.js:161`) — call this with `marked.map(m => ({ chordName: m.chordName }))` and you get
  the whole selection in one shot. **Prefer this** over looping `upperVoicing` yourself.
- When `opts.style === 'triad'`: `triadUpVoicing(chordName, { minFret, maxFret })`
  (`triadVoicings.js:78`) / `suggestTriadProgression(chords, opts)` (`triadVoicings.js:158`) — small
  3-note no-barre grips for hands that can't barre at all (high relevance for the short-finger user).
- Scoring: build each `toScore = personalDifficulty(voicing.score, profile)`. (`voicing.score` is the
  raw `calcDifficulty`; do NOT show it directly — re-score for the profile, since a barre that is 5/10
  on average can be 8/10 for a small hand.)

**Per-chord mapping:** for `perChord[i]`:
- non-null → `toName = chordName`, `toVoicing = result.voicing`, `toScore = personalDifficulty(result.voicing.score, profile)`, `changed = true`.
- null → `toVoicing = null`, `toScore = null`, `changed = false`, push warning (see edges).

**Edge cases (all real, from the engine source):**
- **No clean movable template** — `templateQuality(suffix)` returns `null` for dim / m7b5 / aug
  (`upperVoicings.js:49-61`). Result is null → warn `"No movable barre shape for {chordName}; left unchanged."`
  Fallback: try `opts.style:'triad'` (triadVoicings covers dim/aug via `triadIntervals`).
- **Already high / would exceed neck** — `upperVoicing` skips any candidate whose top fret > `MAX_FRET`
  (9) (`upperVoicings.js:122-123`). If both E/A shapes exceed it → null → warn `"{chordName} can't move
  higher without leaving the playable region (fret > 9)."`
- **Open root maps to fret 0** — `barreFretForRoot` bumps R to 12 / `while (R < minFret) R += 12`
  (`:85, :120`); already handled, no warning needed, but it can land the shape near fret 12 making
  `toScore` HARDER than `fromScore`. Surface this: if `delta < 0`, warn `"Moving {chordName} up the neck
  increases reach for your hand."` — never silently make it worse.
- **Slash chords** (`G/B`): `parseChord` keeps the suffix `/B`, `templateQuality('/B')` → null → no
  barre. Treat as "no movable shape" (triad engine strips the slash and can still voice the triad).

---

## 2. `transformEasierVoicings(marked, profile, opts)` — "Easier voicings / reduce reach"

Find lower-reach alternatives for the marked chords for the short-finger / low-flexibility user.
Two complementary sources, both already in the repo:

```js
/**
 * @param {MarkedChord[]} marked
 * @param {object} profile
 * @param {object} [opts]
 * @param {boolean} [opts.allowQualityChange=true] // permit triad/power substitution (changes harmony)
 * @param {number}  [opts.minGain=1]               // min 1-10 improvement to suggest a same-name voicing
 * @param {number}  [opts.minSaving=0.6]           // forwarded to easierSubstitute
 * @returns {TransformResult}
 */
```

**Reuses (read from source):**
- `findEasierVoicings(chord, scoreFn, { minGain, limit }) -> Array<{ chord, score, exact }>`
  (`chords.js:353`). **Same root + same/related quality family** (`FAMILY_RANK`), ranked easiest-first,
  `exact` flags a same-quality match. `chord` arg must be `{ name, notes }`; pass
  `{ name: m.chordName, notes: m.current.notes }`. `scoreFn` = the §0.3 closure → results are already
  personalized. This is the SAFE, harmony-preserving path (e.g. barre `Cmaj7` → open `Cmaj7`/`C`).
- `easierSubstitute(chordName, profile, opts) -> { original, substitute, saved } | null`
  (`substitutions.js:86`) and `suggestEasierProgression(chords, profile, opts)` (`:145`). This is the
  more aggressive path: simplify extension → triad, then power-chord fallback (`kind:'simplified'|'power'`).
  It already scores with `personalDifficulty` internally and only returns a hit when meaningfully easier.

**Selection algorithm per chord:**
1. Run `findEasierVoicings` first (preserves the exact chord name when possible). If it returns a hit,
   take rank-0: `toName = hit.chord.name`, `toVoicing = { ...hit.chord, score: calcDifficulty(hit.chord.notes), tab: hit.chord.tab }`, `toScore = hit.score`.
2. If empty AND `opts.allowQualityChange`, fall back to `easierSubstitute`. On a hit:
   `toName = res.substitute.name`, `toVoicing = res.substitute.voicing`, `toScore = res.substitute.personalScore`,
   warn `kind === 'power' ? "Simplified {from} to power chord {to} — drops the 3rd." : "Substituted {from} → {to}."`
3. Neither → `changed = false`, `toVoicing = null`, warn `"{chordName} is already easy for your hand — no simpler voicing found."`

**Edge cases:**
- **Already easy** — both engines return empty when nothing beats the current shape by `minGain`/`minSaving`.
  Not an error; mark `changed:false` and report it (so the UI can grey the chord, not hide it).
- **No same-root library entry** — `findEasierVoicings` returns `[]` (filtered by `p.root === parsed.root`).
  Falls through to substitution; if that also fails, unchanged.
- **Harmony drift** — power-chord fallback changes the chord color. Gate behind `opts.allowQualityChange`
  and always emit the warning so the integration agent can show a "changes the sound" tag.
- **Custom / non-parseable name** — `parseChordName`/`parseChord` return null for anything not starting
  with `A–G`. Skip cleanly with warning `"Couldn't parse chord {chordName}."`

---

## 3. `transformCapoSuggestion(marked, profile, opts)` — "Capo suggestion"

Restate hard-key chords (B♭/E♭/F♯/B…) as easy OPEN shapes behind a capo. This transform is
**selection-wide** (one capo for the whole marked run), unlike §1/§2 which are per-chord.

```js
/**
 * @param {MarkedChord[]} marked
 * @param {object} profile
 * @returns {CapoResult}
 *
 * @typedef {Object} CapoResult
 * @property {number|null} fret              // capo fret 1..5, or null if no capo helps
 * @property {ChordResult[]} chords          // per-chord: fromName -> toName (the shape you fret)
 * @property {Record<string,string>} map     // { originalName: shapeName } straight from suggestCapo
 * @property {number} beforeMax              // hardest personal score WITHOUT capo (real fretted shape)
 * @property {number} afterMax               // hardest personal score of the capo SHAPES
 * @property {string[]} warnings
 */
```

**Reuses (read from source):**
- `suggestCapo(chordNames) -> null | { fret:number, map:Record<string,string> }`
  (`lyricChords.js:73`). Pass `marked.map(m => m.chordName)`. It tries capo frets 1–5, transposes each
  chord DOWN by the capo amount (`transposeDown`), and picks the lowest fret that maximizes chords
  landing on an easy open root (`EASY_OPEN_ROOTS = C A G E D`). Returns null when the song is already
  all-easy or no capo helps. **Do not reimplement the capo math — call this.**
- `lookupVoicings(shapeName)` (pattern in `ProgressionExplorer.jsx:37`) — to get the actual open-shape
  notes for each `map[original]` value so we can score and diagram it. Reuse the component's
  `CHORD_MAP`/`lookupVoicings` (consider lifting it into a shared lib so the Editor can import it
  instead of duplicating).

**Scoring nuance (important):** with a capo at fret F, the player frets an OPEN shape but the sounding
pitch is F semitones higher. For REACH, what matters is the shape under the fingers, so
`toScore = scoreFn(lookupVoicings(shapeName)[0].notes)` — the open shape's reach, NOT the transposed
pitch. `beforeMax` uses the original (hard, barre) voicing's notes. The capo strap itself adds no
finger-reach cost in our model, so the open-shape score stands.

**Per-chord mapping:** for each `m`, `shapeName = map[m.chordName]`. `toName = shapeName`,
`toVoicing = lookupVoicings(shapeName)[0]`, `toScore = scoreFn(toVoicing.notes)`,
`changed = (shapeName !== m.chordName)`.

**Edge cases:**
- **No benefit** — `suggestCapo` returns null (already easy, or no fret 1–5 improves on open). Result
  `fret:null, chords:[] , warnings:["No capo improves this section — the chords are already open-friendly."]`.
- **Partial win** — `suggestCapo` may pick a fret where only SOME chords land on easy roots
  (`best.cnt < names.length`). Per chord, if its shape is still not in `EASY_OPEN_ROOTS`, warn
  `"With capo {fret}, {chordName} still needs a barre shape ({shapeName})."` (the UI can show which
  chords remain hard).
- **Shape not in library** — if `lookupVoicings(shapeName)` is empty (rare, e.g. a transposed slash
  chord whose open form isn't catalogued), fall back to `toScore = null`, `changed:false`, warn.
- **Capo > 5** — `suggestCapo` caps the search at fret 5 by design (higher capos crowd the hand);
  nothing to do, it simply won't return those.

---

## 4. Transition cost (cross-cutting, optional but recommended)

The app treats CHORD CHANGES as the real difficulty (CLAUDE.md). After any transform changes voicings,
recompute the adjacent-pair transition cost so the UI can warn if "easier shapes" made the *changes*
harder (e.g. jumping between high barres). Reuse:

- `transitionDifficulty(notesA, notesB) -> 1..10` (`fretboard.js:195`). Sum over adjacent pairs in the
  selection: `transitionBefore = Σ transitionDifficulty(marked[i].current.notes, marked[i+1].current.notes)`,
  `transitionAfter = Σ transitionDifficulty(toVoicing[i].notes, toVoicing[i+1].notes)` (skip pairs where
  either `toVoicing` is null, falling back to the original notes). If `transitionAfter > transitionBefore`,
  add selection warning `"New voicings reduce per-chord reach but make the changes between them harder."`
- `optimalFingering(notes)` (`fretboard.js:119`) is available if the UI wants to label barres / fingers
  on each diagram; `transitionDifficulty` already calls it internally for the barre-anchor discount.

---

## 5. Implementation notes for the integration agent
- Put the three `transform*` functions in a new `client/src/lib/editorTransforms.js`; they are pure
  (no React). They import only from `fretboard.js`, `chords.js`, `handProfile.js`, `upperVoicings.js`,
  `triadVoicings.js`, `substitutions.js`, `lyricChords.js`.
- `lookupVoicings` currently lives INSIDE `ProgressionExplorer.jsx` (line 37) over a module-level
  `CHORD_MAP`. The Editor needs it too — lift `lookupVoicings`/`CHORD_MAP` into a small shared module
  (e.g. `lib/voicingLookup.js`) and import from both, rather than duplicating.
- All three transforms must accept the SAME `profile` and produce `personalScore`-based numbers so the
  before/after badges are consistent across the three buttons.
- None of these transforms mutate the song; they return proposed `ChordResult[]`. Applying a result
  (writing it back into the song's chords/voicings) is the integration agent's job.

---

## 10-line contract summary (for the integration agent)
1. `transformMoveUpFrets(marked, profile, opts?) -> TransformResult` — reuses `suggestUpperProgression`/`upperVoicing` (and `triadUpVoicing` when `opts.style:'triad'`).
2. `transformEasierVoicings(marked, profile, opts?) -> TransformResult` — reuses `findEasierVoicings` first, then `easierSubstitute`/`suggestEasierProgression`.
3. `transformCapoSuggestion(marked, profile) -> CapoResult` — reuses `suggestCapo`; selection-wide single capo fret 1–5 or null.
4. `MarkedChord = { chordName, current: voicing, index }`; `voicing = { name, type, notes:[{string,fret}], tab, score }`.
5. Score everything with `scoreFn = notes => personalDifficulty(calcDifficulty(notes), profile)` — report `personalScore`, never raw.
6. `ChordResult = { index, fromName, fromVoicing, fromScore, toName, toVoicing|null, toScore|null, delta, changed, warnings[] }`.
7. `TransformResult = { chords:ChordResult[], beforeMax, afterMax, changedCount, transitionBefore, transitionAfter, warnings[] }`.
8. Null `toVoicing`/`toScore` = transform didn't apply (no movable shape / already easy / unparseable); always carry a warning, never throw.
9. Edge cases handled by reused engines: dim/aug/m7b5 have no barre template (→null); MAX_FRET=9 cap; power-chord fallback gated by `opts.allowQualityChange`; `suggestCapo` may only partially help.
10. Optionally compute `transitionDifficulty` before/after over adjacent pairs to warn when easier static shapes make the CHANGES harder. Put transforms in pure `lib/editorTransforms.js`; lift `lookupVoicings` out of `ProgressionExplorer.jsx` into a shared module.
