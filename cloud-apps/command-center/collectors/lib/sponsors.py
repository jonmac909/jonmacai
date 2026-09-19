import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BOARD = 'http://127.0.0.1:4175'
COLLECTIONS = Path.home() / 'Projects/2026/YouTube/sponsor-kanban/data/collections.json'


def mark_paid(data, sponsor):
    out = json.loads(json.dumps(data))
    found = False
    for item in out.get('items') or []:
        if item.get('sponsor') != sponsor:
            continue
        found = True
        owed = Number(item.get('owed'))
        item['paid'] = Number(item.get('total')) or Number(item.get('paid'))
        item['owed'] = 0
        month = out.get('currentIncomeMonth')
        if month:
            totals = out.setdefault('incomeTotals', {})
            totals[month] = Number(totals.get(month)) + owed
    if not found:
        raise KeyError(sponsor)
    return out


def Number(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0


def _q(card_id):
    return urllib.parse.quote(card_id or '', safe='')

def _req(method, path, body=None, timeout=60):
    data = None if body is None else json.dumps(body).encode('utf-8')
    req = urllib.request.Request(BOARD + path, data=data, method=method)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read().decode('utf-8') or '{}'
        return json.loads(raw)


def slim_card(card):
    dr = card.get('draftReply') if isinstance(card.get('draftReply'), dict) else {}
    out = {k: card.get(k) for k in (
        'id', 'sponsor', 'contact', 'stage', 'amount', 'status',
        'latestDate', 'to', 'threadId', 'subject', 'reason', 'needsDraft',
    )}
    if dr.get('status') in ('needs-review', 'edited', 'approved') and str(dr.get('body') or '').strip():
        out['draftReply'] = {
            'status': dr.get('status'),
            'subject': dr.get('subject') or '',
            'body': dr.get('body') or '',
        }
    return out


def collect_snapshot():
    board = _req('GET', '/api/board')
    collections = _req('GET', '/api/collections')
    cards = [slim_card(c) for c in board.get('cards') or [] if c.get('stage') != 'archived']
    return {
        'ok': True,
        'updatedAt': board.get('updatedAt'),
        'collections': collections,
        'cards': cards,
    }


def _first(value):
    name = str(value or '').replace('"', '').split('<')[0].strip().split()[0]
    return name or 'there'


def _card(card_id):
    board = _req('GET', '/api/board')
    for card in board.get('cards') or []:
        if card.get('id') == card_id:
            return card
    return None


def handle(kind, payload):
    payload = payload or {}
    card_id = payload.get('id') or ''
    try:
        if kind == 'sponsor.mark_paid':
            data = json.loads(COLLECTIONS.read_text(encoding='utf-8'))
            out = mark_paid(data, payload.get('sponsor'))
            COLLECTIONS.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
            return True, 'Marked %s paid' % payload.get('sponsor')
        if kind == 'sponsor.move_stage':
            _req('PATCH', '/api/cards/%s/stage' % _q(card_id), {'stage': payload.get('stage')})
            return True, payload.get('msg') or 'Moved card'
        if kind == 'sponsor.send_draft':
            _req('POST', '/api/card-drafts/%s/send' % _q(card_id), {
                'subject': payload.get('subject') or '',
                'body': payload.get('body') or '',
            })
            return True, payload.get('msg') or 'Reply sent'
        if kind == 'sponsor.save_draft':
            _req('PATCH', '/api/card-drafts/%s' % _q(card_id), {
                'status': payload.get('status') or 'edited',
                'subject': payload.get('subject') or '',
                'body': payload.get('body') or '',
            })
            return True, 'Draft saved'
        if kind == 'sponsor.nudge':
            card = _card(card_id) or {}
            first = _first(card.get('contact') or payload.get('sponsor'))
            subject = 'Re: %s' % (card.get('subject') or payload.get('sponsor') or 'following up')
            body = 'Hi %s,\n\nJust checking in on this. Happy to jump on whatever you need next.\n\nBest,\nJon Mac' % first
            _req('PATCH', '/api/card-drafts/%s' % _q(card_id or 'missing'), {
                'status': 'needs-review',
                'subject': subject,
                'body': body,
            })
            return True, 'Nudge drafted for approval · nothing sent'
        if kind == 'sponsor.send_invoice':
            card = _card(card_id) or {}
            first = _first(card.get('contact') or payload.get('sponsor'))
            body = 'Hi %s,\n\nThe video is live. Please find the invoice for the remaining balance.\n\nBest,\nJon Mac' % first
            _req('PATCH', '/api/card-drafts/%s' % _q(card_id), {
                'status': 'needs-review',
                'subject': 'Invoice — %s' % (payload.get('sponsor') or card.get('sponsor') or ''),
                'body': body,
            })
            return True, 'Invoice email drafted for approval · nothing sent'
        if kind == 'sponsor.scan_inbox':
            _req('POST', '/api/refresh', {}, timeout=600)
            snap = collect_snapshot()
            cards = snap.get('cards') or []
            drafts = sum(1 for c in cards if c.get('draftReply'))
            return True, json.dumps({'scanned': len(cards), 'drafts': drafts, 'error': None})
        if kind == 'sponsor.discard_draft':
            _req('PATCH', '/api/card-drafts/%s' % _q(card_id or payload.get('id') or 'missing'), {
                'status': 'discarded',
            })
            return True, 'Draft discarded'
        return False, 'unknown action %s' % kind
    except urllib.error.HTTPError as e:
        return False, 'http %s' % e.code
    except Exception as e:
        return False, str(e) or type(e).__name__
