# tab-service — Audio → Tab transcription sidecar

A small **FastAPI** HTTP service that wraps [fingerstyle-tab-mcp](https://github.com/blooper20/fingerstyle-tab-mcp)
(vendored under `vendor/`). It takes a guitar audio clip and returns guitar
tablature **plus structured note events** that the guitar-reach engine
(`client/src/lib/fretboard.js`) can score for physical difficulty.

It exists because the upstream project is a **stdio MCP server with heavy ML deps**
(Basic Pitch, Demucs, FFmpeg) — the Java/Spring backend can't host it. The backend
instead **proxies** to this service over HTTP (`/api/tab/transcribe` →
`TabTranscriptionController`), exactly like it proxies hand-photo analysis to Gemini.

## Why a wrapper (not the raw MCP tool)

The MCP tool returns only an **ASCII** tab and discards the per-note `(string, fret)`
it computed. Our app needs that structured data. So `app.py` re-runs `TabGenerator`'s
own placement logic (`_auto_transpose → detect_chord → find_best_pos`) to recover the
same string/fret it used for the ASCII, and returns it as JSON `events`.

**String convention:** events use `string: 0 = low E … 5 = high e`, which already
matches the guitar-reach app's note model — no conversion needed on the client.

## Prerequisites

- **Python 3.10+**
- **FFmpeg** on PATH (required by librosa / Demucs for decoding mp3/m4a/etc.)
- First run downloads the Basic Pitch model (and Demucs weights if you enable
  source separation) — several hundred MB to multi-GB. They are cached and **not**
  committed (see repo `.gitignore`).

## Run locally

```bash
cd tab-service
python -m venv venv
# Windows:  venv\Scripts\activate     |  macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --port 8000
```

Then point the backend at it via `tab.service.url=http://localhost:8000`
(in `server/.../application.properties` or the `TAB_SERVICE_URL` env var).

## Endpoints

### `GET /health`
`{ "status": "UP" }`

### `POST /transcribe` (multipart/form-data)
| field | type | required | notes |
|---|---|---|---|
| `audio` | file | yes | `.mp3/.wav/.flac/.ogg/.m4a/.aac` |
| `duration_seconds` | float | no | limit analysis length |
| `start_seconds` | float | no | start offset (default 0) |

**Response**
```json
{
  "ascii": "🎸 Fingerstyle Precision Analysis (BPM: 96.0)\n  G ...",
  "bpm": 96.0,
  "events": [
    { "string": 0, "fret": 3, "time": 0.0, "duration": 0.25, "midi": 43, "role": "bass" }
  ],
  "chords": [ { "time": 0.0, "name": "G" } ],
  "note_count": 1
}
```

## Performance note

By default `source_separation` is **off** (in upstream `DEFAULT_CONFIG`) for speed —
the whole clip is transcribed as one stem. Enabling Demucs separation
(melody/bass/harmony) improves arrangement quality but is **slow on CPU** (tens of
seconds to minutes per clip). Keep clips short (a few bars) when testing locally.

## Quick test

```bash
curl -F "audio=@vendor/resource/sample.mp3" http://localhost:8000/transcribe
```
