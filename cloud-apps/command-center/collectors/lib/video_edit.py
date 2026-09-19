import json
import os
import shutil
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_ROOT = r'C:\Users\partn\orca\workspaces\autotube\Davinci'


def root():
    return Path(os.environ.get('CC_VIDEO_ROOT') or DEFAULT_ROOT)


def queue_path():
    return root() / 'out' / 'queue-status.json'


def load_queue():
    p = queue_path()
    if not p.is_file():
        return []
    try:
        data = json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get('queue'), list):
        return data['queue']
    return []


def save_queue(items):
    p = queue_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(items, indent=2), encoding='utf-8')


def collect_queue():
    return {'queue': load_queue()}


def _copy_in(payload):
    rid = str(payload.get('id') or 'upload')
    filename = os.path.basename(str(payload.get('filename') or 'video.mp4')) or 'video.mp4'
    dest_dir = root() / 'in'
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / ('%s-%s' % (rid, filename))
    src = payload.get('path')
    if src:
        shutil.copyfile(src, dest)
        return dest
    url = payload.get('url')
    if not url:
        from cc import load_secrets
        sec = load_secrets()
        base = (sec.get('CC_BASE') or os.environ.get('CC_BASE') or 'https://jonmac.ai/dashboard').rstrip('/')
        key = payload.get('key') or ''
        url = '%s/api/uploads/%s?key=%s' % (base, urllib.parse.quote(rid), urllib.parse.quote(key))
        token = sec.get('MACHINE_TOKEN') or sec.get('MACHINE_TOKEN_GPU2') or ''
        req = urllib.request.Request(url)
        if token:
            req.add_header('Authorization', 'Bearer %s' % token)
        with urllib.request.urlopen(req, timeout=120) as res:
            dest.write_bytes(res.read())
        return dest
    with urllib.request.urlopen(url, timeout=120) as res:
        dest.write_bytes(res.read())
    return dest


def start_edit(payload):
    payload = payload or {}
    rid = str(payload.get('id') or 'upload')
    title = payload.get('title') or 'Recording'
    _copy_in(payload)
    queue = [q for q in load_queue() if q.get('id') != rid]
    busy = any(q.get('status') == 'editing' for q in queue)
    queue.append({
        'id': rid,
        'title': title,
        'step': 1,
        'steps': 5,
        'progress': 12,
        'etaMinutes': 40,
        'status': 'queued' if busy else 'editing',
        'readyPath': '',
    })
    save_queue(queue)
    return True, 'Edit started'


def prioritize(qid):
    queue = load_queue()
    hit = [q for q in queue if q.get('id') == qid]
    rest = [q for q in queue if q.get('id') != qid]
    if not hit:
        return False, 'not in queue'
    hit[0]['status'] = 'editing'
    for q in rest:
        if q.get('status') == 'editing':
            q['status'] = 'queued'
    save_queue(hit + rest)
    return True, 'Moved to the front of the line'


def handle(kind, payload):
    if kind == 'video.start_edit':
        return start_edit(payload)
    if kind == 'video.prioritize':
        return prioritize((payload or {}).get('id'))
    return False, 'unknown action %s' % kind
