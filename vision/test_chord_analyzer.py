"""
Unit tests for chord_analyzer.detect_chord and its helpers.

Run:
    python -m unittest test_chord_analyzer -v
    # or, if pytest is installed:
    python -m pytest test_chord_analyzer.py -v

String convention (matches the app): 0=low E, 1=A, 2=D, 3=G, 4=B, 5=high e.
A fret of -1 means "muted / not played" and is ignored.
"""

import unittest

from chord_analyzer import (
    detect_chord,
    pitch_classes,
    position_to_midi,
    position_to_pitch_class,
)


class TestPositionMath(unittest.TestCase):
    def test_open_strings_midi(self):
        # Open string on each string should give the tuning's open pitch.
        self.assertEqual(position_to_midi((0, 0)), 40)   # low E2
        self.assertEqual(position_to_midi((1, 0)), 45)   # A2
        self.assertEqual(position_to_midi((5, 0)), 64)   # high e4

    def test_fret_raises_pitch(self):
        # 5th fret of low E is A2 (40 + 5 = 45).
        self.assertEqual(position_to_midi((0, 5)), 45)
        # 12th fret is one octave up.
        self.assertEqual(position_to_midi((0, 12)), 52)

    def test_pitch_class(self):
        self.assertEqual(position_to_pitch_class((0, 0)), 4)   # E
        self.assertEqual(position_to_pitch_class((1, 0)), 9)   # A
        self.assertEqual(position_to_pitch_class((2, 0)), 2)   # D

    def test_invalid_string_raises(self):
        with self.assertRaises(ValueError):
            position_to_midi((6, 0))
        with self.assertRaises(ValueError):
            position_to_midi((-1, 0))

    def test_muted_positions_ignored_in_pitch_classes(self):
        # (string, -1) is muted and must not contribute a pitch class.
        # low-E open -> E(4); A-string muted -> dropped; D-string 2nd fret -> E(4).
        # Both sounding notes are E, so the distinct set is just {4}.
        pcs = pitch_classes([(0, 0), (1, -1), (2, 2)])
        self.assertEqual(pcs, {4})


class TestMajorChords(unittest.TestCase):
    def test_e_major_open(self):
        # E:022100  -> E, B, E, G#, B, E -> {E, G#, B}
        pos = [(0, 0), (1, 2), (2, 2), (3, 1), (4, 0), (5, 0)]
        self.assertEqual(detect_chord(pos), "E")

    def test_a_major_open(self):
        # A:x02220 -> A, E, A, C#, E -> {A, C#, E}
        pos = [(1, 0), (2, 2), (3, 2), (4, 2), (5, 0)]
        self.assertEqual(detect_chord(pos), "A")

    def test_c_major_open(self):
        # C:x32010 -> C(A5), E, C, E, C... -> {C, E, G}
        pos = [(1, 3), (2, 2), (3, 0), (4, 1), (5, 0)]
        self.assertEqual(detect_chord(pos), "C")

    def test_g_major_open(self):
        # G:320003 -> G, B, D, G, B, G -> {G, B, D}
        pos = [(0, 3), (1, 2), (2, 0), (3, 0), (4, 0), (5, 3)]
        self.assertEqual(detect_chord(pos), "G")

    def test_d_major_open(self):
        # D:xx0232 -> D, A, D, F# -> {D, F#, A}
        pos = [(2, 0), (3, 2), (4, 3), (5, 2)]
        self.assertEqual(detect_chord(pos), "D")

    def test_bare_major_triad_by_pitch_classes(self):
        # C major as a minimal triad: C, E, G.
        # Fret C(1,3)->C, E(0,0)->E, G(2,5)->G
        pos = [(1, 3), (0, 0), (2, 5)]
        self.assertEqual(detect_chord(pos), "C")


class TestMinorChords(unittest.TestCase):
    def test_a_minor_open(self):
        # Am:x02210 -> A, E, A, C, E -> {A, C, E}
        pos = [(1, 0), (2, 2), (3, 2), (4, 1), (5, 0)]
        self.assertEqual(detect_chord(pos), "Am")

    def test_e_minor_open(self):
        # Em:022000 -> E, B, E, G, B, E -> {E, G, B}
        pos = [(0, 0), (1, 2), (2, 2), (3, 0), (4, 0), (5, 0)]
        self.assertEqual(detect_chord(pos), "Em")

    def test_d_minor_open(self):
        # Dm:xx0231 -> D, A, D, F -> {D, F, A}
        pos = [(2, 0), (3, 2), (4, 3), (5, 1)]
        self.assertEqual(detect_chord(pos), "Dm")

    def test_minor_is_not_major(self):
        # Sanity: A minor triad must not be reported as A major.
        pos = [(1, 0), (2, 2), (3, 2), (4, 1), (5, 0)]
        self.assertNotEqual(detect_chord(pos), "A")


class TestDominant7Chords(unittest.TestCase):
    def test_g7_open(self):
        # G7:320001 -> G, B, D, G, B, F -> {G, B, D, F}
        pos = [(0, 3), (1, 2), (2, 0), (3, 0), (4, 0), (5, 1)]
        self.assertEqual(detect_chord(pos), "G7")

    def test_c7_shape(self):
        # C7:x32310 -> C, E, Bb, C, E ... root C + E + G + Bb.
        # Build C7 pitch classes: C(0), E(4), G(7), Bb(10).
        # C(1,3), E(0,0), G(2,5), Bb(3,3)->Bb
        pos = [(1, 3), (0, 0), (2, 5), (3, 3)]
        self.assertEqual(detect_chord(pos), "C7")

    def test_dom7_preferred_over_major(self):
        # A set containing a major triad PLUS a minor 7th is a dom7, not major.
        # G7 must not collapse to "G".
        pos = [(0, 3), (1, 2), (2, 0), (3, 0), (4, 0), (5, 1)]
        self.assertNotEqual(detect_chord(pos), "G")


class TestEnharmonicAndEdgeCases(unittest.TestCase):
    def test_sharp_root_spelling(self):
        # F# major: F#, A#, C#  -> canonical sharp spelling "F#".
        # F#(0,2), A#(1,1), C#(2,11)... use simple frets:
        # F#(0,2)->F#, A#(0,6)->A#, C#(1,4)->C#
        pos = [(0, 2), (0, 6), (1, 4)]
        self.assertEqual(detect_chord(pos), "F#")

    def test_empty_returns_none(self):
        self.assertIsNone(detect_chord([]))

    def test_all_muted_returns_none(self):
        self.assertIsNone(detect_chord([(0, -1), (1, -1), (2, -1)]))

    def test_single_note_returns_none(self):
        # A single note is not a chord under our supported qualities.
        self.assertIsNone(detect_chord([(0, 0)]))

    def test_unrecognized_cluster_returns_none(self):
        # A chromatic cluster (C, C#, D) matches no major/minor/dom7 template.
        # C(1,3), C#(1,4), D(1,5)
        pos = [(1, 3), (1, 4), (1, 5)]
        self.assertIsNone(detect_chord(pos))

    def test_duplicate_notes_do_not_break_match(self):
        # Same pitch class fretted twice (E on two strings) still -> E major.
        # E(0,0), G#(3,1), B(1,2), and a duplicate E on the high e (5,0)
        pos = [(0, 0), (3, 1), (1, 2), (5, 0)]
        self.assertEqual(detect_chord(pos), "E")


if __name__ == "__main__":
    unittest.main(verbosity=2)
