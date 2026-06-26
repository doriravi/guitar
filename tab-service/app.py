"""
tab-service — thin HTTP wrapper around fingerstyle-tab-mcp.

The MCP server (vendor/) is a stdio tool; our Java backend can't speak stdio and
can't host the ML deps. This FastAPI app exposes the SAME transcription pipeline
over HTTP and, crucially, returns STRUCTURED note events ({string, fret, time})
in addition to the ASCII tab — the structured events are what the guitar-reach
engine (client/src/lib/fretboard.js) scores.

Pipeline (identical to the MCP tool `analyze_audio_to_tab`):
    transcribe_audio(path)  -> [{start,end,pitch,velocity,role}], bpm   (Basic Pitch + Demucs)
    create_tab(notes, bpm)  -> ASCII tab                                 (TabGenerator)
We additionally re-run TabGenerator's OWN placement logic (_auto_transpose →
detect_chord → find_best_pos) to recover the (string, fret) it assigned each note,
so the JSON `events` line up with the ASCII.

String convention: TabGenerator's internal `s_idx` is 0=low E … 5=high e, which is
ALREADY the guitar-reach app's convention ({string:0=low E … 5=high e}). No flip
needed here. (The MCP *tool* surface uses 1=high E…6=low E, but that's only the
public tool args, not the internal placement used below.)
"""
import os
import sys
import tempfile
import logging

# Quiet the ML stack and force CPU (mirrors mcp_server.py)
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("PYTHONWARNINGS", "ignore")
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")

# Make the vendored fingerstyle-tab-mcp importable (it uses `from src...`)
VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
if VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger("tab-service")

app = FastAPI(title="Guitar Reach — Tab Transcription Service")

SUPPORTED_EXT = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}


@app.get("/health")
def health():
    return {"status": "UP"}


def _structured_events(notes, bpm):
    """Recover (string, fret, time) per note by replaying TabGenerator's placement.

    Returns (events, chords). Mirrors TabGenerator.generate_ascii_tab so the JSON
    is consistent with the ASCII tab. Strings are 0=low E … 5=high e.
    """
    from src.tab_generator import TabGenerator  # vendored
    from src.config import config

    if not notes:
        return [], []

    gen = TabGenerator(bpm=bpm)

    # 1) Same auto-transpose ("smart capo") the ASCII path applies.
    if config.get("tablature", "auto_transpose", True):
        notes = gen._auto_transpose(notes)

    sec_per_measure = (60.0 / gen.bpm) * 4
    max_time = max(n["end"] for n in notes)
    num_measures = int(max_time / sec_per_measure) + 1

    # 2) Detect a chord per measure (same as ASCII path).
    measure_chords = []
    for m_idx in range(num_measures):
        m_notes = [n for n in notes if int(n["start"] / sec_per_measure) == m_idx]
        measure_chords.append(gen.detect_chord(m_notes))

    # 3) Place each note with the generator's own role/chord-aware heuristic.
    events = []
    for n in notes:
        m_idx = int(n["start"] / sec_per_measure)
        if m_idx >= num_measures:
            continue
        chord_name = measure_chords[m_idx]
        shape = gen.chord_templates.get(chord_name, {})
        role = n.get("role", "harmony")
        is_bass = (role == "bass") or (n["pitch"] <= gen.bass_threshold)
        pos = gen.find_best_pos(n["pitch"], is_bass=is_bass, chord_shape=shape, role=role)
        if not pos:
            continue
        s_idx, fret = pos  # s_idx: 0=low E … 5=high e == our convention
        events.append({
            "string": int(s_idx),
            "fret": int(fret),
            "time": round(float(n["start"]), 3),
            "duration": round(float(n["end"] - n["start"]), 3),
            "midi": int(n["pitch"]),
            "role": role,
        })

    events.sort(key=lambda e: (e["time"], e["string"]))

    chords = []
    for m_idx, name in enumerate(measure_chords):
        if name and name != "N.C.":
            chords.append({"time": round(m_idx * sec_per_measure, 3), "name": name})

    return events, chords


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    duration_seconds: float | None = Form(None),
    start_seconds: float = Form(0.0),
):
    ext = os.path.splitext(audio.filename or "")[1].lower()
    if ext not in SUPPORTED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{ext}'. Supported: {sorted(SUPPORTED_EXT)}",
        )

    # Persist the upload to a temp file (the pipeline works on file paths).
    fd, tmp = tempfile.mkstemp(suffix=ext)
    os.close(fd)
    try:
        with open(tmp, "wb") as f:
            f.write(await audio.read())

        from src.transcriber import transcribe_audio  # vendored
        from src.tab_generator import create_tab

        notes, bpm = transcribe_audio(
            tmp, duration=duration_seconds, start_offset=start_seconds
        )
        ascii_tab = create_tab(notes, bpm=bpm)
        events, chords = _structured_events(notes, bpm)

        return JSONResponse({
            "ascii": ascii_tab,
            "bpm": round(float(bpm), 1),
            "events": events,
            "chords": chords,
            "note_count": len(events),
        })
    except Exception as e:  # noqa: BLE001 — surface a clean error to the proxy
        logger.exception("transcription failed")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
