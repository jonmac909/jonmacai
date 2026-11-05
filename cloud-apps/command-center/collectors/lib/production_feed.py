"""Reads the ONE production feed owned by the avatar-studio production-tab worker:
my-agent/state/production/status.json (schema in BRIEF_avatar_studio_production_tab.md).
This module never writes it. Only schema fields leave the machine; URL query strings
(where a review key could hide) are dropped, and text is length-capped."""
import json
import os
import re
from pathlib import Path

FEED = Path(os.environ.get('CC_PRODUCTION_FEED') or (Path.home() / 'my-agent' / 'state' / 'production' / 'status.json'))
TEXT = {'program': 20, 'channel': 60, 'host': 60, 'title': 140, 'stage': 30, 'stage_started': 40,
        'eta': 40, 'last_line': 200, 'blocked_reason': 160}
SECRET = re.compile(r'(?i)(key|token|passcode|password|secret)=\S+')


def clean_url(url):
    u = str(url or '').strip()
    if not u.startswith('http'):
        return None
    return u.split('?', 1)[0].split('#', 1)[0][:200]


def _num(v):
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def clean_row(r):
    out = {}
    for k, n in TEXT.items():
        v = r.get(k)
        out[k] = None if v is None else SECRET.sub('', str(v))[:n]
    out['video_no'] = r.get('video_no') if isinstance(r.get('video_no'), (int, str)) else None
    out['stage_pct'] = _num(r.get('stage_pct'))
    out['cap_min'] = _num(r.get('cap_min'))
    out['source_url'] = clean_url(r.get('source_url'))
    out['review_url'] = clean_url(r.get('review_url'))
    return out


def collect(path=None):
    p = Path(path or FEED)
    if not p.is_file():
        return {'ok': False, 'error': 'production feed not written yet', 'rows': []}
    try:
        d = json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return {'ok': False, 'error': 'production feed unreadable', 'rows': []}
    h = d.get('header') or {}
    return {
        'ok': True,
        'updated': str(d.get('updated') or '')[:40] or None,
        'header': {'heygenUsed': _num(h.get('heygen_used')), 'heygenCap': _num(h.get('heygen_cap'))},
        'rows': [clean_row(r) for r in (d.get('rows') or []) if isinstance(r, dict)][:40],
    }
