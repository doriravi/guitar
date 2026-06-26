import os
import yaml
import logging

logger = logging.getLogger(__name__)

# Default configuration matching config.yaml.example
DEFAULT_CONFIG = {
    'audio': {
        'supported_formats': ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'],
        'default_bpm': 120.0,
        'min_bpm': 40,
        'max_bpm': 200,
        'parallel_threshold': 45.0,
        'chunk_size': 30.0,
        'chunk_overlap': 2.0,
        'source_separation': False,  # Disabled by default for speed
        'separation_model': 'htdemucs'
    },
    'post_processing': {
        'min_note_duration': 0.15,   # Increased duration threshold to remove noise
        'min_velocity': 0.45,        # Stricter velocity threshold
        'quantize': True,            # Snap to 16th notes
        'snap_harmony_to_key': True, # Force harmony notes to match detected chord
        'max_polyphony': 3           # Limit simultaneous notes for playability
    },
    'tablature': {
        'auto_transpose': True,      # Automatically shift to guitar-friendly keys (C, G, D, A, E)
        'standard_tuning': ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        'bass_threshold': 50,
        'slots_per_measure': 16,
        'measures_per_line': 4,
        'preferred_fret_range': {'min': 0, 'max': 5},
        'max_fret': 15
    },
    'chord_detection': {
        'min_score': 5,
        'enabled_chord_types': {
            'major': True, 'minor': True, 'seventh': True, 
            'major_seventh': True, 'minor_seventh': True, 
            'suspended': True, 'add9': True
        }
    },
    'logging': {
        'level': 'INFO',
        'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    },
    'i18n': {
        'default_language': 'en',
        'fallback': True
    },
    'mcp': {
        'server_name': "Fingerstyle Tab Generator",
        'detailed_errors': True
    }
}

class Config:
    _instance = None
    _config = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Config, cls).__new__(cls)
            cls._instance._load_config()
        return cls._instance

    def _load_config(self):
        """Load configuration from config.yaml or fall back to defaults."""
        self._config = DEFAULT_CONFIG.copy()
        
        # Try finding config.yaml in project root
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        config_path = os.path.join(project_root, 'config.yaml')

        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    user_config = yaml.safe_load(f)
                    if user_config:
                        self._merge_config(self._config, user_config)
                logger.info(f"Loaded configuration from {config_path}")
            except Exception as e:
                logger.error(f"Failed to load config.yaml: {e}. Using defaults.")
        else:
            logger.info("config.yaml not found. Using default configuration.")

    def _merge_config(self, default, user):
        """Recursively merge dictionary user_config into default_config."""
        for key, value in user.items():
            if isinstance(value, dict) and key in default and isinstance(default[key], dict):
                self._merge_config(default[key], value)
            else:
                default[key] = value

    def get(self, section, key=None, default=None):
        """
        Get a configuration value.
        Usage: config.get('audio', 'default_bpm') or config.get('audio')
        """
        if section not in self._config:
            return default
        
        if key is None:
            return self._config[section]
            
        return self._config[section].get(key, default)

# Global accessor
config = Config()
