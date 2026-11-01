"""Puts the original source video beside our edit on review pages.

  review_source.py backfill [--dry-run]   every review video with no source: add it, or list it as not stored

aieditor's review_upload.py calls add_or_report() after each publish. This only adds: the Worker refuses to
replace a source. Token from ~/.jonmac-review.env, never printed. Failures go to Ana through script_failure.
"""
import glob
import json
import os
import re
import subprocess
import sys
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
quote = lambda s: urllib.parse.quote(s, safe='')  # noqa: E731


def stem(slug):
    return re.sub(r'-v\d+$', '', slug)


def original(video):
    """The stored original of a video such as gail-1 or theo-1, or None. A wrong original is worse than none,
    so a host's bare pack folder only answers for that host's first video."""
    hosts = [video] + ([video[:-2]] if video.endswith('-1') else [])
    stored = [HGP_PACKS / h / 'source' / 'source.mp4' for h in hosts]
    stored += [REMAKES / video.removesuffix('-selfie') / 'src' / 'source.mp4']
    stored += [Path(p) for p in sorted(glob.glob(str(VV / video / 'reference' / 'source_*.mp4')))]
    return next((p for p in stored if p.exists()), None)


def web_copy(src, video):
    """H.264/AAC fast-start copy that iPhones play, kept per video. The stored original stays as it is."""
    out = CACHE / (video + '.mp4')
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        return out
    CACHE.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.tmp.mp4')
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt', '-of', 'json', str(src)],
                           capture_output=True, encoding='utf-8', check=True, creationflags=HIDDEN_LOW)
    streams = {s['codec_type']: s for s in json.loads(probe.stdout)['streams']}
    picture, sound = streams['video'], streams.get('audio')
    plays = picture['codec_name'] == 'h264' and picture.get('pix_fmt') == 'yuv420p' and (not sound or sound['codec_name'] == 'aac')
    codec = ['-c', 'copy'] if plays else ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '4',
                                          '-c:a', 'aac', '-b:a', '128k']
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-map', '0:v:0', '-map', '0:a:0?', *codec, '-movflags', '+faststart', str(tmp)],
                   capture_output=True, check=True, creationflags=HIDDEN_LOW)
    os.replace(tmp, out)
    return out


def token():
    text = (Path.home() / '.jonmac-review.env').read_text(encoding='utf-8')
    return re.search(r'^\s*REVIEW_API_TOKEN\s*=\s*["\']?([^"\'\r\n]+)', text, re.M).group(1)


def api(method, path, body=None, raw=None):
    data = raw if raw is not None else None if body is None else json.dumps(body).encode()
    headers = {'Authorization': 'Bearer ' + token(), 'User-Agent': 'review-source/1.0',
               'Content-Type': 'application/octet-stream' if raw is not None else 'application/json'}
    with urllib.request.urlopen(urllib.request.Request(BASE + path, method=method, data=data, headers=headers), timeout=600) as r:
        return json.loads(r.read().decode() or 'null')


def upload(slug, path):
    started = api('POST', '/%s/uploads' % slug, {'kind': 'source'})
    key, base = started['key'], '/%s/uploads/%s' % (slug, quote(started['uploadId']))
    parts = []
    try:
        with open(path, 'rb') as f:
            for n, chunk in enumerate(iter(lambda: f.read(PART), b''), 1):
                for attempt in range(3):
                    try:
                        parts.append(api('PUT', '%s/%d?key=%s' % (base, n, quote(key)), raw=chunk))
                        break
                    except OSError:
                        if attempt == 2:
                            raise
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
    if not src:
        return 'not stored'
    api('POST', '/%s/source' % slug, {'source_key': upload(slug, web_copy(src, video))})
    return 'added'


def report(what, err):
    hook.fire('script_failure', {'script': 'review_source', 'error': ('%s: %s' % (what, err))[:200]})


def add_or_report(slug):
    """For publishers: the publish stands even if this fails, and QC fails a page with no source."""
    try:
        return add(slug)
    except Exception as err:
        report(slug, err)
        return 'failed'


def backfill(dry):
    rows = [v['slug'] for v in api('GET', '/videos')['videos'] if not v.get('source_url')]
    failed = []
    for slug in rows:
        if dry:
            print(slug, original(stem(slug)) or 'not stored', flush=True)
            continue
        try:
            print(slug, add(slug), flush=True)
        except Exception as err:
            print(slug, 'failed', err, flush=True)
            failed.append('%s (%s)' % (slug, err))
    if failed:
        report('backfill', '; '.join(failed))
    return 1 if failed else 0


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] != ['backfill']:
        sys.exit(__doc__)
    try:
        sys.exit(backfill('--dry-run' in args))
    except Exception as err:
        report('backfill', err)
        raise
