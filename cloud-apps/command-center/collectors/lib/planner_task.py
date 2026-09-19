import json
import subprocess

from agents_collect import _json, _orca


def send_to_planner(payload):
    title = (payload.get('title') or 'Mastermind idea').strip()[:80]
    body = (payload.get('body') or payload.get('text') or title).strip()
    prompt = body + '\n\nFrom Mastermind: https://jonmac.ai/dashboard/#mastermind'
    name = 'Planner - ' + title[:48]
    args = ['worktree', 'create', '--name', name, '--agent', 'omp', '--prompt', prompt]
    try:
        wts = _json(['worktree', 'ps']).get('worktrees') or []
    except Exception:
        wts = []
    planner = next((w for w in wts if (w.get('displayName') or '') == 'Planner'), None)
    if planner:
        args.extend(['--parent-worktree', 'name:Planner'])
    else:
        args.append('--no-parent')
    r = subprocess.run([_orca(), *args, '--json'], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        return False, (r.stderr or r.stdout or 'Planner task failed')[-200:]
    try:
        data = json.loads(r.stdout or '{}')
        wid = (data.get('result') or data).get('id') or name
    except Exception:
        wid = name
    return True, 'Sent to Planner as a task'
