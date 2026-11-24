"""Publish one guide folder to the guide site, then check it live.

Usage: python -I publish_guide.py <folder> [--base URL] [--token-file F] [--state listed|unlisted]

<folder> holds guide.json (slug = the folder name unless guide.json sets it), resource/ and img/.
Uploads everything with PUT /guides/api/<slug> (Bearer token), then checks:
  page /guides/<slug> answers 200 and contains the title,
  every resource file downloads (token path: nothing stored or counted) with the exact bytes,
  every section image answers 200,
  unlisted = noindex and absent from /guides; listed = indexed and on /guides.
Exits 0 only when every check passes; prints one line per check.
"""
import argparse
import base64
import html
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = 'jonmac-guide-publisher/1'
DEFAULT_BASE = 'https://jonmac-cc-preview-guides.jon-c95.workers.dev'
DEFAULT_TOKEN = r'D:\AgentTeam\secrets\guides-publish-preview.token'


def call(url, method='GET', data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers={'User-Agent': UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def main(argv=None):
    ap = argparse.ArgumentParser(description='Publish a guide folder and verify it live.')
    ap.add_argument('folder')
    ap.add_argument('--base', default=DEFAULT_BASE)
    ap.add_argument('--token-file', default=DEFAULT_TOKEN)
    ap.add_argument('--state', choices=['listed', 'unlisted'])
    a = ap.parse_args(argv)
    folder = pathlib.Path(a.folder)
    base = a.base.rstrip('/')
    guide = json.loads((folder / 'guide.json').read_text(encoding='utf-8'))
    slug = guide.get('slug') or folder.name
    guide['slug'] = slug
    if a.state:
        guide['state'] = a.state
    state = guide.get('state') or 'unlisted'
    token = pathlib.Path(a.token_file).read_text(encoding='utf-8').strip()
    auth = {'Authorization': f'Bearer {token}'}

    files = {}
    for sub in ('resource', 'img'):
        d = folder / sub
        if d.is_dir():
            for p in sorted(d.iterdir()):
                if p.is_file():
                    files[f'{sub}/{p.name}'] = base64.b64encode(p.read_bytes()).decode()
    fails = []

    def check(ok, what):
        print(('PASS ' if ok else 'FAIL ') + what)
        if not ok:
            fails.append(what)

    s, _, body = call(f'{base}/guides/api/{slug}', 'PUT', json.dumps({'guide': guide, 'files': files}).encode(),
                      {**auth, 'Content-Type': 'application/json'})
    check(s == 200, f'publish {slug} ({state}, {len(files)} files): {s} {body[:200].decode("utf-8", "replace") if s != 200 else ""}'.rstrip())
    if s != 200:
        return 1

    s, h, page = call(f'{base}/guides/{slug}?qc=1')
    text = page.decode('utf-8', 'replace')
    check(s == 200, f'page /guides/{slug} answers 200 ({s})')
    check(html.escape(guide['title'], quote=True) in text or guide['title'] in text, 'page shows the title')
    noindex = 'name="robots" content="noindex"' in text or (h.get('X-Robots-Tag') or '').lower() == 'noindex'
    check(noindex == (state != 'listed'), f'robots: {"noindex" if noindex else "indexed"} matches {state}')

    for i, f in enumerate((guide.get('resource') or {}).get('files') or []):
        want = (folder / f).read_bytes()
        s, _, got = call(f'{base}/guides/{slug}/download', 'POST', urllib.parse.urlencode({'file': str(i)}).encode(),
                         {**auth, 'Content-Type': 'application/x-www-form-urlencoded'})
        check(s == 200 and got == want, f'download {f}: {s}, {len(got)} of {len(want)} bytes match={got == want}')
    for sec in guide.get('sections') or []:
        if sec.get('image'):
            s, _, _ = call(f'{base}/guides/{slug}/{sec["image"]}')
            check(s == 200, f'image {sec["image"]}: {s}')

    s, _, idx = call(f'{base}/guides')
    on_index = f'/guides/{slug}"' in idx.decode('utf-8', 'replace')
    check(s == 200 and on_index == (state == 'listed'), f'/guides index lists it: {on_index} (state {state})')
    print(f'{"OK" if not fails else "FAILED"} {base}/guides/{slug}')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
