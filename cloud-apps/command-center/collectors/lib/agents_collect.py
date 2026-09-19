import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path

from agent_status import SPIN, agent_status

AGENTS_JSON = Path(__file__).resolve().parents[1] / 'agents.json'
LABEL = {'mac': 'Mac mini', 'gpu2': 'GPU2'}


def _orca():
    env = os.environ.get('ORCA')
    if env:
        return env
    win = Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'orca' / 'resources' / 'bin' / 'orca.exe'
    if win.is_file():
        return str(win)
    for p in ('/usr/local/bin/orca', '/Applications/Orca.app/Contents/Resources/bin/orca'):
        if Path(p).is_file():
            return p
    return 'orca'


def _json(args, timeout=12):
    r = subprocess.run([_orca(), *args, '--json'], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout or 'orca failed')
    data = json.loads(r.stdout or '{}')
    return data.get('result', data)


def _meta():
    if not AGENTS_JSON.is_file():
        return {}
    try:
        return json.loads(AGENTS_JSON.read_text(encoding='utf-8'))
    except Exception:
        return {}


def _strip(title):
    t = title or ''
    for ch in SPIN:
        t = t.replace(ch, '')
    return ' '.join(t.split()).strip(' -–·')


def _terms_for(terms, worktree_id):
    return [t for t in terms if t.get('worktreeId') == worktree_id]


def collect_agents(machine):
    now = int(time.time() * 1000)
    meta = _meta()
    try:
        wts = _json(['worktree', 'ps']).get('worktrees') or []
        terms = _json(['terminal', 'list']).get('terminals') or []
    except Exception:
        return []
    out = []
    for w in wts:
        if not w.get('isPinned'):
            continue
        name = w.get('displayName') or Path(w.get('path') or '').name or 'Agent'
        info = meta.get(name) or {}
        daily = bool(info.get('daily'))
        mine = _terms_for(terms, w.get('worktreeId'))
        title = next((t.get('title') or '' for t in mine if t.get('title')), '')
        preview = (w.get('preview') or '') + ' ' + (w.get('comment') or '')
        last = w.get('lastActivityAt') or 0
        handle = None
        for t in mine:
            last = max(last or 0, t.get('lastOutputAt') or 0)
            if not handle and t.get('handle') and t.get('connected'):
                handle = t['handle']
            if t.get('title') and any(ch in (t.get('title') or '') for ch in SPIN):
                title = t['title']
        st = agent_status(title, preview, last or None, now, daily)
        today = last and datetime.fromtimestamp(last / 1000).date() == datetime.fromtimestamp(now / 1000).date()
        if st == 'working':
            job, pct, pg, pill, pill_cls = 'Working', 50, '', 'Working', 'ok'
        elif st == 'needs_you':
            job, pct, pg, pill, pill_cls = 'Waiting', 50, 'risk', 'Needs you', 'risk'
        elif st == 'quiet':
            job, pct, pg, pill, pill_cls = 'Not run', 0, 'crit', 'Quiet too long', 'crit'
        elif today:
            job, pct, pg, pill, pill_cls = 'Done', 100, 'ok', 'Idle', ''
        else:
            job, pct, pg, pill, pill_cls = 'Idle', 0, '', 'Idle', ''
        doing = _strip(title) or (w.get('comment') or preview.strip() or 'Quiet')
        row = {
            'name': name,
            'runs': LABEL.get(machine, machine),
            'machine': machine,
            'now': doing[:120],
            'job': job,
            'pct': pct,
            'pg': pg,
            'status': st,
            'pill': pill,
            'pillCls': pill_cls,
            'page': info.get('page') or '',
            'handle': handle,
            'worktreeId': w.get('worktreeId'),
        }
        if st == 'needs_you':
            row['waiting'] = {
                'title': doing[:120],
                'lines': [ln.strip() for ln in (w.get('comment') or preview).split('\n') if ln.strip()][:2] or [doing[:120]],
                'waitLabel': 'Needs you',
            }
        if info.get('prompt') and st in ('quiet', 'idle'):
            row['restart'] = 'Restart'
            row['restartMsg'] = '%s agent restarted' % name
        out.append(row)
    return out


def restart_agent(payload):
    name = payload.get('name') or ''
    prompt = (_meta().get(name) or {}).get('prompt')
    if not prompt:
        return False, 'No daily prompt for %s' % name
    handle = payload.get('handle')
    if not handle:
        for row in collect_agents(payload.get('machine') or 'gpu2'):
            if row.get('name') == name and row.get('handle'):
                handle = row['handle']
                break
    if not handle:
        return False, 'No live terminal for %s' % name
    subprocess.run(
        [_orca(), 'terminal', 'send', '--terminal', handle, '--text', prompt, '--enter', '--json'],
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=20,
    )
    return True, '%s agent restarted' % name
