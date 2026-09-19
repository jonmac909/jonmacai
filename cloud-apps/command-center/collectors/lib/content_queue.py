import json
import os
from datetime import datetime, timezone
from pathlib import Path


def _dir():
    return Path(os.environ.get('CC_CONTENT_DIR') or (Path.home() / '.command-center'))


def collect_queue():
    path = _dir() / 'content-queue.json'
    if not path.is_file():
        return {'queued': [], 'missing': True}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return {'queued': [], 'missing': True}
    if isinstance(data, list):
        return {'queued': data}
    if not isinstance(data, dict):
        return {'queued': [], 'missing': True}
    data.setdefault('queued', [])
    return data


def handle(kind, payload):
    payload = payload or {}
    folder = _dir()
    folder.mkdir(parents=True, exist_ok=True)
    rec = {
        'kind': kind,
        'payload': payload,
        'at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    with (folder / 'content-approvals.jsonl').open('a', encoding='utf-8') as f:
        f.write(json.dumps(rec) + '\n')
    if not os.environ.get('CC_CONTENT_DIR'):
        try:
            _notify(kind, payload)
        except Exception:
            pass
    if kind == 'content.approve_all':
        n = len(payload.get('ids') or [])
        return True, payload.get('msg') or ('All %s posts approved and scheduled' % n)
    if kind == 'content.remix':
        return True, payload.get('msg') or 'Remix sent to Content Marketing agent'
    return True, payload.get('msg') or 'Post approved'


def _notify(kind, payload):
    from agents_collect import collect_agents, _run
    handle = None
    for row in collect_agents('gpu2'):
        if row.get('name') == 'Content Marketing' and row.get('handle'):
            handle = row['handle']
            break
    if not handle:
        return
    text = 'Command center %s: %s' % (kind, json.dumps(payload, ensure_ascii=False)[:1500])
    _run(['terminal', 'send', '--terminal', handle, '--text', text, '--enter', '--json'], 20)
