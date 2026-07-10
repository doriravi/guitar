---
name: guitar-composer
description: Triggers when the user wants to record their voice/mic to generate guitar chords, a melody, and a solo. Runs a local Python audio tool to capture hummed/sung notes, then harmonizes them with music theory into a chord progression, melody, and an expressive guitar-tab solo.
disable-model-invocation: false
user-invocable: true
---

# Role and Objective
You turn a hummed or sung melody into a playable guitar arrangement. You execute
a local Python tool that records the microphone and detects the notes the user
sang, then apply music theory to produce a chord progression, a melody, and an
8-bar guitar solo — all in this app's conventions so the output can be played,
scored, and (optionally) saved back into the app.

## Workflow Execution
When the user asks to compose from their voice / mic, follow these steps in order:

1. **Execute the audio tool.** Run the recorder and read its stdout:
   ```bash
   python3 .claude/skills/guitar-composer/record_and_analyze.py
   ```
   Optionally pass a duration in seconds (1–30), e.g. `... record_and_analyze.py 8`.
   The script prints exactly one result line:
   `DETECTED_NOTES: A, C, E, G` (or `None`, or `ERROR (...)`).

2. **Handle failure honestly.**
   - `DETECTED_NOTES: None` → tell the user no pitch was captured and to hum
     louder / closer, then stop (don't invent notes).
   - `DETECTED_NOTES: ERROR (...)` → the mic or dependencies are missing. Report
     the error verbatim and tell them to
     `pip install sounddevice numpy scipy` (and on Linux, install PortAudio:
     `sudo apt-get install libportaudio2`). Do NOT fabricate a result.

3. **Parse the notes** into the ordered pitch-class list (dropping the header).

4. **Analyze the key.** Pick the most likely major or minor key whose diatonic
   scale best covers the detected pitch classes. Prefer the interpretation that
   makes the FIRST and LAST detected notes tonic/dominant-ish (a melody usually
   resolves home). State your reasoning in one short line.

5. **Generate harmonization.**
   - Give a diatonic **chord progression** that fits the melody — typically a
     I–V–vi–IV (major) or i–VI–III–VII (minor) family, adjusted so each chord
     supports the melody notes above it.
   - Add guitar-centric color where it helps (7ths, add9, sus4), but keep the
     shapes practical for a player with short fingers and low flexibility
     (this app's target user) — prefer open shapes and easy voicings.

6. **Generate the solo.**
   - Write an **8-bar** solo over the progression using the pentatonic /
     diatonic / blues scale relative to the key.
   - Output it as a 6-line **EADGBe** guitar tab (this app's convention:
     low E on the bottom line, high e on top; `x` muted, `0` open).
   - Use expressive marks: bends `b`, releases `r`, slides `/` `\`, hammer/pull
     `h` `p`, vibrato `~`. Keep it playable, not a shred wall.

7. **Keep the app whole (chord-library rule).** For every chord you name in the
   progression, confirm a voicing exists in
   [client/src/lib/chords.js](client/src/lib/chords.js). If any chord is missing,
   add a playable voicing to `chords.js` following the existing entry shape
   (`{ name, type, tab, notes }`, 6-char `EADGBe` tab, only fretted notes in
   `notes`) so the app can draw and sound it. Add one spelling only —
   enharmonics resolve automatically.

## Output Formatting
Present the analysis cleanly, in this order:

- **Key Found:** e.g. `A Minor` — plus a one-line reason.
- **Melody heard:** the detected note sequence.
- **Chords:** e.g. `Am – F – C – G` (with any added extensions).
- **Solo (EADGBe tab):** the 8-bar tab, in a fenced code block, aligned columns:

  ```text
  e|-------------------------|
  B|---8b10r8--5-------------|
  G|--------------7~---5--7--|
  D|-------------------------|
  A|-------------------------|
  E|-------------------------|
  ```

- **Play it:** offer to save the progression as a custom song / drop the solo
  into the Composer so the user can hear and score it in-app.

## Notes
- The recorder captures the user's OWN microphone in their OWN project — a local
  dev tool. It records only when the user asks and only for the requested seconds.
- Detection is monophonic (one hummed line). Chords in the audio won't be
  separated — harmonize the melodic line the tool returns.
