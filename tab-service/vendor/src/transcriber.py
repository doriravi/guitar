import numpy as np
import librosa
import gettext
import os
import logging
from typing import List, Dict, Tuple, Any
from pathlib import Path
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH
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

# Supported audio formats
SUPPORTED_FORMATS = set(config.get('audio', 'supported_formats', ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']))

# Global model cache to avoid re-loading for every request
_MODEL_CACHE = None

def get_model():
    """Lazy load and cache the Basic Pitch model."""
    global _MODEL_CACHE
    if _MODEL_CACHE is None:
        try:
            from basic_pitch.inference import Model
            logger.info(_("Loading Basic Pitch model into memory..."))
            _MODEL_CACHE = Model(str(ICASSP_2022_MODEL_PATH))
            logger.info(_("Model loaded successfully."))
        except Exception as e:
            logger.error(_("Failed to load model: {}").format(str(e)))
            # Fallback to path string if direct load fails
            _MODEL_CACHE = ICASSP_2022_MODEL_PATH
    return _MODEL_CACHE

def validate_audio_file(audio_path: str) -> Path:
    """
    Validates that the audio file exists and is in a supported format.

    Args:
        audio_path: Path to the audio file

    Returns:
        Path object for the validated file

    Raises:
        FileNotFoundError: If the file doesn't exist
        ValueError: If the file format is not supported
    """
    path = Path(audio_path)

    if not path.exists():
        raise FileNotFoundError(_("Audio file not found: {}").format(audio_path))

    if not path.is_file():
        raise ValueError(_("Path is not a file: {}").format(audio_path))

    if path.suffix.lower() not in SUPPORTED_FORMATS:
        raise ValueError(
            _("Unsupported audio format: {}. Supported formats: {}").format(
                path.suffix, ', '.join(SUPPORTED_FORMATS)
            )
        )

    return path

def _transcribe_chunk(audio_path: str, duration: float = None, start_offset: float = 0.0) -> List[Dict[str, Any]]:
    """Internal function for processing a single audio chunk."""
    temp_path = None
    try:
        validated_path = validate_audio_file(audio_path)
        target_path = str(validated_path)
        if duration or start_offset > 0:
            import tempfile
            import soundfile as sf
            y, sr = librosa.load(str(validated_path), offset=start_offset, duration=duration)
            fd, temp_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            sf.write(temp_path, y, sr)
            target_path = temp_path

        model = get_model()
        model_output, midi_data, note_events = predict(target_path, model_or_model_path=model)

        notes = []
        for note in note_events:
            notes.append({
                'start': float(note[0]) + start_offset,
                'end': float(note[1]) + start_offset,
                'pitch': int(note[2]),
                'velocity': float(note[3])
            })
        return notes
    finally:
        if temp_path and os.path.exists(temp_path):
            try: os.remove(temp_path)
            except: pass

from src.audio_processor import separate_audio

def transcribe_audio(audio_path: str, duration: float = None, start_offset: float = 0.0) -> Tuple[List[Dict[str, Any]], float]:
    """
    Transcribe audio with source-separated-aware arrangement logic.
    """
    validated_path = validate_audio_file(audio_path)
    audio_path_str = str(validated_path)
    
    # 0. Source Separation
    # Returns {'vocals':..., 'bass':..., 'other':...} or {'original':...}
    stems = separate_audio(audio_path_str)
    
    # 1. Detect BPM (Use original or drums/bass for best rhythm)
    bpm_source = stems.get('drums', stems.get('original', stems.get('bass', audio_path_str)))
    logger.info(_("Detecting tempo from: {}").format(os.path.basename(bpm_source)))
    
    bpm_detect_duration = min(60, duration if duration else 60)
    y, sr = librosa.load(bpm_source, offset=start_offset, duration=bpm_detect_duration)
    tempo, __ = librosa.beat.beat_track(y=y, sr=sr)
    detected_bpm = float(tempo)
    logger.info(_("Detected BPM: {:.2f}").format(detected_bpm))

    # 2. Transcription Logic
    all_notes = []
    
    # Helper to transcribe a specific file and assign a role
    def process_stem(path: str, role: str) -> List[Dict[str, Any]]:
        if not os.path.exists(path): return []
        
        # Determine duration for this stem
        s_dur = float(librosa.get_duration(path=path))
        if duration: s_dur = min(s_dur, duration)
        
        parallel_threshold = config.get('audio', 'parallel_threshold', 45.0)
        
        stem_notes = []
        if s_dur < parallel_threshold:
             stem_notes = _transcribe_chunk(path, duration=s_dur, start_offset=start_offset)
        else:
            # Parallel chunking for this stem
            chunk_size = config.get('audio', 'chunk_size', 30.0)
            overlap = config.get('audio', 'chunk_overlap', 2.0)
            chunks = []
            curr = start_offset
            end_t = start_offset + s_dur
            while curr < end_t:
                d = min(chunk_size + overlap, end_t - curr)
                chunks.append((curr, d))
                if curr + chunk_size >= end_t: break
                curr += chunk_size
            
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = [executor.submit(_transcribe_chunk, path, d, s) for s, d in chunks]
                for f in futures:
                    try: stem_notes.extend(f.result())
                    except: pass

        # Assign role
        for n in stem_notes:
            n['role'] = role
        return stem_notes

    # If we have stems, process them
    if 'vocals' in stems:
        logger.info(_("Transcribing stems for fingerstyle arrangement..."))
        # We can parallelize stem processing too
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_voc = executor.submit(process_stem, stems.get('vocals'), 'melody')
            future_bas = executor.submit(process_stem, stems.get('bass'), 'bass')
            future_oth = executor.submit(process_stem, stems.get('other'), 'harmony')
            
            try: all_notes.extend(future_voc.result())
            except Exception as e: logger.error(f"Vocal transcription failed: {e}")
            
            try: all_notes.extend(future_bas.result())
            except Exception as e: logger.error(f"Bass transcription failed: {e}")
            
            try: all_notes.extend(future_oth.result())
            except Exception as e: logger.error(f"Harmony transcription failed: {e}")
            
        logger.info(_("Merged {} notes from stems.").format(len(all_notes)))
        
    else:
        # Fallback to original single-file processing
        logger.info(_("Transcribing single audio file..."))
        all_notes = process_stem(stems['original'], 'harmony')

    # 3. Deduplicate (Modified for roles)
    # Sort by time, then priority (Melody > Bass > Harmony)
    role_priority = {'melody': 0, 'bass': 1, 'harmony': 2}
    all_notes.sort(key=lambda x: (x['start'], role_priority.get(x.get('role', 'harmony'), 2), -x['velocity']))
    
    # Define _clean_and_quantize helper
    def _clean_and_quantize(notes: List[Dict[str, Any]], bpm: float) -> List[Dict[str, Any]]:
        if not notes: return []
        
        min_vel = config.get('post_processing', 'min_velocity', 0.3)
        min_dur = config.get('post_processing', 'min_note_duration', 0.1)
        do_quantize = config.get('post_processing', 'quantize', True)
        
        # 16th note duration in seconds
        beat_dur = 60.0 / bpm
        sixteenth_dur = beat_dur / 4.0
        
        cleaned = []
        # Enforce strict fingering limits
        max_poly = config.get('post_processing', 'max_polyphony', 3) # Reduced from 4 to 3
        
        for n in notes:
            # Velocity Filter
            if n['velocity'] < min_vel: continue
            
            # Duration Filter
            if (n['end'] - n['start']) < min_dur: continue
            
            new_n = n.copy()
            if do_quantize:
                # Snap start to nearest 16th
                grid_idx = round(n['start'] / sixteenth_dur)
                new_n['start'] = grid_idx * sixteenth_dur
                new_n['end'] = max(new_n['start'] + sixteenth_dur, n['end'])
                
            cleaned.append(new_n)
            
        # Polyphony Limiter & Deduplicate
        # Group by start time
        time_groups = {}
        for n in cleaned:
            t = int(n['start'] * 100)
            if t not in time_groups: time_groups[t] = []
            time_groups[t].append(n)
            
        final_notes = []
        for t, group in time_groups.items():
            # Deduplicate pitches at same time
            pitch_map = {}
            for n in group:
                if n['pitch'] not in pitch_map or n['velocity'] > pitch_map[n['pitch']]['velocity']:
                    pitch_map[n['pitch']] = n
            
            unique_in_group = list(pitch_map.values())
            
            # Priority Sorting: Melody > Bass > Harmony > Velocity
            # We need to rely on the role assigned earlier OR pitch
            # Heuristic: Highest pitch = Melody, Lowest = Bass. Middle = Harmony.
            unique_in_group.sort(key=lambda x: x['pitch']) 
            
            # If we have too many notes, keep:
            # 1. The highest note (Melody)
            # 2. The lowest note (Bass)
            # 3. The loudest remaining notes
            if len(unique_in_group) > max_poly:
                melody = unique_in_group[-1]
                bass = unique_in_group[0]
                others = unique_in_group[1:-1]
                
                # Keep top (max_poly - 2) from others
                others.sort(key=lambda x: -x['velocity'])
                keep_others = others[:max(0, max_poly - 2)]
                
                limited_group = [bass] + keep_others + [melody]
                # Remove duplicates if bass==melody (unlikely but possible)
                unique_in_group = []
                seen_p = set()
                for n in limited_group:
                    if n['pitch'] not in seen_p:
                        unique_in_group.append(n)
                        seen_p.add(n['pitch'])
                
            final_notes.extend(unique_in_group)
            
        # Horizontal Cleaning (Speed Limit)
        # If notes are too close together (humanly impossible 32nd notes strumming?), thin them out.
        # Simple implementation: Ensure unique start times are at least X ms apart? 
        # No, 16th quantization handles that.
        # But we might have too many 16th notes in a row (machine gun effect).
        # Let's trust quantization for now, but the Polyphony Limit is key.

        return sorted(final_notes, key=lambda x: x['start'])

    # Apply cleaning
    unique_notes = _clean_and_quantize(all_notes, detected_bpm)

    return unique_notes, detected_bpm

    # 3. Deduplicate
    all_notes.sort(key=lambda x: (x['start'], x['pitch']))
    unique_notes = []
    if all_notes:
        unique_notes.append(all_notes[0])
        for i in range(1, len(all_notes)):
            curr_n = all_notes[i]
            prev_n = unique_notes[-1]
            if curr_n['pitch'] == prev_n['pitch'] and (curr_n['start'] - prev_n['start']) < 0.1:
                continue
            unique_notes.append(curr_n)

    return unique_notes, detected_bpm
