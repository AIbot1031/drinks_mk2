"""Shared, explicit Qwen base selection for inference and scheduled training."""
import json
import re
from pathlib import Path

DEFAULT_MODEL_DIRECTORY='qwen3.5-9b-4bit'
SUPPORTED_MODELS={
    'Qwen/Qwen3-8B':('mlx-community/Qwen3-8B-4bit','qwen3-8b-4bit'),
    'Qwen/Qwen3.5-9B':('mlx-community/Qwen3.5-9B-4bit','qwen3.5-9b-4bit'),
}


def default_model_path(root):
    return Path(root)/'training_artifacts'/DEFAULT_MODEL_DIRECTORY


def model_version(path):
    source=json.loads((Path(path)/'source.json').read_text())
    expected=SUPPORTED_MODELS.get(source.get('base'))
    if not expected or source.get('model')!=expected[0] or source.get('quantization')!='4bit':
        raise ValueError('Unapproved Qwen model source')
    revision=source.get('revision','')
    if not isinstance(revision,str) or not re.fullmatch(r'[0-9a-f]{40}',revision):
        raise ValueError('An immutable model revision is required')
    return expected[1]+'-'+revision[:12]+'-intent-v7'
