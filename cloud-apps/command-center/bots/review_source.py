"""Puts the original source video beside our edit on review pages.

  review_source.py backfill [--dry-run]   every review video with no source: add it, or list it as not stored
  review_source.py clear <slug>           takes a wrong original off a page. Put the right file in place first and
                                          clear every version holding the wrong one. Deletes the copy: Jon's click
                                          unless you uploaded it.

aieditor's review_upload.py calls add_or_report() after each publish. Adding never replaces: the Worker refuses to.
Token from ~/.jonmac-review.env, never printed. Failures and videos with no stored original go to Ana through
script_failure.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hook  # noqa: E402

BASE = 'https://jonmac.ai/api/review'
HGP_PACKS = Path(r'D:\HGP-work\packs')
VV = Path(r'D:\AgentTeam\viral-view')
REMAKES = Path(r'D:\AgentTeam\footage\short-form\remakes')
CACHE = Path(r'D:\AgentTeam\tmp\review-sources')
PART = 50 * 1024 * 1024
HIDDEN_LOW = 0x08000000 | 0x00004000  # no window, below normal priority
UA = 'review-source/1.0'
quote = lambda s: urllib.parse.quote(s, safe='')  # noqa: E731


def stem(slug):
    return re.sub(r'-v\d+$', '', slug)


def version(slug):
    found = re.search(r'-v(\d+)$', slug)
    return int(found.group(1)) if found else 0


def references(video):
    return [Path(p) for p in glob.glob(str(VV / video / 'reference' / 'source_*.mp4'))]


def original(video):
    """The stored original of a video such as gail-1 or theo-1, or None. A wrong original is worse than none, and
    the Worker won't replace one: a host's bare pack folder only answers for that host's first video, and a
    reference folder holding several sources doesn't say which one was used."""
    hosts = [video] + ([video[:-2]] if video.endswith('-1') else [])
    stored = [HGP_PACKS / h / 'source' / 'source.mp4' for h in hosts]
    stored += [REMAKES / video.removesuffix('-selfie') / 'src' / 'source.mp4']
    found = references(video)
    stored += found if len(found) == 1 else []
    return next((p for p in stored if p.exists()), None)


def run(args, timeout):
    done = subprocess.run(args, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout, creationflags=HIDDEN_LOW)
    if done.returncode:
        raise RuntimeError('%s failed: %s' % (Path(args[0]).name, done.stderr[-300:].strip()))
    return done


def web_copy(src, video):
    """H.264/AAC fast-start copy that iPhones play, kept per video and original. The stored original stays as it is."""
    out = CACHE / ('%s-%s-%d.mp4' % (video, src.stem, src.stat().st_size))
    if out.exists():
        return out
    CACHE.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.tmp.mp4')
    probe = run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt', '-of', 'json', str(src)], 120)
    streams = {}
    for stream in json.loads(probe.stdout)['streams']:
        streams.setdefault(stream['codec_type'], stream)  # first of each kind, as -map takes
    picture, sound = streams['video'], streams.get('audio')
    plays = picture['codec_name'] == 'h264' and picture.get('pix_fmt') == 'yuv420p' and (not sound or sound['codec_name'] == 'aac')
    codec = ['-c', 'copy'] if plays else ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                                          '-pix_fmt', 'yuv420p', '-threads', '4', '-c:a', 'aac', '-b:a', '128k']
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-map', '0:v:0', '-map', '0:a:0?', *codec, '-movflags', '+faststart', str(tmp)], 3600)
    os.replace(tmp, out)
    return out


def token():
    text = (Path.home() / '.jonmac-review.env').read_text(encoding='utf-8')
    return re.search(r'^\s*REVIEW_API_TOKEN\s*=\s*["\']?([^"\'\r\n]+)', text, re.M).group(1)


def api(method, path, body=None, raw=None):
    data = raw if raw is not None else None if body is None else json.dumps(body).encode()
    headers = {'Authorization': 'Bearer ' + token(), 'User-Agent': UA,
               'Content-Type': 'application/octet-stream' if raw is not None else 'application/json'}
    with urllib.request.urlopen(urllib.request.Request(BASE + path, method=method, data=data, headers=headers), timeout=600) as r:
        return json.loads(r.read().decode() or 'null')


def carried(slug):
    """A new version whose original isn't kept here uses the newest earlier version's source, or None."""
    earlier = [v for v in api('GET', '/videos')['videos']
               if stem(v['slug']) == stem(slug) and version(v['slug']) < version(slug) and v.get('source_url')]
    if not earlier:
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / ('carried-%s.mp4' % slug)
    request = urllib.request.Request(max(earlier, key=lambda v: version(v['slug']))['source_url'],
                                     headers={'Authorization': 'Bearer ' + token(), 'User-Agent': UA})
    with urllib.request.urlopen(request, timeout=600) as r, open(out, 'wb') as f:
        shutil.copyfileobj(r, f, 1024 * 1024)
        if f.tell() != int(r.headers['Content-Length']):
            raise RuntimeError('download of the earlier source was cut off')
    return out


def put_part(path, chunk):
    for attempt in range(3):
        try:
            return api('PUT', path, raw=chunk)
        except OSError as err:  # HTTPError is one: only a server fault or a dropped connection is worth another try
            if attempt == 2 or 400 <= getattr(err, 'code', 500) < 500:
                raise
            time.sleep(5 * (attempt + 1))


def upload(slug, path):
    started = api('POST', '/%s/uploads' % slug, {'kind': 'source'})
    key, base = started['key'], '/%s/uploads/%s' % (slug, quote(started['uploadId']))
    parts = []
    try:
        with open(path, 'rb') as f:
            for n, chunk in enumerate(iter(lambda: f.read(PART), b''), 1):
                parts.append(put_part('%s/%d?key=%s' % (base, n, quote(key)), chunk))
        api('POST', base + '/complete', {'key': key, 'parts': parts})
    except Exception:
        try:
            api('DELETE', '%s?key=%s' % (base, quote(key)))
        except OSError:
            pass
        raise
    return key


def add(slug):
    """Adds the stored original to slug's page. Returns 'added', 'has source' or 'not stored'."""
    if api('GET', '/' + slug)['video'].get('source_url'):
        return 'has source'
    video = stem(slug)
    src = original(video)
    if not src and not references(video):  # several references mean the topic changed: an older version's may be wrong
        src = carried(slug)
    if not src:
        return 'not stored'
    api('POST', '/%s/source' % slug, {'source_key': upload(slug, web_copy(src, video))})
    return 'added'


def report(what, err):
    """Never raises: a publisher calls this after its publish, and that publish stands."""
    try:
        hook.fire('script_failure', {'script': 'review_source', 'error': ('%s: %s' % (what, err))[:800]})
    except Exception as failure:
        print('could not report:', failure, file=sys.stderr, flush=True)


def add_or_report(slug):
    """For publishers: the publish stands whatever happens here. A page left with no source is reported."""
    try:
        result = add(slug)
    except Exception as err:
        report(slug, err)
        return 'failed'
    if result == 'not stored':
        report(slug, 'no stored original, the owner must supply it')
    return result


def backfill(dry):
    rows = [v['slug'] for v in api('GET', '/videos')['videos'] if not v.get('source_url')]
    failed, missing = [], []
    for slug in rows:
        if dry:
            print(slug, original(stem(slug)) or 'not stored', flush=True)
            continue
        try:
            result = add(slug)
            print(slug, result, flush=True)
            if result == 'not stored':
                missing.append(slug)
        except Exception as err:
            print(slug, 'failed', err, flush=True)
            failed.append('%s (%s)' % (slug, err))
    if failed or missing:
        report('backfill', 'no stored original: %s. failed: %s' % (', '.join(missing) or 'none', '; '.join(failed) or 'none'))
    return 1 if failed else 0


def main(args):
    clear = len(args) == 2 and args[0] == 'clear'
    if not clear and args not in (['backfill'], ['backfill', '--dry-run']):
        sys.exit(__doc__)
    try:
        if clear:
            api('DELETE', '/%s/source' % args[1])
            return 0
        return backfill(len(args) == 2)
    except Exception as err:
        report(args[0], err)
        raise


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
