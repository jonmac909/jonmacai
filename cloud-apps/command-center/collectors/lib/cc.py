import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

LABEL = {'mac': 'Mac mini', 'gpu2': 'GPU2'}


def utc_now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_secrets(path=None):
    home = Path.home() / '.command-center' / 'secrets.env'
    p = Path(path or os.environ.get('CC_SECRETS', home))
    out = {}
    if not p.is_file():
        return out
    for line in p.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def load_sources(folder):
    import importlib.util
    mods = []
    for p in sorted(Path(folder).glob('*.py')):
        if p.name.startswith('_'):
            continue
        spec = importlib.util.spec_from_file_location(p.stem, p)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if hasattr(mod, 'source') and hasattr(mod, 'collect'):
            mods.append(mod)
    return mods


def handle_action(kind, payload, machine):
    if kind == 'ping':
        return True, '%s is up' % LABEL.get(machine, machine)
    if str(kind).startswith('sponsor.'):
        from sponsors import handle as sponsor_handle
        return sponsor_handle(kind, payload or {})
    if str(kind).startswith('support.'):
        from support_mail import handle as support_handle
        return support_handle(kind, payload or {})
    if kind == 'mastermind.send_to_planner':
        from planner_task import send_to_planner
        return send_to_planner(payload or {})
    if kind == 'agent.restart':
        from agents_collect import restart_agent
        return restart_agent(payload or {})
    if kind == 'mastermind.scan':
        from telegram_digest import run_digest
        n = run_digest()
        return True, 'Scanned %s messages' % n
    return False, 'unknown action %s' % kind


def _req(url, token, body):
    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', 'Bearer %s' % token)
    req.add_header('User-Agent', 'CommandCenterCollector/1.0')
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=30, context=ctx) as res:
        return json.loads(res.read().decode('utf-8') or '{}')


def ingest(base, token, source, data, collected_at=None):
    return _req(base.rstrip('/') + '/api/ingest', token, {
        'source': source,
        'collectedAt': collected_at or utc_now(),
        'data': data,
    })


def claim(base, token, machine):
    return _req(base.rstrip('/') + '/api/actions/claim', token, {'machine': machine}).get('actions') or []


def complete(base, token, action_id, ok, result):
    return _req(base.rstrip('/') + '/api/actions/%s/complete' % action_id, token, {
        'ok': bool(ok),
        'result': result,
    })


def cfg(machine):
    sec = load_secrets()
    token = sec.get('MACHINE_TOKEN') or sec.get('MACHINE_TOKEN_MAC' if machine == 'mac' else 'MACHINE_TOKEN_GPU2')
    base = sec.get('CC_BASE') or 'https://jonmac.ai/dashboard'
    if not token:
        raise SystemExit('missing MACHINE_TOKEN in secrets.env')
    return base, token


def main_collect(machine):
    base, token = cfg(machine)
    here = Path(sys.argv[0]).resolve().parent / 'sources'
    payloads = []
    for mod in load_sources(here):
        payloads.append((mod.source(machine), mod.collect(machine)))
    if '--dry-run' in sys.argv:
        print(json.dumps([{'source': s, 'data': d} for s, d in payloads]))
        return
    for source, data in payloads:
        ingest(base, token, source, data)
        print('ingested %s' % source)

def main_run(machine):
    base, token = cfg(machine)
    once = '--once' in sys.argv
    print('runner up', flush=True)
    while True:
        try:
            for row in claim(base, token, machine):
                payload = row.get('payload') or '{}'
                if isinstance(payload, str):
                    try:
                        payload = json.loads(payload)
                    except Exception:
                        payload = {}
                try:
                    ok, result = handle_action(row.get('kind'), payload, machine)
                except Exception as e:
                    ok, result = False, '%s: %s' % (type(e).__name__, e)
                complete(base, token, row['id'], ok, str(result)[:500])
        except urllib.error.HTTPError as e:
            sys.stderr.write('runner http %s\n' % e.code)
        except Exception as e:
            sys.stderr.write('runner error: %s\n' % type(e).__name__)
        if once:
            return
        time.sleep(15)
