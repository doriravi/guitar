"""
Guitar Composer — audio engine.

Records a few seconds of humming / singing / playing from the default
microphone, detects the sequence of musical notes via FFT fundamental-frequency
estimation, and prints them as a single machine-parseable line for the
`guitar-composer` Claude Code skill to read:

    DETECTED_NOTES: A, C, E, G, ...

Run directly:   python3 record_and_analyze.py [seconds]

Dependencies:   pip install sounddevice numpy scipy
On Linux you may also need PortAudio headers: sudo apt-get install libportaudio2
"""

import sys
import numpy as np
import sounddevice as sd
from scipy.fftpack import fft

# ── Constants ─────────────────────────────────────────────────────────────────
SAMPLING_RATE = 44100
DURATION = 5              # seconds (overridable via argv[1])
CONCERT_A = 440.0         # A4 reference
# Note names indexed so that index 0 == A (matches 12*log2(hz/440) rounding,
# where h == 0 is A4). h % 12 then selects the pitch class directly.
NOTE_NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']

# Human hum / low-guitar usable band. Widened a little past the original 800 Hz
# so it also captures a sung soprano line and higher guitar melody notes.
MIN_HZ = 70.0
MAX_HZ = 1000.0
WINDOW_SEC = 0.4          # note-quantization window (a note change is detected per window)
SILENCE_RMS = 300         # int16 RMS below which a window is treated as silence


def hz_to_note(hz):
    """Closest note name for a frequency, or None if out of the musical range."""
    if hz is None or hz < MIN_HZ or hz > MAX_HZ:
        return None
    h = 12 * np.log2(hz / CONCERT_A)
    note_idx = int(round(h)) % 12
    return NOTE_NAMES[note_idx]


def record_audio(duration):
    print(f"🎤 Listening for {duration}s... Hum or sing your melody now!", flush=True)
    audio = sd.rec(int(duration * SAMPLING_RATE), samplerate=SAMPLING_RATE,
                   channels=1, dtype='int16')
    sd.wait()
    return audio.flatten()


def dominant_hz(chunk):
    """Peak fundamental frequency in the hum band for one window, or None."""
    # Window the chunk to reduce FFT spectral leakage before finding the peak.
    windowed = chunk.astype(np.float64) * np.hanning(len(chunk))
    fft_data = np.abs(fft(windowed))
    frequencies = np.fft.fftfreq(len(fft_data), 1 / SAMPLING_RATE)

    idx = np.where((frequencies > MIN_HZ) & (frequencies < MAX_HZ))[0]
    if len(idx) == 0:
        return None
    peak_idx = idx[np.argmax(fft_data[idx])]
    return abs(frequencies[peak_idx])


def analyze_pitches(audio):
    """Split the recording into windows and return the sequence of notes,
    collapsing immediate repeats so held notes appear once."""
    window_size = int(SAMPLING_RATE * WINDOW_SEC)
    detected_notes = []

    for i in range(0, len(audio), window_size):
        chunk = audio[i:i + window_size]
        if len(chunk) < window_size:
            break

        # Noise gate: skip near-silent windows so we don't chase room hum.
        rms = np.sqrt(np.mean(chunk.astype(np.float64) ** 2))
        if rms < SILENCE_RMS:
            continue

        note = hz_to_note(dominant_hz(chunk))
        if note and (not detected_notes or detected_notes[-1] != note):
            detected_notes.append(note)

    return detected_notes


def main():
    duration = DURATION
    if len(sys.argv) > 1:
        try:
            duration = max(1, min(30, float(sys.argv[1])))
        except ValueError:
            pass

    try:
        signal = record_audio(duration)
    except Exception as e:  # no mic / PortAudio missing / permission denied
        print(f"DETECTED_NOTES: ERROR ({e})")
        return

    notes = analyze_pitches(signal)
    if notes:
        print(f"DETECTED_NOTES: {', '.join(notes)}")
    else:
        print("DETECTED_NOTES: None (Try humming louder or closer to the mic)")


if __name__ == "__main__":
    main()
