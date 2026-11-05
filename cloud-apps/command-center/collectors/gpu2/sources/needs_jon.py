"""Needs Jon: the numbered asks in Documents/Jarvis/Waiting On You.md (Ana keeps it current).
Only each ask's first 160 characters leave the machine; the Ana-owned notes are skipped."""
import os
import re
from datetime import datetime, timezone
from pathlib import Path

NOTE = Path(os.environ.get('CC_WAITING_ON_YOU') or (Path.home() / 'Documents' / 'Jarvis' / 'Waiting On You.md'))
ITEM = re.compile(r'^\s*(\d+)[.)]\s+(.*\S)')
EMAIL = re.compile(r'\S+@\S+')


def source(_machine):
    return 'needs_jon'


def parse(text):
    updated = ''
    items = []
    for line in (text or '').splitlines():
        if line.lower().startswith('updated') and not updated:
            updated = line.strip()[:80]
        m = ITEM.match(line)
        if m:
            body = EMAIL.sub('', m.group(2)).strip()
            area, _, ask = body.partition(' - ')
            items.append({'area': area[:40] if ask else '', 'ask': (ask or body)[:160]})
    return updated, items


def collect(_machine):
    if not NOTE.is_file():
        return {'ok': False, 'error': 'Waiting On You.md not found', 'items': []}
    updated, items = parse(NOTE.read_text(encoding='utf-8', errors='replace'))
    edited = datetime.fromtimestamp(NOTE.stat().st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {'ok': True, 'updated': updated, 'editedAt': edited, 'items': items}
