"""Group scan is not the webpage digest. Fail closed until a dedicated bot is configured."""
from __future__ import annotations
import html
import json
import os
import re
from pathlib import Path

STATE = Path(os.environ.get('CC_AGENT_STATE', r'C:\Users\partn\my-agent\state'))
DIGEST = STATE / 'telegram-digest.json'


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



class SourceUnavailable(Exception):
    pass


CONNECTOR = (
    'Jonmac_JarvisBot is a DM bridge (privacy mode on, one allowed chat, no group id). '
    'Add a different bot to Built With AI - Advanced, disable that bot\'s privacy mode, and set '
    'TELEGRAM_GROUP_BOT_TOKEN and TELEGRAM_GROUP_CHAT_ID on the worker. Do not reuse the DM bridge token '
    'or call getUpdates on it. Bot API has no getChatHistory; messages from before the bot joins are unavailable, '
    'and unconfirmed updates last about 24 hours.'
)


def scan_unavailable():
    STATE.mkdir(parents=True, exist_ok=True)
    DIGEST.write_text(json.dumps({
        'access': 'unavailable',
        'scanned': 0,
        'items': [],
        'connector': CONNECTOR,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return CONNECTOR


def run_digest():
    raise SourceUnavailable(scan_unavailable())


def main() -> int:
    print(scan_unavailable())
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
