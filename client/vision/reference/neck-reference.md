# Fretboard camera — reference view

A user-provided **known-good** top-down neck shot, used as the target the
`neckDetect` tuning and tests should match. We do NOT template-match live frames
against a stored photo (the detector is geometric, per-frame); instead we encode
the *measurable characteristics* of this reference and assert the detector +
its confidence gates accept views like it, across a range of tilt angles.

## The instrument

**Takamine G-series GC1CE-NAT** — classical, nylon strings, ~52 mm nut width
(the `classical` profile in `lib/geometry.js`).

## Reference images

| File | View |
|------|------|
| `nut-to-12th.png`            | The guitar cropped **nut → 12th fret**, as shot (nut at top). |
| `nut-to-12th-horizontal.png` | The same crop rotated so the neck runs left→right — the orientation the Note Map camera sees (nut on the right, 12th fret on the left). |

Cropped from the user's top-down still at original-pixel box
`(735, 388) → (950, 1288)`: the nut sits at y≈400 and the 12th-fret wire at
y≈1272. On a classical the neck/body joint falls at the 12th fret, which
corroborates the landmark. These show what a correct **nut→12 framing** looks
like for this instrument — the span the Note Map calibrates (`spanFrets: 12`).

## Live-view characteristics (measured from the user's webcam frame)

These describe the *live camera* reference (a hand-held top-down webcam shot),
which is what the detector actually has to cope with — not the clean still above.

| Property            | Value / range                                             |
|---------------------|-----------------------------------------------------------|
| View                | Top-down, camera above the neck looking straight down     |
| Neck orientation    | Near-horizontal, tilt ≈ **−0.10 rad** (~5–8° down L→R)    |
| Neck span in frame  | Full width; fretboard band occupies the **top ~55–65%**   |
| Strings             | 6 clear parallel lines → **high string-texture ratio**    |
| Background          | Dark lap / plain below the neck (strong band contrast)    |
| Calibration span    | **nut → 12th fret** (Note Map uses `spanFrets: 12`)        |

## What "match across angles" means here

`dominantAxis` votes *all* edge orientations and picks the dominant parallel
bundle, so the neck's long axis is found at **any** tilt — horizontal, the ~7°
of this reference, or steeper diagonals. The reference is therefore used to
calibrate the **confidence gates** (sharpness floor/target, texture ratio, band
size), not to constrain the angle. The regression test below builds synthetic
necks at several tilt angles matching this reference's contrast/texture and
asserts they all detect with a plausible axis + bounding corners.

## Regression

See `client/src/lib/neckDetect.reference.test.js` — synthetic "reference-like"
necks at tilts {0°, 7°, 15°, −12°} must each: detect (non-null), return an axis
within the histogram's honest resolution (~0.30 rad; 36 bins over 180° ≈ 5°/bin,
±1–2 bins with smoothing) of the built tilt, and keep corners in frame. This
locks in that a view like the user's reference keeps passing as the detector
evolves. Exact corner alignment is the job of **Fine-tune**, not the auto axis
estimate — the auto detector gets close; the drag makes it precise.
