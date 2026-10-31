#!/usr/bin/env python3
"""hook.py - wake a bot through its OpenBot webhook routine (Python stdlib only).

  hook.py fire EVENT [--data JSON | --data -] [--key ID]   send EVENT to every routine it wakes
  hook.py test [ROUTE ...]                                  send a test event (all routines by default)

EVENTS below says which routines each event wakes. Each routine's URL and signing secret live in
D:\\AgentTeam\\secrets\\webhooks.json as {"<route>": {"url": "...", "secret": "..."}} (override with
HOOK_SECRETS). Never print, paste or commit that file. --data - reads the JSON from stdin. --key makes
a retry safe: the same event and key are delivered once.

Prints {route: status}. Exit codes: 0 every routine took it (202, or 200 for a repeat); 1 a routine
refused it or stayed unreachable after retries; 2 a local problem (usage, bad JSON, no secrets file,
a routine without its secret). See HOOKS.md.
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

SECRETS = Path(os.environ.get('HOOK_SECRETS', r'D:\AgentTeam\secrets\webhooks.json'))
EVENTS = {
    'sponsor_email': ['sponsors', 'ana'],
    'raw_footage': ['video-editor'],
    'proof_posted': ['qc'],
    'script_failure': ['developer', 'ana'],
    'cancellation_spike': ['viral-view', 'ana'],
    'accounting_email': ['accounting'],
}
ROUTES = sorted({r for routes in EVENTS.values() for r in routes} | {'nina'})  # nina: dash.py picks the QC bot per proof
TRIES = 3
NO_SECRET = 'no secret'


class Fail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def load_routes():
    try:
        return json.loads(SECRETS.read_text(encoding='utf-8-sig'))
    except FileNotFoundError:
        raise Fail(2, '%s not found' % SECRETS)
    except ValueError as err:
        raise Fail(2, '%s is not valid JSON: %s' % (SECRETS, err))


def send(cfg, body, delivery):
    """POST one signed event and return the HTTP status (0 = unreachable). Retries 503 and network errors."""
    status = 0
    for attempt in range(TRIES):
        if attempt:
            time.sleep(2 * attempt)
        ts = str(int(time.time()))
        sig = hmac.new(cfg['secret'].encode(), ('%s.%s.' % (ts, delivery)).encode() + body, hashlib.sha256)
        req = urllib.request.Request(cfg['url'], data=body, method='POST', headers={
            'Content-Type': 'application/json', 'x-openbot-timestamp': ts,
            'x-openbot-delivery-id': delivery, 'x-openbot-signature': 'sha256=' + sig.hexdigest()})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status
        except urllib.error.HTTPError as err:
            if err.code != 503:
                return err.code
            status = 503
        except OSError:  # URLError, timeouts, resets
            status = 0
        except ValueError:  # malformed URL in the secrets file; its message would show the URL
            return 0
    return status


def fire(event, data=None, key=None, routes=None):
    """Send EVENT to the routines it wakes (or to `routes`). Returns {route: status}."""
    if routes is None:
        if event not in EVENTS:
            raise Fail(2, 'unknown event %s; known: %s' % (event, ', '.join(EVENTS)))
        routes = EVENTS[event]
    config = load_routes()
    body = json.dumps({'type': event, 'occurredAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                       'data': data if data is not None else {}}, ensure_ascii=False).encode()
    out = {}
    for route in routes:
        cfg = config.get(route) or {}
        if not cfg.get('url') or not cfg.get('secret'):
            out[route] = NO_SECRET
            continue
        delivery = (hashlib.sha256(('%s\n%s\n%s' % (route, event, key)).encode()).hexdigest()[:32]
                    if key is not None else uuid.uuid4().hex)
        out[route] = send(cfg, body, delivery)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('fire', help='send an event to the routines it wakes')
    a.add_argument('event', choices=sorted(EVENTS))
    a.add_argument('--data', default='{}', help='JSON object, or - to read it from stdin')
    a.add_argument('--key', help='unique id for this event, so a retry is delivered once')
    a = sub.add_parser('test', help='send a test event to routines (all by default)')
    a.add_argument('routes', nargs='*', metavar='ROUTE', help=', '.join(ROUTES))
    args = ap.parse_args(argv)
    if args.cmd == 'test' and set(args.routes) - set(ROUTES):
        ap.error('unknown route; known: %s' % ', '.join(ROUTES))
    try:
        if args.cmd == 'fire':
            raw = sys.stdin.buffer.read().decode('utf-8-sig') if args.data == '-' else args.data
            try:
                data = json.loads(raw)
            except ValueError as err:
                raise Fail(2, '--data is not JSON: %s' % err)
            out = fire(args.event, data, args.key)
        else:
            out = fire('test', {'note': 'Test from Developer: the webhook works. Nothing to do, just stop.'},
                       routes=args.routes or ROUTES)
    except Fail as err:
        print('hook.py: %s' % err, file=sys.stderr)
        return err.code
    print(json.dumps(out))
    if NO_SECRET in out.values():
        print('hook.py: no url or secret in %s for: %s' % (SECRETS, ', '.join(
            r for r, s in out.items() if s == NO_SECRET)), file=sys.stderr)
        return 2
    return 0 if all(s in (200, 202) for s in out.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
