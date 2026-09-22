"""Claim GPU1 video jobs and run the pinned Loop Studio cutter. CPU only."""
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from cc import cfg, claim, complete
from loop_studio import advance, open_job

ROOT = os.environ.get('LS_JOB_ROOT') or str(Path.home() / 'loop-studio-jobs')


def _progress(base, token, action_id, state):
    body = json.dumps({
        'host': 'gpu1',
        'stage': state.get('stage'),
        'device': state.get('device') or 'cpu',
        'encoder': state.get('encoder') or 'libx264',
        'failure': state.get('failure'),
        'retry': state.get('retry') or 0,
        'validated': bool(state.get('validated')),
        'outputKey': state.get('outputKey'),
    }).encode('utf-8')
    req = urllib.request.Request(
        base.rstrip('/') + '/api/actions/%s/progress' % action_id,
        data=body,
        method='POST',
    )
    req.add_header('Authorization', 'Bearer %s' % token)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode('utf-8') or '{}')


def _download(base, token, key, dest):
    url = base.rstrip('/') + '/api/uploads/%s?key=%s' % (key.split('/')[1], urllib.parse.quote(key))
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer %s' % token)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=120) as res:
        dest.write_bytes(res.read())


def run_once():
    import urllib.parse
    base, token = cfg('gpu1')
    for action in claim(base, token, 'gpu1'):
        if action.get('kind') != 'video.start_edit':
            continue
        payload = json.loads(action.get('payload') or '{}')
        job = Path(open_job(ROOT, payload.get('id') or action['id'], payload.get('title') or 'Upload'))
        raw = job / 'raw.mp4'
        if not raw.exists() and payload.get('key'):
            _download(base, token, payload['key'], raw)
        keepers = payload.get('keepers')
        if keepers:
            (job / 'keepers.json').write_text(json.dumps(keepers), encoding='utf-8')
        state = advance(str(job), str(raw))
        if state.get('stage') == 'done' and state.get('output'):
            state['outputKey'] = 'uploads/%s/out.mp4' % (payload.get('id') or action['id'])
            _progress(base, token, action['id'], state)
            complete(base, token, action['id'], True, state)
        else:
            _progress(base, token, action['id'], state)
            if state.get('stage') == 'failed':
                complete(base, token, action['id'], False, state)


if __name__ == '__main__':
    run_once()
