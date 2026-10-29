#!/usr/bin/env python3
"""dash.py - talk to the jonmac.ai dashboard as one bot (Python stdlib only).

Which bot: --bot SLUG, else env DASH_BOT, else the bot whose OpenBot workspace (BOTS.md)
contains the current folder. The token is read from D:\\AgentTeam\\secrets\\bot-tokens\\<slug>.token
(override the folder with DASH_TOKEN_DIR). Never print or paste the token.

Prints the JSON reply. Exit code 0 on success, 1 when the dashboard refuses (message on
stderr), 2 when it cannot be reached or the bot/token is missing. See DASH.md.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = os.environ.get('DASH_BASE', 'https://jonmac.ai/dashboard/api/v1')
TOKEN_DIR = Path(os.environ.get('DASH_TOKEN_DIR', r'D:\AgentTeam\secrets\bot-tokens'))
BOTS_MD = Path(os.environ.get('DASH_BOTS_MD', r'D:\AgentTeam\rules\BOTS.md'))
TASK_STATUSES = ['todo', 'doing', 'waiting_on_jon', 'qc', 'done']
PROOF_KINDS = ['render', 'url', 'pdf', 'test']


class Fail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def bots_table():
    """[(slug, workspace path)] from BOTS.md."""
    rows = []
    try:
        text = BOTS_MD.read_text(encoding='utf-8')
    except OSError:
        return rows
    for line in text.splitlines():
        m = re.match(r'^\|\s*[^|]+?\s*\|\s*areas/([a-z0-9-]+)\.md\s*\|\s*([^|]+?)\s*\|', line)
        if m:
            rows.append((m.group(1), m.group(2)))
    return rows


def which_bot(explicit):
    if explicit:
        return explicit.strip().lower()
    if os.environ.get('DASH_BOT'):
        return os.environ['DASH_BOT'].strip().lower()
    cwd = os.path.normcase(os.path.abspath(os.getcwd()))
    for slug, workspace in bots_table():
        ws = os.path.normcase(os.path.abspath(workspace))
        if cwd == ws or cwd.startswith(ws + os.sep):
            return slug
    raise Fail(2, 'Which bot? Pass --bot <slug> or set DASH_BOT (slugs are the areas/<slug>.md names in BOTS.md).')


def read_token(slug):
    if not re.match(r'^[a-z0-9][a-z0-9-]{0,39}$', slug):
        raise Fail(2, 'Bad bot name: %s' % slug)
    path = TOKEN_DIR / ('%s.token' % slug)
    try:
        token = path.read_text(encoding='utf-8').strip()
    except OSError:
        raise Fail(2, 'No token file for %s at %s. Ask Developer to issue one.' % (slug, path))
    if not token:
        raise Fail(2, 'Token file %s is empty.' % path)
    return token


def call(ctx, method, path, body=None, query=None):
    url = ctx['base'].rstrip('/') + path
    if query:
        clean = {k: v for k, v in query.items() if v not in (None, '')}
        if clean:
            url += '?' + urllib.parse.urlencode(clean)
    data = None if body is None else json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', 'Bearer %s' % ctx['token'])
    req.add_header('Accept', 'application/json')
    req.add_header('User-Agent', 'AgentTeamDash/1.0 (%s)' % ctx['bot'])
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as err:
        raw = err.read().decode('utf-8', 'replace')
        try:
            msg = json.loads(raw).get('error') or raw
        except ValueError:
            msg = raw[:300]
        raise Fail(1, 'HTTP %s: %s' % (err.code, msg))
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise Fail(2, 'Dashboard not reachable: %s' % getattr(err, 'reason', err))


def only(d):
    return {k: v for k, v in d.items() if v is not None}


def payload_of(args):
    if args.payload and args.payload_file:
        raise Fail(2, 'Use --payload or --payload-file, not both.')
    raw = args.payload
    if args.payload_file:
        raw = Path(args.payload_file).read_text(encoding='utf-8')
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except ValueError as err:
        raise Fail(2, 'Payload is not JSON: %s' % err)
    if not isinstance(value, dict):
        raise Fail(2, 'Payload must be a JSON object.')
    return value


def run(args, ctx):
    c = args.cmd
    q = urllib.parse.quote
    if c == 'whoami':
        return call(ctx, 'GET', '/me')
    if c == 'task-add':
        return call(ctx, 'POST', '/tasks', only({'title': args.title, 'owner': args.owner, 'status': args.status,
                                                 'note': args.note, 'key': args.key}))
    if c == 'task-update':
        body = only({'title': args.title, 'owner': args.owner, 'status': args.status, 'note': args.note})
        if not body:
            raise Fail(2, 'Nothing to change: pass --status, --owner, --note or --title.')
        return call(ctx, 'PATCH', '/tasks/%s' % q(args.id, safe=''), body)
    if c == 'tasks':
        return call(ctx, 'GET', '/tasks', query={'owner': args.owner, 'status': args.status, 'limit': args.limit})
    if c == 'task':
        return call(ctx, 'GET', '/tasks/%s' % q(args.id, safe=''))
    if c == 'proof-add':
        return call(ctx, 'POST', '/tasks/%s/proofs' % q(args.task_id, safe=''),
                    only({'kind': args.kind, 'link': args.link, 'note': args.note}))
    if c == 'proofs':
        return call(ctx, 'GET', '/proofs', query={'status': args.status, 'task': args.task, 'limit': args.limit})
    if c == 'proof-check':
        return call(ctx, 'POST', '/proofs/%s/check' % q(args.id, safe=''), only({'result': args.result, 'note': args.note}))
    if c == 'ask':
        return call(ctx, 'POST', '/questions', only({'question': args.question, 'options': args.option or None,
                                                    'context': args.context, 'task': args.task, 'key': args.key}))
    if c == 'question':
        return call(ctx, 'GET', '/questions/%s' % q(args.id, safe=''))
    if c == 'questions':
        return call(ctx, 'GET', '/questions', query={'status': args.status, 'asked_by': args.asked_by, 'limit': args.limit})
    if c == 'question-close':
        return call(ctx, 'POST', '/questions/%s/close' % q(args.id, safe=''), {})
    if c == 'approval-request':
        return call(ctx, 'POST', '/approvals', only({'action': args.action, 'title': args.title, 'payload': payload_of(args),
                                                    'task': args.task, 'key': args.key}))
    if c == 'approvals':
        return call(ctx, 'GET', '/approvals', query={'status': args.status, 'action': args.action,
                                                     'requested_by': args.requested_by, 'limit': args.limit})
    if c == 'approval':
        return call(ctx, 'GET', '/approvals/%s' % q(args.id, safe=''))
    if c == 'approval-done':
        return call(ctx, 'POST', '/approvals/%s/done' % q(args.id, safe=''), only({'note': args.note}))
    if c == 'approval-cancel':
        return call(ctx, 'POST', '/approvals/%s/cancel' % q(args.id, safe=''), only({'note': args.note}))
    if c == 'run-report':
        return call(ctx, 'POST', '/runs', only({'status': args.status, 'started': args.started, 'ended': args.ended,
                                               'tokens': args.tokens, 'error': args.error, 'task': args.task,
                                               'note': args.note}))
    if c == 'runs':
        return call(ctx, 'GET', '/runs', query={'bot': args.of, 'status': args.status, 'since': args.since, 'limit': args.limit})
    raise Fail(2, 'Unknown command %s' % c)


def parser():
    p = argparse.ArgumentParser(prog='dash.py', description='Talk to the jonmac.ai dashboard as one bot. See DASH.md.')
    p.add_argument('--bot', help='bot slug, e.g. video-editor (default: DASH_BOT or the current workspace)')
    p.add_argument('--base', default=BASE, help='API base (default %(default)s)')
    s = p.add_subparsers(dest='cmd', required=True, metavar='COMMAND')

    s.add_parser('whoami', help='check the token: prints your bot name')

    a = s.add_parser('task-add', help='create a task')
    a.add_argument('title')
    a.add_argument('--owner', help='bot slug that owns it (default: you)')
    a.add_argument('--status', choices=['todo', 'doing', 'waiting_on_jon'])
    a.add_argument('--note')
    a.add_argument('--key', help='your own unique key; repeating it returns the first task instead of a copy')

    a = s.add_parser('task-update', help='change one task')
    a.add_argument('id')
    a.add_argument('--status', choices=TASK_STATUSES, help='qc and done need proof first')
    a.add_argument('--owner')
    a.add_argument('--note')
    a.add_argument('--title')

    a = s.add_parser('tasks', help='list tasks')
    a.add_argument('--owner', help='bot slug or "me"')
    a.add_argument('--status', help='one status or a comma list, e.g. todo,doing')
    a.add_argument('--limit', type=int)

    a = s.add_parser('task', help='one task with its proof')
    a.add_argument('id')

    a = s.add_parser('proof-add', help='add proof to a task')
    a.add_argument('task_id')
    a.add_argument('--kind', required=True, choices=PROOF_KINDS)
    a.add_argument('--link', required=True, help='https:// URL or a file path on GPU1')
    a.add_argument('--note')

    a = s.add_parser('proofs', help='list proof (QC: --status pending)')
    a.add_argument('--status', help='pending, passed or failed (comma list ok)')
    a.add_argument('--task')
    a.add_argument('--limit', type=int)

    a = s.add_parser('proof-check', help='QC only: pass or fail one proof')
    a.add_argument('id')
    a.add_argument('result', choices=['passed', 'failed'])
    a.add_argument('--note')

    a = s.add_parser('ask', help='ask Jon a question')
    a.add_argument('question')
    a.add_argument('--option', action='append', help='an answer button; repeat for each (max 10)')
    a.add_argument('--context')
    a.add_argument('--task')
    a.add_argument('--key')

    a = s.add_parser('question', help='read one question and its answer')
    a.add_argument('id')

    a = s.add_parser('questions', help='list questions')
    a.add_argument('--status', help='open, answered or closed (comma list ok)')
    a.add_argument('--asked-by', help='bot slug or "me"')
    a.add_argument('--limit', type=int)

    a = s.add_parser('question-close', help='close your own question (after reading the answer, or to withdraw it)')
    a.add_argument('id')

    a = s.add_parser('approval-request', help='ask Jon to approve an action')
    a.add_argument('action', help='snake_case, e.g. send_pitches, publish_draft, post_clips, spotify_batch')
    a.add_argument('title')
    a.add_argument('--payload', help='JSON object the action needs')
    a.add_argument('--payload-file', help='file holding that JSON object')
    a.add_argument('--task')
    a.add_argument('--key')

    a = s.add_parser('approvals', help='list approvals (to act on: --status approved)')
    a.add_argument('--status', help='pending, approved, rejected, done or cancelled (comma list ok)')
    a.add_argument('--action')
    a.add_argument('--requested-by', help='bot slug or "me"')
    a.add_argument('--limit', type=int)

    a = s.add_parser('approval', help='one approval')
    a.add_argument('id')

    a = s.add_parser('approval-done', help='mark an approved action carried out')
    a.add_argument('id')
    a.add_argument('--note')

    a = s.add_parser('approval-cancel', help='withdraw your own pending or approved request')
    a.add_argument('id')
    a.add_argument('--note')

    a = s.add_parser('run-report', help='report one run of this bot')
    a.add_argument('--status', required=True, choices=['running', 'ok', 'failed'])
    a.add_argument('--started', help='ISO time (default: now)')
    a.add_argument('--ended', help='ISO time')
    a.add_argument('--tokens', type=int)
    a.add_argument('--error')
    a.add_argument('--task')
    a.add_argument('--note')

    a = s.add_parser('runs', help='list runs')
    a.add_argument('--of', help='bot slug or "me"')
    a.add_argument('--status')
    a.add_argument('--since', help='ISO time')
    a.add_argument('--limit', type=int)
    return p


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    args = parser().parse_args(argv)
    try:
        bot = which_bot(args.bot)
        ctx = {'bot': bot, 'token': read_token(bot), 'base': args.base}
        out = run(args, ctx)
    except Fail as err:
        print('dash.py: %s' % err, file=sys.stderr)
        return err.code
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
