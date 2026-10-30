#!/usr/bin/env python3
"""youtube_upload.py - put finished renders on YouTube as PRIVATE videos; publish only with Jon's approval (stdlib only).

  youtube_upload.py channels                       every channel: slug, name, account, connected or not
  youtube_upload.py upload CHANNEL FILE --title T --synthetic yes|no [--description D | --description-file F]
        [--tags "a,b"] [--category 22] [--playlist PLAYLIST_ID] [--thumbnail IMG] [--test-clip] [--dry-run]
                                                   private upload; an interrupted one resumes when run again,
                                                   and a finished one returns the same video (never a 2nd copy)
  youtube_upload.py schedule APPROVAL_ID [--dry-run]   publish at the time Jon approved (or now)
  youtube_upload.py delete CHANNEL VIDEO_ID        delete a test clip this tool uploaded (nothing else)

Publishing: ask Jon first, then run schedule with the approval id once he approves it:
  dash.py approval-request publish_video "<video title> - <channel name>" --project viral-view
          --payload-file p.json      p.json: {"channel": "mina", "video": "VIDEO_ID", "publishAt": "2026-11-02T17:00:00Z"}
  "publishAt": "now" makes it public right away. schedule claims the approval, so only the bot that asked can use it.

Tokens: D:\\AgentTeam\\secrets\\google\\yt-<channel>.json, one per channel, made on the google_connect.py page.
Prints JSON. Exit codes: 0 ok, 1 Google or the dashboard refused, 2 local problem or not allowed. See GOOGLE.md.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dash  # noqa: E402  (which_bot, read_token, call for approvals)

DIR = Path(os.environ.get('GOOGLE_SECRETS', r'D:\AgentTeam\secrets\google'))
API = 'https://www.googleapis.com/youtube/v3'
UPLOAD = 'https://www.googleapis.com/upload/youtube/v3'
SCOPE = 'https://www.googleapis.com/auth/youtube'  # upload, update, thumbnails, playlists, delete
CHUNK = 8 * 1024 * 1024  # resumable chunks must be multiples of 256 KiB
RETRIES = 5
# Google locks every video uploaded through an API project it has not audited as private, for good
# (videos.insert docs). Flip to True once Google approves Jon's audit form; until then only test clips.
AUDITED = False
AUDIT_MSG = ('Google keeps videos uploaded through our API project private forever until it passes the YouTube API '
             'audit (Jon is sending the form). Upload real videos in YouTube Studio until then. '
             'Use --test-clip only for a throwaway test.')
ACCOUNTS = {'partners': 'partners@thejonmac.com', 'jon': 'jon@thejonmac.com', 'jacqueline': None}  # login hints
CHANNELS = {  # slug: (name, Google account, channel id). Ids checked on youtube.com 2026-10-30.
    'theo': ('Theo Creates', 'partners', 'UCkFjK8d-7lfxqv3QUg8cI5Q'),
    'sienna': ('Sienna Creates', 'partners', 'UCGiPAxrv67y0RWohzLZbyPQ'),
    'zane': ('Zane Creates', 'partners', 'UCwSZZcyK_mTeEtN4Mu-QB0Q'),
    'aria': ('Aria Creates', 'partners', 'UCyEqHP8AtuPDzIWH7klmfkg'),
    'ash': ('Ash Creates', 'partners', 'UCunL92G3UzjUwSFyh8kvU8A'),
    'mina': ('Mina Creates', 'partners', 'UC6XzgM4IyRqSo9x6OwI2yqA'),
    'max': ('Max Creates', 'partners', 'UCfTP8sUPbX9R2PYxk9Txilg'),
    'peter-collins': ('Peter Collins', 'partners', 'UC4ElbvMXjotuSot1rMhRx5A'),
    'jack-mercer': ('Jack Mercer', 'partners', 'UCP4LZ2M-dz3tLaSDohBp5yw'),
    'rosa-cooks': ('Rosa Cooks', 'partners', 'UC13zfnUYAzTbK0scEj-ENDw'),
    'rosas-clean-home': ("Rosa's Clean Home", 'partners', 'UCGWwd-g7dzWuu00qERpOesQ'),
    'rosas-house-hacks': ("Rosa's House Hacks", 'partners', 'UCdc02lfXuQEKZEmxhC7HCdQ'),
    'giovanni-moretti': ('Giovanni Moretti', 'partners', 'UC-IKqe1B22dw4ki-C_L_Aig'),
    'frank-bennett-dogs': ('Frank Bennett Dogs', 'partners', 'UCC4wThHwp6t1xymt9FYw80g'),
    'ruth-calder': ('Ruth Calder', 'partners', 'UCFiCcgw7wbxzbGTJ6F_vn9A'),
    'dale-whitaker-pitbulls': ('Dale Whitaker Pitbulls', 'partners', 'UCAS0vfGZ1Q_fIUeACpjEUjQ'),
    'nora-fairweather-cats': ('Nora Fairweather Cats', 'partners', 'UCA-p6ISXtMw0rNxqIGvXlpg'),
    'gail-merriman-golf': ('Gail Merriman Golf', 'partners', 'UCmuuW-Cd9JI_FvD6JnC4MSQ'),
    'naomi-takeda-japan': ('Naomi Takeda Japan', 'partners', 'UCVQ1IvY122yx8G8zXAgPo1g'),
    'walter-brandt-dogs': ('Walter Brandt Dogs', 'partners', 'UCFohnIKCzMdwzUQw5rIjKUw'),
    'jon-mac': ('Jon Mac', 'jon', 'UC21BTzNwbWbQF4d22iq950w'),
    'jonmacai': ('Jon Mac | AI UGC (@JonMacAI)', 'jon', 'UCVLKdNuEVq3dxNCU2EMxqOg'),
    'complete-histories': ('Complete Histories with Henry', 'jacqueline', 'UCYDJzAxGnamFV6puHyFHKnw'),
}
VIDEO_ID_RE = re.compile(r'[A-Za-z0-9_-]{11}')
PLAYLIST_ID_RE = re.compile(r'[A-Za-z0-9_-]{10,64}')
APPROVAL_ID_RE = re.compile(r'a_[0-9a-f]{6,40}')
IMAGE_TYPES = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'}
OCTET = {'Content-Type': 'application/octet-stream'}  # else urllib labels the bytes as a form


class Fail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):  # a resumable upload answers 308 "keep going", never a redirect to follow
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def http(method, url, data=None, headers=None):
    """One request: (status, headers with lower-case names, body). Network errors raise OSError. Tests fake this."""
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with OPENER.open(req, timeout=120) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read()


def google_error(status, body):
    try:
        e = json.loads(body)['error']
        reason, message = (e.get('errors') or [{}])[0].get('reason', ''), e.get('message', '')
    except (ValueError, KeyError, TypeError, AttributeError):
        reason, message = '', body[:300].decode('utf-8', 'replace')
    if reason in ('quotaExceeded', 'dailyLimitExceeded'):
        return Fail(1, "YouTube API quota for today is used up (uploads: 100 a day; other calls: 10,000 units). "
                       "It resets at midnight Pacific; run the same command again then.")
    if reason == 'uploadLimitExceeded':
        return Fail(1, "This channel hit YouTube's own daily upload limit. Run the same command again tomorrow.")
    return Fail(1, 'YouTube said %s %s: %s' % (status, reason, message))


def client():
    """The YouTube OAuth client Jon made (youtube-client.json), else the team's Gmail one (client.json)."""
    for name in ('youtube-client.json', 'client.json'):
        if (DIR / name).exists():
            c = json.loads((DIR / name).read_text(encoding='utf-8'))
            return c.get('installed') or c['web']
    raise OSError('no OAuth client file')


def token_path(channel):
    return DIR / ('yt-%s.json' % channel)


def connected(channel):
    try:
        return json.loads(token_path(channel).read_text(encoding='utf-8')).get('channel') == CHANNELS[channel][2]
    except (OSError, ValueError):
        return False


class YouTube:
    """One channel's session. The access token is fetched at start and again if Google answers 401."""
    def __init__(self, channel):
        self.channel = channel
        if not connected(channel):
            raise Fail(2, '%s is not connected yet: Jon connects it on the google_connect.py page' % channel)
        try:
            self.tok = json.loads(token_path(channel).read_text(encoding='utf-8'))
            self.client = client()
        except (OSError, ValueError, KeyError):
            raise Fail(2, 'the OAuth client file is missing or broken (see GOOGLE.md)')
        self.refresh()

    def refresh(self):
        c = self.client
        try:
            status, _, body = http('POST', c['token_uri'], urllib.parse.urlencode({
                'client_id': c['client_id'], 'client_secret': c['client_secret'],
                'refresh_token': self.tok['refresh_token'], 'grant_type': 'refresh_token'}).encode(),
                {'Content-Type': 'application/x-www-form-urlencoded'})
        except OSError as err:
            raise Fail(1, 'Google unreachable: %s' % err)
        if status != 200:
            raise Fail(1, "Google refused %s's saved sign-in (%s); Jon reconnects it on the google_connect.py page"
                       % (self.channel, status))
        self.access = json.loads(body)['access_token']

    def request(self, method, url, data=None, headers=None):
        for attempt in (1, 2):
            status, h, body = http(method, url, data, dict(headers or {}, Authorization='Bearer ' + self.access))
            if status != 401 or attempt == 2:
                return status, h, body
            self.refresh()

    def call(self, method, url, body=None, query=None):
        """A JSON call; anything but 2xx raises Fail."""
        if query:
            url += '?' + urllib.parse.urlencode(query)
        try:
            status, _, raw = self.request(method, url, None if body is None else json.dumps(body).encode(),
                                          None if body is None else {'Content-Type': 'application/json'})
        except OSError as err:
            raise Fail(1, 'YouTube unreachable: %s' % err)
        if not 200 <= status < 300:
            raise google_error(status, raw)
        return json.loads(raw) if raw else {}


# One record per upload (channel + file + size + modified time), in the secrets folder because a session link
# lets anyone finish the upload. It holds the session link until the upload ends, then the video id.
def record_path(channel, path):
    st = path.stat()
    key = '%s|%s|%d|%d' % (channel, os.path.normcase(str(path.resolve())), st.st_size, st.st_mtime_ns)
    return DIR / 'youtube-uploads' / ('%s.json' % hashlib.sha256(key.encode()).hexdigest()[:24])


def read_record(p):
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def write_record(p, rec):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(rec), encoding='utf-8')
    os.replace(tmp, p)


def next_offset(headers):
    m = re.match(r'bytes=0-(\d+)$', headers.get('range', ''))
    return int(m.group(1)) + 1 if m else 0


def send_file(yt, path, meta, rec, save):
    """Resumable upload. The session link is saved before the first byte, so a crash or a killed run resumes
    from Google's last received byte on the next run. Returns the video id."""
    size = rec['size']

    def start():
        status, h, body = yt.request('POST', UPLOAD + '/videos?uploadType=resumable&part=snippet,status',
                                     json.dumps(meta).encode(), {'Content-Type': 'application/json; charset=UTF-8',
                                                                 'X-Upload-Content-Length': str(size),
                                                                 'X-Upload-Content-Type': 'video/*'})
        if status >= 500:
            raise OSError('YouTube %s' % status)
        if status != 200 or 'location' not in h:
            raise google_error(status, body)
        rec['uri'] = h['location']
        save()
        return 0

    def where():  # bytes Google holds, the finished video, or None if it dropped the session
        status, h, body = yt.request('PUT', rec['uri'], b'', {'Content-Range': 'bytes */%d' % size, **OCTET})
        if status in (200, 201):
            return json.loads(body)
        if status == 308:
            return next_offset(h)
        if status in (404, 410):
            return None
        if status >= 500:
            raise OSError('YouTube %s' % status)
        raise google_error(status, body)

    offset, tries = None, 0
    with open(path, 'rb') as f:
        while True:
            try:
                if offset is None:  # a new upload, a rerun, or after a failure: start or ask Google how far it got
                    got = where() if rec.get('uri') else None
                    if isinstance(got, dict):
                        return got['id']
                    offset = start() if got is None else got
                f.seek(offset)
                chunk = f.read(CHUNK)
                status, h, body = yt.request('PUT', rec['uri'], chunk, {
                    'Content-Range': 'bytes %d-%d/%d' % (offset, offset + len(chunk) - 1, size), **OCTET})
            except OSError as err:
                status, body = None, str(err).encode()
            if status in (200, 201):
                return json.loads(body)['id']
            if status == 308:
                offset, tries = next_offset(h), 0
                continue
            if status is not None and status < 500:
                raise google_error(status, body)
            tries += 1
            if tries > RETRIES:
                raise Fail(1, 'The upload stopped after %d tries (%s). Run the same command again: it resumes.'
                           % (RETRIES, body[:200].decode('utf-8', 'replace')))
            time.sleep(min(60, 2 ** tries))
            offset = None


def upload(yt, channel, path, meta, thumbnail=None, playlist=None, test=False):
    rp = record_path(channel, path)
    rec = read_record(rp) or {'channel': channel, 'file': str(path), 'size': path.stat().st_size, 'test': test}
    already = bool(rec.get('video'))
    if not already:
        rec['video'] = send_file(yt, path, meta, rec, lambda: write_record(rp, rec))
        rec.pop('uri', None)
        write_record(rp, rec)
    video, problems = rec['video'], []
    if thumbnail and not rec.get('thumbnail'):
        try:
            status, _, body = yt.request('POST', UPLOAD + '/thumbnails/set?videoId=' + video, thumbnail.read_bytes(),
                                         {'Content-Type': IMAGE_TYPES[thumbnail.suffix.lower()]})
        except OSError as err:
            status, body = None, str(err).encode()
        if status == 200:
            rec['thumbnail'] = True
        else:
            hint = ' (the channel needs YouTube phone verification; Jon)' if status == 403 else ''
            problems.append('thumbnail not set: %s%s; run the same command again later'
                            % (google_error(status, body) if status else body.decode(), hint))
    if playlist and rec.get('playlist') != playlist:
        try:
            yt.call('POST', API + '/playlistItems', {'snippet': {
                'playlistId': playlist, 'resourceId': {'kind': 'youtube#video', 'videoId': video}}}, {'part': 'snippet'})
            rec['playlist'] = playlist
        except Fail as err:
            problems.append('not added to the playlist: %s' % err)
    write_record(rp, rec)
    return {'channel': channel, 'video': video, 'privacy': 'private', 'already_uploaded': already,
            'studio': 'https://studio.youtube.com/video/%s/edit' % video, 'problems': problems}


def delete(yt, channel, video):
    folder = DIR / 'youtube-uploads'
    for p in folder.glob('*.json') if folder.exists() else []:
        rec = read_record(p) or {}
        if rec.get('video') == video and rec.get('channel') == channel:
            if not rec.get('test'):
                raise Fail(2, 'only test clips can be deleted here; deleting a real video needs Jon')
            try:
                status, _, body = yt.request('DELETE', API + '/videos?id=' + video)
            except OSError as err:
                raise Fail(1, 'YouTube unreachable: %s' % err)
            if status not in (200, 204, 404):
                raise google_error(status, body)
            p.unlink()
            return {'deleted': video, 'channel': channel}
    raise Fail(2, 'only test clips this tool uploaded can be deleted')


def dash_call(ctx, method, path, body=None):
    try:
        return dash.call(ctx, method, path, body)
    except dash.Fail as err:
        raise Fail(2 if err.code == 2 else 1, 'dashboard: %s' % err)


def publish_time(value, now):
    if value == 'now':
        return 'now'
    try:
        when = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        when = None
    if when is None or when.tzinfo is None:
        raise Fail(2, 'publishAt must be "now" or a time with its zone, like 2026-11-02T17:00:00Z')
    if when < now + timedelta(minutes=2):
        raise Fail(2, 'publishAt %s has passed; ask Jon again with a new time' % value)
    return when.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def schedule(approval_id, dry_run=False, now=None):
    try:
        bot = dash.which_bot()
        ctx = {'bot': bot, 'token': dash.read_token(bot), 'base': dash.check_base(dash.BASE)}
    except dash.Fail as err:
        raise Fail(2, str(err))
    q = urllib.parse.quote(approval_id, safe='')
    out = dash_call(ctx, 'GET', '/approvals/' + q)
    a = out.get('approval', out)
    p = a.get('payload') or {}
    if a.get('action') != 'publish_video':
        raise Fail(2, 'approval %s is for %s, not publish_video' % (approval_id, a.get('action')))
    if a.get('status') != 'approved':
        raise Fail(2, 'approval %s is %s; only one Jon approved and not yet used can publish' % (approval_id, a.get('status')))
    channel, video = p.get('channel'), str(p.get('video', ''))
    if channel not in CHANNELS or not VIDEO_ID_RE.fullmatch(video):
        raise Fail(2, 'the approval payload needs "channel" (one of the channels) and "video" (an 11-character id)')
    when = publish_time(p.get('publishAt'), now or datetime.now(timezone.utc))
    plan = {'approval': approval_id, 'channel': channel, 'video': video, 'publish': when}
    if dry_run:
        return dict(plan, dry_run=True)
    yt = YouTube(channel)  # before the claim, so a missing sign-in doesn't use up Jon's approval
    dash_call(ctx, 'POST', '/approvals/%s/claim' % q, {})
    try:
        items = yt.call('GET', API + '/videos', query={'part': 'status', 'id': video}).get('items') or []
        if not items:
            raise Fail(1, 'video %s is not on %s' % (video, channel))
        keep = ('license', 'embeddable', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia')
        status = {k: v for k, v in items[0].get('status', {}).items() if k in keep}
        status.update({'privacyStatus': 'public'} if when == 'now' else {'privacyStatus': 'private', 'publishAt': when})
        yt.call('PUT', API + '/videos', {'id': video, 'status': status}, {'part': 'status'})
    except Fail as err:
        try:
            dash_call(ctx, 'POST', '/approvals/%s/release' % q, {'note': str(err)[:500]})
        except Fail:
            pass  # still "running"; the next session finds it (DASH.md)
        raise
    note = 'public now' if when == 'now' else 'scheduled for %s' % when
    dash_call(ctx, 'POST', '/approvals/%s/done' % q, {'note': note})
    return dict(plan, done=note, studio='https://studio.youtube.com/video/%s/edit' % video)


def upload_meta(args):
    """Check everything before any byte goes up. Returns (file, metadata, thumbnail)."""
    path = Path(args.file)
    if not path.is_file() or path.stat().st_size == 0:
        raise Fail(2, 'no video at %s' % path)
    if args.description_file:
        try:
            args.description = Path(args.description_file).read_text(encoding='utf-8-sig')
        except OSError as err:
            raise Fail(2, 'cannot read the description: %s' % err)
    desc = args.description or ''
    tags = [t.strip() for t in (args.tags or '').split(',') if t.strip()]
    if not 0 < len(args.title.strip()) <= 100 or len(desc.encode()) > 5000 or len(','.join(tags)) > 500:
        raise Fail(2, 'title 1-100 characters, description up to 5000 bytes, tags up to 500 characters')
    if any(c in s for s in [args.title, desc] + tags for c in '<>'):
        raise Fail(2, 'YouTube refuses < and > in titles, descriptions and tags')
    if args.playlist and not PLAYLIST_ID_RE.fullmatch(args.playlist):
        raise Fail(2, 'a playlist id looks like PLxxxxxxxx (from its YouTube link)')
    thumb = Path(args.thumbnail) if args.thumbnail else None
    if thumb and (not thumb.is_file() or thumb.suffix.lower() not in IMAGE_TYPES or thumb.stat().st_size > 2 * 1024 * 1024):
        raise Fail(2, 'the thumbnail must be a .jpg or .png file up to 2 MB')
    snippet = {'title': args.title.strip(), 'description': desc, 'categoryId': str(args.category)}
    if tags:
        snippet['tags'] = tags
    return path, {'snippet': snippet, 'status': {'privacyStatus': 'private', 'selfDeclaredMadeForKids': False,
                                                 'containsSyntheticMedia': args.synthetic == 'yes'}}, thumb


def parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = ap.add_subparsers(dest='cmd', required=True)
    s.add_parser('channels')
    a = s.add_parser('upload')
    a.add_argument('channel', choices=sorted(CHANNELS))
    a.add_argument('file')
    a.add_argument('--title', required=True)
    a.add_argument('--synthetic', required=True, choices=['yes', 'no'],
                   help='yes when realistic AI people, voices or scenes appear (YouTube asks creators to say so)')
    d = a.add_mutually_exclusive_group()
    d.add_argument('--description')
    d.add_argument('--description-file')
    a.add_argument('--tags', help='comma-separated')
    a.add_argument('--category', type=int, default=22, help='22 People & Blogs, 26 Howto & Style, 28 Science & Tech')
    a.add_argument('--playlist', help='playlist id to add the video to')
    a.add_argument('--thumbnail', help='.jpg or .png up to 2 MB')
    a.add_argument('--test-clip', action='store_true', help='a throwaway test video (allowed before the audit; deletable)')
    a.add_argument('--dry-run', action='store_true', help='check everything and print the plan; uploads nothing')
    a = s.add_parser('schedule')
    a.add_argument('approval_id')
    a.add_argument('--dry-run', action='store_true', help='check the approval and print the plan; changes nothing')
    a = s.add_parser('delete')
    a.add_argument('channel', choices=sorted(CHANNELS))
    a.add_argument('video_id')
    return ap


def run(args):
    if args.cmd == 'channels':
        return [{'channel': k, 'name': n, 'account': acc, 'connected': connected(k)} for k, (n, acc, _) in CHANNELS.items()]
    if args.cmd == 'schedule':
        if not APPROVAL_ID_RE.fullmatch(args.approval_id):
            raise Fail(2, 'approval ids look like a_0123abcd')
        return schedule(args.approval_id, args.dry_run)
    if args.cmd == 'delete':
        if not VIDEO_ID_RE.fullmatch(args.video_id):
            raise Fail(2, 'video ids are 11 characters')
        return delete(YouTube(args.channel), args.channel, args.video_id)
    path, meta, thumb = upload_meta(args)
    allowed = AUDITED or args.test_clip
    if args.dry_run:
        return {'dry_run': True, 'channel': args.channel, 'file': str(path), 'bytes': path.stat().st_size,
                'connected': connected(args.channel), 'metadata': meta, 'thumbnail': str(thumb) if thumb else None,
                'playlist': args.playlist, 'blocked': None if allowed else AUDIT_MSG}
    if not allowed:
        raise Fail(2, AUDIT_MSG)
    return upload(YouTube(args.channel), args.channel, path, meta, thumb, args.playlist, args.test_clip)


def main(argv=None):
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        out = run(parser().parse_args(argv))
    except Fail as err:
        print('youtube_upload.py: %s' % err, file=sys.stderr)
        return err.code
    except OSError as err:
        print('youtube_upload.py: %s' % err, file=sys.stderr)
        return 2
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
