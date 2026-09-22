import re

FRESH_MS = 30 * 60 * 1000
SECRET = re.compile(r'(?i)\b(sk-[A-Za-z0-9_-]{6,}|bearer\s+\S+|api[_-]?key[=:]\S*|token[=:]\S+|password[=:]\S+)')
EMAIL = re.compile(r'\S+@\S+')


def redact(text):
    t = EMAIL.sub('', text or '')
    t = SECRET.sub('', t)
    return ' '.join(t.split())[:80]


def _connected(term):
    return bool(term.get('connected')) and bool(term.get('agentIdentity'))


def _row(name, status, activity, host, worktree_id, pane, observed_at):
    pills = {
        'working': ('Working', 'ok', 'Working', 50, ''),
        'action_required': ('Action required', 'risk', 'Waiting', 50, 'risk'),
        'error': ('Error', 'crit', 'Error', 0, 'crit'),
        'exited': ('Exited', '', 'Exited', 0, ''),
        'idle': ('Idle', '', 'Idle', 0, ''),
        'unverified': ('Unknown', '', 'Unknown', 0, ''),
    }
    pill, pill_cls, job, pct, pg = pills[status]
    return {
        'id': '%s:%s:%s' % (host or '', worktree_id or '', pane or ''),
        'name': redact(name) or 'Agent',
        'hostId': host or '',
        'worktreeId': worktree_id or '',
        'pane': pane or '',
        'status': status,
        'now': redact(activity) or pill,
        'job': job,
        'pct': pct,
        'pg': pg,
        'pill': pill,
        'pillCls': pill_cls,
        'observedAt': observed_at,
    }


def paint(row, status, activity, observed_at, provenance):
    nxt = _row(row.get('name'), status, activity, row.get('hostId'), row.get('worktreeId'), row.get('pane'), observed_at)
    nxt['provenance'] = provenance
    return nxt


def _status(agent, live, now_ms):
    state = agent.get('state')
    updated = agent.get('updatedAt') if agent.get('updatedAt') is not None else agent.get('stateStartedAt')
    fresh = isinstance(updated, (int, float)) and now_ms - updated <= FRESH_MS
    if not live:
        return 'exited'
    if state in ('blocked', 'waiting'):
        return 'action_required'
    if state in ('error', 'failed', 'unverifiable'):
        return 'error'
    if state == 'working' and fresh:
        return 'working'
    return 'idle'


def classify_sessions(worktrees, terminals, now_ms):
    terminals = terminals or []
    out = []
    for w in worktrees or []:
        wid = w.get('worktreeId')
        host = w.get('hostId') or ''
        mine = [t for t in terminals if t.get('worktreeId') == wid]
        agents = w.get('agents') or []
        live_terms = [t for t in mine if _connected(t)]
        closed = [t for t in mine if t.get('agentIdentity') and not _connected(t)]
        if not agents:
            if live_terms:
                for t in live_terms:
                    name = w.get('displayName') or t.get('agentIdentity') or 'Agent'
                    out.append(_row(name, 'unverified', 'No hook status', host, wid, t.get('handle'), t.get('lastOutputAt')))
                continue
            if closed:
                for t in closed:
                    out.append(_row(w.get('displayName') or 'Agent', 'exited', 'Exited', host, wid, t.get('handle'), t.get('lastOutputAt')))
            continue
        if not live_terms and not closed and mine:
            continue
        for i, agent in enumerate(agents):
            pane = agent.get('paneKey') or str(i)
            updated = agent.get('updatedAt') if agent.get('updatedAt') is not None else agent.get('stateStartedAt')
            name = agent.get('taskTitle') or agent.get('displayName') or w.get('displayName') or 'Agent'
            tool = agent.get('toolName') or ''
            activity = ('Using ' + tool) if tool else name
            out.append(_row(name, _status(agent, bool(live_terms), now_ms), activity, host, wid, pane, updated))
    return out
