import email
import imaplib
import os
import re
import smtplib
import sys
import time
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid, parseaddr, parsedate_to_datetime
from pathlib import Path

# ponytail: Vancouver is UTC-7 in Sep; tzdata package if DST around midnight matters
TZ = timezone(timedelta(hours=-7))
SUPPORT = 'support@viralview.io'
MONEY_RE = re.compile(r'\brefund|\bchargeback|\bcancel (my )?(plan|sub)', re.I)
AMT_RE = re.compile(r'\$(\d+(?:\.\d+)?)')
AGENT = Path(os.environ.get('CC_AGENT_HOME', r'C:\Users\partn\my-agent'))


def _text(subject, body):
    return f'{subject or ""} {body or ""}'


def is_money(subject, body):
    return bool(MONEY_RE.search(_text(subject, body)))


def amount_of(text):
    m = AMT_RE.search(text or '')
    return int(float(m.group(1))) if m else 0


def classify(subject, body):
    t = _text(subject, body).lower()
    if 'export' in t:
        return 'Export problems'
    if any(w in t for w in ('refund', 'bill', 'invoice', 'charge', 'paid $')):
        return 'Billing'
    if any(w in t for w in ('how ', 'how do', 'voice', 'change the', 'yearly')):
        return 'How-to questions'
    if any(w in t for w in ('bug', 'error', 'stuck', 'crash')):
        return 'Bugs'
    return 'Other'


def plan_of(ticket):
    if ticket.get('plan'):
        return ticket['plan']
    t = _text(ticket.get('subject'), (ticket.get('body') or '') + ' ' + (ticket.get('to') or '')).lower()
    if 'chat' in t:
        return 'Visitor on live chat'
    if 'trial' in t:
        return 'Free trial'
    if is_money(ticket.get('subject'), ticket.get('body')) or 'paid' in t:
        return 'Paid plan'
    return 'Email'


def snapshot_from(drafts, sent, inbound_today=0, now_ms=None, week_tickets=None):
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    tickets = []
    for d in drafts or []:
        subj = d.get('subject') or ''
        body = d.get('body') or ''
        money = is_money(subj, body)
        tickets.append({
            'id': 'd-%s' % d.get('uid'),
            'uid': str(d.get('uid') or ''),
            'subject': subj,
            'plan': plan_of(d),
            'waitedMs': max(0, now_ms - int(d.get('date_ms') or now_ms)),
            'body': body,
            'category': classify(subj, body),
            'money': money,
            'amount': amount_of(_text(subj, body)) if money else 0,
            'to': d.get('to') or '',
            'inReplyTo': d.get('in_reply_to') or d.get('inReplyTo') or '',
            'references': d.get('references') or '',
        })
    week = week_tickets if week_tickets is not None else list(drafts or [])
    counts = {}
    for w in week:
        cat = w.get('category') or classify(w.get('subject') or '', w.get('body') or '')
        counts[cat] = counts.get(cat, 0) + 1
    topics = [{'label': k, 'n': v} for k, v in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
    return {
        'tickets': tickets,
        'answeredToday': sum(1 for s in (sent or []) if s.get('from_us')),
        'inboundToday': int(inbound_today or 0),
        'refundsThisMonth': 0,
        'weekCount': len(week),
        'topics': topics,
        'ok': True,
    }


def build_reply(ticket, body=None):
    msg = MIMEText(body if body is not None else (ticket.get('body') or ''), 'plain', 'utf-8')
    msg['From'] = 'ViralView Support <%s>' % SUPPORT
    msg['To'] = ticket.get('to') or ''
    subj = ticket.get('subject') or ''
    msg['Subject'] = subj if subj.lower().startswith('re:') else ('Re: ' + subj if subj else 'Re:')
    msg['Date'] = formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain='viralview.io')
    irt = (ticket.get('inReplyTo') or ticket.get('in_reply_to') or '').strip()
    refs = (ticket.get('references') or irt).strip()
    if irt and irt not in refs:
        refs = (refs + ' ' + irt).strip()
    if irt:
        msg['In-Reply-To'] = irt
        msg['References'] = refs
    return msg


def send_draft(smtp_send, box, ticket, body=None):
    try:
        smtp_send(build_reply(ticket, body))
    except TimeoutError as e:
        return False, 'unknown:%s' % type(e).__name__
    except (smtplib.SMTPAuthenticationError, smtplib.SMTPConnectError, smtplib.SMTPHeloError,
            smtplib.SMTPSenderRefused, smtplib.SMTPRecipientsRefused) as e:
        return False, 'not_sent:%s' % type(e).__name__
    except smtplib.SMTPException as e:
        return False, 'unknown:%s' % type(e).__name__
    except (ConnectionError, OSError) as e:
        return False, 'not_sent:%s' % type(e).__name__
    except Exception as e:
        return False, 'unknown:%s' % type(e).__name__
    try:
        uid = str(ticket.get('uid') or '')
        if uid:
            box.uid('STORE', uid, '+FLAGS', r'(\Deleted)')
            if hasattr(box, 'expunge'):
                box.expunge()
    except Exception as e:
        return False, 'unknown:%s' % type(e).__name__
    return True, 'Reply sent'


def _acct():
    sys.path.insert(0, str(AGENT))
    sys.path.insert(0, str(AGENT / 'ai-visualizer'))
    import voice_email
    acct = next((a for a in voice_email._accounts() if SUPPORT in (a.get('address') or '')), None)
    if not acct:
        raise RuntimeError('support account missing')
    pw = voice_email._password(acct)
    if not pw:
        raise RuntimeError('support account locked')
    return acct, pw


def _box(acct, pw):
    box = imaplib.IMAP4_SSL(str(acct.get('imap') or 'imap.gmail.com'), timeout=25)
    box.login(acct['address'], pw)
    return box


def _body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == 'text/plain':
                raw = part.get_payload(decode=True) or b''
                return raw.decode(part.get_content_charset() or 'utf-8', 'replace')
    raw = msg.get_payload(decode=True) or b''
    if isinstance(raw, bytes):
        return raw.decode(msg.get_content_charset() or 'utf-8', 'replace')
    return str(raw or '')


def _date_ms(msg):
    try:
        dt = parsedate_to_datetime(msg.get('Date'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return int(time.time() * 1000)


def _parse(raw, uid):
    msg = email.message_from_bytes(raw)
    _name, to = parseaddr(msg.get('To') or '')
    return {
        'uid': str(uid),
        'subject': msg.get('Subject') or '',
        'body': _body(msg),
        'date_ms': _date_ms(msg),
        'to': to or (msg.get('To') or ''),
        'in_reply_to': (msg.get('In-Reply-To') or '').strip(),
        'references': (msg.get('References') or '').strip(),
        'from': msg.get('From') or '',
    }


def _search_parse(box, folder, query):
    typ, _ = box.select('"%s"' % folder, readonly=True)
    if typ != 'OK':
        return []
    _, data = box.uid('SEARCH', None, query)
    uids = (data[0] or b'').split()
    out = []
    for uid_b in uids[-40:]:
        try:
            _, msg_data = box.uid('FETCH', uid_b, '(RFC822)')
            raw = msg_data[0][1]
        except Exception:
            continue
        if isinstance(raw, bytes):
            out.append(_parse(raw, uid_b.decode()))
    return out


def _search_count(box, folder, query):
    typ, _ = box.select('"%s"' % folder, readonly=True)
    if typ != 'OK':
        return 0
    _, data = box.uid('SEARCH', None, query)
    return len((data[0] or b'').split())


def _imap_day(now_ms, days=0):
    dt = datetime.fromtimestamp(now_ms / 1000, TZ) - timedelta(days=days)
    months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
    return '%02d-%s-%04d' % (dt.day, months[dt.month - 1], dt.year)


def collect_snapshot(now_ms=None):
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    box = None
    empty = {'tickets': [], 'answeredToday': 0, 'inboundToday': 0, 'refundsThisMonth': 0, 'topics': [], 'weekCount': 0, 'ok': False}
    try:
        acct, pw = _acct()
        box = _box(acct, pw)
        drafts = _search_parse(box, '[Gmail]/Drafts', 'ALL')
        sent = _search_parse(box, '[Gmail]/Sent Mail', '(SINCE %s)' % _imap_day(now_ms))
        for s in sent:
            s['from_us'] = True
        inbound_n = _search_count(box, 'INBOX', '(SINCE %s NOT FROM "%s")' % (_imap_day(now_ms), SUPPORT))
        return snapshot_from(drafts, sent, inbound_n, now_ms, sent + drafts)
    except Exception:
        return empty
    finally:
        if box:
            try:
                box.logout()
            except Exception:
                pass


def _smtp_send(acct, pw, msg):
    with smtplib.SMTP(str(acct.get('smtp') or 'smtp.gmail.com'), 587, timeout=25) as s:
        s.starttls()
        s.login(acct['address'], pw)
        s.send_message(msg)


def _fetch_uid(box, uid):
    box.select('"[Gmail]/Drafts"')
    _, data = box.uid('FETCH', str(uid), '(RFC822)')
    raw = data[0][1]
    row = _parse(raw, uid)
    row['inReplyTo'] = row.get('in_reply_to') or ''
    return row


def send_live(payload):
    payload = payload or {}
    acct, pw = _acct()
    box = _box(acct, pw)
    try:
        uid = str(payload.get('uid') or '')
        ticket = _fetch_uid(box, uid) if uid else dict(payload)
        if payload.get('body') is not None:
            ticket['body'] = payload['body']
        if payload.get('to'):
            ticket['to'] = payload['to']
        if payload.get('subject'):
            ticket['subject'] = payload['subject']
        return send_draft(lambda m: _smtp_send(acct, pw, m), box, ticket, payload.get('body'))
    finally:
        try:
            box.logout()
        except Exception:
            pass


def save_live(payload):
    payload = payload or {}
    uid = str(payload.get('uid') or '')
    if not uid:
        return False, 'missing draft'
    acct, pw = _acct()
    box = _box(acct, pw)
    try:
        ticket = _fetch_uid(box, uid)
        ticket['body'] = payload.get('body') if payload.get('body') is not None else ticket.get('body')
        if payload.get('subject'):
            ticket['subject'] = payload['subject']
        if payload.get('to'):
            ticket['to'] = payload['to']
        raw = build_reply(ticket).as_bytes()
        box.append('"[Gmail]/Drafts"', r'(\Draft \Seen)', imaplib.Time2Internaldate(time.time()), raw)
        box.uid('STORE', uid, '+FLAGS', r'(\Deleted)')
        box.expunge()
        return True, 'Draft saved'
    finally:
        try:
            box.logout()
        except Exception:
            pass


def discard_live(payload):
    payload = payload or {}
    uid = str(payload.get('uid') or '')
    if not uid:
        return False, 'missing draft'
    acct, pw = _acct()
    box = _box(acct, pw)
    try:
        typ, _ = box.select('"[Gmail]/Drafts"')
        if typ != 'OK':
            return False, 'Drafts folder not available'
        box.uid('STORE', uid, '+FLAGS', r'(\Deleted)')
        box.expunge()
        return True, 'Draft discarded'
    finally:
        try:
            box.logout()
        except Exception:
            pass


def handle(kind, payload):
    payload = payload or {}
    try:
        if kind == 'support.save_draft':
            return save_live(payload)
        if kind == 'support.discard_draft':
            return discard_live(payload)
        if kind == 'support.send_all_safe':
            n = 0
            for uid in payload.get('ids') or []:
                ok, _ = send_live({'uid': str(uid)})
                n += bool(ok)
            extra = ' · refund left for you' if payload.get('refundLeft') else ''
            return True, '%s safe replies sent%s' % (n, extra)
        if kind == 'support.decide_refund':
            ok, _ = send_live(payload)
            if payload.get('decision') == 'decline':
                return ok, payload.get('msg') or 'Polite decline sent'
            return ok, payload.get('msg') or 'Reply sent · refund still in Commas'
        if kind == 'support.send':
            return send_live(payload)
    except Exception as e:
        return False, 'not_sent:%s' % type(e).__name__
    return False, 'unknown action %s' % kind
