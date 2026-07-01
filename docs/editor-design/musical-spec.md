# Song Editor — Musical / Expressive Transforms Design Spec

Owner: Musical Experience Expert. Status: spec only (no feature code).
Scope: the creative transforms (melody, rhythm, style), the editor UX, and audio preview.

This doc is grounded in the **real** existing APIs. Do not invent new audio/scale
signatures — everything below feeds the functions exactly as they exist today.

---

## 0. Grounding — the APIs we build on (verified against source)

### Audio (`client/src/lib/audio.js`)
```js
// Strum one voicing per 4 beats. Voicing MUST have a 6-char EADGBe `.tab`
// ('x'=muted, '0'=open, digit=fret).
playProgression(voicings /* [{tab:string}] */, bpm = 72, onChord?, onDone?)

// Free-timed note events. THIS is our melody/arpeggio/rhythm engine.
// string 0=low E … 5=high e ; fret >= 0 ; time & duration in SECONDS, clip-relative.
// Returns total playback duration in seconds.
playEvents(events /* [{string, fret, time, duration?}] */, onDone?)

stopAudio()        // silences ringing notes, KEEPS the AudioContext (iOS unlock)
unlockAudio()      // call once from a real tap before first playback (iOS)
```
Notes:
- `playProgression` is fixed-grid (4 beats/chord, hard-coded 16ms low→high strum). Good only for the **"before"** chord audition.
- `playEvents` is the workhorse for **every transform's "after"** — melody, arpeggios, custom strum subdivisions are all just `{string,fret,time,duration}` arrays.
- `pluck` amplitude is fixed (0.22 peak); there is no per-note velocity input. We model dynamics by **duration + omission** (see Rhythm), not loudness. (Future: add optional `gain` to `playEvents` — flagged below, out of scope.)

### Scales (`client/src/lib/scales.js`)
```js
ROOT_NOTES // ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']
MAJOR_ROMAN / MINOR_ROMAN
getDiatonicChords(root, scaleType /* 'major'|'minor' */)
  // -> [{ degree:0-6, roman, chordName }]   (7 entries)
```
`MAJOR_INTERVALS = [0,2,4,5,7,9,11]`, `MINOR_INTERVALS = [0,2,3,5,7,8,10]` (private,
but we replicate the scale-degree → semitone map locally in the transforms lib).

### Song shape (`client/src/lib/songs.js`)
```js
{ title, artist, key, scaleType:'major'|'minor',
  degrees:[int],        // 0-based diatonic degree indices, the chord sequence
  lineChords?:[int],    // per-line index INTO degrees (verse/chorus cycling)
  qualities?, chords?,  // explicit overrides
  lyricLines?:[{text, chordNames:[str]}],  // custom songs
  bpm? }
songBpm(title) -> number | undefined   // fallback default 100 in the component
```
Voicing objects (from `chords.js` via `lookupVoicings`): `{ name|chordName, type, tab, notes:[{string,fret}], score }`. `playProgression` only needs `.tab`.

### Existing AI proxy (the HYBRID precedent)
`server/.../HandAnalysisController.java`: `POST /api/analyze-hand {imageB64}` → strict
JSON, **503 when `GEMINI_API_KEY` unset**, fences stripped server-side. Frontend AI
calls all live in `client/src/lib/api.js` (`apiFetch`, `credentials:'include'`). The
`explain` helper there is the model to copy: **call AI, on any failure return `null`
and let the caller fall back to local output.**

---

## 1. Editor data model (shared by all transforms)

The editor operates on a **flattened chord timeline** derived from the song — the same
sequence `ProgressionExplorer` already builds for playback (`songPlaySequence` /
`songChordsWithVoicings`). One slot per chord beat-cell:

```js
// MarkedSection = a contiguous run the user selected
{
  start: int, end: int,         // inclusive indices into the chord timeline
  bpm: int,                     // song.bpm ?? songBpm(title) ?? 100
  key: string,                  // song.key e.g. 'C', 'A'
  scaleType: 'major'|'minor',
  chords: [                     // the marked cells, resolved
    { degree:int|null, chordName:string, roman:string,
      tab:string, notes:[{string,fret}],   // chosen (easiest) voicing
      beats:int /* default 4, from playProgression's 4-beats/chord grid */ }
  ]
}
```
Every transform is a **pure function** `(MarkedSection, opts) -> TransformResult`:
```js
// TransformResult — directly auditionable AND re-insertable
{
  kind: 'melody'|'rhythm'|'style',
  events: [{string, fret, time, duration}],   // FEEDS playEvents() verbatim
  // optional richer payloads for re-skin / persistence:
  voicings?: [{chordName, tab}],              // FEEDS playProgression() (style re-skin)
  meta: { label, source:'local'|'ai', seed?, patternId?, presetId? }
}
```
`time` is seconds from section start: `secPerBeat = 60/bpm`. Cell *i* starts at
`offsetBeats(i) * secPerBeat`.

---

## 2. Transform 1 — New Melody / Lead Line

Generate a singable lead line over the marked chords, locked to the song's key/scale and
chord tones. Local rule-based by default; optional AI enrichment.

### Signature
```js
// PURE. Returns events for playEvents() (melody plays on top of / instead of the chords).
transformAddMelody(markedSection, opts) -> TransformResult
opts = {
  density: 'sparse'|'medium'|'busy',   // notes per beat: 0.5 / 1 / 2   (default 'medium')
  contour: 'arch'|'ascending'|'descending'|'wave'|'static',  // default 'arch'
  range: { lowString:int=2, highFret:int=12 },  // keep it singable / mid-neck
  rhythm: 'straight'|'syncopated'|'dotted',     // default 'straight'
  restProb: number=0.15,               // chance a slot is a rest (breathing room)
  seed: number,                        // deterministic; reroll = new seed
  useAI: false,                        // when true, enrich via Gemini (see §5)
}
```

### Local rule engine (deterministic, seeded)
1. Build the **scale pool**: from `markedSection.key` + `scaleType`, compute the 7
   scale semitones (replicate `MAJOR_INTERVALS`/`MINOR_INTERVALS`). Map each to the
   nearest fretboard `{string,fret}` inside `opts.range` → candidate note set.
2. For each chord cell, get its **chord tones** via `getDiatonicChords` + triad
   intervals (root/3rd/5th). These are "strong" landing notes.
3. **Per beat-slot** (count = `beats * densityFactor`):
   - On strong beats (beat 1 & 3): pick a **chord tone** of the current chord.
   - On weak beats: pick a scale tone, biased toward stepwise motion from the previous
     note (passing/neighbor tones). Avoid leaps > a 4th unless `contour` demands it.
   - Apply `contour` as a target pitch envelope across the section (arch = rise to
     midpoint then fall); choose the candidate nearest the envelope target.
   - `restProb` → emit no event for that slot (a rest).
4. **Phrase ending**: last note of the section resolves to a chord tone of the final
   chord (prefer root or 3rd) — gives a sense of cadence.
5. Emit `events:[{string,fret,time,duration}]`. `duration = slotSeconds * 0.9`
   (legato-ish, clamped to playEvents' 0.25–2.5 floor/ceiling). Seeded PRNG so the
   same seed reproduces the line; the "Reroll" button just bumps the seed.

Output is melody-only (single voice). The preview plays melody **over** a low-volume
chord bed (we re-run the chords through `playEvents` as block events; see §6).

### Where AI helps (hybrid)
Local rules guarantee in-key, in-time, resolves-correctly structure. AI is for
**open-ended musicality** the rules can't invent: motif development, call-and-response,
genre-idiomatic licks, tasteful chromatic approach notes. See §5 for the contract.

---

## 3. Transform 2 — Rhythm / Strumming Change

Re-pattern the marked section's chords with a new strum/picking feel. The **chords are
unchanged**; only *when* and *which strings* are struck changes.

### Pattern representation
A pattern is a **per-beat grid of strum/pick steps**, tempo-independent (resolved to
seconds at apply time):
```js
// RhythmPattern
{
  id: 'straight'|'syncopated'|'arpeggio'|'fingerstyle'|...,
  label: 'Straight 8ths',
  subdiv: 8,                  // steps per BAR (8 = eighth notes in 4/4)
  steps: [                    // length === subdiv
    // each step strikes the current chord's voicing; one of:
    { type:'strum', dir:'D'|'U', accent?:bool },       // strum across voicing strings
    { type:'pick',  strings:[int] },                   // pick specific string indices
    { type:'rest' },                                   // silence this step
  ],
}
```
Built-in patterns (data, ship 4–6 to start):
```
straight    : 8× {strum D}                       (down on every 8th)
syncopated  : D _ D U _ U D U   (the "DD-DUUDU" pop pattern; _ = rest/let-ring)
arpeggio    : pick bass then ascending chord tones, one string per step
fingerstyle : Travis-style — alternating bass (strings 0/1) + inner strings on offbeats
```
`subdiv` lets a pattern be 8ths, 16ths (subdiv 16), triplets (subdiv 12), etc.

### Signature
```js
// PURE. Expands each marked chord through the pattern → timed events.
transformRhythm(markedSection, opts) -> TransformResult
opts = {
  patternId: string,          // key into RHYTHM_PATTERNS
  feel: 'straight'|'swing',   // swing delays every other subdiv by ~33%
  intensity: 1,               // 0.5–1.5 multiplier on note duration (staccato↔legato)
}
```

### Expansion algorithm
For each chord cell (covers `beats` beats), tile the pattern across those beats:
- `stepSeconds = (60/bpm) * (4/subdiv)` (assuming 4/4); `swing` adds offset to odd steps.
- `strum` → emit one event per non-muted string of the voicing's tab, staggered ~12–16ms
  (reuse `playProgression`'s strum feel), `dir:'U'` reverses string order (high→low).
- `pick` → emit events only for the listed string indices that are non-muted in the tab.
- `rest` → emit nothing.
- `duration = stepSeconds * intensity`, clamped to playEvents bounds.
- `accent` → (until playEvents supports gain) modeled as slightly longer duration.

Result `events` feed `playEvents()` directly. This is the cleanest fit: the existing
`playProgression` cannot express subdivisions or fingerpicking — `playEvents` can.

---

## 4. Transform 3 — Style / Genre Re-skin

Reinterpret the section in a genre. A style preset is a **bundle** = voicing recipe +
rhythm pattern + feel/tempo nudges. It composes Transforms 2 (and optionally chord
re-voicing) under one button.

### Preset representation
```js
// StylePreset
{
  id: 'reggae'|'ballad'|'funk'|'bossa'|'folk'|...,
  label: 'Reggae',
  voicing: {
    // how to re-voice each chord for the genre
    extension: 'triad'|'7th'|'9th'|'add9'|'sus',   // chord-quality flavour
    register:  'open'|'mid'|'high',                 // preferred fret zone
    omitStrings?: [int],     // e.g. reggae often skips the low bass strings
  },
  rhythm:  'syncopated',      // a RhythmPattern id (reggae = upstroke offbeat "skank")
  bpmScale: 1.0,              // multiply section bpm (ballad ~0.7, funk ~1.0)
  feel:    'straight'|'swing',
}
```
Starter presets:
```
reggae  : triad, mid register, omit low E/A, OFFBEAT upstroke skank pattern, straight
ballad  : add9/sus open voicings, arpeggio pattern, bpmScale 0.7, legato
funk    : 7th/9th high register, 16th-note scratchy pick pattern (short durations), straight
bossa   : 7th mid, fingerstyle thumb-bass + chord stabs, swing-ish, bpmScale 0.85
folk    : triad open, Travis fingerstyle, straight
```

### Signature
```js
// PURE. Composes re-voicing + rhythm into both events (preview) and voicings (persist).
transformStyle(markedSection, opts) -> TransformResult
opts = { presetId: string, intensity?, useAI?: false }
```

### Algorithm
1. **Re-voice**: for each chord, derive the genre voicing — start from
   `getDiatonicChords`/`lookupVoicings`, apply `extension` (look up e.g. `G` → `Gmaj7`),
   filter to `register`, blank `omitStrings` (set those tab chars to `'x'`). Produces a
   new `tab` per cell.
2. **Re-rhythm**: feed the re-voiced cells + `preset.rhythm` through the *same
   `transformRhythm` expansion* (§3), at `bpm * bpmScale`, with `preset.feel`.
3. Return `{ events, voicings:[{chordName,tab}], meta:{presetId} }`. `events` →
   `playEvents` for preview; `voicings` → `playProgression` for a quick chord-only A/B
   and for writing back into the song.

### Where AI helps (hybrid)
Local presets give a solid, predictable genre skin. AI can **suggest a preset from a
free-text vibe** ("make it dreamy 80s") or propose voicing substitutions/borrowed chords
beyond the fixed table. AI returns the same `StylePreset` JSON shape, which we then run
through the **local** composer — so AI only chooses parameters, local code guarantees
playable output. See §5.

---

## 5. HYBRID boundary — local vs AI, and the AI contract

**Principle (mirrors `analyze-hand` + `explain`):** local rules always produce a valid,
in-key, playable result. AI is *optional enrichment*; on 503 / error / malformed JSON we
silently keep the local result. The user toggles "✨ AI ideas" per transform.

| Concern | LOCAL (always) | AI (optional) |
|---|---|---|
| In-key / in-time / resolves | ✅ guaranteed by rules | — |
| Playable `{string,fret}` events | ✅ generated locally | never trusted raw — see below |
| Melody motif / phrasing ideas | basic contour | richer call-response, idiomatic licks |
| Style param selection | fixed preset table | infer preset from free-text vibe |
| Chord substitutions | diatonic only | borrowed/secondary-dominant suggestions |

**Critical rule:** AI never returns raw `{string,fret,time}` we play directly (it would
hallucinate unplayable shapes). Instead **AI returns high-level musical intent** (scale
degrees, rhythmic pattern choice, preset params), and the **local composer renders it to
events** — same validation path as local generation. This keeps audio always-valid.

### New backend endpoint (one, parallels HandAnalysisController)
```
POST /api/compose
  body: {
    transform: 'melody'|'style',
    key, scaleType,
    chords: [{ roman, chordName }],   // the marked section, no fretboard data
    bars: int,
    vibe?: string                     // free text for style, optional for melody
  }
  -> 200 strict JSON (fences stripped server-side, like analyze-hand):
     melody: { degrees: [ {beat:number, degree:0-6, octave:-1|0|1, accent?:bool} ],
               notes_about_phrasing?: string }
     style : { preset: StylePreset, rationale?: string }
  -> 503 when GEMINI_API_KEY unset   (caller falls back to local)
```
Gemini prompt is fixed/server-side (same pattern as `SYSTEM_PROMPT`): "You are a guitar
composition assistant. Given key/scale and a chord sequence, return ONLY JSON … using
scale degrees 0–6 relative to the key, never raw fret numbers."

### Frontend API helper (add to `client/src/lib/api.js`, beside `explain`)
```js
export const compose = {
  get: (ctx) =>
    apiFetch('/api/compose', { method:'POST', body: JSON.stringify(ctx) })
      .then(r => r || null)
      .catch(() => null),     // any failure → null → caller uses local result
};
```
The transform fns accept the AI payload as `opts.aiHint`; when present they **render the
AI degrees/preset through the local engine** (so output is still validated/clamped).
`transformAddMelody`/`transformStyle` remain pure — the network call happens in the
component, which then re-invokes the pure fn with `aiHint`.

---

## 6. Audio preview — exactly how the result is auditioned

All previews use **`playEvents`** except the chord-only "before" which can use
`playProgression`. Flow on every preview button (call `unlockAudio()` once on the first
tap so iOS is unlocked):

```js
// BEFORE (original section, chord strums)
stopAudio();
playProgression(markedSection.chords.map(c => ({ tab: c.tab })),
                markedSection.bpm, onChord, () => setPlaying(false));

// AFTER (any transform result)
stopAudio();
playEvents(result.events, () => setPlaying(false));   // events = [{string,fret,time,duration}]

// MELODY-OVER-CHORDS (transform 1): merge a chord "bed" into the event stream
const bed = markedSection.chords.flatMap((c, i) =>
  tabToEvents(c.tab, /*time*/ i * beatsToSec, /*dur*/ c.beats * secPerBeat));
playEvents([...bed, ...result.events], () => setPlaying(false));
```
- `tabToEvents(tab, time, dur)` is a tiny local helper (mirrors `tabToNotes` in audio.js)
  mapping a tab + onset into `{string,fret,time,duration}` — needed because `playEvents`
  has no chord-block concept. (Bed plays at same fixed amplitude; acceptable for preview.)
- **A/B toggle**: a single segmented control flips the source array between
  `beforeEvents` and `result.events`; pressing play always `stopAudio()` first (it keeps
  the AudioContext, so iOS stays unlocked).
- **Loop**: on `onDone`, if loop is enabled, re-call the same play fn (the component owns
  a `loopRef`, exactly like `ProgressionExplorer` already does at line 161/169).
- Stop is `stopAudio()`; unmount cleanup runs `loopRef=false; stopAudio()`.

Limitation noted for integration: no per-note gain today → accents/dynamics are faked via
duration. A future `playEvents(events, onDone, {gain})` is the clean fix (out of scope).

---

## 7. Editor screen — wireframe (ASCII)

```
┌────────────────────────────────────────────────────────────────────────┐
│  ‹ Back     Editing: "Let It Be" — The Beatles        Key C major  73bpm │
├────────────────────────────────────────────────────────────────────────┤
│  TRANSFORMS  (act on the marked section)                                 │
│  ┌──────────────┐ ┌───────────────────┐ ┌─────────────────────────────┐ │
│  │ + New Melody │ │ ♫ Rhythm / Strum ▾│ │ 🎨 Style Re-skin ▾          │ │
│  └──────────────┘ └───────────────────┘ └─────────────────────────────┘ │
│   options strip (changes per active transform):                          │
│   density:[sparse|medium|busy]  contour:[arch▾]  [↻ Reroll]  [✨ AI ideas]│
├────────────────────────────────────────────────────────────────────────┤
│  SONG TIMELINE  (tap a cell = start mark, tap again = end → range)       │
│                                                                          │
│   1     2     3     4     5     6     7     8                            │
│  │ C  │ G  │░Am░│░F ░│░C ░│░G ░│ F  │ C  │   ░ = marked (5–6 selected)   │
│  └────┴────┴────┴────┴────┴────┴────┴────┘                              │
│  "...whisper words of  [ wis ][ dom ] let it..."  ← lyric line under cells│
│                                                                          │
│  [ Select bar ] [ Select line ] [ Clear marks ]                          │
├────────────────────────────────────────────────────────────────────────┤
│  PREVIEW                                                                  │
│   ( ● Before ) ( ○ After )      [ ▶ Play ]  [ ⟲ Loop ]  [ ■ Stop ]       │
│   ▸ result: "Medium arch melody, 6 notes"   source: local                │
│   [ Apply to song ]   [ Discard ]                                        │
└────────────────────────────────────────────────────────────────────────┘
```
Marking UX:
- The timeline reuses the existing chord-cell rendering; tapping toggles a contiguous
  `[start,end]` range (first tap = start, second = end; tapping inside clears).
- "Select bar/line" are shortcuts that set the range to a measure or a lyric line.
- Transform buttons are **disabled until a section is marked**. Choosing one populates
  the options strip and auto-generates a preview (local, instant).
- "Apply to song" writes the result back: melody/rhythm/style results that carry
  `voicings` update the song's chord cells; melody is stored as an overlay event track on
  the section (persistence schema is the Integration agent's call).

---

## 8. Files this touches (for the integration agent)
- NEW `client/src/lib/editorTransforms.js` — the 3 pure fns + `RHYTHM_PATTERNS`,
  `STYLE_PRESETS`, `tabToEvents`, seeded PRNG. No React, no network. Pure like `fretboard.js`.
- EDIT `client/src/lib/api.js` — add `compose` helper (§5).
- NEW `client/src/components/SongEditor.jsx` — the screen (§7); owns marking state,
  preview playback (`playEvents`/`playProgression`/`stopAudio`), AI fetch + fallback.
- EDIT `client/src/components/ProgressionExplorer.jsx` — add the per-song "Editor"
  button that opens `SongEditor` with the resolved chord timeline (reuse
  `songChordsWithVoicings` / `songPlaySequence`).
- NEW backend `server/.../controller/ComposeController.java` — mirror
  `HandAnalysisController` (Gemini proxy, strict JSON, 503 fallback). Optional/last.

---

## 9. Ten-line summary (for the integration agent)
1. Three pure transforms live in a new `client/src/lib/editorTransforms.js`, no React/network, modeled on `fretboard.js`.
2. All preview audio uses `playEvents(events:[{string,fret,time,duration}], onDone)`; the chord-only "before" may use `playProgression(voicings:[{tab}],bpm,onChord,onDone)`. `stopAudio()` before each play; `unlockAudio()` once on first tap.
3. `transformAddMelody(section,opts)` → scale/chord-tone melody (seeded, contour+density+rests), resolves to a chord tone; returns `{events}`.
4. `transformRhythm(section,opts)` → expands each chord through a `RhythmPattern` ({subdiv,steps:[strum/pick/rest]}) into timed `{events}`; covers straight/syncopated/arpeggio/fingerstyle + swing.
5. `transformStyle(section,opts)` → a `StylePreset` (voicing recipe + rhythm id + bpm/feel) = re-voice then re-rhythm; returns `{events, voicings}`.
6. Shared input is a `MarkedSection` = `{start,end,bpm,key,scaleType,chords:[{degree,chordName,roman,tab,notes,beats}]}` built from the existing `songChordsWithVoicings`/`songPlaySequence`.
7. HYBRID: local rules always yield valid playable output; AI is opt-in via a `✨ AI ideas` toggle and **never returns raw fret events** — it returns scale degrees / preset params that the local engine renders + validates.
8. AI contract: new `POST /api/compose` (mirror `HandAnalysisController`: fixed prompt, strict JSON, **503 when no `GEMINI_API_KEY`**); frontend `api.compose.get(ctx)` returns `null` on any failure → local fallback (like `explain`).
9. UX: an Editor screen with a tappable chord timeline (tap-start/tap-end range, plus Select bar/line), transform buttons + per-transform options strip, and a Before/After + Play/Loop/Stop preview with Apply/Discard.
10. Melody-over-chords preview merges a local `tabToEvents` chord "bed" with the melody events into one `playEvents` call; no per-note gain exists today so dynamics are faked via note duration (future `playEvents` gain param noted, out of scope).
