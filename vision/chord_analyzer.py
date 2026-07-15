"""
chord_analyzer.py
=================
Map a set of fretted note positions to a chord name.

This is the *inverse* of the app's chord library (client/src/lib/chords.js maps
a chord NAME -> a tab). Here we take the physical `(string, fret)` positions a
player is holding and figure out which chord they form.

Model
-----
- Standard tuning only. A note is a tuple `(string, fret)`:
    * `string` is 0-5, matching the app's convention:
        0 = low E, 1 = A, 2 = D, 3 = G, 4 = B, 5 = high e
    * `fret` is 0 (open) .. up the neck. Negative fret means "muted / not
      played" and is ignored (lets callers pass a full 6-slot hand if they like).
- Each position -> a MIDI pitch -> a pitch class (0-11, C=0).
- The distinct pitch classes are matched against chord templates. We try every
  sounding pitch class as a candidate root and see whether the remaining
  intervals match a known chord quality.

Supported qualities (per the request): major, minor, dominant 7th.
`detect_chord` returns a name like "C", "Am", or "G7", or None if no match.
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

# Open-string MIDI pitches in standard tuning, indexed by string 0..5
# (low E2=40, A2=45, D3=50, G3=55, B3=59, high e4=64).
OPEN_STRING_MIDI = (40, 45, 50, 55, 59, 64)

# Pitch-class names. We use sharps as the canonical spelling; enharmonic flats
# (Bb == A#) resolve to the same class, matching how the app treats them.
NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F",
              "F#", "G", "G#", "A", "A#", "B")

# Chord quality -> the set of intervals (in semitones from the root) that must
# ALL be present, and the suffix appended to the root name.
# Ordered most-specific first so, e.g., a dominant 7th (which contains a major
# triad) is matched as "7" rather than as a plain major.
CHORD_QUALITIES = (
    # name suffix, required intervals (as a frozenset of semitone offsets)
    ("7", frozenset({0, 4, 7, 10})),   # dominant 7th: root, M3, P5, m7
    ("m", frozenset({0, 3, 7})),        # minor triad:  root, m3, P5
    ("", frozenset({0, 4, 7})),         # major triad:  root, M3, P5
)

Position = Tuple[int, int]


def _validate_position(pos: Position) -> None:
    if not isinstance(pos, (tuple, list)) or len(pos) != 2:
        raise ValueError(f"position must be a (string, fret) pair, got {pos!r}")
    string, fret = pos
    if not isinstance(string, int) or not isinstance(fret, int):
        raise ValueError(f"string and fret must be ints, got {pos!r}")
    if not 0 <= string <= 5:
        raise ValueError(f"string must be 0..5 (0=low E, 5=high e), got {string}")


def position_to_midi(pos: Position) -> int:
    """Convert a (string, fret) position to its MIDI pitch."""
    _validate_position(pos)
    string, fret = pos
    return OPEN_STRING_MIDI[string] + fret


def position_to_pitch_class(pos: Position) -> int:
    """Convert a (string, fret) position to a pitch class 0..11 (C=0)."""
    return position_to_midi(pos) % 12


def pitch_classes(finger_positions: Sequence[Position]) -> set:
    """Return the set of distinct sounding pitch classes.
    Positions with a negative fret (muted) are skipped."""
    classes = set()
    for pos in finger_positions:
        _validate_position(pos)
        if pos[1] < 0:  # muted / not played
            continue
        classes.add(position_to_pitch_class(pos))
    return classes


def detect_chord(finger_positions: Sequence[Position]) -> Optional[str]:
    """
    Identify the chord formed by a list of (string, fret) positions.

    Returns a chord name (e.g. "C", "Am", "G7") or None if the notes don't
    form a supported major / minor / dominant-7th chord.

    Matching rule: the set of sounding pitch classes must exactly equal the
    root plus the quality's intervals — no extra notes and none missing. This
    keeps detection unambiguous (a bare major triad won't be reported as a 7th,
    and vice-versa). We try every sounding note as a candidate root and, for a
    given root, prefer the most-specific quality (7th before triad).
    """
    classes = pitch_classes(finger_positions)
    if not classes:
        return None

    best: Optional[str] = None
    for root in sorted(classes):
        # Intervals present relative to this candidate root.
        intervals = frozenset((pc - root) % 12 for pc in classes)
        for suffix, required in CHORD_QUALITIES:
            # Exact match: the chord is precisely these intervals, nothing else.
            if intervals == required:
                name = NOTE_NAMES[root] + suffix
                # First exact match wins. Because we iterate roots in ascending
                # pitch-class order and qualities most-specific-first, an exact
                # match is unique for the supported qualities, so we can return.
                return name
    return best


__all__ = [
    "detect_chord",
    "position_to_midi",
    "position_to_pitch_class",
    "pitch_classes",
    "OPEN_STRING_MIDI",
    "NOTE_NAMES",
]
