import json
import os
from pathlib import Path

from agent_status import paint

STALE_MS = 45 * 1000
WORK = {
    'before_agent_start', 'agent_start', 'tool_execution_start', 'tool_call',
    'tool_execution_end', 'tool_approval_resolved',
}
APPROVAL = {'tool_approval_requested', 'ui_prompt_start'}
LEAK = {
    'prompt', 'args', 'input', 'tool_input', 'text', 'output', 'token', 'tokens',
    'messages', 'lastAssistantMessage', 'reason', 'password', 'authorization',
    'apiKey', 'api_key', 'secret',
}


def state_dir():
    env = os.environ.get('CC_OMP_LIFECYCLE_DIR')
    if env:
        return Path(env)
    return Path.home() / '.command-center' / 'omp-lifecycle'


def load_records(directory=None):
    root = Path(directory) if directory else state_dir()
    try:
        root = root.resolve()
    except Exception:
        return []
    if not root.is_dir():
        return []
    out = []
    for path in root.glob('*.json'):
        try:
            if not path.is_file() or path.resolve().parent != root:
                continue
            out.append(json.loads(path.read_text(encoding='utf-8')))
        except Exception:
            continue
    return out


def interpret(rec, now_ms):
    if not isinstance(rec, dict) or rec.get('v') != 1:
        return None
    if any(key in rec for key in LEAK):
        return None
    phase = rec.get('phase')
    last = rec.get('lastEvent')
    hb = rec.get('heartbeatAt')
    fresh = isinstance(hb, (int, float)) and now_ms - hb <= STALE_MS
    closed = rec.get('closed') is True and last == 'session_shutdown'
    if closed:
        status = 'exited'
    elif not fresh:
        status = 'unverified'
    elif phase == 'idle' and last == 'agent_end' and rec.get('willContinue') is not True:
        status = 'idle'
    elif phase == 'working' and (last in WORK or (last == 'agent_end' and rec.get('willContinue') is True)):
        status = 'working'
    elif phase == 'action_required' and last in APPROVAL:
        status = 'action_required'
    else:
        status = 'unverified'
    tool = rec.get('tool') if isinstance(rec.get('tool'), str) else ''
    return {
        'host': rec.get('host') or '',
        'sessionId': rec.get('sessionId') or '',
        'incarnation': rec.get('incarnation') or '',
        'worktreeId': rec.get('worktreeId') or '',
        'terminalHandle': rec.get('terminalHandle') or '',
        'status': status,
        'tool': tool,
        'lastEventAt': rec.get('lastEventAt'),
        'heartbeatAt': hb,
        'reporter': 'alive' if fresh or closed else 'stale',
    }


def pick(records, now_ms):
    grouped = {}
    for rec in records or []:
        view = interpret(rec, now_ms)
        if not view or not view['sessionId']:
            continue
        key = (view['host'], view['sessionId'], view['worktreeId'])
        grouped.setdefault(key, []).append(view)
    chosen = []
    for views in grouped.values():
        live = [v for v in views if v['reporter'] == 'alive']
        incarnations = {v['incarnation'] for v in live}
        if len(incarnations) > 1:
            continue
        if live:
            chosen.append(max(live, key=lambda v: v['heartbeatAt'] or 0))
            continue
        stale = {v['incarnation'] for v in views}
        if len(stale) == 1:
            chosen.append(views[0])
    return chosen


def _match(row, terms, chosen):
    wid = row.get('worktreeId') or ''
    if not wid:
        return None
    connected = [t for t in terms or [] if t.get('worktreeId') == wid and t.get('connected')]
    omp = [t for t in connected if t.get('agentIdentity') == 'omp']
    if not omp:
        return None
    pane = row.get('pane') or ''
    by_handle = [r for r in chosen if r.get('terminalHandle') and r['terminalHandle'] == pane and r.get('worktreeId') == wid]
    if len(by_handle) == 1:
        return by_handle[0]
    if any(t.get('agentIdentity') != 'omp' for t in connected):
        return None
    by_wt = [r for r in chosen if r.get('worktreeId') == wid]
    if len(omp) == 1 and len(by_wt) == 1:
        return by_wt[0]
    return None


def overlay(rows, terminals, records, now_ms):
    chosen = pick(records, now_ms)
    out = []
    for row in rows or []:
        rec = _match(row, terminals, chosen)
        if not rec:
            out.append(row)
            continue
        activity = ('Using ' + rec['tool']) if rec['status'] == 'working' and rec.get('tool') else ''
        out.append(paint(row, rec['status'], activity, rec.get('lastEventAt'), 'omp-lifecycle'))
    return out
