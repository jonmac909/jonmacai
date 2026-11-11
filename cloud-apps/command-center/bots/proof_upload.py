"""proof_upload.py - post a file as card proof with an https link QC and Jon can open (Python stdlib only).

    python -I proof_upload.py <card id> <file> --kind render|url|pdf|test --note "what it shows"
    python -I proof_upload.py <card id> final.mp4 --kind render --note "v3" -- --slug diane-1-v3 --channel diane \
        --video diane-1 --version v3 --title "..."      (an mp4 render: the args after -- go to review_publish.mjs)

Pictures, PDFs, text, JSON and short mp4 clips go to jonmac.ai/dashboard/f/<random name> (bot token, 95 MB cap).
An mp4 with --kind render is published to jonmac.ai/review as today and its review page is the proof link.
Then it runs dash.py proof-add with that link, so every proof-add check and the QC wake still happen.
A missing, empty or unlisted file is refused and no proof is posted. Exit codes follow dash.py.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dash  # noqa: E402  same folder; -I leaves it off sys.path

TYPES = ('png', 'jpg', 'jpeg', 'pdf', 'txt', 'md', 'json', 'mp4')
MAX_BYTES = 95 * 1024 * 1024
PUBLISH = Path(os.environ.get('REVIEW_PUBLISH', str(HERE / 'review_publish.mjs')))


def check_file(path):
    p = Path(path)
    if not p.is_file():
        raise dash.Fail(2, 'Refused, no proof posted: %s is not a file.' % path)
    ext = p.suffix.lower().lstrip('.')
    if ext not in TYPES:
        raise dash.Fail(2, 'Refused, no proof posted: .%s is not a proof type (%s).' % (ext or '?', ', '.join(TYPES)))
    size = p.stat().st_size
    if size == 0:
        raise dash.Fail(2, 'Refused, no proof posted: %s is empty (0 bytes).' % path)
    return p, ext, size


def upload(p, size):
    if size > MAX_BYTES:
        raise dash.Fail(2, 'Refused, no proof posted: %s is over 95 MB. Renders go through review_publish (--kind render -- --slug ...).' % p)
    bot = dash.which_bot()
    token = dash.read_token(bot)
    url = dash.check_base(dash.BASE).rstrip('/') + '/files?' + urllib.parse.urlencode({'name': p.name})
    with p.open('rb') as fh:
        req = urllib.request.Request(url, data=fh, method='POST')
        req.add_header('Authorization', 'Bearer %s' % token)
        req.add_header('Content-Type', 'application/octet-stream')
        req.add_header('Content-Length', str(size))
        req.add_header('User-Agent', 'AgentTeamDash/1.0 (%s)' % bot)
        try:
            with dash.OPENER.open(req, timeout=600) as res:
                out = json.loads(res.read().decode('utf-8', 'replace'))
        except urllib.error.HTTPError as err:
            raw = err.read().decode('utf-8', 'replace')
            try:
                msg = json.loads(raw).get('error') or raw[:300]
            except (ValueError, AttributeError):
                msg = raw[:300]
            raise dash.Fail(1 if 400 <= err.code < 500 else 3, 'Upload refused, no proof posted: HTTP %s: %s' % (err.code, msg))
        except (urllib.error.URLError, OSError) as err:
            raise dash.Fail(3, 'Upload failed, no proof posted: %s' % err)
    link = out.get('url') or ''
    if not link.startswith('https://'):
        raise dash.Fail(3, 'Upload gave no https link, no proof posted: %s' % out)
    return link


def publish(card, p, extra):
    if '--slug' not in extra:
        raise dash.Fail(2, 'Refused, no proof posted: an mp4 render goes to jonmac.ai/review. Add -- --slug .. --channel .. '
                           '--video .. --version .. --title .. (review_publish.mjs args).')
    cmd = ['node', str(PUBLISH), '--file', str(p), '--task', card] + extra
    run = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    sys.stderr.write(run.stderr)
    if run.returncode != 0:
        raise dash.Fail(3, 'review_publish failed (exit %s), no proof posted.' % run.returncode)
    start = run.stdout.find('{')
    try:
        link = json.loads(run.stdout[start:]).get('page_url') or '' if start >= 0 else ''
    except ValueError:
        link = ''
    if not link.startswith('https://'):
        raise dash.Fail(3, 'review_publish gave no https page link, no proof posted.')
    return link


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    extra = argv[argv.index('--') + 1:] if '--' in argv else []
    argv = argv[:argv.index('--')] if '--' in argv else argv
    ap = argparse.ArgumentParser(prog='proof_upload.py', description='Post a file as card proof with an https link.')
    ap.add_argument('card')
    ap.add_argument('file')
    ap.add_argument('--kind', required=True, choices=['render', 'url', 'pdf', 'test'])
    ap.add_argument('--note', default='')
    args = ap.parse_args(argv)
    try:
        if not re.match(r'^t_[0-9a-f]{16}$', args.card):
            raise dash.Fail(2, 'Refused, no proof posted: %s is not a card id (t_ and 16 hex).' % args.card)
        p, ext, size = check_file(args.file)
        link = publish(args.card, p, extra) if ext == 'mp4' and args.kind == 'render' else upload(p, size)
    except dash.Fail as err:
        print(err, file=sys.stderr)
        return err.code
    print(link, flush=True)  # before proof-add's own output
    cmd =[sys.executable, '-I', str(HERE / 'dash.py'), 'proof-add', args.card, '--kind', args.kind, '--link', link]
    if args.note:
        cmd += ['--note', args.note]
    return subprocess.run(cmd).returncode


if __name__ == '__main__':
    sys.exit(main())
