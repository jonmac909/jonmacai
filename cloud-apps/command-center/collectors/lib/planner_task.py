import json
from agents_collect import _json, _run


def send_to_planner(payload):
    title = (payload.get('title') or 'Mastermind idea').strip()[:80]
    body = (payload.get('body') or payload.get('text') or title).strip()
    prompt = body + '\n\nFrom Mastermind: https://jonmac.ai/dashboard/#mastermind'
    name = 'Planner - ' + title[:48]
    repo = 'path:C:/Users/partn/my-agent'
    args = ['worktree', 'create', '--name', name, '--repo', repo, '--base-branch', 'jarvis-v2', '--agent', 'omp', '--prompt', prompt]
    try:
        wts = _json(['worktree', 'ps']).get('worktrees') or []
    except Exception:
        wts = []
    planner = next((w for w in wts if (w.get('displayName') or '') == 'Planner'), None)
    if planner:
        args.extend(['--parent-worktree', 'name:Planner'])
    else:
        args.append('--no-parent')
    code, out, err = _run([*args, '--json'], 60)
    if code != 0:
        return False, (err or out or 'Planner task failed')[-200:]
    try:
        data = json.loads(out or '{}')
    except Exception:
        data = {}
    if data.get('ok') is False:
        err = (data.get('error') or {}).get('message') or 'Planner task failed'
        return False, err[-200:]
    return True, 'Sent to Planner as a task'
