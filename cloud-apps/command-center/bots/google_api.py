#!/usr/bin/env python3
"""google_api.py - Gmail and Calendar for the bots, each bot limited to what it may do (stdlib only).

  google_api.py subjects ACCOUNT [-n 5] [--query "in:inbox"]   newest messages: id, date, from, subject
  google_api.py label ACCOUNT MSG_ID LABEL                      add a label (made if missing)
  google_api.py archive ACCOUNT MSG_ID                          take a message out of the inbox
  google_api.py draft ACCOUNT --to ADDR --subject S (--body B | --body-file F)   save a draft; never sends
  google_api.py draft-delete ACCOUNT DRAFT_ID                   delete a draft this tool made
  google_api.py events ACCOUNT [--date YYYY-MM-DD]              that day's events on the primary calendar

Who you are comes from dash.py (your OpenBot workspace, or DASH_BOT outside every workspace). ALLOWED
says which bot may run which command on which account; nothing here sends mail, deletes mail, marks
mail read or writes the calendar. Tokens: D:\\AgentTeam\\secrets\\google\\<account>.json, made by
google_connect.py. Prints JSON. Exit codes: 0 ok, 1 Google refused, 2 local problem or not allowed.
See GOOGLE.md.
"""
import argparse
import base64
import email.policy
import imaplib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.parser import BytesParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dash  # noqa: E402  (which_bot)

DIR = Path(os.environ.get('GOOGLE_SECRETS', r'D:\AgentTeam\secrets\google'))
GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
ALLOWED = {
    'inbox': {'jon': {'subjects', 'label', 'archive'}, 'jonstagger': {'subjects', 'label', 'archive'}},
    'sponsors': {'partners': {'subjects', 'draft', 'draft-delete'}},
    'accounting': {'jon': {'subjects'}, 'jonstagger': {'subjects'}},
    'ana': {'jon': {'events'}},
}
# Personal Gmail can't use the Workspace-internal OAuth app, so it goes over IMAP with an app password
# Jon saved in OpenBot's key store (read here only; never copy or print it).
IMAP_ACCOUNTS = {'jonstagger': ('jonstagger@gmail.com', Path(
    r'C:\Users\jonst\AppData\Roaming\OpenBot\agent-api-keys\agent-f48f578a-c9a6-4e93-9294-e4a0cbbb17e2'
    r'\JONSTAGGER_GMAIL_APP_PASSWORD'))}
SYSTEM_LABELS = {'INBOX', 'UNREAD', 'TRASH', 'SPAM', 'SENT', 'DRAFT', 'STARRED', 'IMPORTANT'}
# Arguments reach IMAP commands and API paths, so only these shapes get through (no quotes, backslashes,
# control characters or slashes).
LABEL_RE = re.compile(r'[A-Za-z0-9 _.&-][A-Za-z0-9 _./&-]{0,99}')
MSG_ID_RE = re.compile(r'[0-9a-f]{1,24}')
QUERY_BAD_RE = re.compile(r'["\\\x00-\x1f\x7f]')


def check_args(args):
    if getattr(args, 'msg_id', None) is not None and not MSG_ID_RE.fullmatch(args.msg_id):
        raise Fail(2, 'message ids are hex, like 18c2f0a1b2c3d4e5')
    name = getattr(args, 'label', None)
    if name is not None and (not LABEL_RE.fullmatch(name) or name.upper() in SYSTEM_LABELS
                             or name.upper().startswith('CATEGORY_')):
        raise Fail(2, 'label names are your own labels: letters, digits, space and _ . / & -')
    if getattr(args, 'query', None) is not None and QUERY_BAD_RE.search(args.query):
        raise Fail(2, 'queries may not contain quotes, backslashes or control characters')


class Fail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Google:
    """One account's API session: refreshes its access token once, then calls JSON endpoints."""
    def __init__(self, account):
        try:
            self.tok = json.loads((DIR / ('%s.json' % account)).read_text(encoding='utf-8'))
            c = json.loads((DIR / 'client.json').read_text(encoding='utf-8'))['installed']
        except (OSError, ValueError, KeyError):
            raise Fail(2, '%s is not connected (run google_connect.py)' % account)
        fields = {'client_id': c['client_id'], 'client_secret': c['client_secret'],
                  'refresh_token': self.tok['refresh_token'], 'grant_type': 'refresh_token'}
        self.access = self._send(urllib.request.Request(
            c['token_uri'], data=urllib.parse.urlencode(fields).encode(), method='POST'))['access_token']

    def call(self, method, url, body=None, query=None):
        if query:
            url += '?' + urllib.parse.urlencode(query, doseq=True)
        req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Authorization': 'Bearer ' + self.access, 'Content-Type': 'application/json'})
        return self._send(req)

    @staticmethod
    def _send(req):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            raise Fail(1, 'Google %s: %s' % (err.code, err.read()[:300].decode('utf-8', 'replace')))
        except OSError as err:
            raise Fail(1, 'Google unreachable: %s' % err)


imaplib._MAXLINE = 50_000_000  # a big mailbox's SEARCH reply is one line of every matching id


class Imap:
    """Gmail over IMAP: headers read with BODY.PEEK (stays unread), labels changed with X-GM-LABELS.
    No send, no \\Deleted, no expunge. Message ids are Gmail's hex ids, the same as the Gmail API's."""
    def __init__(self, account):
        email_addr, pw_file = IMAP_ACCOUNTS[account]
        try:
            pw = pw_file.read_text(encoding='utf-8').strip()
        except OSError:
            raise Fail(2, '%s app password file is missing' % account)
        try:
            self.box = imaplib.IMAP4_SSL('imap.gmail.com', timeout=30)
            self.box.login(email_addr, pw)
        except imaplib.IMAP4.error:
            raise Fail(1, 'Gmail refused the app password for %s' % account)
        except OSError as err:
            raise Fail(1, 'Gmail IMAP unreachable: %s' % err)
        typ, rows = self.box.list()
        allmail = next((r.decode() for r in rows or [] if b'\\All' in r), '')
        self.allmail = allmail.rsplit(' "/" ', 1)[-1] if allmail else '"[Gmail]/All Mail"'

    def close(self):
        try:
            self.box.logout()
        except Exception:
            pass

    def _ok(self, typ, data):
        if typ != 'OK':
            raise Fail(1, 'Gmail IMAP: %s' % data)
        return data

    def subjects(self, n, query):
        self._ok(*self.box.select(self.allmail, readonly=True))
        uids = self._ok(*self.box.uid('SEARCH', 'X-GM-RAW', '"%s"' % query))[0].split()[-n:][::-1]
        out = []
        for uid in uids:
            data = self._ok(*self.box.uid('FETCH', uid, '(X-GM-MSGID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])'))
            meta, raw = data[0]
            msgid = re.search(rb'X-GM-MSGID (\d+)', meta).group(1)
            h = BytesParser(policy=email.policy.default).parsebytes(raw)
            out.append({'id': '%x' % int(msgid), 'date': h['date'], 'from': h['from'], 'subject': h['subject']})
        return out

    def _uid(self, msg_id):
        self._ok(*self.box.select(self.allmail))
        found = self._ok(*self.box.uid('SEARCH', 'X-GM-MSGID', str(int(msg_id, 16))))[0].split()
        if not found:
            raise Fail(2, 'no message %s' % msg_id)
        return found[0]

    def label(self, msg_id, name):
        self._ok(*self.box.uid('STORE', self._uid(msg_id), '+X-GM-LABELS', '("%s")' % name))
        return {'id': msg_id, 'label': name}

    def archive(self, msg_id):
        self._ok(*self.box.uid('STORE', self._uid(msg_id), '-X-GM-LABELS', '(\\Inbox)'))
        return {'archived': msg_id}


def subjects(g, n, query):
    ids = g.call('GET', GMAIL + '/messages', query={'maxResults': n, 'q': query}).get('messages') or []
    out = []
    for m in ids:
        msg = g.call('GET', GMAIL + '/messages/' + m['id'], query={
            'format': 'metadata', 'metadataHeaders': ['From', 'Subject', 'Date']})
        h = {x['name'].lower(): x['value'] for x in msg.get('payload', {}).get('headers', [])}
        out.append({'id': m['id'], 'date': h.get('date'), 'from': h.get('from'), 'subject': h.get('subject')})
    return out


def label(g, msg_id, name):
    labels = g.call('GET', GMAIL + '/labels').get('labels') or []
    lab = (next((x for x in labels if x['name'] == name and x.get('type') == 'user'), None)
           or g.call('POST', GMAIL + '/labels', {'name': name}))
    g.call('POST', GMAIL + '/messages/%s/modify' % msg_id, {'addLabelIds': [lab['id']]})
    return {'id': msg_id, 'label': name}


def drafts_made():
    try:
        return json.loads((DIR / 'drafts-made.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []


def draft(g, to, subject, body):
    msg = EmailMessage()
    msg['To'], msg['Subject'] = to, subject
    msg.set_content(body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    d = g.call('POST', GMAIL + '/drafts', {'message': {'raw': raw}})
    (DIR / 'drafts-made.json').write_text(json.dumps(drafts_made() + [d['id']]), encoding='utf-8')
    return {'draft': d['id'], 'to': to, 'subject': subject}


def draft_delete(g, draft_id):
    made = drafts_made()
    if draft_id not in made:
        raise Fail(2, 'only drafts this tool made can be deleted')
    g.call('DELETE', GMAIL + '/drafts/' + urllib.parse.quote(draft_id, safe=''))
    (DIR / 'drafts-made.json').write_text(json.dumps([d for d in made if d != draft_id]), encoding='utf-8')
    return {'deleted': draft_id}


def events(g, day):
    d = datetime.strptime(day, '%Y-%m-%d') if day else datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    start, end = d.astimezone(), (d + timedelta(days=1)).astimezone()  # each midnight gets its own UTC offset (DST)
    items = g.call('GET', CAL, query={'timeMin': start.isoformat(), 'timeMax': end.isoformat(),
                                      'singleEvents': 'true', 'orderBy': 'startTime', 'maxResults': 100}).get('items') or []
    return [{'start': e['start'].get('dateTime') or e['start'].get('date'),
             'end': e['end'].get('dateTime') or e['end'].get('date'), 'summary': e.get('summary', '(no title)')}
            for e in items]


def parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = ap.add_subparsers(dest='cmd', required=True)
    a = s.add_parser('subjects')
    a.add_argument('account')
    a.add_argument('-n', type=int, default=5)
    a.add_argument('--query', default='in:inbox')
    a = s.add_parser('label')
    a.add_argument('account')
    a.add_argument('msg_id')
    a.add_argument('label')
    a = s.add_parser('archive')
    a.add_argument('account')
    a.add_argument('msg_id')
    a = s.add_parser('draft')
    a.add_argument('account')
    a.add_argument('--to', required=True)
    a.add_argument('--subject', required=True)
    b = a.add_mutually_exclusive_group(required=True)
    b.add_argument('--body')
    b.add_argument('--body-file')
    a = s.add_parser('draft-delete')
    a.add_argument('account')
    a.add_argument('draft_id')
    a = s.add_parser('events')
    a.add_argument('account')
    a.add_argument('--date')
    return ap


def run(args):
    try:
        bot = dash.which_bot()
    except dash.Fail as err:
        raise Fail(2, str(err))
    if args.cmd not in ALLOWED.get(bot, {}).get(args.account, set()):
        raise Fail(2, '%s may not run %s on %s' % (bot, args.cmd, args.account))
    check_args(args)
    if args.account in IMAP_ACCOUNTS:
        m = Imap(args.account)
        try:
            if args.cmd == 'subjects':
                return m.subjects(max(1, min(args.n, 50)), args.query)
            if args.cmd == 'label':
                return m.label(args.msg_id, args.label)
            return m.archive(args.msg_id)
        finally:
            m.close()
    g = Google(args.account)
    if args.cmd == 'subjects':
        return subjects(g, max(1, min(args.n, 50)), args.query)
    if args.cmd == 'label':
        return label(g, args.msg_id, args.label)
    if args.cmd == 'archive':
        g.call('POST', GMAIL + '/messages/%s/modify' % args.msg_id, {'removeLabelIds': ['INBOX']})
        return {'archived': args.msg_id}
    if args.cmd == 'draft':
        body = args.body if args.body is not None else Path(args.body_file).read_text(encoding='utf-8')
        return draft(g, args.to, args.subject, body)
    if args.cmd == 'draft-delete':
        return draft_delete(g, args.draft_id)
    return events(g, args.date)


def main(argv=None):
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        out = run(parser().parse_args(argv))
    except Fail as err:
        print('google_api.py: %s' % err, file=sys.stderr)
        return err.code
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
