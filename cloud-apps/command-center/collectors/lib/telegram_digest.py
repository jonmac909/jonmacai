"""Write state/telegram-digest.json from the Built With AI digest pages."""
from __future__ import annotations
import html
import json
import os
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

STATE = Path(os.environ.get('CC_AGENT_STATE', r'C:\Users\partn\my-agent\state'))
DIGEST = STATE / 'telegram-digest.json'
PACIFIC = timezone(timedelta(hours=-7))  # ponytail: PDT; use zoneinfo if winter drift bites
UA = 'CommandCenterCollector/1.0'


def _plain(text: str) -> str:
    t = re.sub(r'<!--.*?-->', '', text or '', flags=re.S)
    t = re.sub(r'(?i)<br\s*/?>', '\n', t)
    t = re.sub(r'(?i)</(?:p|div|h\d|li|section|ul)>', '\n', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    return html.unescape(re.sub(r'\s+', ' ', t)).strip()


def parse_digest(text: str):
    raw = text or ''
    scanned = 0
    m = re.search(r'(\d[\d,]*)\s+messages', _plain(raw), re.I)
    if m:
        scanned = int(m.group(1).replace(',', ''))
    items = []
    if '## Key Takeaways' in raw:
        part = raw.split('## Key Takeaways', 1)[1]
        part = re.split(r'\n## ', part, 1)[0]
        for line in part.splitlines():
            s = line.strip()
            if s.startswith('- '):
                t = re.sub(r'\s+', ' ', s[2:]).strip()
                if t:
                    items.append({'source': 'advanced-chat', 'text': t})
    else:
        hm = re.search(r'<h2[^>]*>\s*Key Takeaways\s*</h2>\s*<ul[^>]*>(.*?)</ul>', raw, re.I | re.S)
        if hm:
            for li in re.findall(r'<li[^>]*>(.*?)</li>', hm.group(1), re.I | re.S):
                spans = re.findall(r'<span[^>]*>(.*?)</span>', li, re.I | re.S)
                t = _plain(spans[-1] if spans else li)
                if t:
                    items.append({'source': 'advanced-chat', 'text': t})
    return items, scanned


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=30, context=ctx) as res:
        return res.read().decode('utf-8', 'replace')


def _dates():
    today = datetime.now(PACIFIC).date()
    return today, today - timedelta(days=1)


def collect_items():
    items, scanned = [], 0
    seen = set()
    for d in _dates():
        url = 'https://www.builtwithai.com/digest/%s' % d.isoformat()
        try:
            body = _fetch(url)
        except Exception:
            continue
        chunk, n = parse_digest(body)
        scanned = max(scanned, n)
        for it in chunk:
            key = it['text']
            if key in seen:
                continue
            seen.add(key)
            it['url'] = url
            it['ts'] = d.isoformat()
            items.append(it)
    return items, scanned


def write_digest(items, scanned=0):
    STATE.mkdir(parents=True, exist_ok=True)
    DIGEST.write_text(json.dumps({'scanned': scanned, 'items': items}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def fallback_filter(items):
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        'ran': now,
        'count': len(items),
        'spoken': 'Park: %s items.' % len(items) if items else 'No digest items to filter.',
        'items': [{'text': it['text'], 'source': it.get('source') or 'advanced-chat', 'action': 'park'} for it in items],
    }
    (STATE / 'morning-filter.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return payload


def run_jev():
    tools = Path(r'C:\Users\partn\my-agent\tools')
    if str(tools) not in sys.path:
        sys.path.insert(0, str(tools))
    import jev_morning
    return jev_morning.run()


def run_digest():
    items, scanned = collect_items()
    write_digest(items, scanned)
    try:
        run_jev()
    except Exception:
        fallback_filter(items)
    return scanned or len(items)


def main() -> int:
    n = run_digest()
    print('digest %s' % n)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
