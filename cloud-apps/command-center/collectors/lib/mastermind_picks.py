import hashlib
import json
from pathlib import Path


def _load(path: Path):
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return None


def _area(text: str) -> str:
    t = (text or '').lower()
    if 'instantly' in t or 'outreach' in t or 'bounce' in t:
        return 'Outreach'
    if 'sponsor' in t:
        return 'Sponsors'
    if 'meta' in t or ' ad' in t or 'ads' in t:
        return 'Viral View'
    if 'post' in t or 'content' in t:
        return 'Content'
    return 'Mastermind'


def _id(text: str) -> str:
    return hashlib.sha1((text or '').encode('utf-8')).hexdigest()[:12]


def _title(text: str) -> str:
    t = re_sub_space(text or '').strip()
    if len(t) <= 80:
        return t
    return t[:77].rsplit(' ', 1)[0] + '…'


def re_sub_space(text: str) -> str:
    return ' '.join((text or '').split())


def picks_from_state(state: Path) -> dict:
    filt = _load(state / 'morning-filter.json') or {}
    digest = _load(state / 'telegram-digest.json')
    items = filt.get('items') or []
    scanned = 0
    if isinstance(digest, dict):
        scanned = int(digest.get('scanned') or 0)
    if not scanned:
        scanned = int(filt.get('count') or 0)
    if not scanned and isinstance(digest, list):
        scanned = len(digest)
    if not scanned:
        scanned = len(items)
    impl, park = [], []
    for it in items:
        action = it.get('action') or 'park'
        if action == 'ignore':
            continue
        text = re_sub_space(it.get('text') or it.get('body') or '')
        if not text:
            continue
        row = {
            'id': _id(text),
            'area': _area(text),
            'title': _title(text),
            'text': text,
            'verdict': 'implement' if action == 'implement' else 'park',
            'href': it.get('url') or it.get('href') or '',
            'ts': it.get('ts') or it.get('at') or filt.get('ran') or '',
            'lines': ['From the AI Advanced group', text[:180]],
        }
        (impl if row['verdict'] == 'implement' else park).append(row)
    return {
        'scanned': scanned,
        'scannedAt': filt.get('ran') or '',
        'picks': impl + park,
    }
