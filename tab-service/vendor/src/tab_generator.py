import gettext
import os
import logging
from typing import List, Dict, Tuple, Optional, Any
from music21 import pitch

from src.config import config

# Setup logging
logging.basicConfig(
    level=getattr(logging, config.get('logging', 'level', 'INFO').upper()),
    format=config.get('logging', 'format', '%(asctime)s - %(name)s - %(levelname)s - %(message)s')
)
logger = logging.getLogger(__name__)

# Internationalization Setup
localedir = os.path.join(os.path.abspath(os.path.dirname(__file__)), '../locales')
translate = gettext.translation('messages', localedir, fallback=True)
_ = translate.gettext

class TabGenerator:
    def __init__(self, tuning: List[str] = None, bpm: float = 75):
        """
        Initialize the TabGenerator.

        Args:
            tuning: List of string tunings (default: standard tuning from config)
            bpm: Beats per minute (default: 75, constrained by config limits)
        """
        if tuning is None:
            tuning = config.get('tablature', 'standard_tuning', ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'])

        try:
            self.tuning = [pitch.Pitch(t).midi for t in tuning]
        except Exception as e:
            logger.error(_("Invalid tuning specification: {}").format(str(e)))
            raise ValueError(_("Invalid tuning: {}").format(tuning)) from e

        self.num_strings = len(self.tuning)
        min_bpm = config.get('audio', 'min_bpm', 40)
        max_bpm = config.get('audio', 'max_bpm', 200)
        self.bpm = max(min_bpm, min(bpm, max_bpm))
        
        self.bass_threshold = config.get('tablature', 'bass_threshold', 50)
        self.config_max_fret = config.get('tablature', 'max_fret', 15)
        self.capo = 0

        logger.info(_("TabGenerator initialized - Tuning: {}, BPM: {:.1f}").format(
            tuning, self.bpm
        )) 

        # Precision Chord Templates
        all_templates = {
            "C": {1: 3, 2: 2, 3: 0, 4: 1, 5: 0},
            "Cm": {1: 3, 2: 5, 3: 5, 4: 4, 5: 3},
            "C7": {1: 3, 2: 2, 3: 3, 4: 1, 5: 0},
            "CM7": {1: 3, 2: 2, 3: 0, 4: 0, 5: 0},
            "Cm7": {1: 3, 2: 5, 3: 3, 4: 4, 5: 3},
            "Csus4": {1: 3, 2: 3, 3: 0, 4: 1, 5: 1},
            "D": {2: 0, 3: 2, 4: 3, 5: 2},
            "Dm": {2: 0, 3: 2, 4: 3, 5: 1},
            "D7": {2: 0, 3: 2, 4: 1, 5: 2},
            "DM7": {2: 0, 3: 2, 4: 2, 5: 2},
            "Dm7": {2: 0, 3: 2, 4: 1, 5: 1},
            "Dsus4": {2: 0, 3: 2, 4: 3, 5: 3},
            "E": {0: 0, 1: 2, 2: 2, 3: 1, 4: 0, 5: 0},
            "Em": {0: 0, 1: 2, 2: 2, 3: 0, 4: 0, 5: 0},
            "E7": {0: 0, 1: 2, 2: 0, 3: 1, 4: 0, 5: 0},
            "EM7": {0: 0, 1: 2, 2: 1, 3: 1, 4: 0, 5: 0},
            "Em7": {0: 0, 1: 2, 2: 0, 3: 0, 4: 0, 5: 0},
            "Esus4": {0: 0, 1: 2, 2: 2, 3: 2, 4: 0, 5: 0},
            "F": {0: 1, 1: 3, 2: 3, 3: 2, 4: 1, 5: 1},
            "Fm": {0: 1, 1: 3, 2: 3, 3: 1, 4: 1, 5: 1},
            "F7": {0: 1, 1: 3, 2: 1, 3: 2, 4: 1, 5: 1},
            "FM7": {2: 3, 3: 2, 4: 1, 5: 0},
            "Fm7": {0: 1, 1: 3, 2: 1, 3: 1, 4: 1, 5: 1},
            "Fsus4": {0: 1, 1: 3, 2: 3, 3: 3, 4: 1, 5: 1},
            "G": {0: 3, 1: 2, 2: 0, 3: 0, 4: 0, 5: 3},
            "Gm": {0: 3, 1: 5, 2: 5, 3: 3, 4: 3, 5: 3},
            "G7": {0: 3, 1: 2, 2: 0, 3: 0, 4: 0, 5: 1},
            "GM7": {0: 3, 1: 2, 2: 0, 3: 0, 4: 0, 5: 2},
            "Gm7": {0: 3, 1: 5, 2: 3, 3: 3, 4: 3, 5: 3},
            "Gsus4": {0: 3, 1: 3, 2: 0, 3: 0, 4: 1, 5: 3},
            "A": {1: 0, 2: 2, 3: 2, 4: 2, 5: 0},
            "Am": {1: 0, 2: 2, 3: 2, 4: 1, 5: 0},
            "A7": {1: 0, 2: 2, 3: 0, 4: 2, 5: 0},
            "AM7": {1: 0, 2: 2, 3: 1, 4: 2, 5: 0},
            "Am7": {1: 0, 2: 2, 3: 0, 4: 1, 5: 0},
            "Asus4": {1: 0, 2: 2, 3: 2, 4: 3, 5: 0},
            "B": {1: 2, 2: 4, 3: 4, 4: 4, 5: 2},
            "Bm": {1: 2, 2: 4, 3: 4, 4: 3, 5: 2},
            "B7": {1: 2, 2: 1, 3: 2, 4: 0, 5: 2},
            "BM7": {1: 2, 2: 4, 3: 3, 4: 4, 5: 2},
            "Bm7": {1: 2, 2: 4, 3: 2, 4: 3, 5: 2},
            "Bsus4": {1: 2, 2: 4, 3: 4, 4: 5, 5: 2},
            "Fadd9": {1: 3, 2: 3, 3: 2, 4: 1, 5: 3},
        }

        # Filter based on enabled chord types in config (simple implementation)
        # This assumes chord names follow conventions (m, 7, sus, etc.)
        enabled_types = config.get('chord_detection', 'enabled_chord_types', {})
        self.chord_templates = {}
        
        for name, template in all_templates.items():
            if 'm' in name and '7' not in name and not enabled_types.get('minor', True): continue
            if '7' in name and not enabled_types.get('seventh', True): continue
            if 'sus' in name and not enabled_types.get('suspended', True): continue
            if 'add9' in name and not enabled_types.get('add9', True): continue
            # Default to include if passing checks or simple major
            self.chord_templates[name] = template

    def _auto_transpose(self, notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Detect key and transpose notes to the nearest guitar-friendly key (C, G, D, A, E).
        Effectively acts as a 'Smart Capo'.
        """
        if not notes: return notes
        
        # 1. Simple Weighted Chroma Analysis to find root
        chroma = [0] * 12
        for n in notes:
            chroma[n['pitch'] % 12] += 1
            
        detected_root = chroma.index(max(chroma))
        
        # 2. Guitar Friendly Roots (C=0, D=2, E=4, G=7, A=9)
        friendly_roots = [0, 2, 4, 7, 9]
        
        # Find nearest friendly root
        best_shift = 0
        min_dist = 999
        
        for fr in friendly_roots:
            # Calculate distance (considering wrap-around)
            diff = (fr - detected_root + 6) % 12 - 6
            if abs(diff) < abs(min_dist):
                min_dist = diff
                best_shift = diff
                
        if best_shift != 0:
            logger.info(_("Auto-Transpose: Shifting pitch by {} semitones to fit guitar key.").format(best_shift))
            for n in notes:
                n['pitch'] += best_shift
                
        return notes

    def find_best_pos(self, midi_pitch: int, is_bass: bool = False,
                      chord_shape: Optional[Dict[int, int]] = None, role: str = 'harmony') -> Optional[Tuple[int, int]]:
        """
        Find optimal string and fret position with role-based heuristics.
        """
        best_cand = None
        max_score = -float('inf')

        # Try various octave shifts to fit the range, prioritizing the original pitch
        shifts = [0, -12, 12]
        if role == 'bass': shifts = [0, -12, -24]
        if role == 'melody': shifts = [0, 12, -12]

        for octave_shift in shifts:
            shifted_pitch = midi_pitch + octave_shift
            for s_idx in range(self.num_strings):
                fret = shifted_pitch - self.tuning[s_idx]
                
                # Use self.config_max_fret if available, else 15
                max_fret = getattr(self, 'config_max_fret', 15)
                
                if 0 <= fret <= max_fret:
                    score = 0
                    
                    # 1. Extreme Open Position Preference (The "Easy Tab" Factor)
                    if fret == 0: 
                        score += 3000 # Open strings are King
                    elif fret <= 3: 
                        score += 1500 # First position is Queen
                    elif fret <= 5: 
                        score += 500  # Acceptable
                    else: 
                        score -= (fret * 100) # Check high frets heavily
                    
                    # 2. Role-based string preference
                    if role == 'melody':
                        if s_idx >= 3: score += 500
                        if s_idx <= 1: score -= 1000
                    elif role == 'bass' or is_bass:
                        if s_idx <= 2: score += 500
                        if s_idx >= 4: score -= 1000
                    
                    # 3. Chord Context
                    if chord_shape and s_idx in chord_shape and chord_shape[s_idx] == fret:
                        score += 2000 # Always obey the chord
                    
                    # Select best score
                    if score > max_score:
                        max_score = score
                        best_cand = (s_idx, fret)
            
            # If we found an ideal candidate in original octave, stop
            if best_cand and max_score > 2000:
                break

        return best_cand

    def generate_ascii_tab(self, notes: List[Dict[str, Any]]) -> str:
        """
        Generate ASCII tablature from a list of notes.

        Args:
            notes: List of note dictionaries with 'start', 'end', 'pitch', 'velocity'

        Returns:
            ASCII tablature string

        Raises:
            ValueError: If notes list is empty or invalid
        """
        if not notes:
            logger.warning(_("No notes provided for tab generation"))
            return _("No notes detected.")

        try:
            # Auto-Transpose (Smart Capo)
            if config.get('tablature', 'auto_transpose', True):
                notes = self._auto_transpose(notes)

            slots_per_measure = config.get('tablature', 'slots_per_measure', 16)
            sec_per_measure = (60 / self.bpm) * 4
            max_time = max(n['end'] for n in notes)
            num_measures = int(max_time / sec_per_measure) + 1

            logger.info(_("Generating tab: {} measures, {:.2f} sec/measure").format(
                num_measures, sec_per_measure
            ))

            # Initialize tab grid
            full_tab = [[["-" for ___ in range(slots_per_measure)]
                         for ___ in range(num_measures)]
                        for ___ in range(self.num_strings)]
            measure_chords = ["N.C." for ___ in range(num_measures)]

            # Detect chords for each measure
            for m_idx in range(num_measures):
                m_notes = [n for n in notes if int(n['start'] / sec_per_measure) == m_idx]
                measure_chords[m_idx] = self.detect_chord(m_notes)

            # Place notes on the tab
            for n in notes:
                m_idx = int(n['start'] / sec_per_measure)
                if m_idx >= num_measures:
                    continue

                chord_name = measure_chords[m_idx]
                current_shape = self.chord_templates.get(chord_name, {})

                role = n.get('role', 'harmony')
                
                # Harmonic Filtering
                # If enabled, remove 'harmony' notes that don't fit the detected chord
                # This drastically cleans up the arrangement to sound like the chord.
                snap_to_chord = config.get('post_processing', 'snap_harmony_to_key', True)
                if snap_to_chord and role == 'harmony' and chord_name != "N.C." and current_shape:
                    # Calculate allowable pitches (semitone classes 0-11)
                    allowable_pcs = set()
                    for s, f in current_shape.items():
                        p = (self.tuning[s] + f) % 12
                        allowable_pcs.add(p)
                    
                    if (n['pitch'] % 12) not in allowable_pcs:
                        continue # Skip this note (dissonant / busy)

                # Role overrides distinct is_bass logic usually, but keep fallback
                is_bass = (role == 'bass') or (n['pitch'] <= self.bass_threshold)
                
                pos = self.find_best_pos(
                    n['pitch'], 
                    is_bass=is_bass, 
                    chord_shape=current_shape,
                    role=role
                )

                if pos:
                    s_idx, fret = pos
                    rel_time = n['start'] % sec_per_measure
                    slot_idx = int((rel_time / sec_per_measure) * slots_per_measure)
                    line_idx = self.num_strings - 1 - s_idx

                    fret_str = str(fret)
                    for i, c in enumerate(fret_str):
                        write_idx = slot_idx + i
                        if write_idx < slots_per_measure:
                            # 1. Collision Check (Don't overwrite existing notes)
                            if full_tab[line_idx][m_idx][write_idx] != '-':
                                continue
                                
                            # 2. Physical Spacer Check (Don't play same string too fast)
                            # If previous 16th note on this string was played, skip this one
                            # This clears up the 'machine gun' effect (1-1-1-1)
                            if write_idx > 0 and full_tab[line_idx][m_idx][write_idx - 1] != '-':
                                continue
                            
                            # Write the note
                            full_tab[line_idx][m_idx][write_idx] = c

            logger.info(_("Tab generation completed successfully"))
            return self._render_layout(full_tab, measure_chords, num_measures, slots_per_measure)

        except KeyError as e:
            logger.error(_("Missing required note field: {}").format(str(e)))
            raise ValueError(_("Invalid note format: {}").format(str(e))) from e
        except Exception as e:
            logger.error(_("Tab generation failed: {}").format(str(e)))
            raise RuntimeError(_("Failed to generate tablature: {}").format(str(e))) from e

    def detect_chord(self, m_notes: List[Dict[str, Any]]) -> str:
        """
        Detect the most likely chord from notes in a measure.

        Args:
            m_notes: List of note dictionaries in the measure

        Returns:
            Chord name (e.g., 'C', 'Am', 'G7') or 'N.C.' (No Chord)
        """
        if not m_notes:
            return "N.C."

        pitches = [n['pitch'] % 12 for n in m_notes]
        scores = {}

        for name, shape in self.chord_templates.items():
            template_pitches = set([(self.tuning[s] + f) % 12 for s, f in shape.items()])
            scores[name] = sum(3 for p in pitches if p in template_pitches)

            # Root note bonus
            if shape:
                first_s = next(iter(shape))
                root_pitch = (self.tuning[first_s] + shape[first_s]) % 12
                if root_pitch in pitches:
                    scores[name] += 5
            
            # Simplicity Bias: Prefer Triads (Major/Minor) over complex chords (7ths, sus, add9)
            # This makes the chord progression more "standard/popular" unless strong evidence exists.
            is_simple = (len(name) <= 3 and '7' not in name and '9' not in name and 'sus' not in name)
            # Major (len 1 or 2 e.g. 'F#') or Minor (len 2 or 3 e.g. 'F#m')
            # Adjust bias as needed. 4 points = roughly 1-2 matching notes worth.
            if is_simple:
                scores[name] += 4

        min_score = config.get('chord_detection', 'min_score', 5)
        best = max(scores, key=scores.get)
        detected = best if scores[best] > min_score else "N.C."

        if detected != "N.C.":
            logger.debug(_("Detected chord: {}").format(detected))

        return detected

    def _render_layout(self, full_tab, measure_chords, num_measures, slots_per_measure):
        measures_per_line = config.get('tablature', 'measures_per_line', 4)
        headers = ['e|', 'B|', 'G|', 'D|', 'A|', 'E|']
        header_text = _("🎸 Fingerstyle Precision Analysis")
        output = [f"{header_text} (BPM: {self.bpm:.1f})\n"]

        for start_m in range(0, num_measures, measures_per_line):
            end_m = min(start_m + measures_per_line, num_measures)
            chord_line = "  "
            for m_idx in range(start_m, end_m):
                chord_line += measure_chords[m_idx].ljust(slots_per_measure) + " "
            output.append(chord_line)

            for s_idx in range(self.num_strings):
                line = headers[s_idx]
                for m_idx in range(start_m, end_m):
                    line += "".join(full_tab[s_idx][m_idx]) + "|"
                output.append(line)
            output.append("")

        return "\n".join(output)

def create_tab(notes: List[Dict[str, Any]], bpm: float = 75) -> str:
    """
    Convenience function to create a tablature from notes.

    Args:
        notes: List of note dictionaries
        bpm: Beats per minute (default: 75)

    Returns:
        ASCII tablature string
    """
    generator = TabGenerator(bpm=bpm)
    return generator.generate_ascii_tab(notes)
