"""GPU1 Loop Studio stages. Calls the pinned cutter. Does not invent keepers or a fake queue."""
import json
import os
import subprocess
import sys
from pathlib import Path

HOST = 'gpu1'
def missing_lines(text, expected):
    heard = (text or '').lower()
    return [line for line in expected or [] if line.lower() not in heard]



def open_job(root, upload_id, title):
    job = Path(root) / upload_id
    job.mkdir(parents=True, exist_ok=True)
    state_path = job / 'state.json'
    if not state_path.exists():
        state_path.write_text(json.dumps({
            'id': upload_id,
            'title': title,
            'host': HOST,
            'stage': 'queued',
            'device': os.environ.get('LS_DEVICE', 'cpu'),
            'encoder': os.environ.get('LS_ENCODER', 'libx264'),
            'failure': None,
            'retry': 0,
            'validated': False,
            'output': None,
        }), encoding='utf-8')
    return str(job)


def _state(job):
    return json.loads((Path(job) / 'state.json').read_text(encoding='utf-8'))


def _save(job, state):
    (Path(job) / 'state.json').write_text(json.dumps(state), encoding='utf-8')
    return state
def segments_from_words(path):
    words = json.loads(Path(path).read_text(encoding='utf-8'))
    groups, cur = [], []
    for word in words:
        if cur and float(word['s']) - float(cur[-1]['e']) > 1:
            groups.append(cur)
            cur = []
        cur.append(word)
    if cur:
        groups.append(cur)
    return [{
        'cs': float(g[0]['s']),
        'ce': float(g[-1]['e']),
        'label': ' '.join(w['w'] for w in g).strip(),
    } for g in groups if g]



def _cut(job, *args):
    cutter = os.environ.get('LS_CUTTER')
    if not cutter:
        raise RuntimeError('LS_CUTTER is not set')
    env = os.environ.copy()
    env['CUDA_VISIBLE_DEVICES'] = ''
    env['LS_WHISPER_DEVICE'] = 'cpu'
    subprocess.run([sys.executable, cutter, *args], check=True, env=env)


def advance(job, raw=None):
    job = Path(job)
    state = _state(job)
    raw = raw or str(job / 'raw.mp4')
    work = str(job / 'work')
    keepers = job / 'keepers.json'
    try:
        if not keepers.exists():
            _cut(job, 'prep', raw, work, '')
            state['stage'] = 'waiting-for-review'
            state['failure'] = None
            state['validated'] = False
            words = job / 'work' / 'words.json'
            state['segments'] = segments_from_words(words) if words.exists() else []
            state['stage'] = 'waiting-for-review'
            return _save(job, state)
        out = str(job / 'out.mp4')
        state['stage'] = 'finish'
        _save(job, state)
        _cut(job, 'render', raw, str(keepers), out)
        state['stage'] = 'verify'
        _save(job, state)
        _cut(job, 'verify', out)
        state['stage'] = 'done'
        state['validated'] = True
        state['output'] = out
        state['failure'] = None
        return _save(job, state)
    except Exception as err:
        state['stage'] = 'failed'
        state['failure'] = str(err)
        state['retry'] = int(state.get('retry') or 0) + 1
        state['validated'] = False
        return _save(job, state)
