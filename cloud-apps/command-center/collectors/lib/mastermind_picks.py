import json
from pathlib import Path


def _load(path: Path):
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return None


def picks_from_state(state: Path) -> dict:
    digest = _load(state / 'telegram-digest.json')
    if isinstance(digest, dict) and digest.get('origin') == 'telegram-group' and digest.get('access') == 'ok':
        return digest
    return {
        'access': 'unavailable',
        'scanned': 0,
        'picks': [],
        'connector': 'Webpage digest is not Built With AI - Advanced history.',
    }
