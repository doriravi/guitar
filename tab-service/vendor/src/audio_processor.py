import os
import logging
import subprocess
from pathlib import Path
from typing import Optional, Dict
import shutil
from src.config import config

logger = logging.getLogger(__name__)

def separate_audio(input_path: str, output_dir: Optional[str] = None, model_name: Optional[str] = None) -> Dict[str, str]:
    """
    Separate audio into stems using Demucs and return paths to stems.
    
    Args:
        input_path: Path to the input audio file.
        output_dir: Directory to save separated files.
        model_name: Demucs model to use (e.g. 'htdemucs', 'htdemucs_6s').
        
    Returns:
        Dictionary with keys 'vocals', 'bass', 'other', 'drums' (and 'piano', 'guitar') pointing to file paths.
        If separation checks fail or is disabled, returns {'original': input_path}.
    """
    if not config.get('audio', 'source_separation', False) and model_name is None:
        return {'original': input_path}

    if model_name is None:
        model_name = config.get('audio', 'separation_model', 'htdemucs')
    
    input_file = Path(input_path)
    if not input_file.exists():
        logger.error(f"Input file not found: {input_path}")
        return {'original': input_path}

    # Define output directory
    if output_dir is None:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        output_dir = os.path.join(project_root, 'temp', 'separated')
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Check if already separated
    track_name = input_file.stem
    base_output = Path(output_dir) / model_name / track_name
    
    # Basic stems
    expected_stems = ['vocals', 'bass', 'drums', 'other']
    if '6s' in model_name:
        expected_stems.extend(['guitar', 'piano'])
        
    stems = {name: base_output / f"{name}.wav" for name in expected_stems}
    
    # Check if all exist
    if all(s.exists() for s in stems.values()):
        logger.info(f"Stems found in cache for: {track_name}")
        return {k: str(v) for k, v in stems.items()}

    logger.info(f"Starting source separation for {input_file.name} using {model_name}...")
    logger.info("This process may take a few minutes...")

    try:
        import sys
        cmd = [
            sys.executable, "-m", "demucs",
            "-n", model_name,
            "--out", str(output_dir),
            "-j", "2",  # Use 2 threads
            str(input_path)
        ]
        
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        logger.info("Source separation completed successfully.")
        
        result_paths = {}
        # Dynamically find all wav files in the output directory
        if base_output.exists():
            for f in base_output.glob("*.wav"):
                result_paths[f.stem] = str(f)
        
        if not result_paths:
             logger.warning("No stems found after separation.")
             return {'original': input_path}
             
        return result_paths

    except subprocess.CalledProcessError as e:
        logger.error(f"Demucs failed: {e.stderr}")
        return {'original': input_path}
    except Exception as e:
        logger.error(f"Error during separation: {str(e)}")
        return {'original': input_path}
