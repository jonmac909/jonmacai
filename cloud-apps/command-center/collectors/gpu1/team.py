"""Team collector for the Command Center Team page (redesign V3).

Read-only. Reads OpenMausBot's own files on GPU1 and sends one summary per beat:
  bots.json     name, title, section, model, newest task and its thread
  routines.json the next scheduled run for each bot (the next checkpoint)
  events/*.ndjson  the last turn event, to tell working from idle

No message text, no prompts, no souls leave the machine.
"""
import io
import json
import os
import sys
import time
from pathlib import Path

OMB = Path(os.environ.get('CC_OPENMAUSBOT') or (Path.home() / '.openmausbot'))
TAIL_BYTES = 96 * 1024
FRESH_WORK_SECS = 900      # a turn with no completion is 'working' for 15 min
STUCK_SECS = 1800          # then it is 'stuck' until a completion lands


def _read_json(path):
    raw = Path(path).read_bytes()
    last = None
    for enc in ('utf-8', 'cp1252', 'latin-1'):
        try:
            return json.loads(raw.decode(enc))
        except (UnicodeDecodeError, ValueError) as e:
            last = e
    raise RuntimeError('%s: %s' % (Path(path).name, type(last).__name__))


def _last_event(thread_id):
    if not thread_id:
        return None
    path = OMB / 'events' / ('%s.ndjson' % thread_id)
    try:
        size = path.stat().st_size
        with open(path, 'rb') as fh:
            if size > TAIL_BYTES:
                fh.seek(size - TAIL_BYTES)
                fh.readline()          # drop the partial first line
            raw = fh.read().decode('utf-8', 'replace')
    except OSError:
        return None
    last = None
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            last = json.loads(line)
        except ValueError:
            continue
    if last is None:
        return None
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = 0
    return {'type': last.get('type') or '', 'at': int(mtime)}


def _state(ev, now):
    if not ev:
        return 'nodata'
    kind = ev['type']
    age = max(0, now - ev['at'])
    if kind == 'turn.wait_started':
        return 'waiting'
    if kind in ('turn.completed', 'turn.failed', 'turn.cancelled', 'turn.wait_ended'):
        return 'idle'
    if age <= FRESH_WORK_SECS:
        return 'working'
    if age >= STUCK_SECS:
        return 'stuck'
    return 'working'


def _next_run(routines, bot_id, now_ms):
    best = None
    for r in routines:
        if r.get('botId') != bot_id or not r.get('enabled'):
            continue
        at = r.get('nextRunAt')
        if not isinstance(at, (int, float)) or at <= now_ms:
            continue
        if best is None or at < best['at']:
            best = {'at': int(at), 'name': (r.get('name') or '')[:80]}
    return best


def collect(_machine='gpu1'):
    now_ms = int(time.time() * 1000)
    try:
        bots = _read_json(OMB / 'bots.json')
    except Exception as e:
        return {'ok': False, 'error': str(e), 'bots': []}
    try:
        routines = (_read_json(OMB / 'routines.json') or {}).get('routines') or []
    except Exception:
        routines = []
    rows = []
    for b in bots:
        tasks = b.get('tasks') or []
        task = tasks[0] if tasks else {}
        name = str(b.get('name') or '')
        short = name.split(' · ')[0].strip() or name
        thread = task.get('threadId') or b.get('threadId')
        events = []
        for tid in {thread, b.get('threadId')}:
            ev = _last_event(tid)
            if ev:
                events.append(ev)
        ev = max(events, key=lambda x: x['at']) if events else None
        sel = b.get('modelSelection') or {}
        rows.append({
            'id': b.get('id') or '',
            'name': name,
            'short': short,
            'role': str(b.get('title') or ''),
            'section': b.get('section') or '',
            'model': str(sel.get('model') or ''),
            'modelSelection': {'model': sel.get('model') or '', 'instanceId': sel.get('instanceId') or ''},
            'status': _state(ev, time.time()),
            'task': str(task.get('title') or '')[:120],
            'taskAt': task.get('updatedAt') if isinstance(task.get('updatedAt'), (int, float)) else None,
            'threadId': str(thread or ''),
            'nextRunAt': _next_run(routines, b.get('id'), now_ms),
        })
    return {'ok': True, 'source': 'OpenMausBot bots.json + routines.json + thread events', 'bots': rows}


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
    from cc import cfg, ingest
    if '--dry-run' in sys.argv:
        print(json.dumps(collect(), indent=1, ensure_ascii=False))
        return
    base, token = cfg('gpu1')
    ingest(base, token, 'team', collect())


if __name__ == '__main__':
    main()
