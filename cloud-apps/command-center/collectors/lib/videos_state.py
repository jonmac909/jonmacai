"""Per-channel video pipeline state for the dashboard Videos page.

Sources (read-only, all on GPU2):
- my-agent/state/remake/queue.json        ViralView remake queue (status, review url, video number)
- my-agent/state/remake/heygen_ledger.json one HeyGen draft per video key (status, created)
- my-agent/state/remake/heygen_submits.csv one row per Generate press (date, time_pt, project_status_after)
- C:/tmp/avs/bridge/affiliates.json + review_slugs.json   old affiliate-N key -> review slug
Only titles, keys, statuses and dates leave the machine; notes, paths, ids and links with keys never do.
"""
import csv
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

STATE = Path(os.environ.get('CC_REMAKE_STATE') or (Path.home() / 'my-agent' / 'state' / 'remake'))
BRIDGE = Path(os.environ.get('CC_AVS_BRIDGE') or 'C:/tmp/avs/bridge')

VIRALVIEW = [('theo', 'Theo'), ('max', 'Max'), ('mina', 'Mina'), ('sienna', 'Sienna'),
             ('ash', 'Ash'), ('aria', 'Aria'), ('zane', 'Zane')]
# Ledger keys per PLAN_proper_clones.md: aff-<short>-N. Old batch keys affiliate-N map by source video.
AFFILIATE = [('angelo', 'Angelo Ferrara'), ('steve', 'Steve Copper Dogs'), ('freddy', 'Freddy Craddock'),
             ('gary', 'Gary Webster'), ('teruko', 'Teruko Imai'), ('delton', 'Delton Mendenhall'),
             ('prepared', 'Be Prepared UK')]
OLD_AFFILIATE = {'affiliate-1': 'angelo', 'affiliate-2': 'steve', 'affiliate-3': 'freddy',
                 'affiliate-5': 'gary', 'affiliate-6': 'teruko'}
ACTIVE = {'review': 0, 'producing': 1, 'brief': 2, 'paused': 3}


def _load(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return None


def _edited(path):
    try:
        return datetime.fromtimestamp(Path(path).stat().st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except OSError:
        return None


def review_slug(url):
    m = re.search(r'jonmac\.ai/review/([a-z0-9-]+)', str(url or ''))
    return m.group(1) if m else ''


def video_key(item):
    slug = review_slug(item.get('review_url') or item.get('review_page'))
    m = re.match(r'^([a-z]+-\d+)', slug)
    if m:
        return m.group(1)
    if item.get('video_number'):
        return '%s-%s' % (item.get('channel'), item['video_number'])
    m = re.search(r'/remake/([a-z]+-\d+)', str(item.get('review_page') or ''))
    return m.group(1) if m else ''


def ledger_row(entry):
    if not isinstance(entry, dict):
        return None
    return {'status': str(entry.get('status') or '')[:20], 'created': str(entry.get('created') or '')[:19],
            'redrafts': len(entry.get('history') or [])}


def viralview_rows(queue, ledger):
    items = (queue or {}).get('items') or []
    out = []
    for cid, name in VIRALVIEW:
        mine = [i for i in items if i.get('channel') == cid and i.get('status') in ACTIVE]
        mine.sort(key=lambda i: (ACTIVE[i['status']], video_key(i) or 'zzz'))
        cur = mine[0] if mine else None
        key = video_key(cur) if cur else ''
        out.append({
            'id': cid, 'name': name, 'kind': 'viralview', 'target': 3, 'period': 'week',
            'key': key,
            'title': str(cur.get('title') or '')[:120] if cur else '',
            'queueStatus': cur.get('status') if cur else '',
            'reviewSlug': review_slug(cur.get('review_url') or cur.get('review_page')) if cur else '',
            'independentReview': str(cur.get('independent_review') or '')[:12] if cur else '',
            'uploadApproved': bool(cur.get('upload_approved')) if cur else False,
            'ledger': ledger_row(ledger.get(key)) if key else None,
            'queued': len([i for i in items if i.get('channel') == cid and i.get('status') == 'queued']),
            'alsoActive': max(0, len(mine) - 1),
        })
    return out


def affiliate_rows(ledger, bridge_map, slugs):
    out = []
    for short, name in AFFILIATE:
        keys = [k for k in ledger if k.startswith('aff-%s-' % short)]
        keys += [k for k, s in OLD_AFFILIATE.items() if s == short and k in ledger]
        keys.sort(key=lambda k: str((ledger.get(k) or {}).get('created') or ''), reverse=True)
        key = keys[0] if keys else ''
        src = (bridge_map.get(key) or {}).get('source') if key.startswith('affiliate-') else None
        out.append({
            'id': 'aff-%s' % short, 'name': name, 'kind': 'affiliate', 'target': 7, 'period': 'week',
            'key': key, 'title': '',
            'queueStatus': '', 'reviewSlug': slugs.get(src, '') if src else '',
            'independentReview': '', 'uploadApproved': False,
            'ledger': ledger_row(ledger.get(key)) if key else None,
        })
    return out


def heygen_today(path, today):
    """Generate presses HeyGen accepted (project went to processing), by Pacific date."""
    try:
        with open(path, encoding='utf-8-sig', newline='') as fh:
            lines = [l for l in fh if l.strip() and not l.startswith('#')]
    except OSError:
        return None
    rows = list(csv.DictReader(lines))
    accepted = [r for r in rows if (r.get('date') or '') == today and (r.get('project_status_after') or '').strip() == 'processing']
    pressed = [r for r in rows if (r.get('date') or '') == today]
    return {'date': today, 'used': len(accepted), 'pressed': len(pressed), 'cap': 130,
            'scope': 'remake kit and Avatar Studio presses logged by agents; sponsor videos not logged'}


def collect(today=None):
    today = today or datetime.now().strftime('%Y-%m-%d')  # GPU2 clock is Pacific
    queue = _load(STATE / 'queue.json')
    ledger = ((_load(STATE / 'heygen_ledger.json') or {}).get('videos')) or {}
    bridge_map = _load(BRIDGE / 'affiliates.json') or {}
    slugs = _load(BRIDGE / 'review_slugs.json') or {}
    return {
        'ok': queue is not None,
        'queueEditedAt': _edited(STATE / 'queue.json'),
        'ledgerEditedAt': _edited(STATE / 'heygen_ledger.json'),
        'channels': viralview_rows(queue, ledger) + affiliate_rows(ledger, bridge_map, slugs),
        'heygen': heygen_today(STATE / 'heygen_submits.csv', today),
        'posts': None,  # no record of published YouTube videos exists yet
    }
