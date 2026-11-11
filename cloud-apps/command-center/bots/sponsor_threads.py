#!/usr/bin/env python3
"""sponsor_threads.py - the Gmail thread above each sponsor draft on the dashboard Review page (stdlib only).

Read only: asks the dashboard which threads have a draft waiting for Jon, reads each one from partners@
with GET calls (never sends, drafts, labels or marks read), keeps each message's own words (quoted history
folded) and sends them as the 'sponsor_threads' snapshot. Runs on GPU1, where the partners@ token lives.

  python -I sponsor_threads.py                    ingest to jonmac.ai (machine token from CC_SECRETS)
  python -I sponsor_threads.py --ids 1a2b,3c4d --out threads.json   write the snapshot instead (preview tests)
Exit codes: 0 ok, 1 Google or the dashboard refused, 2 local problem.
"""
import argparse
import base64
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from google_api import GMAIL, MSG_ID_RE, Fail, Google  # noqa: E402

SECRETS = Path(os.environ.get('CC_SECRETS') or (Path.home() / '.command-center' / 'gpu1-loop.env'))
MAX_MESSAGES = 25    # newest kept; older ones are already quoted inside them
MAX_CHARS = 6000     # per message, after the quoted history is folded
# Where a reply's quoted history starts: "On <date>, <name> wrote:" (Gmail, may wrap), Outlook's header block,
# "Original Message" and underscore rules.
QUOTE_START = re.compile(
    r'^\s*On [^\n]{0,300}(?:\n[^\n]{0,300})?wrote:\s*$'
    r'|^\s*-{2,}\s*Original Message\s*-{2,}'
    r'|^\s*_{8,}\s*$'
    r'|^\s*From:\s[^\n]+\n\s*(?:Sent|Date):\s',
    re.M | re.I)


def fold_quotes(text):
    """The message's own words and whether quoted history was cut off."""
    text = (text or '').replace('\r\n', '\n').replace('\r', '\n')
    m = QUOTE_START.search(text)
    quoted = bool(m)
    if m:
        text = text[:m.start()]
    lines = text.split('\n')
    while lines and (lines[-1].startswith('>') or not lines[-1].strip()):
        quoted = quoted or lines[-1].startswith('>')
        lines.pop()
    text = re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS].rstrip() + ' …'
    return text, quoted


def html_text(raw):
    raw = re.sub(r'(?is)<(script|style|head)\b.*?</\1>', '', raw)
    raw = re.sub(r'(?is)<blockquote\b.*', '', raw)  # Gmail's quoted history
    raw = re.sub(r'(?i)<br\s*/?>|</(p|div|li|tr|h\d)>', '\n', raw)
    return html.unescape(re.sub(r'<[^>]+>', '', raw))


def _decode(data):
    return base64.urlsafe_b64decode((data or '') + '=' * (-len(data or '') % 4)).decode('utf-8', 'replace')


def body_of(payload):
    """Plain text of a Gmail message payload: the text/plain part, else the text/html part stripped."""
    found = {}

    def walk(p):
        mime = (p.get('mimeType') or '').lower()
        if mime in ('text/plain', 'text/html') and mime not in found and (p.get('body') or {}).get('data') \
                and not (p.get('filename') or ''):
            found[mime] = _decode(p['body']['data'])
        for part in p.get('parts') or []:
            walk(part)
    walk(payload or {})
    if 'text/plain' in found:
        return found['text/plain']
    return html_text(found.get('text/html', ''))


def thread_of(t):
    """One Gmail thread (format=full) as the Review page shows it: messages oldest first, drafts left out."""
    out = []
    for m in t.get('messages') or []:
        if 'DRAFT' in (m.get('labelIds') or []):
            continue  # the reply waiting for Jon is shown on its own, under the thread
        h = {x['name'].lower(): x['value'] for x in (m.get('payload') or {}).get('headers') or []}
        ms = int(m.get('internalDate') or 0)
        body, quoted = fold_quotes(body_of(m.get('payload')))
        out.append({'from': h.get('from', ''), 'date': datetime.fromtimestamp(ms / 1000, timezone.utc).strftime(
            '%Y-%m-%dT%H:%M:%SZ') if ms else '', 'body': body, 'quoted': quoted, '_ms': ms})
    out.sort(key=lambda x: x.pop('_ms'))
    subject = next((x['value'] for x in ((t.get('messages') or [{}])[0].get('payload') or {}).get('headers') or []
                    if x['name'].lower() == 'subject'), '')
    return {'subject': subject, 'messages': out[-MAX_MESSAGES:]}


def _get_thread(g, tid, sleep=time.sleep):
    """partners@ shares Gmail's per-minute quota with the inbox scan: wait out a quota refusal, 3 tries."""
    for wait in (20, 40, 0):
        try:
            return g.call('GET', GMAIL + '/threads/' + tid, query={'format': 'full'})
        except Fail as err:
            if not wait or not re.search(r'Google (429|403).*(quota|rate)', str(err), re.I | re.S):
                raise
            sleep(wait)


def collect(g, ids, sleep=time.sleep):
    threads, missing = {}, []
    for tid in ids:
        try:
            threads[tid] = thread_of(_get_thread(g, tid, sleep))
        except Fail as err:
            if ' 404' not in str(err) and ' 400' not in str(err):
                raise
            missing.append(tid)  # gone from partners@: the page says "No thread found"
    return {'threads': threads, 'missing': missing}


def _secrets():
    out = {}
    for line in SECRETS.read_text(encoding='utf-8').splitlines():
        k, sep, v = line.partition('=')
        if sep and not k.strip().startswith('#'):
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _dash(method, base, token, path, body=None):
    req = urllib.request.Request(base.rstrip('/') + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                                          'User-Agent': 'CommandCenterCollector/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b'{}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--ids', help='comma-separated thread ids instead of asking the dashboard')
    ap.add_argument('--out', help='write the snapshot JSON here instead of sending it')
    a = ap.parse_args(argv)
    try:
        base = token = None
        if not (a.ids and a.out):
            sec = _secrets()
            base, token = sec.get('CC_BASE') or 'https://jonmac.ai/dashboard', sec.get('MACHINE_TOKEN_GPU1')
            if not token:
                raise Fail(2, 'no MACHINE_TOKEN_GPU1 in %s' % SECRETS)
        ids = a.ids.split(',') if a.ids else _dash('GET', base, token, '/api/sponsor-threads/wanted').get('threads') or []
        ids = [i.strip() for i in ids if MSG_ID_RE.fullmatch(i.strip())]
        data = collect(Google('partners'), ids)
        if a.out:
            Path(a.out).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        else:
            _dash('POST', base, token, '/api/ingest', {
                'source': 'sponsor_threads', 'collectedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                'data': data})
        print(json.dumps({'threads': len(data['threads']), 'missing': len(data['missing']),
                          'messages': sum(len(t['messages']) for t in data['threads'].values())}))
        return 0
    except Fail as err:
        print(json.dumps({'error': str(err)}))
        return err.code
    except OSError as err:
        print(json.dumps({'error': 'dashboard: %s' % err}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
