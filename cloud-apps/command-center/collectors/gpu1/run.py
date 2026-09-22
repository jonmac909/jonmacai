"""Claim GPU1 video jobs and run the pinned Loop Studio cutter. CPU only."""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from cc import acquire_run_lock, cfg, claim, complete, ingest
from loop_studio import advance, missing_lines, open_job

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
        'segments': state.get('segments') or [],
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
def _put_output(base, token, upload_id, path):
    req = urllib.request.Request(
        base.rstrip('/') + '/api/uploads/%s/output' % urllib.parse.quote(upload_id),
        data=path.read_bytes(),
        method='PUT',
    )
    req.add_header('Authorization', 'Bearer %s' % token)
    req.add_header('Content-Type', 'video/mp4')
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read().decode('utf-8') or '{}')



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
        expected = payload.get('expectedLines') or []
        exp_path = job / 'expected.json'
        if not expected and exp_path.exists():
            expected = json.loads(exp_path.read_text(encoding='utf-8'))
        if state.get('stage') == 'done' and expected:
            import ls_platform
            heard = ls_platform.transcribe(str(job / 'out.mp4')).get('text') or ''
            missed = missing_lines(heard, expected)
            if missed:
                state['stage'] = 'quality-failure'
                state['validated'] = False
                state['failure'] = 'missing unique lines: ' + '; '.join(missed)
        if state.get('stage') == 'done' and state.get('output'):
            out_key = 'uploads/%s/out.mp4' % (payload.get('id') or action['id'])
            _put_output(base, token, payload.get('id') or action['id'], Path(state['output']))
            state['outputKey'] = out_key
            _progress(base, token, action['id'], state)
            complete(base, token, action['id'], True, state)
        else:
            _progress(base, token, action['id'], state)
            if state.get('stage') in ('failed', 'quality-failure'):
                complete(base, token, action['id'], False, state)


def _beat(base, token):
    try:
        ingest(base, token, 'video_gpu1', {'ok': True, 'host': 'gpu1', 'device': 'cpu', 'encoder': 'libx264'})
    except Exception as err:
        sys.stderr.write('heartbeat %s\n' % type(err).__name__)


def main():
    acquire_run_lock('gpu1')
    once = '--once' in sys.argv
    while True:
        base, token = cfg('gpu1')
        _beat(base, token)
        try:
            run_once()
        except Exception as err:
            sys.stderr.write('runner %s\n' % type(err).__name__)
        if once:
            return
        time.sleep(15)


if __name__ == '__main__':
    main()
