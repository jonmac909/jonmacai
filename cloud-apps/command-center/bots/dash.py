#!/usr/bin/env python3
"""dash.py - talk to the jonmac.ai dashboard as one bot (Python stdlib only).

Which bot: the one whose OpenBot workspace (BOTS.md) contains the current folder, or env
DASH_BOT for scripts that run elsewhere. The token is read from
D:\\AgentTeam\\secrets\\bot-tokens\\<slug>.token (override the folder with DASH_TOKEN_DIR).
Never print or paste the token.

Prints the JSON reply. Exit codes: 0 ok; 1 the dashboard refused (reason on stderr);
2 a local problem (usage, unknown bot, no token, bad payload); 3 the dashboard could not be
reached or failed (network, 5xx, redirect, not JSON). See DASH.md.
"""
import argparse
import csv
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
TASK_STATUSES = ['todo', 'doing', 'waiting_on_jon', 'qc', 'review', 'done', 'cancelled']
PROOF_KINDS = ['render', 'url', 'pdf', 'test']
FEEDS = ['morning_summary', 'calendar_today', 'claude_usage', 'ebook_sales', 'daily_checklists']
# Same labels, slugs and order as PROJECTS in src/projects.js. "unsorted" means no project.
LABELS = {'Sponsors': 'sponsors', 'YT-JM': 'jon-mac', 'YT-AI UGC': 'jonmacai', 'Viral View': 'viral-view',
          'Home Guide Press': 'home-guide-press', 'Short-form': 'short-form', 'Accounting': 'accounting', 'Coding': 'coding'}
PROJECTS = list(LABELS.values())
CALENDAR_STATUSES = ['idea', 'planned', 'scripted', 'recording', 'editing', 'qc', 'review', 'scheduled', 'published']
CALENDAR_DIR = Path(r'D:\AgentTeam\calendar')  # one CSV per channel: date,time_pt,channel,title,status,link
CONTENT_DIR = Path(r'D:\AgentTeam\content')  # channel,outlier_title,source_channel,url,views,channel_avg,multiple,published_date,selected[,thumbnail_url]
WEB_RE = re.compile(r'^https?://[^\s/?#]+\S*$', re.I)
DAILY_FILE = r'D:\AgentTeam\rules\facts\daily-checklists.md'


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


def which_bot():
    """The workspace folder decides; DASH_BOT is only for scripts that run outside every workspace."""
    env_bot = os.environ.get('DASH_BOT', '').strip().lower()
    cwd = os.path.normcase(os.path.abspath(os.getcwd()))
    for slug, workspace in bots_table():
        ws = os.path.normcase(os.path.abspath(workspace))
        if cwd == ws or cwd.startswith(ws + os.sep):
            if env_bot and env_bot != slug:
                raise Fail(2, 'DASH_BOT=%s but this is the %s workspace.' % (env_bot, slug))
            return slug
    if env_bot:
        return env_bot
    raise Fail(2, 'Which bot? Run from your OpenBot workspace, or set DASH_BOT to your slug (areas/<slug>.md in BOTS.md).')


def check_base(base):
    u = urllib.parse.urlsplit(base)
    local = u.hostname in ('localhost', '127.0.0.1')
    if u.scheme != 'https' and not (u.scheme == 'http' and local):
        raise Fail(2, 'DASH_BASE must be https:// (http only for localhost): %s' % base)
    return base


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Fail(3, 'Dashboard answered with a redirect (%s) to %s; not following it with the token' % (code, newurl))


OPENER = urllib.request.build_opener(NoRedirect)


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
        with OPENER.open(req, timeout=30) as res:
            raw = res.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as err:
        raw = err.read().decode('utf-8', 'replace')
        try:
            msg = json.loads(raw).get('error') or raw[:300]
        except (ValueError, AttributeError):
            msg = raw[:300]
        raise Fail(1 if 400 <= err.code < 500 else 3, 'HTTP %s: %s' % (err.code, msg))
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise Fail(3, 'Dashboard not reachable: %s' % getattr(err, 'reason', err))
    try:
        return json.loads(raw or '{}')
    except ValueError:
        raise Fail(3, 'Dashboard reply is not JSON: %s' % raw[:200])


def only(d):
    return {k: v for k, v in d.items() if v is not None}


def payload_of(args):
    if args.payload and args.payload_file:
        raise Fail(2, 'Use --payload or --payload-file, not both.')
    raw = args.payload
    if args.payload_file:
        try:
            raw = Path(args.payload_file).read_text(encoding='utf-8-sig')
        except OSError as err:
            raise Fail(2, 'Cannot read payload file: %s' % err)
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except ValueError as err:
        raise Fail(2, 'Payload is not JSON: %s' % err)
    if not isinstance(value, dict):
        raise Fail(2, 'Payload must be a JSON object.')
    return value


def read_file(path):
    try:
        return Path(path).read_text(encoding='utf-8-sig')
    except OSError as err:
        raise Fail(2, 'Cannot read %s: %s' % (path, err))


def feed_data(args):
    data = {}
    if args.data or args.data_file:
        try:
            data = json.loads(args.data or read_file(args.data_file))
        except ValueError as err:
            raise Fail(2, 'Feed data is not JSON: %s' % err)
        if not isinstance(data, dict):
            raise Fail(2, 'Feed data must be a JSON object.')
    if args.text or args.text_file:
        data['text'] = args.text or read_file(args.text_file)
    return data


def wake_qc(out, task_id, bot):
    """Wake QC through its webhook routine (hook.py beside this file). The proof is saved either way."""
    proof = out.get('proof') or {}
    if out.get('duplicate') or not proof.get('id'):
        return
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        import hook
        res = hook.fire('proof_posted', {'proof': proof['id'], 'task': task_id, 'kind': proof.get('kind'),
                                         'link': proof.get('link'), 'by': bot}, key=proof['id'])
        bad = {r: s for r, s in res.items() if s not in (200, 202)}
    except Exception as err:  # never fail a saved proof because QC couldn't be woken
        bad = str(err)
    if bad:
        print('dash.py: proof saved, but QC was not woken (%s); QC will see it in its queue.' % bad, file=sys.stderr)


def daily_lists(path):
    """{slug: [item, ...]} from the `## <tab label>` sections' `- item` lines; every other line is ignored."""
    lists, slug = {}, None
    for line in read_file(path).splitlines():
        if line.startswith('## '):
            slug = LABELS.get(line[3:].strip())
            if slug:
                lists.setdefault(slug, [])
        elif slug and line.startswith('- ') and line[2:].strip():
            lists[slug].append(line[2:].strip())
    if not any(lists.values()):
        raise Fail(2, 'No checklist items in %s: expected "## <tab label>" sections with "- item" lines.' % path)
    missing = [label for label, slug in LABELS.items() if not lists.get(slug)]
    if missing:  # a typo'd heading would otherwise empty that tab's checklist
        raise Fail(2, 'No items under: %s. Check the "## " headings in %s.' % (', '.join(missing), path))
    return lists


def project_of(value):
    if value is None:
        return None
    s = value.strip().lower()
    if s not in PROJECTS + ['unsorted']:
        raise Fail(2, 'Unknown project %r. Use one of: %s (or unsorted).' % (value, ', '.join(PROJECTS)))
    return s


def day_of(value, flag):
    if value is not None and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise Fail(2, '%s must be a date like 2026-11-03.' % flag)
    return value


def time_of(value):
    """'9:00', '09:00', '9am', '9:30 PM' -> '09:00' / '21:30' (PT); '' -> None."""
    s = (value or '').strip().lower().replace('.', '')
    if not s:
        return None
    m = re.fullmatch(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*pt)?', s)
    if not m or (not m.group(2) and not m.group(3)):
        raise ValueError('time_pt %r is not a time like 09:00 or 9:30 PM' % value)
    h, mins, half = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if half:
        if not 1 <= h <= 12:
            raise ValueError('time_pt %r is not a time' % value)
        h = h % 12 + (12 if half == 'pm' else 0)
    if h > 23 or mins > 59:
        raise ValueError('time_pt %r is not a time' % value)
    return '%02d:%02d' % (h, mins)


def csv_import(ctx, paths, folder, resource, key, row_of):
    """Each <channel-slug>.csv (default: every one in `folder`) replaces that channel's CSV rows on its page
    (PUT /<resource>/<channel>). row_of(row) turns one CSV row into what the API takes, or raises ValueError:
    that row is skipped and reported. The file name is the channel; a CSV's channel column is only a label."""
    files = [Path(p) for p in paths] or sorted(folder.glob('*.csv'))
    if not files:
        raise Fail(2, 'No CSV files in %s.' % folder)
    channels, skipped = {}, []
    for f in files:
        try:
            try:
                rows = read_rows(f, 'utf-8-sig')
            except UnicodeDecodeError:
                rows = read_rows(f, 'cp1252')  # Excel's default "CSV" save
        except OSError as err:
            raise Fail(2, 'Cannot read %s: %s' % (f, err))
        items, bad = [], 0
        for n, row in enumerate(rows, start=2):  # line 1 is the header
            if None in row:  # more cells than columns
                skipped.append('%s line %d: more cells than columns (put quotes around text with commas)' % (f.name, n))
                bad += 1
                continue
            row = {(k or '').strip().lower(): (v or '').strip() for k, v in row.items()}
            if not any(row.values()):
                continue
            try:
                items.append(row_of(row))
            except ValueError as err:
                skipped.append('%s line %d: %s' % (f.name, n, err))
                bad += 1
        # A file with a bad row isn't sent at all: the page keeps its last good import rather than losing rows.
        # Only a file with no data rows clears its channel.
        if bad:
            skipped.append('%s: not imported until its %d bad row(s) are fixed; the page keeps the last good import' % (f.name, bad))
        else:
            channels[f.stem] = items
    done = {}
    for channel, items in channels.items():
        try:
            done[channel] = call(ctx, 'PUT', '/%s/%s' % (resource, urllib.parse.quote(channel, safe='')), {key: items})[key]
        except Fail as err:
            skipped.append('%s: %s' % (channel, err))
    return {'imported': done, 'skipped': skipped}


def read_rows(path, encoding):
    with open(path, newline='', encoding=encoding) as fh:
        return list(csv.DictReader(fh))


def day_or_fail(value, name):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value or ''):
        raise ValueError('%s %r is not like 2026-11-03' % (name, value))
    return value


def calendar_row(row):
    """A Calendar CSV row: date,time_pt,channel,title,status,link. A link that isn't http(s) is left off."""
    status = row.get('status', '').lower()
    if status not in CALENDAR_STATUSES:
        raise ValueError('status %r is not one of %s' % (row.get('status'), ', '.join(CALENDAR_STATUSES)))
    if not row.get('title'):
        raise ValueError('title is empty')
    link = row.get('link', '')
    return only({'date': day_or_fail(row.get('date'), 'date'), 'time': time_of(row.get('time_pt')), 'title': row['title'],
                 'status': status, 'link': link if WEB_RE.match(link) else None})


def whole(value, name):
    try:
        return int(float((value or '').replace(',', '')))
    except (ValueError, OverflowError):
        raise ValueError('%s %r is not a number' % (name, value))


def content_row(row):
    """A Content CSV row: outlier_title,source_channel,url,views,channel_avg,multiple,published_date,selected
    (yes/no),thumbnail_url. With no channel_avg, the average is views / multiple."""
    if not row.get('outlier_title'):
        raise ValueError('outlier_title is empty')
    if not WEB_RE.match(row.get('url', '')):
        raise ValueError('url %r is not an http(s) link' % row.get('url'))
    views = whole(row.get('views'), 'views')
    if row.get('channel_avg'):
        avg = whole(row['channel_avg'], 'channel_avg')
    else:
        multiple = float(row.get('multiple') or 0)
        if multiple <= 0:
            raise ValueError('needs channel_avg or multiple')
        avg = round(views / multiple)
    picked = row.get('selected', '').lower()
    if picked not in ('yes', 'no', 'y', 'n', 'true', 'false', '1', '0', ''):
        raise ValueError('selected %r is not yes or no' % row.get('selected'))
    thumb = row.get('thumbnail_url', '')
    return only({'title': row['outlier_title'], 'source': row.get('source_channel') or None, 'link': row['url'],
                 'thumb': thumb if WEB_RE.match(thumb) else None, 'views': views, 'avg': max(1, avg),
                 'published': day_or_fail(row.get('published_date'), 'published_date'),
                 'selected': picked in ('yes', 'y', 'true', '1')})


def web_of(value, flag):
    """The Calendar and Content pages take http(s) links only ("" clears a calendar link)."""
    if value and not re.match(r'^https?://[^\s/?#]+\S*$', value, re.I):
        raise Fail(2, '%s must be an http(s) link.' % flag)
    return value


def run(args, ctx):
    c = args.cmd
    q = urllib.parse.quote
    minutes, due = getattr(args, 'minutes', None), getattr(args, 'due', None)
    if minutes is not None and not 1 <= minutes <= 480:
        raise Fail(2, '--minutes must be 1 to 480.')
    if due is not None and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', due):
        raise Fail(2, '--due must be a date like 2026-10-30.')
    project = project_of(getattr(args, 'project', None))
    if c == 'whoami':
        return call(ctx, 'GET', '/me')
    if c == 'task-add':
        return call(ctx, 'POST', '/tasks', only({'title': args.title, 'owner': args.owner, 'status': args.status,
                                                 'note': args.note, 'project': project, 'minutes': args.minutes,
                                                 'due': args.due, 'key': args.key}))
    if c == 'task-update':
        if args.status == 'done':
            raise Fail(2, 'Bots cannot set done. Jon approves a task from review to done on the dashboard; '
                          'QC passing your proof moves a qc task to review.')
        body = only({'title': args.title, 'owner': args.owner, 'status': args.status, 'note': args.note,
                     'project': project, 'minutes': args.minutes, 'due': args.due})
        if not body:
            raise Fail(2, 'Nothing to change: pass --status, --owner, --note, --title, --project, --minutes or --due.')
        return call(ctx, 'PATCH', '/tasks/%s' % q(args.id, safe=''), body)
    if c == 'tasks':
        return call(ctx, 'GET', '/tasks', query={'owner': args.owner, 'status': args.status, 'project': project,
                                                 'limit': args.limit})
    if c == 'task':
        return call(ctx, 'GET', '/tasks/%s' % q(args.id, safe=''))
    if c == 'comment':
        if args.text and args.text_file:
            raise Fail(2, 'Give the text or --text-file, not both.')
        body = (read_file(args.text_file) if args.text_file else args.text or '').strip()
        if not body:
            raise Fail(2, 'The comment is empty.')
        if len(body) > 4000:
            raise Fail(2, 'The comment is longer than 4000 characters.')
        return call(ctx, 'POST', '/tasks/%s/comments' % q(args.task_id, safe=''), {'body': body})
    if c == 'proof-add':
        out = call(ctx, 'POST', '/tasks/%s/proofs' % q(args.task_id, safe=''),
                   only({'kind': args.kind, 'link': args.link, 'note': args.note}))
        wake_qc(out, args.task_id, ctx['bot'])
        return out
    if c == 'proofs':
        return call(ctx, 'GET', '/proofs', query={'status': args.status, 'task': args.task, 'limit': args.limit})
    if c == 'proof-check':
        return call(ctx, 'POST', '/proofs/%s/check' % q(args.id, safe=''), only({'result': args.result, 'note': args.note}))
    if c == 'ask':
        return call(ctx, 'POST', '/questions', only({'question': args.question, 'options': args.option or None,
                                                    'context': args.context, 'task': args.task, 'project': project,
                                                    'minutes': args.minutes, 'key': args.key}))
    if c == 'question':
        return call(ctx, 'GET', '/questions/%s' % q(args.id, safe=''))
    if c == 'questions':
        return call(ctx, 'GET', '/questions', query={'status': args.status, 'asked_by': args.asked_by, 'project': project,
                                                     'limit': args.limit})
    if c == 'question-close':
        return call(ctx, 'POST', '/questions/%s/close' % q(args.id, safe=''), {})
    if c == 'approval-request':
        return call(ctx, 'POST', '/approvals', only({'action': args.action, 'title': args.title, 'payload': payload_of(args),
                                                    'task': args.task, 'project': project, 'minutes': args.minutes,
                                                    'key': args.key}))
    if c == 'approvals':
        return call(ctx, 'GET', '/approvals', query={'status': args.status, 'action': args.action,
                                                     'requested_by': args.requested_by, 'project': project,
                                                     'limit': args.limit})
    if c == 'approval':
        return call(ctx, 'GET', '/approvals/%s' % q(args.id, safe=''))
    if c == 'approval-claim':
        return call(ctx, 'POST', '/approvals/%s/claim' % q(args.id, safe=''), {})
    if c == 'approval-done':
        return call(ctx, 'POST', '/approvals/%s/done' % q(args.id, safe=''), only({'note': args.note}))
    if c == 'approval-release':
        return call(ctx, 'POST', '/approvals/%s/release' % q(args.id, safe=''), only({'note': args.note}))
    if c == 'approval-cancel':
        return call(ctx, 'POST', '/approvals/%s/cancel' % q(args.id, safe=''), only({'note': args.note}))
    if c == 'run-report':
        return call(ctx, 'POST', '/runs', only({'status': args.status, 'started': args.started, 'ended': args.ended,
                                               'tokens': args.tokens, 'error': args.error, 'task': args.task,
                                               'note': args.note}))
    if c == 'runs':
        return call(ctx, 'GET', '/runs', query={'bot': args.of, 'status': args.status, 'since': args.since, 'limit': args.limit})
    if c == 'feed-put':
        return call(ctx, 'PUT', '/feeds/%s' % q(args.name, safe=''), feed_data(args))
    if c == 'feed':
        return call(ctx, 'GET', '/feeds/%s' % q(args.name, safe=''))
    if c == 'daily-sync':
        return call(ctx, 'PUT', '/feeds/daily_checklists', {'projects': daily_lists(args.file)})
    if c == 'daily-done':
        return call(ctx, 'POST', '/daily', only({'project': project, 'item': args.item, 'link': args.link, 'note': args.note}))
    if c == 'channels':
        return call(ctx, 'GET', '/channels')
    if c == 'channel-set':
        return call(ctx, 'PUT', '/channels/%s' % q(args.channel, safe=''), {'schedule': args.schedule})
    if c == 'calendar':
        return call(ctx, 'GET', '/calendar', query={'channel': args.channel, 'from': day_of(args.start, '--from'),
                                                    'to': day_of(args.end, '--to'), 'limit': args.limit})
    if c == 'calendar-import':
        return csv_import(ctx, args.files, CALENDAR_DIR, 'calendar', 'videos', calendar_row)
    if c == 'content-import':
        return csv_import(ctx, args.files, CONTENT_DIR, 'outliers', 'outliers', content_row)
    if c in ('calendar-add', 'calendar-update'):
        try:
            time = time_of(args.time) if args.time else args.time
        except ValueError as err:
            raise Fail(2, str(err))
    if c == 'calendar-add':
        return call(ctx, 'POST', '/calendar', only({'channel': args.channel, 'title': args.title, 'date': day_of(args.date, '--date'),
                                                   'time': time, 'status': args.status, 'link': web_of(args.link, '--link'),
                                                   'key': args.key}))
    if c == 'calendar-update':
        body = only({'title': args.title, 'date': day_of(args.date, '--date'), 'time': time, 'status': args.status,
                     'link': web_of(args.link, '--link')})
        if not body:
            raise Fail(2, 'Nothing to change: pass --title, --date, --time, --status or --link.')
        return call(ctx, 'PATCH', '/calendar/%s' % q(args.id, safe=''), body)
    if c == 'outliers':
        return call(ctx, 'GET', '/outliers', query={'channel': args.channel, 'selected': '1' if args.selected else None,
                                                    'limit': args.limit})
    if c == 'outlier-add':
        if args.views < 0 or args.avg < 1:
            raise Fail(2, '--views must be 0 or more and --avg 1 or more.')
        return call(ctx, 'POST', '/outliers', only({'channel': args.channel, 'title': args.title, 'link': web_of(args.link, '--link'),
                                                   'thumb': web_of(args.thumb, '--thumb'), 'views': args.views, 'avg': args.avg,
                                                   'published': day_of(args.published, '--published'), 'key': args.key}))
    if c == 'outlier-select':
        return call(ctx, 'POST', '/outliers/%s/select' % q(args.id, safe=''), {'selected': args.state == 'on'})
    raise Fail(2, 'Unknown command %s' % c)


def project_args(a, filter_only=False):
    a.add_argument('--project', help='one of: %s (or unsorted)' % ', '.join(PROJECTS))
    if not filter_only:
        a.add_argument('--minutes', type=int, help='minutes of Jon time it takes, 1 to 480')


def parser():
    p = argparse.ArgumentParser(prog='dash.py', description='Talk to the jonmac.ai dashboard as one bot. See DASH.md.')
    p.add_argument('--base', default=BASE, help='API base, https only (default %(default)s)')
    s = p.add_subparsers(dest='cmd', required=True, metavar='COMMAND')

    s.add_parser('whoami', help='check the token: prints your bot name')

    a = s.add_parser('task-add', help='create a task')
    a.add_argument('title')
    a.add_argument('--owner', help='bot slug that owns it, or jon for something only Jon can do (default: you)')
    a.add_argument('--status', choices=['todo', 'doing', 'waiting_on_jon'])
    a.add_argument('--note')
    project_args(a)
    a.add_argument('--due', help='YYYY-MM-DD, with --owner jon')
    a.add_argument('--key', help='your own unique key; repeating it returns the first task instead of a copy')

    a = s.add_parser('task-update', help='change one task')
    a.add_argument('id')
    a.add_argument('--status', choices=TASK_STATUSES,
                   help='qc needs proof; review needs proof QC passed; done is Jon\'s alone; cancelled needs --note')
    a.add_argument('--owner')
    a.add_argument('--note')
    a.add_argument('--title')
    project_args(a)
    a.add_argument('--due', help='YYYY-MM-DD')

    a = s.add_parser('tasks', help='list tasks')
    a.add_argument('--owner', help='bot slug, jon or "me"')
    a.add_argument('--status', help='one status or a comma list, e.g. todo,doing')
    project_args(a, filter_only=True)
    a.add_argument('--limit', type=int)

    a = s.add_parser('task', help='one task with its proof, history and comments')
    a.add_argument('id')

    a = s.add_parser('comment', help="answer in a task's comment thread (wakes no one)")
    a.add_argument('task_id')
    a.add_argument('text', nargs='?')
    a.add_argument('--text-file', help='file whose contents become the comment')

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
    project_args(a)
    a.add_argument('--key')

    a = s.add_parser('question', help='read one question and its answer')
    a.add_argument('id')

    a = s.add_parser('questions', help='list questions')
    a.add_argument('--status', help='open, answered or closed (comma list ok)')
    a.add_argument('--asked-by', help='bot slug or "me"')
    project_args(a, filter_only=True)
    a.add_argument('--limit', type=int)

    a = s.add_parser('question-close', help='close your own question (after reading the answer, or to withdraw it)')
    a.add_argument('id')

    a = s.add_parser('approval-request', help='ask Jon to approve an action')
    a.add_argument('action', help='snake_case, e.g. send_pitches, publish_draft, post_clips, spotify_batch')
    a.add_argument('title')
    a.add_argument('--payload', help='JSON object the action needs')
    a.add_argument('--payload-file', help='file holding that JSON object')
    a.add_argument('--task')
    project_args(a)
    a.add_argument('--key')

    a = s.add_parser('approvals', help='list approvals (to act on: --status approved --requested-by me)')
    a.add_argument('--status', help='pending, approved, rejected, running, done or cancelled (comma list ok)')
    a.add_argument('--action')
    a.add_argument('--requested-by', help='bot slug or "me"')
    project_args(a, filter_only=True)
    a.add_argument('--limit', type=int)

    a = s.add_parser('approval', help='one approval')
    a.add_argument('id')

    a = s.add_parser('approval-claim', help='take your approved request before carrying it out (approved -> running)')
    a.add_argument('id')

    a = s.add_parser('approval-done', help='mark your claimed request carried out (running -> done)')
    a.add_argument('id')
    a.add_argument('--note')

    a = s.add_parser('approval-release', help='give a claimed request back to try later (running -> approved)')
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

    a = s.add_parser('feed-put', help='post a feed: morning_summary, calendar_today, claude_usage, ebook_sales')
    a.add_argument('name', choices=FEEDS)
    a.add_argument('--data', help='JSON object, e.g. \'{"weekPct": 62}\'')
    a.add_argument('--data-file', help='file holding that JSON object')
    a.add_argument('--text', help='sets "text" (morning_summary)')
    a.add_argument('--text-file', help='file whose contents become "text"')

    a = s.add_parser('feed', help='read the newest entry of a feed')
    a.add_argument('name', choices=FEEDS)

    a = s.add_parser('daily-sync', help='Ana: post the daily checklists from daily-checklists.md')
    a.add_argument('--file', default=DAILY_FILE, help='default %(default)s')

    a = s.add_parser('daily-done', help="tick one of your project's daily items for today (PT)")
    a.add_argument('project', help='one of: %s' % ', '.join(PROJECTS))
    a.add_argument('item', help='the item text, or its number in the list (1 = first)')
    a.add_argument('--link', required=True, help='proof: https:// URL or a file path on GPU1')
    a.add_argument('--note')

    s.add_parser('channels', help='the channel slugs (Calendar and Content tabs) and their posting schedules')

    a = s.add_parser('channel-set', help="set a channel's posting schedule ('' clears it)")
    a.add_argument('channel', help='channel slug, see: dash.py channels')
    a.add_argument('--schedule', required=True, help='e.g. "Tue and Fri 9 am PT"')

    a = s.add_parser('calendar', help='list calendar videos')
    a.add_argument('--channel')
    a.add_argument('--from', dest='start', help='YYYY-MM-DD')
    a.add_argument('--to', dest='end', help='YYYY-MM-DD')
    a.add_argument('--limit', type=int)

    a = s.add_parser('calendar-import', help="load channel schedules from <channel-slug>.csv files (date,time_pt,channel,title,status,link); "
                                               "each file replaces that channel's CSV rows")
    a.add_argument('files', nargs='*', help='CSV files (default: every one in D:\\AgentTeam\\calendar)')

    a = s.add_parser('content-import', help="load outliers from <channel-slug>.csv files (channel,outlier_title,source_channel,url,"
                                              "views,channel_avg,multiple,published_date,selected[,thumbnail_url]); each file replaces "
                                              "that channel's CSV rows, keeping Jon's own Select choices")
    a.add_argument('files', nargs='*', help='CSV files (default: every one in D:\\AgentTeam\\content)')

    a = s.add_parser('calendar-add', help="add a video to a channel's calendar")
    a.add_argument('channel')
    a.add_argument('title')
    a.add_argument('--date', required=True, help='YYYY-MM-DD (PT)')
    a.add_argument('--time', help='posting time PT, e.g. 09:00 or 9:30 PM')
    a.add_argument('--status', required=True, choices=CALENDAR_STATUSES)
    a.add_argument('--link', help='https:// link to the video, Studio page or script')
    a.add_argument('--key', help='your own unique key; repeating it returns the first video instead of a copy')

    a = s.add_parser('calendar-update', help='change one calendar video')
    a.add_argument('id')
    a.add_argument('--title')
    a.add_argument('--date', help='YYYY-MM-DD (PT)')
    a.add_argument('--time', help="posting time PT, or '' to remove it")
    a.add_argument('--status', choices=CALENDAR_STATUSES)
    a.add_argument('--link', help="https:// link, or '' to remove it")

    a = s.add_parser('outliers', help='list outliers, best first (what Jon picked: --selected)')
    a.add_argument('--channel')
    a.add_argument('--selected', action='store_true', help='only those selected for production')
    a.add_argument('--limit', type=int)

    a = s.add_parser('outlier-add', help='add an outlier video found for a channel')
    a.add_argument('channel')
    a.add_argument('title')
    a.add_argument('--link', required=True, help='https:// link to the video')
    a.add_argument('--views', required=True, type=int)
    a.add_argument('--avg', required=True, type=int, help="its own channel's average views")
    a.add_argument('--published', required=True, help='YYYY-MM-DD')
    a.add_argument('--thumb', help='https:// thumbnail image')
    a.add_argument('--key', help='your own unique key, e.g. the video id; repeating it returns the first row')

    a = s.add_parser('outlier-select', help='mark an outlier selected for production, or not')
    a.add_argument('id')
    a.add_argument('state', choices=['on', 'off'])
    return p


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    args = parser().parse_args(argv)
    try:
        bot = which_bot()
        ctx = {'bot': bot, 'token': read_token(bot), 'base': check_base(args.base)}
        out = run(args, ctx)
    except Fail as err:
        print('dash.py: %s' % err, file=sys.stderr)
        return err.code
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 1 if isinstance(out, dict) and out.get('skipped') else 0  # an import with problems exits 1, so it gets reported


if __name__ == '__main__':
    sys.exit(main())
