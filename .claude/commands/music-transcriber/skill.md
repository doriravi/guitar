# Skill: Music Transcriber

Transcribes an audio file into a lead sheet combining chord progressions and lyrics.

## Input

- `AUDIO_FILE` — path to the source audio file (mp3, wav, m4a, flac, etc.)
- `OUTPUT_NAME` — base name for output files (no extension), defaults to the audio filename stem
- `OUTPUT_FORMAT` — `markdown` (default) or `chordpro`

## Step 1 — Normalize audio with ffmpeg

Convert the input to a 16-bit mono WAV at 22050 Hz, which both librosa and Whisper handle optimally.

```bash
ffmpeg -i "$AUDIO_FILE" \
  -ac 1 -ar 22050 -sample_fmt s16 \
  -y "${OUTPUT_NAME}_normalized.wav"
```

Fail fast if ffmpeg exits non-zero. The normalized file is the input for all subsequent steps.

## Step 2 — Chord analysis with librosa (`extract_chords.py`)

Run the bundled Python script against the normalized WAV. It uses librosa's CQT-based chroma and a simple nearest-neighbour chord template matcher to produce timestamped chord events.

```bash
python skills/music-transcriber/extract_chords.py \
  "${OUTPUT_NAME}_normalized.wav" \
  --out "${OUTPUT_NAME}_chords.json"
```

### `extract_chords.py` contract

**Input:** normalized WAV path, `--out` path for JSON output.

**Algorithm:**
1. Load audio with `librosa.load(path, sr=22050, mono=True)`.
2. Compute a chroma-CQT with `librosa.feature.chroma_cqt` (hop_length=4096 → ~0.185 s resolution).
3. For each frame, find the closest match among 24 chord templates (12 major + 12 minor) using cosine similarity.
4. Collapse consecutive identical chords into a single event with start/end times.
5. Write JSON:

```json
[
  { "start": 0.0,  "end": 3.7,  "chord": "A" },
  { "start": 3.7,  "end": 7.4,  "chord": "D" },
  { "start": 7.4,  "end": 11.1, "chord": "E" }
]
```

**Dependencies:** `pip install librosa numpy`

## Step 3 — Lyrics transcription with Whisper

Run OpenAI Whisper on the same normalized WAV to get word-level timestamps.

```bash
whisper "${OUTPUT_NAME}_normalized.wav" \
  --model small \
  --output_format json \
  --output_dir . \
  --word_timestamps True
```

This produces `${OUTPUT_NAME}_normalized.json` containing a `segments` array, each with `start`, `end`, and `text`. Rename or copy it to `${OUTPUT_NAME}_lyrics.json` for clarity.

**Whisper model trade-offs:**

| Model  | Speed  | Accuracy |
|--------|--------|----------|
| tiny   | fastest | lower   |
| small  | fast    | good    |
| medium | slower  | better  |
| large  | slowest | best    |

Use `small` by default; switch to `medium` or `large` for studio-quality transcription.

**Dependencies:** `pip install openai-whisper` (requires ffmpeg on PATH)

## Step 4 — Merge into a lead sheet with Claude

Pass both JSON files to Claude and ask it to produce the final lead sheet. Use the `claude` CLI or API.

```bash
claude --print "$(cat <<'PROMPT'
You are a music transcription assistant. You will receive:
1. A JSON array of chord events with start/end times in seconds.
2. A JSON array of lyric segments with start/end times in seconds.

Your task: merge them into a lead sheet where each lyric line is preceded by
the chord that is playing at that moment. Output FORMAT below.

Rules:
- Place the chord name that is active at the START of each lyric segment before that line.
- When the chord changes mid-line, insert the new chord inline in square brackets, e.g. [D].
- Group lines into verses/choruses based on blank-line gaps in the lyrics (gap > 1.5 s = new section).
- Label sections: Verse 1, Chorus, Bridge, etc., using your best judgment from lyric content.
- If OUTPUT_FORMAT is "chordpro", use ChordPro syntax: {title:}, {artist:}, [Chord] inline.
- If OUTPUT_FORMAT is "markdown", use Markdown with chord on its own line above the lyric line.

CHORDS:
$(cat "${OUTPUT_NAME}_chords.json")

LYRICS:
$(cat "${OUTPUT_NAME}_lyrics.json")

OUTPUT_FORMAT: ${OUTPUT_FORMAT:-markdown}
PROMPT
)" > "${OUTPUT_NAME}_leadsheet.md"
```

### Output example (Markdown format)

```markdown
# Wild Thing — The Troggs

## Verse 1

A
Wild thing, you make my heart sing

D  E  D
You make everything groovy

## Chorus

A
Wild thing, I think I love you

D
But I wanna know for sure

E  D  A
Come on and hold me tight
```

### Output example (ChordPro format)

```
{title: Wild Thing}
{artist: The Troggs}

{start_of_verse: Verse 1}
[A]Wild thing, you make my [D]heart [E]sing
[D]You make everything [A]groovy
{end_of_verse}

{start_of_chorus: Chorus}
[A]Wild thing, I think I [D]love you
[E]But I wanna know for [D]sure
{end_of_chorus}
```

## Full pipeline (one command)

```bash
#!/usr/bin/env bash
set -euo pipefail

AUDIO_FILE="${1:?Usage: transcribe.sh <audio_file> [output_name] [markdown|chordpro]}"
OUTPUT_NAME="${2:-${AUDIO_FILE%.*}}"
OUTPUT_FORMAT="${3:-markdown}"

echo "==> Step 1: Normalizing audio..."
ffmpeg -i "$AUDIO_FILE" -ac 1 -ar 22050 -sample_fmt s16 -y "${OUTPUT_NAME}_normalized.wav"

echo "==> Step 2: Extracting chords..."
python skills/music-transcriber/extract_chords.py \
  "${OUTPUT_NAME}_normalized.wav" \
  --out "${OUTPUT_NAME}_chords.json"

echo "==> Step 3: Transcribing lyrics..."
whisper "${OUTPUT_NAME}_normalized.wav" \
  --model small --output_format json \
  --output_dir . --word_timestamps True
cp "${OUTPUT_NAME}_normalized.json" "${OUTPUT_NAME}_lyrics.json"

echo "==> Step 4: Generating lead sheet..."
# (paste the claude command from Step 4 here, with OUTPUT_NAME and OUTPUT_FORMAT substituted)

echo "Done! Lead sheet written to ${OUTPUT_NAME}_leadsheet.md"
```

## Error handling notes

- **ffmpeg not found:** install via `choco install ffmpeg` (Windows) or `brew install ffmpeg` (Mac).
- **Whisper CUDA errors:** add `--device cpu` to the Whisper command to force CPU inference.
- **Poor chord detection:** librosa's chroma is sensitive to reverb and complex arrangements. For polyphonic pop songs, consider `--model medium` or a dedicated chord recognition model (e.g., `chord-recognition` from `madmom`).
- **Lyrics hallucination:** Whisper occasionally hallucinates on instrumental passages. Review and trim segments with low confidence (Whisper JSON includes `avg_logprob` per segment; discard segments below -1.0).
