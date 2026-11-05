"""Webinar funnel readiness from the JON-6 worker's results files (read-only).

Folder: my-agent/state/linear_board/JON-6-20261013 (override CC_JON6_RESULTS).
- stress-raw*/run.log   lines like "STRESS stress 1: software=first-try audit=REFUSED vault=REFUSED"
- stress-raw*/failure.txt  a run that died before its summary
- trial-1usd-product.json  the $1 7-day trial product exists in the sandbox
- webinar_checklist.json   optional, written by the JON-6 worker: {"<item>": {"status": "pass|fail|pending", "note": "..."}}
Only counts, offer names, statuses and timestamps leave the machine; never emails, ids or checkout links.
"""
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

RESULTS = Path(os.environ.get('CC_JON6_RESULTS') or (Path.home() / 'my-agent' / 'state' / 'linear_board' / 'JON-6-20261013'))
ITEMS = ['stress', 'trial', 'sessions', 'meta', 'ads']
STRESS = re.compile(r'^STRESS\s+(.+?):\s+(.*)$')
URL = re.compile(r'https?://\S+')


def _when(path):
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_stress(text):
    offers = {}
    runs = 0
    for line in (text or '').splitlines():
        m = STRESS.match(line.strip())
        if not m:
            continue
        runs += 1
        for pair in m.group(2).split():
            if '=' not in pair:
                continue
            offer, result = pair.split('=', 1)
            o = offers.setdefault(offer, {'offer': offer, 'firstTry': 0, 'retried': 0, 'refused': 0})
            r = result.lower()
            if r == 'first-try':
                o['firstTry'] += 1
            elif r == 'refused':
                o['refused'] += 1
            else:
                o['retried'] += 1
    return runs, list(offers.values())


def stress(folder):
    dirs = sorted((d for d in folder.glob('stress-*') if d.is_dir()), key=lambda d: d.stat().st_mtime, reverse=True)
    for d in dirs:
        log = d / 'run.log'
        if log.is_file():
            runs, offers = parse_stress(log.read_text(encoding='utf-8', errors='replace'))
            if runs:
                total = sum(o['firstTry'] + o['retried'] + o['refused'] for o in offers)
                ok = sum(o['firstTry'] + o['retried'] for o in offers)
                return {'status': 'pass' if total and ok == total else 'fail', 'at': _when(log), 'run': d.name,
                        'buyers': runs, 'charges': total, 'charged': ok, 'offers': offers}
        fail = d / 'failure.txt'
        if fail.is_file():
            first = URL.sub('<link>', fail.read_text(encoding='utf-8', errors='replace').strip().splitlines()[0:2][-1])[:140]
            return {'status': 'fail', 'at': _when(fail), 'run': d.name, 'note': first}
    return None


def trial(folder, st):
    product = folder / 'trial-1usd-product.json'
    if not product.is_file():
        return None
    t = next((o for o in (st or {}).get('offers', []) if o['offer'] == 'trial'), None)
    if t and t['firstTry'] + t['retried']:
        return {'status': 'pass', 'at': (st or {}).get('at'), 'note': '$1 trial charged one-click %d of %d in the stress run' % (t['firstTry'] + t['retried'], t['firstTry'] + t['retried'] + t['refused'])}
    return {'status': 'pending', 'at': _when(product), 'note': '$1 trial product created in the sandbox; no charge result yet'}


def overrides(folder):
    p = folder / 'webinar_checklist.json'
    try:
        d = json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return {}
    out = {}
    for k, v in (d or {}).items():
        if k in ITEMS and isinstance(v, dict) and v.get('status') in ('pass', 'fail', 'pending'):
            out[k] = {'status': v['status'], 'note': URL.sub('<link>', str(v.get('note') or ''))[:160], 'at': _when(p)}
    return out


def collect(folder=None):
    folder = Path(folder or RESULTS)
    if not folder.is_dir():
        return {'ok': False, 'error': 'JON-6 results folder not found', 'items': {}}
    st = stress(folder)
    items = {'stress': st, 'trial': trial(folder, st)}
    items.update(overrides(folder))
    return {'ok': True, 'items': items}
