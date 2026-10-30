#!/usr/bin/env python3
"""short_post.py - post Jon-approved short clips to Instagram Reels, the Facebook Page (Reels), TikTok and YouTube Shorts (stdlib only).

  short_post.py check [--youtube-channel jonmacai]   each platform: which account it posts as, from the real APIs (posts nothing)
  short_post.py post APPROVAL_ID [--dry-run]          post every clip of an approved post_clips approval to the platforms it lists

Ask Jon first: dash.py approval-request post_clips "<clip titles>" --project short-form --payload-file p.json, with p.json:
  {"platforms": ["instagram_reels", "facebook_reels", "tiktok", "youtube_shorts"], "youtube_channel": "jonmacai",
   "clips": [{"file": "D:/AgentTeam/footage/short-form/clip1.mp4", "title": "YouTube title", "caption": "...", "hashtags": "#a #b", "synthetic": true}]}
  Clips: vertical .mp4, 3 to 90 s. "synthetic": true when realistic AI people, voices or scenes appear.
post refuses anything but an approved post_clips approval of this bot, and posts only the clips it lists. It claims the
approval, posts each clip once per platform (keyed by the file's SHA-256, so a rerun or a copy never posts twice), records
the post id, link or error per platform, and marks the approval done when every clip is on every platform. Otherwise it
gives the approval back with what failed; the same command later posts only what is missing.

Before the audits: YouTube refuses API uploads (youtube_upload.AUDITED) and TikTok only lets an unaudited app post to
private accounts, so each clip goes to Jon's TikTok inbox: he taps the notification, pastes the caption and posts.
Flip AUDITED / TIKTOK_AUDITED when each audit passes.
Tokens: D:\\AgentTeam\\secrets\\social\\ (meta.json, tiktok-client.json, tiktok.json), made on the google_connect.py page,
with one record per clip and platform in posts\\. Never print or copy them.
Prints JSON. Exit codes: 0 ok, 1 a platform or the dashboard refused (or not every clip got posted), 2 local problem or not allowed.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import youtube_upload as yt  # noqa: E402  (http, Fail, records, dashboard calls, YouTube upload)

Fail = yt.Fail
DIR = Path(os.environ.get('SOCIAL_SECRETS', r'D:\AgentTeam\secrets\social'))
VERSION = 'v23.0'
GRAPH = 'https://graph.facebook.com/' + VERSION
RUPLOAD = 'https://rupload.facebook.com'
TIKTOK = 'https://open.tiktokapis.com/v2'
TIKTOK_REDIRECT = 'http://localhost:8765/tiktok-callback/'  # the connect page; registered in Jon's TikTok app
TIKTOK_SCOPES = 'user.info.basic,video.upload,video.publish'
TIKTOK_AUDITED = False  # unaudited: inbox drafts (TikTok refuses direct posts to public accounts until the audit)
PLATFORMS = ('instagram_reels', 'facebook_reels', 'tiktok', 'youtube_shorts')
DONE = ('posted', 'inbox')
POLL, WAIT = 10, 60  # seconds between status checks, checks before "run again later"
FFPROBE = os.environ.get('FFPROBE', 'ffprobe')
YT_AUDIT = ("YouTube Shorts wait for Google's YouTube API audit: until it passes, Google keeps API uploads private "
            "for good (youtube_upload.AUDITED)")
NOT_CONNECTED = '%s is not connected yet: Jon connects it on the connect page (google_connect.py serve)'


def read_json(name):
    return json.loads((DIR / name).read_text(encoding='utf-8'))


def save_json(name, data):
    yt.write_record(DIR / name, dict(data, saved_at=time.strftime('%Y-%m-%dT%H:%M:%S%z')))


# ---- Meta: one Page token for the Facebook Page and the Instagram account linked to it ----

def meta_error(status, body):
    try:
        e = json.loads(body)['error']
        code, msg = e.get('code'), e.get('error_user_msg') or e.get('message', '')
    except (ValueError, KeyError, TypeError, AttributeError):
        code, msg = None, body[:300].decode('utf-8', 'replace')
    if code == 190:
        return Fail(1, 'Meta refused the saved sign-in (%s); Jon reconnects Instagram and Facebook on the connect page' % msg)
    return Fail(1, 'Meta said %s: %s' % (status, msg))


class Meta:
    def __init__(self):
        try:
            m = read_json('meta.json')
            self.token, self.page, self.ig, self.ig_username = m['page_token'], m['page_id'], m['ig_id'], m['ig_username']
        except (OSError, ValueError, KeyError):
            raise Fail(2, NOT_CONNECTED % 'Instagram and Facebook')

    def call(self, method, path, form=None, query=None):
        url = GRAPH + path + ('?' + urllib.parse.urlencode(query) if query else '')
        headers = {'Authorization': 'OAuth ' + self.token}
        if form:
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        status, _, body = yt.http(method, url, urllib.parse.urlencode(form).encode() if form else None, headers)
        if status != 200:
            raise meta_error(status, body)
        return json.loads(body)

    def rupload(self, url, path):
        status, _, body = yt.http('POST', url, path.read_bytes(), {
            'Authorization': 'OAuth ' + self.token, 'offset': '0', 'file_size': str(path.stat().st_size), **yt.OCTET})
        if status != 200:
            raise meta_error(status, body)


def instagram(m, clip, rec, save):
    if not rec.get('uploaded'):  # a container that never got all its bytes is never published: make a new one
        d = m.call('POST', '/%s/media' % m.ig, {'media_type': 'REELS', 'upload_type': 'resumable',
                                                'caption': clip['text'], 'share_to_feed': 'true'})
        m.rupload(d.get('uri') or '%s/ig-api-upload/%s/%s' % (RUPLOAD, VERSION, d['id']), clip['file'])
        rec.update(container=d['id'], uploaded=True)
        save()
    for _ in range(WAIT):
        st = m.call('GET', '/' + rec['container'], query={'fields': 'status_code,status'})
        code = st.get('status_code')
        if code == 'FINISHED':
            rec['id'] = m.call('POST', '/%s/media_publish' % m.ig, {'creation_id': rec['container']})['id']
            break
        if code == 'PUBLISHED':  # an earlier run published it and stopped before saving the id
            break
        if code in ('ERROR', 'EXPIRED'):
            for k in ('container', 'uploaded'):
                rec.pop(k, None)
            save()
            raise Fail(1, 'Instagram could not process the clip (%s); run the same command again' % st.get('status'))
        time.sleep(POLL)
    else:
        raise Fail(1, 'Instagram is still processing the clip; run the same command again later')
    link = (m.call('GET', '/' + rec['id'], query={'fields': 'permalink'}).get('permalink') if rec.get('id')
            else 'https://www.instagram.com/%s/' % m.ig_username)
    rec.update(state='posted', link=link)


def facebook(m, clip, rec, save):
    if not rec.get('uploaded'):  # a video that never got all its bytes is never published: start a new one
        d = m.call('POST', '/%s/video_reels' % m.page, {'upload_phase': 'start'})
        m.rupload(d.get('upload_url') or '%s/video-upload/%s/%s' % (RUPLOAD, VERSION, d['video_id']), clip['file'])
        rec.update(video=d['video_id'], uploaded=True)
        save()
    if not rec.get('finished'):  # finishing the same video again can't make a second reel
        if not m.call('POST', '/%s/video_reels' % m.page, {'upload_phase': 'finish', 'video_id': rec['video'],
                                                           'video_state': 'PUBLISHED', 'description': clip['text']}).get('success'):
            raise Fail(1, 'Facebook did not accept the reel; run the same command again')
        rec['finished'] = True
        save()
    for _ in range(WAIT):
        st = m.call('GET', '/' + rec['video'], query={'fields': 'status'}).get('status') or {}
        phases = [st.get(p) or {} for p in ('uploading_phase', 'processing_phase', 'publishing_phase')]
        if st.get('video_status') == 'error' or any(p.get('status') == 'error' for p in phases):
            for k in ('video', 'uploaded', 'finished'):
                rec.pop(k, None)
            save()
            raise Fail(1, 'Facebook could not process the reel (%s); run the same command again' % json.dumps(st)[:300])
        if phases[2].get('status') in ('complete', 'completed'):
            break
        time.sleep(POLL)
    else:
        raise Fail(1, 'Facebook is still processing the reel; run the same command again later')
    rec.update(state='posted', id=rec['video'], link='https://www.facebook.com/reel/%s' % rec['video'])


def meta_connect(app_id, app_secret, user_token):
    """Jon pastes his Meta app's id and secret and a user token from the Graph API Explorer. Saves the Page token
    (made from a long-lived user token, so it doesn't expire) and the Instagram account linked to the Page.
    Returns a problem or ''."""
    if not re.fullmatch(r'[0-9]{5,25}', app_id) or not re.fullmatch(r'[0-9a-f]{32}', app_secret) or \
            not re.fullmatch(r'[A-Za-z0-9]{20,1000}', user_token):
        return 'That is not an App ID, App secret and access token. Copy all three again.'
    try:
        status, _, body = yt.http('GET', GRAPH + '/oauth/access_token?' + urllib.parse.urlencode({
            'grant_type': 'fb_exchange_token', 'client_id': app_id, 'client_secret': app_secret,
            'fb_exchange_token': user_token}))
        if status != 200:
            return 'Meta refused the token (%s). Make a new one in the Graph API Explorer and paste it again.' % \
                meta_error(status, body)
        status, _, body = yt.http('GET', GRAPH + '/me/accounts?fields=id,name,access_token,instagram_business_account'
                                  '%7Bid,username%7D', None, {'Authorization': 'OAuth ' + json.loads(body)['access_token']})
    except OSError as err:
        return 'Meta unreachable (%s). Try again.' % err
    if status != 200:
        return 'Meta would not list your Pages (%s). Tick pages_show_list and try again.' % meta_error(status, body)
    pages = [p for p in json.loads(body).get('data', []) if p.get('instagram_business_account')]
    if len(pages) != 1:
        return ('Found %d Facebook Pages with an Instagram account linked; it must be exactly one. Make the token '
                'again and choose only your Jon Mac Page and its Instagram.' % len(pages))
    p, ig = pages[0], pages[0]['instagram_business_account']
    save_json('meta.json', {'app_id': app_id, 'page_id': p['id'], 'page_name': p['name'], 'page_token': p['access_token'],
                            'ig_id': ig['id'], 'ig_username': ig.get('username', '')})
    return ''


# ---- TikTok ----

def tiktok_token(fields):
    c = read_json('tiktok-client.json')
    status, _, body = yt.http('POST', TIKTOK + '/oauth/token/', urllib.parse.urlencode(dict(
        fields, client_key=c['client_key'], client_secret=c['client_secret'])).encode(),
        {'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        out = json.loads(body)
    except ValueError:
        out = {}
    return c['client_key'], (out if status == 200 and out.get('access_token') else {'error': out.get('error_description')
                                                                                   or out.get('error') or status})


class TikTok:
    def __init__(self):
        if not connected('tiktok'):  # a sign-in made with another TikTok app doesn't count
            raise Fail(2, NOT_CONNECTED % 'TikTok')
        self.tok = read_json('tiktok.json')
        _, out = tiktok_token({'grant_type': 'refresh_token', 'refresh_token': self.tok['refresh_token']})
        if 'error' in out:
            raise Fail(1, "TikTok refused the saved sign-in (%s); Jon reconnects TikTok on the connect page" % out['error'])
        self.access = out['access_token']
        if out.get('refresh_token', self.tok['refresh_token']) != self.tok['refresh_token']:  # TikTok may rotate it
            self.tok['refresh_token'] = out['refresh_token']
            save_json('tiktok.json', self.tok)

    def call(self, method, path, body=None, query=None):
        url = TIKTOK + path + ('?' + urllib.parse.urlencode(query) if query else '')
        status, _, raw = yt.http(method, url, None if body is None else json.dumps(body).encode(), {
            'Authorization': 'Bearer ' + self.access, 'Content-Type': 'application/json; charset=UTF-8'})
        try:
            out = json.loads(raw)
        except ValueError:
            out = {}
        err = out.get('error') or {}
        if status != 200 or err.get('code', 'ok') != 'ok':
            raise Fail(1, 'TikTok said %s %s: %s' % (status, err.get('code', ''), err.get('message') or raw[:200]))
        return out.get('data') or {}


def tiktok(t, clip, rec, save):
    if not rec.get('publish_id'):
        size = clip['file'].stat().st_size
        chunk = min(size, 64 << 20)  # 5-64 MB chunks, a file under 5 MB whole; the last chunk takes the rest
        count = size // chunk
        body = {'source_info': {'source': 'FILE_UPLOAD', 'video_size': size, 'chunk_size': chunk, 'total_chunk_count': count}}
        path = '/post/publish/inbox/video/init/'
        if TIKTOK_AUDITED:
            info = t.call('POST', '/post/publish/creator_info/query/', {})
            if 'PUBLIC_TO_EVERYONE' not in info.get('privacy_level_options', []):
                raise Fail(1, 'TikTok will not let this account post publicly right now')
            rec['username'] = info.get('creator_username')
            path = '/post/publish/video/init/'
            body['post_info'] = {'title': clip['text'], 'privacy_level': 'PUBLIC_TO_EVERYONE', 'is_aigc': clip['synthetic']}
        d = t.call('POST', path, body)
        rec.update(publish_id=d['publish_id'], started=time.time())
        save()
        with open(clip['file'], 'rb') as f:
            for i in range(count):
                data = f.read(chunk if i < count - 1 else size - i * chunk)
                status, _, raw = yt.http('PUT', d['upload_url'], data, {
                    'Content-Type': 'video/mp4', 'Content-Range': 'bytes %d-%d/%d' % (i * chunk, i * chunk + len(data) - 1, size)})
                if status not in (201, 206):
                    raise Fail(1, 'TikTok refused the upload (%s): %s' % (status, raw[:200].decode('utf-8', 'replace')))
    for _ in range(WAIT):
        st = t.call('POST', '/post/publish/status/fetch/', {'publish_id': rec['publish_id']})
        s = st.get('status')
        if s == 'SEND_TO_USER_INBOX':
            rec.update(state='inbox', id=rec['publish_id'], note="In Jon's TikTok inbox: he taps the notification, "
                                                                   "pastes the caption and posts (needs TikTok audit to post directly)")
            return
        if s == 'PUBLISH_COMPLETE':
            ids = st.get('publicaly_available_post_id') or []  # (sic) only once TikTok's moderation passes
            user = 'https://www.tiktok.com/@%s' % rec.get('username', '')
            rec.update(state='posted', id=str(ids[0]) if ids else rec['publish_id'],
                       link='%s/video/%s' % (user, ids[0]) if ids else user)
            return
        # Nothing was posted: an upload link lasts an hour, so after that no more bytes can arrive.
        if s == 'FAILED' or (s == 'PROCESSING_UPLOAD' and time.time() - rec['started'] > 3700):
            rec.pop('publish_id')
            save()
            raise Fail(1, 'TikTok did not take the clip (%s); run the same command again'
                       % (st.get('fail_reason') or 'the upload stopped part way'))
        time.sleep(POLL)
    raise Fail(1, 'TikTok is still working on the clip; run the same command again later')


def tiktok_client_save(client_key, client_secret):
    """Jon pastes his TikTok app's Client key and secret on the connect page. Returns a problem or ''."""
    if not re.fullmatch(r'[A-Za-z0-9]{10,40}', client_key) or not re.fullmatch(r'[A-Za-z0-9_-]{20,80}', client_secret):
        return 'That is not a Client key and secret. Copy both again from the app page.'
    save_json('tiktok-client.json', {'client_key': client_key, 'client_secret': client_secret})
    return ''


def tiktok_auth_url(state, verifier):
    return 'https://www.tiktok.com/v2/auth/authorize/?' + urllib.parse.urlencode({
        'client_key': read_json('tiktok-client.json')['client_key'], 'scope': TIKTOK_SCOPES, 'response_type': 'code',
        'redirect_uri': TIKTOK_REDIRECT, 'state': state, 'code_challenge_method': 'S256',
        'code_challenge': hashlib.sha256(verifier.encode()).hexdigest()})  # TikTok desktop wants hex, not base64


def tiktok_connect(code, verifier):
    """Swap the consent code for a refresh token (365 days) and save it. Returns a problem or ''."""
    try:
        key, out = tiktok_token({'code': code, 'grant_type': 'authorization_code', 'redirect_uri': TIKTOK_REDIRECT,
                                 'code_verifier': verifier})
    except (OSError, ValueError, KeyError) as err:
        return 'TikTok unreachable or the TikTok app is not saved (%s). Try again.' % err
    if 'error' in out:
        return 'TikTok refused the sign-in (%s). Press Connect TikTok again.' % out['error']
    missing = [s for s in ('video.upload', 'video.publish') if s not in out.get('scope', '').split(',')]
    if missing:
        return 'TikTok did not grant %s. Add Content Posting API with Direct Post to the app, then connect again.' % \
            ', '.join(missing)
    save_json('tiktok.json', {'client_key': key, 'open_id': out.get('open_id'), 'scope': out['scope'],
                              'refresh_token': out['refresh_token']})
    return ''


def connected(name):
    try:
        if name == 'meta':
            return bool(read_json('meta.json').get('page_token'))
        return read_json('tiktok.json').get('client_key') == read_json('tiktok-client.json')['client_key']
    except (OSError, ValueError, KeyError):
        return False


# ---- YouTube Shorts: the YouTube uploader does the upload ----

def youtube(y, clip, rec, save):
    out = yt.upload(y, y.channel, clip['file'], clip['yt_meta'])
    rec.update(state='posted', id=out['video'], link='https://youtube.com/shorts/' + out['video'])


def session(pf, channel):
    if pf == 'tiktok':
        return TikTok()
    if pf == 'youtube_shorts':
        if not yt.AUDITED:
            raise Fail(2, YT_AUDIT)
        return yt.YouTube(channel)
    return Meta()


POSTERS = {'instagram_reels': instagram, 'facebook_reels': facebook, 'tiktok': tiktok, 'youtube_shorts': youtube}


def account(pf, channel=None):
    """Who this platform posts as, asked from the real API. Posts nothing."""
    if pf == 'instagram_reels':
        m = Meta()
        return 'Instagram @' + m.call('GET', '/' + m.ig, query={'fields': 'username'})['username']
    if pf == 'facebook_reels':
        m = Meta()
        return 'Facebook Page ' + m.call('GET', '/' + m.page, query={'fields': 'name'})['name']
    if pf == 'tiktok':
        return 'TikTok ' + TikTok().call('GET', '/user/info/', query={'fields': 'display_name'})['user']['display_name']
    items = yt.YouTube(channel).call('GET', yt.API + '/channels', query={'part': 'snippet', 'mine': 'true'}).get('items')
    return 'YouTube ' + (items[0]['snippet']['title'] if items else 'no channel')


def accounts(platforms, channel):
    out = {}
    for pf in platforms:
        try:
            out[pf] = {'account': account(pf, channel)}
        except Exception as err:  # reported per platform; the others are still checked
            out[pf] = {'error': str(err)}
    return out


# ---- clips and approvals ----

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def probe(path):
    """(width, height, seconds) as a player shows the clip, from ffprobe."""
    try:
        r = subprocess.run([FFPROBE, '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                            'stream=width,height:stream_side_data=rotation:format=duration', '-of', 'json', str(path)],
                           capture_output=True, timeout=60, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        info = json.loads(r.stdout)
        s = info['streams'][0]
        w, h, secs = int(s['width']), int(s['height']), float(info['format']['duration'])
        rot = sum(int(d.get('rotation', 0)) for d in s.get('side_data_list', []))
    except (OSError, ValueError, KeyError, IndexError, TypeError, subprocess.SubprocessError):
        raise Fail(2, 'ffprobe cannot read %s' % path)
    return (h, w, secs) if abs(rot) % 180 == 90 else (w, h, secs)


def clips_of(payload):
    """Check the approved payload before anything is claimed or posted. Returns (platforms, YouTube channel, clips)."""
    platforms, channel, clips = payload.get('platforms'), payload.get('youtube_channel'), payload.get('clips')
    if not isinstance(platforms, list) or not platforms or any(p not in PLATFORMS for p in platforms):
        raise Fail(2, 'the approval needs "platforms": some of %s' % ', '.join(PLATFORMS))
    if 'youtube_shorts' in platforms and channel not in yt.CHANNELS:
        raise Fail(2, 'the approval needs "youtube_channel" (a youtube_upload.py channel slug) for youtube_shorts')
    if not isinstance(clips, list) or not clips or not all(isinstance(c, dict) for c in clips):
        raise Fail(2, 'the approval needs "clips": [{"file", "caption", "hashtags", "title", "synthetic"}]')
    out = []
    for n, c in enumerate(clips, 1):
        path = Path(str(c.get('file') or ''))
        if path.suffix.lower() != '.mp4' or not path.is_file():
            raise Fail(2, 'clip %d: no .mp4 at %s' % (n, path))
        synthetic = c.get('synthetic', payload.get('synthetic'))
        if not isinstance(synthetic, bool):
            raise Fail(2, 'clip %d: say "synthetic": true or false (realistic AI people, voices or scenes)' % n)
        w, h, secs = probe(path)
        if not (h > w and 3 <= secs <= 90):
            raise Fail(2, 'clip %d must be vertical and 3 to 90 s; it is %dx%d, %.1f s' % (n, w, h, secs))
        text = '\n\n'.join(s for s in (str(c.get('caption') or '').strip(), str(c.get('hashtags') or '').strip()) if s)
        if not text or len(text) > 2200 or text.count('#') > 30:
            raise Fail(2, 'clip %d: caption plus hashtags must be 1-2200 characters with up to 30 hashtags' % n)
        clip = {'n': n, 'file': path, 'sha': sha256(path), 'text': text, 'synthetic': synthetic}
        if 'youtube_shorts' in platforms:
            desc = text if '#shorts' in text.lower() else text + ' #Shorts'
            _, clip['yt_meta'], _ = yt.upload_meta(argparse.Namespace(
                file=str(path), title=str(c.get('yt_short_title') or c.get('title') or ''), description=desc,
                description_file=None, tags=None, playlist=None, thumbnail=None, category=22,
                synthetic='yes' if synthetic else 'no'))
            clip['yt_meta']['status']['privacyStatus'] = 'public'
        out.append(clip)
    return platforms, channel, out


def record_path(sha, platform):
    return DIR / 'posts' / ('%s-%s.json' % (sha[:32], platform))


def post_one(pf, clip, sess, approval_id):
    """One clip on one platform, at most once ever. Returns what the record says."""
    rp = record_path(clip['sha'], pf)
    rec = yt.read_record(rp) or {'platform': pf, 'sha256': clip['sha']}
    already = rec.get('state') in DONE
    if not already:
        rec.update(file=str(clip['file']), approval=approval_id)
        try:
            if isinstance(sess, Exception):
                raise sess
            POSTERS[pf](sess, clip, rec, lambda: yt.write_record(rp, rec))
            rec.pop('error', None)
        except Exception as err:  # recorded and reported; the other platforms still post
            rec['error'] = str(err) if isinstance(err, Fail) else '%s: %s' % (type(err).__name__, err)
        yt.write_record(rp, rec)
    out = {k: rec[k] for k in ('state', 'id', 'link', 'note', 'error') if k in rec}
    return dict(out, already_posted=True) if already else out


def post(approval_id, dry_run=False):
    try:
        bot = yt.dash.which_bot()
        ctx = {'bot': bot, 'token': yt.dash.read_token(bot), 'base': yt.dash.check_base(yt.dash.BASE)}
    except yt.dash.Fail as err:
        raise Fail(2, str(err))
    q = urllib.parse.quote(approval_id, safe='')
    got = yt.dash_call(ctx, 'GET', '/approvals/' + q)
    a = got.get('approval', got)
    if a.get('action') != 'post_clips':
        raise Fail(2, 'approval %s is for %s, not post_clips' % (approval_id, a.get('action')))
    if a.get('status') != 'approved':
        raise Fail(2, 'approval %s is %s; only one Jon approved and not yet used can post (one left running by a run '
                      'that stopped: dash.py approval-release it, then run this again)' % (approval_id, a.get('status')))
    platforms, channel, clips = clips_of(a.get('payload') or {})
    if dry_run:
        return {'approval': approval_id, 'dry_run': True, 'accounts': accounts(platforms, channel),
                'clips': [dict({'n': c['n'], 'file': str(c['file'])}, **{
                    pf: (yt.read_record(record_path(c['sha'], pf)) or {}).get('state') or 'would post'
                    for pf in platforms}) for c in clips]}
    yt.dash_call(ctx, 'POST', '/approvals/%s/claim' % q, {})
    try:
        sessions = {}
        for pf in platforms:
            try:
                sessions[pf] = session(pf, channel)
            except Exception as err:  # this platform fails for every clip; the others still post
                sessions[pf] = err
        results = [dict({'n': c['n'], 'file': str(c['file'])}, **{pf: post_one(pf, c, sessions[pf], approval_id)
                                                                  for pf in platforms}) for c in clips]
    except Exception as err:
        try:
            yt.dash_call(ctx, 'POST', '/approvals/%s/release' % q, {'note': str(err)[:500]})
        except Fail:
            pass  # still "running"; the next session finds it (DASH.md)
        raise
    complete = all('error' not in r[pf] for r in results for pf in platforms)
    note = '; '.join('clip %d: %s' % (r['n'], ', '.join('%s %s' % (pf, r[pf].get('state') or 'failed') for pf in platforms))
                     for r in results)
    out = {'approval': approval_id, 'complete': complete, 'clips': results}
    try:
        yt.dash_call(ctx, 'POST', '/approvals/%s/%s' % (q, 'done' if complete else 'release'), {'note': note[:500]})
    except Fail as err:  # the posts are out; only the dashboard record is behind
        out['warning'] = 'could not mark the approval %s (%s); run dash.py approval-%s' % (
            'done' if complete else 'released', err, 'done' if complete else 'release')
    return out


def parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = ap.add_subparsers(dest='cmd', required=True)
    a = s.add_parser('check')
    a.add_argument('--youtube-channel', choices=sorted(yt.CHANNELS))
    a = s.add_parser('post')
    a.add_argument('approval_id')
    a.add_argument('--dry-run', action='store_true', help='check the approval, clips and accounts; claims and posts nothing')
    return ap


def run(args):
    if args.cmd == 'check':
        pfs = PLATFORMS if args.youtube_channel else PLATFORMS[:3]
        return {'accounts': accounts(pfs, args.youtube_channel),
                'audited': {'youtube': yt.AUDITED, 'tiktok': TIKTOK_AUDITED}}
    if not yt.APPROVAL_ID_RE.fullmatch(args.approval_id):
        raise Fail(2, 'approval ids look like a_0123abcd')
    return post(args.approval_id, args.dry_run)


def main(argv=None):
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        out = run(parser().parse_args(argv))
    except Fail as err:
        print('short_post.py: %s' % err, file=sys.stderr)
        return err.code
    except OSError as err:
        print('short_post.py: %s' % err, file=sys.stderr)
        return 2
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if out.get('complete', True) else 1


if __name__ == '__main__':
    sys.exit(main())
