SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◑'
QUIET_MS = 48 * 3600 * 1000


def agent_status(title, preview, last_activity_ms, now_ms, daily, wt_status=None, agent_states=None):
    blob = ' '.join([title or '', preview or '']).lower()
    waiting = (
        'waiting on' in blob
        or 'needs you' in blob
        or 'waiting for input' in blob
        or 'paused' in blob
        or blob.rstrip().endswith('?')
    )
    if waiting:
        return 'needs_you'
    states = [s or '' for s in (agent_states or [])]
    if 'working' in states or wt_status == 'working':
        return 'working'
    spin_src = (title or '') + (preview or '')
    if any(ch in spin_src for ch in SPIN):
        return 'working'
    if daily and last_activity_ms is not None and now_ms is not None:
        if now_ms - last_activity_ms >= QUIET_MS:
            return 'quiet'
    return 'idle'
