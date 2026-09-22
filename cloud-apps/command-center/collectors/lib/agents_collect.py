import json
import os
import subprocess
import time

from pathlib import Path

from agent_status import classify_sessions

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


def _run(args, timeout=12):
    r = subprocess.run([_orca(), *args], capture_output=True, timeout=timeout)
    out = (r.stdout or b'').decode('utf-8', 'replace')
    err = (r.stderr or b'').decode('utf-8', 'replace')
    return r.returncode, out, err


def _json(args, timeout=12):
    code, out, err = _run([*args, '--json'], timeout)
    if code != 0:
        raise RuntimeError(err or out or 'orca failed')
    data = json.loads(out or '{}')
    return data.get('result', data)


def _meta():
    if not AGENTS_JSON.is_file():
        return {}
    try:
        return json.loads(AGENTS_JSON.read_text(encoding='utf-8'))
    except Exception:
        return {}



def collect_report(machine):
    now = int(time.time() * 1000)
    try:
        ps = _json(['worktree', 'ps'])
        listed = _json(['terminal', 'list'])
    except Exception:
        return {'ok': False, 'unreachable': True, 'agents': [], 'hostScope': {}}
    terms = listed.get('terminals') or []
    meta = _meta()
    out = []
    for row in classify_sessions(ps.get('worktrees') or [], terms, now):
        info = meta.get(row['name']) or {}
        item = {
            'id': row['id'],
            'name': row['name'],
            'hostId': row['hostId'],
            'worktreeId': row['worktreeId'],
            'runs': LABEL.get(machine, machine),
            'machine': machine,
            'now': row['now'],
            'job': row['job'],
            'pct': row['pct'],
            'pg': row['pg'],
            'status': row['status'],
            'pill': row['pill'],
            'pillCls': row['pillCls'],
            'page': info.get('page') or '',
            'observedAt': row.get('observedAt'),
        }
        for t in terms:
            if t.get('worktreeId') == row.get('worktreeId') and t.get('connected') and t.get('handle') and t.get('agentIdentity'):
                item['handle'] = t['handle']
                break
        if row['status'] == 'action_required':
            item['waiting'] = {
                'title': row['now'],
                'lines': [row['now']],
                'waitLabel': 'Action required',
            }
        out.append(item)
    return {
        'ok': True,
        'unreachable': False,
        'agents': out,
        'hostScope': ps.get('hostScope') or {},
    }


def collect_agents(machine):
    return collect_report(machine).get('agents') or []


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
    _run(['terminal', 'send', '--terminal', handle, '--text', prompt, '--enter', '--json'], 20)
    return True, '%s agent restarted' % name
