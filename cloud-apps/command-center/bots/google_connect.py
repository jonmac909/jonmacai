#!/usr/bin/env python3
"""google_connect.py - Jon connects each Google account to the team with one consent click (stdlib only).

  google_connect.py serve [--hours 24]   local page on http://localhost:8765/ with one link per account
  google_connect.py status               which accounts are connected (no secrets printed)

Open http://localhost:8765/<account> in a browser on GPU1 (the consent returns to this PC). Each link
goes to Google's consent screen for that account; afterwards the token is checked (right account,
every scope ticked) and saved to D:\\AgentTeam\\secrets\\google\\<account>.json. The OAuth client is
the old Hermes one (project ana-assistant-510518), in D:\\AgentTeam\\secrets\\google\\client.json.
The server stops when every account is connected or after --hours. Never print or copy the files.
See GOOGLE.md.
"""
import argparse
import base64
import hashlib
import html
import json
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIR = Path(os.environ.get('GOOGLE_SECRETS', r'D:\AgentTeam\secrets\google'))
PORT = 8765
REDIRECT = 'http://localhost:%d/' % PORT
GMAIL, CAL = 'https://www.googleapis.com/auth/gmail.', 'https://www.googleapis.com/auth/calendar.'
# One consent per account, with every scope the team needs on it. What each bot may do with it is
# enforced by google_api.py, not by Google: see GOOGLE.md.
ACCOUNTS = {
    'partners': ('partners@thejonmac.com', [GMAIL + 'readonly', GMAIL + 'compose']),  # watcher, Sponsors drafts
    'jon': ('jon@thejonmac.com', [GMAIL + 'modify', CAL + 'events']),  # Inbox, Accounting, watcher, Ana calendar
}
# shortcut: the Hermes client's app ("Historient") is internal to thejonmac.com, so Google blocks
# jonstagger@gmail.com (Error 403 org_internal). Connect that account another way (see GOOGLE.md).


def client():
    return json.loads((DIR / 'client.json').read_text(encoding='utf-8'))['installed']


def connected(slug):
    try:
        return json.loads((DIR / ('%s.json' % slug)).read_text(encoding='utf-8')).get('email') == ACCOUNTS[slug][0]
    except (OSError, ValueError):
        return False


def post(url, fields):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def profile_email(access_token):
    req = urllib.request.Request('https://gmail.googleapis.com/gmail/v1/users/me/profile',
                                 headers={'Authorization': 'Bearer ' + access_token})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())['emailAddress'].lower()


class Flow:
    """Pending consents: state -> (slug, PKCE verifier). In memory only; a restart just needs a new click."""
    def __init__(self):
        self.pending, self.lock = {}, threading.Lock()

    def start(self, slug):
        state, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(64)
        with self.lock:
            self.pending[state] = (slug, verifier)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        email, scopes = ACCOUNTS[slug]
        return 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode({
            'client_id': client()['client_id'], 'redirect_uri': REDIRECT, 'response_type': 'code',
            'scope': ' '.join(scopes), 'access_type': 'offline', 'prompt': 'consent', 'login_hint': email,
            'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'})

    def finish(self, state, code):
        """Exchange the code; save the token only if it is the right account with every scope. Returns (slug, problem)."""
        with self.lock:
            slug, verifier = self.pending.pop(state, (None, None))
        if not slug:
            return None, 'This consent link expired. Open the account link again.'
        email, scopes = ACCOUNTS[slug]
        c = client()
        try:
            tok = post(c['token_uri'], {'code': code, 'client_id': c['client_id'], 'client_secret': c['client_secret'],
                                        'redirect_uri': REDIRECT, 'grant_type': 'authorization_code',
                                        'code_verifier': verifier})
        except urllib.error.HTTPError as err:
            return slug, 'Google refused the code (%s). Open the link again.' % err.code
        granted = set((tok.get('scope') or '').split())
        missing = [s.rsplit('/', 1)[1] for s in scopes if s not in granted]
        if missing:
            return slug, 'Some permissions were not ticked (%s). Open the link again and tick every box.' % ', '.join(missing)
        if not tok.get('refresh_token'):
            return slug, 'Google sent no long-lived token. Open the link again.'
        got = profile_email(tok['access_token'])
        if got != email:
            return slug, 'That was %s. Open the link again and choose %s.' % (got, email)
        DIR.mkdir(parents=True, exist_ok=True)
        tmp = DIR / ('%s.json.tmp' % slug)
        tmp.write_text(json.dumps({'account': slug, 'email': email, 'scopes': sorted(granted),
                                   'refresh_token': tok['refresh_token'],
                                   'connected_at': time.strftime('%Y-%m-%dT%H:%M:%S%z')}), encoding='utf-8')
        os.replace(tmp, DIR / ('%s.json' % slug))
        return slug, ''


def page(body):
    return ('<!doctype html><meta charset="utf-8"><title>Connect Google</title>'
            '<body style="font:16px system-ui;max-width:640px;margin:40px auto;line-height:1.5">%s</body>' % body).encode()


def index():
    rows = ''.join('<li><a href="/%s">%s</a> %s</li>' % (s, html.escape(e), '&#10003; connected' if connected(s) else '')
                   for s, (e, _) in ACCOUNTS.items())
    return page('<h1>Connect Google accounts to the team</h1><p>Click each account, pick that account on Google, '
                'tick every box and press Continue.</p><ul>%s</ul>' % rows)


def handler(flow, done):
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            slug = u.path.strip('/')
            if slug in ACCOUNTS:
                self.send_response(302)
                self.send_header('Location', flow.start(slug))
                self.end_headers()
                return
            if 'state' in q:
                if 'code' in q:
                    slug, problem = flow.finish(q['state'], q['code'])
                else:
                    slug, problem = None, 'Google said: %s. Open the account link again.' % q.get('error', 'cancelled')
                log('%s %s' % (slug or '?', problem or 'connected'))
                body = ('<h1>Not connected yet</h1><p>%s</p>' % html.escape(problem) if problem else
                        '<h1>Connected %s</h1><p>You can close this tab.</p>' % html.escape(ACCOUNTS[slug][0]))
                self.reply(page(body + '<p><a href="/">All accounts</a></p>'))
                if all(connected(s) for s in ACCOUNTS):
                    done.set()
                return
            self.reply(index())

        def reply(self, body):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass
    return H


def log(text):
    path = Path(os.environ.get('GOOGLE_CONNECT_LOG', r'D:\AgentTeam\logs\google_connect.log'))
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        f.write('%s %s\n' % (time.strftime('%Y-%m-%dT%H:%M:%S'), text))


def serve(hours):
    client()  # fail now if the client file is missing
    done = threading.Event()
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), handler(Flow(), done))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    log('serving on %s' % REDIRECT)
    done.wait(hours * 3600)
    time.sleep(2)  # let the last page reach the browser
    srv.shutdown()
    log('stopped: %s' % ('all accounts connected' if done.is_set() else 'time limit'))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('serve').add_argument('--hours', type=float, default=24)
    sub.add_parser('status')
    args = ap.parse_args(argv)
    if args.cmd == 'serve':
        serve(args.hours)
    else:
        print(json.dumps({s: connected(s) for s in ACCOUNTS}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
