#!/usr/bin/env python3
"""google_connect.py - Jon connects each Google account and YouTube channel to the team with one consent click (stdlib only).

  google_connect.py serve [--hours 24]   local page on http://localhost:8765/ with one link per account and channel
  google_connect.py status               which accounts and channels are connected (no secrets printed)

Open http://localhost:8765/ in a browser on GPU1 (the consent returns to this PC). Each link goes to
Google's consent screen; afterwards the token is checked (right account or channel, every scope ticked)
and saved to D:\\AgentTeam\\secrets\\google\\<account>.json (YouTube: yt-<channel>.json). Gmail uses the old
Hermes client (project ana-assistant-510518, client.json). YouTube uses Jon's own External app
(youtube-client.json, pasted on the page) when it exists, else client.json. The server stops when
everything is connected or after --hours. The same page connects Instagram/Facebook and TikTok for short_post.py
(D:\\AgentTeam\\secrets\\social\\). Never print or copy the files. See GOOGLE.md.
"""
import argparse
import base64
import hashlib
import hmac
import html
import json
import os
import re
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
HOSTS = ('localhost:%d' % PORT, '127.0.0.1:%d' % PORT)
GMAIL, CAL = 'https://www.googleapis.com/auth/gmail.', 'https://www.googleapis.com/auth/calendar.'
# One consent per account, with every scope the team needs on it. What each bot may do with it is
# enforced by google_api.py, not by Google: see GOOGLE.md.
ACCOUNTS = {
    'partners': ('partners@thejonmac.com', [GMAIL + 'readonly', GMAIL + 'compose']),  # watcher, Sponsors drafts
    'jon': ('jon@thejonmac.com', [GMAIL + 'modify', CAL + 'events']),  # Inbox, Accounting, watcher, Ana calendar
}
# shortcut: the Hermes client's app ("Historient") is internal to thejonmac.com, so Google blocks
# jonstagger@gmail.com (Error 403 org_internal). Connect that account another way (see GOOGLE.md).
sys.path.insert(0, str(Path(__file__).resolve().parent))
import youtube_upload as yt  # noqa: E402  (channel list, YouTube OAuth client, scope)
import short_post as sp  # noqa: E402  (Meta and TikTok sign-ins for the short clips)

# A brand channel is its own Google identity, so YouTube needs one consent per channel.
YOUTUBE = {'yt-' + k: v for k, v in yt.CHANNELS.items()}  # slug: (name, account, channel id)
SOCIAL = {'meta': 'Instagram and Facebook', 'tiktok': 'TikTok'}


def client():
    return json.loads((DIR / 'client.json').read_text(encoding='utf-8'))['installed']


def target(slug):
    """(login hint, scopes, which field names the identity, the identity it must be) for one link."""
    if slug in YOUTUBE:
        return yt.ACCOUNTS[YOUTUBE[slug][1]], [yt.SCOPE], 'channel', YOUTUBE[slug][2]
    return ACCOUNTS[slug][0], ACCOUNTS[slug][1], 'email', ACCOUNTS[slug][0]


def oauth_client(slug):
    return yt.client() if slug in YOUTUBE else client()


def label(slug):
    return YOUTUBE[slug][0] if slug in YOUTUBE else SOCIAL[slug] if slug in SOCIAL else ACCOUNTS[slug][0]


def connected(slug):
    if slug in YOUTUBE:
        return yt.connected(slug[3:])
    if slug in SOCIAL:
        return sp.connected(slug)
    _, _, key, want = target(slug)
    try:
        return json.loads((DIR / ('%s.json' % slug)).read_text(encoding='utf-8')).get(key) == want
    except (OSError, ValueError):
        return False


def everything():
    return list(ACCOUNTS) + list(YOUTUBE) + list(SOCIAL)


def post(url, fields):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def profile_email(access_token):
    req = urllib.request.Request('https://gmail.googleapis.com/gmail/v1/users/me/profile',
                                 headers={'Authorization': 'Bearer ' + access_token})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())['emailAddress'].lower()


def channel_id(access_token):
    req = urllib.request.Request('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
                                 headers={'Authorization': 'Bearer ' + access_token})
    with urllib.request.urlopen(req, timeout=30) as r:
        items = json.loads(r.read()).get('items') or []
    return items[0]['id'] if items else 'an account with no channel'


def save_youtube_client(client_id, client_secret):
    """Jon pastes his YouTube app's Desktop client on the page. Returns a problem or ''."""
    if not re.fullmatch(r'[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com', client_id) or \
            not re.fullmatch(r'[A-Za-z0-9_-]{20,64}', client_secret):
        return 'That is not a Client ID and secret. Copy both again from the Clients page.'
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = DIR / 'youtube-client.json.tmp'
    tmp.write_text(json.dumps({'installed': {
        'client_id': client_id, 'client_secret': client_secret, 'redirect_uris': ['http://localhost'],
        'auth_uri': 'https://accounts.google.com/o/oauth2/auth', 'token_uri': 'https://oauth2.googleapis.com/token'}}),
        encoding='utf-8')
    os.replace(tmp, DIR / 'youtube-client.json')
    return ''


class Flow:
    """Pending consents: state -> (slug, PKCE verifier). In memory only; a restart just needs a new click."""
    def __init__(self):
        self.pending, self.lock = {}, threading.Lock()
        self.form_key = secrets.token_urlsafe(16)  # only this page may post the YouTube client form

    def start(self, slug):
        state, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(64)
        with self.lock:
            self.pending[state] = (slug, verifier)
        if slug == 'tiktok':
            return sp.tiktok_auth_url(state, verifier)
        challenge =base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        hint, scopes, _, _ = target(slug)
        q = {'client_id': oauth_client(slug)['client_id'], 'redirect_uri': REDIRECT, 'response_type': 'code',
             'scope': ' '.join(scopes), 'access_type': 'offline', 'prompt': 'consent',
             'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'}
        if hint:
            q['login_hint'] = hint
        return 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode(q)

    def finish(self, state, code):
        """Exchange the code; save the token only if it is the right account or channel with every scope.
        Returns (slug, problem)."""
        with self.lock:
            slug, verifier = self.pending.pop(state, (None, None))
        if not slug:
            return None, 'This consent link expired. Open the account link again.'
        if slug == 'tiktok':
            return slug, sp.tiktok_connect(code, verifier)
        _, scopes, key, want = target(slug)
        c = oauth_client(slug)
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
        try:
            got = (channel_id if key == 'channel' else profile_email)(tok['access_token'])
        except urllib.error.HTTPError as err:
            return slug, 'Google would not say which account that was (%s). Open the link again.' % err.code
        if got != want:
            return slug, 'That was %s. Open the link again and choose %s.' % (got, label(slug))
        DIR.mkdir(parents=True, exist_ok=True)
        tmp = DIR / ('%s.json.tmp' % slug)
        tmp.write_text(json.dumps({'account': slug, key: want, 'client_id': c['client_id'], 'scopes': sorted(granted),
                                   'refresh_token': tok['refresh_token'],
                                   'connected_at': time.strftime('%Y-%m-%dT%H:%M:%S%z')}), encoding='utf-8')
        os.replace(tmp, DIR / ('%s.json' % slug))
        return slug, ''


def page(body):
    return ('<!doctype html><meta charset="utf-8"><title>Connect Google</title>'
            '<body style="font:16px system-ui;max-width:640px;margin:40px auto;line-height:1.5">%s</body>' % body).encode()


SETUP = '''<h1>Connect accounts to the team</h1>
<h2>1. YouTube app (once, 5 min, signed in as jon@)</h2><ol>
<li><a href="https://console.cloud.google.com/projectcreate">Create a project</a> named Jon Mac Team YouTube.</li>
<li><a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com">Turn on YouTube Data API v3</a> in it.</li>
<li><a href="https://console.cloud.google.com/auth/overview">Google Auth Platform</a>: Get started. App name Jon Mac Team,
your email, audience <b>External</b>.</li>
<li><a href="https://console.cloud.google.com/auth/audience">Audience</a>: press <b>Publish app</b>
(otherwise every sign-in expires after 7 days).</li>
<li><a href="https://console.cloud.google.com/auth/clients">Clients</a>: Create client, type <b>Desktop app</b>,
then paste its Client ID and secret here (YouTube app: %(app)s):
<form method="post" action="/youtube-client"><input type="hidden" name="key" value="%(key)s">
<input name="client_id" placeholder="Client ID" size="60" autocomplete="off"><br>
<input name="client_secret" placeholder="Client secret" size="60" autocomplete="off" type="password">
<button>Save</button></form></li></ol>
<h2>2. YouTube channels (about 30 s each)</h2>
<p>Click a channel, choose the Google account, then choose <b>that channel</b> and press Continue. Google says the app
is not verified: press Advanced, then Go to Jon Mac Team.</p>%(youtube)s
<h2>3. Thumbnails</h2><p>YouTube allows custom thumbnails only on phone-verified channels.
<a href="https://www.youtube.com/verify">Verify the channel</a> that is switched on in YouTube (one phone number covers
2 channels a year).</p>
<h2>4. YouTube API audit</h2><p>Until Google approves it, videos the bots upload stay private for good, so the bots
upload in Studio meanwhile. <a href="https://support.google.com/youtube/contact/yt_api_form">Open the form</a> and copy
<a href="https://github.com/jonmac909/jonmacai/blob/main/cloud-apps/command-center/bots/GOOGLE.md#youtube-api-audit-answers">the
written answers</a>.</p>
<h2>5. Instagram and Facebook (once, 15 min)</h2><p>Your Instagram must be a professional account linked to your
Facebook Page. No Meta review is needed for your own accounts.</p><ol>
<li><a href="https://developers.facebook.com/apps/creation/">Meta for Developers</a>: create an app named Jon Mac Team,
type Business. Add Facebook Login for Business and Instagram.</li>
<li><a href="https://developers.facebook.com/tools/explorer/">Graph API Explorer</a>: pick the Jon Mac Team app, add the
permissions pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish and
business_management (plus ads_management and ads_read if the Page sits in a Meta business portfolio), press
<b>Generate Access Token</b> and choose only your Page and its Instagram.</li>
<li>Paste the App ID and App secret (App settings, Basic) and that token here (Instagram and Facebook: %(meta)s):
<form method="post" action="/meta"><input type="hidden" name="key" value="%(key)s">
<input name="app_id" placeholder="App ID" size="60" autocomplete="off"><br>
<input name="app_secret" placeholder="App secret" size="60" autocomplete="off" type="password"><br>
<input name="token" placeholder="Access token" size="60" autocomplete="off" type="password">
<button>Save</button></form></li>
<li>App settings, Basic: Privacy Policy URL https://viralview.io/privacy, then switch App Mode to <b>Live</b>
(in Development mode the posts show only to you).</li></ol>
<h2>6. TikTok (once, 15 min)</h2><ol>
<li><a href="https://developers.tiktok.com/apps/">TikTok for Developers</a>: sign up, Connect an app named Jon Mac Team,
platform <b>Desktop</b>. Add Login Kit with the redirect URI <code>%(tiktok_redirect)s</code>, and Content Posting API with
Direct Post on. Under Sandbox, add your TikTok account as a target user.</li>
<li>Paste the Client key and Client secret here (TikTok app: %(tiktok_app)s):
<form method="post" action="/tiktok-client"><input type="hidden" name="key" value="%(key)s">
<input name="client_key" placeholder="Client key" size="60" autocomplete="off"><br>
<input name="client_secret" placeholder="Client secret" size="60" autocomplete="off" type="password">
<button>Save</button></form></li>
<li><a href="/tiktok">Connect TikTok</a> %(tiktok)s</li></ol>
<p>Until TikTok audits the app, each approved clip arrives in your TikTok inbox: tap the notification, paste the
caption and post.</p>
<h2>Gmail and Calendar</h2><ul>%(gmail)s</ul>'''


def index(form_key):
    def li(slug):
        return '<li><a href="/%s">%s</a> %s</li>' % (slug, html.escape(label(slug)),
                                                      '&#10003; connected' if connected(slug) else '')
    groups = {}
    for slug, (_, account, _) in YOUTUBE.items():
        groups.setdefault(account, []).append(li(slug))
    youtube = ''.join('<h3>%s</h3><ul>%s</ul>' % (html.escape(yt.ACCOUNTS[a] or "Jacqueline's account (she signs in)"),
                                                  ''.join(rows)) for a, rows in groups.items())
    return page(SETUP % {'app': 'saved' if (DIR / 'youtube-client.json').exists() else 'not saved yet',
                         'key': form_key, 'youtube': youtube, 'gmail': ''.join(li(s) for s in ACCOUNTS),
                         'meta': 'connected' if connected('meta') else 'not connected yet',
                         'tiktok_app': 'saved' if (sp.DIR / 'tiktok-client.json').exists() else 'not saved yet',
                         'tiktok': '&#10003; connected' if connected('tiktok') else '', 'tiktok_redirect': sp.TIKTOK_REDIRECT})


# The forms on the page: path -> (save function, its form fields, what Jon sees when it worked)
FORMS = {'/youtube-client': (save_youtube_client, ('client_id', 'client_secret'), 'YouTube app saved. Now connect the channels.'),
         '/meta': (sp.meta_connect, ('app_id', 'app_secret', 'token'), 'Instagram and Facebook connected.'),
         '/tiktok-client': (sp.tiktok_client_save, ('client_key', 'client_secret'), 'TikTok app saved. Now press Connect TikTok.')}


def handler(flow, done):
    class H(BaseHTTPRequestHandler):
        def foreign(self):  # another site reaching this page through DNS rebinding
            if self.headers.get('Host') in HOSTS:
                return False
            self.send_error(403)
            return True

        def do_GET(self):
            if self.foreign():
                return
            u = urllib.parse.urlparse(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            slug = u.path.strip('/')
            if slug == 'tiktok' and not (sp.DIR / 'tiktok-client.json').exists():
                self.reply(page('<h1>Save the TikTok app first</h1><p><a href="/">Back to the connect page</a></p>'))
                return
            if slug in ACCOUNTS or slug in YOUTUBE or slug == 'tiktok':
                self.send_response(302)
                self.send_header('Location', flow.start(slug))
                self.end_headers()
                return
            if 'state' in q:
                if 'code' in q:
                    slug, problem = flow.finish(q['state'], q['code'])
                else:
                    slug, problem = None, 'The sign-in said: %s. Open the account link again.' % q.get('error', 'cancelled')
                log('%s %s' % (slug or '?', problem or 'connected'))
                body = ('<h1>Not connected yet</h1><p>%s</p>' % html.escape(problem) if problem else
                        '<h1>Connected %s</h1><p>You can close this tab.</p>' % html.escape(label(slug)))
                self.reply(page(body + '<p><a href="/">All accounts</a></p>'))
                if all(connected(s) for s in everything()):
                    done.set()
                return
            self.reply(index(flow.form_key))

        def do_POST(self):
            if self.foreign():
                return
            size = int(self.headers.get('Content-Length') or 0)
            form = dict(urllib.parse.parse_qsl(self.rfile.read(min(size, 4096)).decode('utf-8', 'replace')))
            path = urllib.parse.urlparse(self.path).path
            if path not in FORMS or not hmac.compare_digest(form.get('key', ''), flow.form_key):
                self.reply(page('<h1>Not saved</h1><p>Open <a href="/">the connect page</a> and try again.</p>'))
                return
            save, fields, ok = FORMS[path]
            problem = save(*(form.get(f, '').strip() for f in fields))
            log('%s %s' % (path, problem or 'saved'))
            self.reply(page('<h1>%s</h1><p><a href="/">Back to the connect page</a></p>' % html.escape(problem or ok)))

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
        print(json.dumps({s: connected(s) for s in everything()}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
