import json
import os
import subprocess
import time

from pathlib import Path

from agent_status import classify_sessions, last_line, redact_long
from omp_lifecycle import load_records, overlay

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



def workspace_of(path):
    parts = [p for p in str(path or '').replace('\\', '/').split('/') if p]
    if 'workspaces' in parts:
        return '/'.join(parts[parts.index('workspaces') + 1:])[:60]
    return parts[-1][:60] if parts else ''


ASKING = ('Do you want to', 'Would you like to', 'Allow this', '❯ 1. Yes', '> 1. Yes', 'Press enter to confirm')


def term_title(t):
    title = str(t.get('title') or '')
    if title.lower().endswith('.exe'):
        title = title.replace('\\', '/').rsplit('/', 1)[-1][:-4]
        title = {'powershell': 'PowerShell', 'pwsh': 'PowerShell', 'cmd': 'Command Prompt'}.get(title.lower(), title)
    return redact_long(title, 80)


def screen_read(handle):
    """(last meaningful line, True when the screen shows a yes/no prompt waiting on Jon)."""
    try:
        r = _json(['terminal', 'read', '--terminal', handle, '--screen'], 8)
    except Exception:
        return '', False
    tail = (r.get('terminal') or {}).get('tail') or []
    asking = any(a in str(l) for l in tail[-14:] for a in ASKING)
    return last_line(tail), asking


def _term_for(row, terms):
    pane = row.get('pane') or ''
    for t in terms:
        if t.get('worktreeId') == row.get('worktreeId') and '%s:%s' % (t.get('tabId'), t.get('leafId')) == pane:
            return t
    for t in terms:
        if t.get('handle') and t.get('handle') == pane:
            return t
    return None


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
    seen = set()
    lines = {}
    for row in overlay(classify_sessions(ps.get('worktrees') or [], terms, now), terms, load_records(), now):
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
        if row.get('provenance'):
            item['provenance'] = row['provenance']
        term = _term_for(row, terms)
        if not term and row['status'] not in ('working', 'action_required'):
            continue  # leftover record of a closed pane, not a live terminal
        if not term:
            item['workspace'] = workspace_of(str(row.get('worktreeId') or '').split('::')[-1])
        if term:
            seen.add(term.get('handle'))
            item['terminal'] = term.get('handle')
            item['title'] = term_title(term)
            item['workspace'] = workspace_of(term.get('worktreePath'))
            if term.get('connected') and term.get('handle') not in lines:
                lines[term['handle']] = screen_read(term['handle'])
            line, asking = lines.get(term.get('handle'), ('', False))
            item['lastLine'] = line
            if asking and item['status'] in ('working', 'idle', 'unverified'):
                item.update({'status': 'action_required', 'pill': 'Action required', 'pillCls': 'risk', 'job': 'Waiting', 'pg': 'risk'})
            item['lastOutputAt'] = term.get('lastOutputAt')
        for t in terms:
            if t.get('worktreeId') == row.get('worktreeId') and t.get('connected') and t.get('handle') and t.get('agentIdentity'):
                item['handle'] = t['handle']
                break
        if item['status'] == 'action_required':
            item['waiting'] = {
                'title': item.get('title') or row['now'],
                'lines': [item.get('lastLine') or row['now']],
                'waitLabel': 'Action required',
            }
        out.append(item)
    for t in terms:
        if not t.get('connected') or t.get('handle') in seen:
            continue
        out.append({
            'id': '%s:%s' % (t.get('executionHostId') or 'local', t.get('handle')),
            'name': term_title(t) or 'Terminal',
            'runs': LABEL.get(machine, machine),
            'machine': machine,
            'terminal': t.get('handle'),
            'title': term_title(t),
            'workspace': workspace_of(t.get('worktreePath')),
            'lastLine': screen_read(t['handle'])[0],
            'lastOutputAt': t.get('lastOutputAt'),
            'now': t.get('agentIdentity') or 'shell',
            'job': 'Idle', 'pct': 0, 'pg': '', 'status': 'idle', 'pill': 'Idle', 'pillCls': '', 'page': '',
            'observedAt': t.get('lastOutputAt'),
        })
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
