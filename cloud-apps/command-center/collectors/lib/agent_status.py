SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◑'
QUIET_MS = 48 * 3600 * 1000


def agent_status(title, preview, last_activity_ms, now_ms, daily):
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
    if title and any(ch in title for ch in SPIN):
        return 'working'
    if daily and last_activity_ms is not None and now_ms is not None:
        if now_ms - last_activity_ms >= QUIET_MS:
            return 'quiet'
    return 'idle'
