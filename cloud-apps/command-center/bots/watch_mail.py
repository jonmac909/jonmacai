#!/usr/bin/env python3
"""watch_mail.py - wake bots on new mail in partners@ and jon@ (stdlib only, no Claude tokens).

Every CHECK_SECS it asks Gmail's history log what reached each inbox since the last check (Ana's call,
2026-10-29: a timed check by a script, no bot, no Pub/Sub). Only a match wakes anyone, one event per
account per check:
  partners@  any new inbox mail not sent by partners@     -> sponsor_email (Sponsors + Ana)
  jon@       mail from gdbookkeeping.com or maxeisner.ca  -> accounting_email (Accounting)
The first check only records where the log is, so old mail never wakes anyone. A matched batch is saved
before it is sent and resent as the same batch (same key) until every routine takes it, so nobody is
woken twice for one message. Each account is checked on its own; errors back off up to BACKOFF_MAX and
FAIL_AFTER failures in a row send one script_failure. Runs hidden (pythonw) until stopped. See HOOKS.md.
"""
import json
import os
import sys
import time
from email.utils import parseaddr
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import google_api  # noqa: E402
import hook  # noqa: E402

CHECK_SECS, BACKOFF_MAX, FAIL_AFTER = 120, 1800, 3
STATE = Path(os.environ.get('WATCH_MAIL_STATE', r'D:\AgentTeam\logs\watch_mail.state.json'))
LOG = Path(os.environ.get('WATCH_MAIL_LOG', r'D:\AgentTeam\logs\watch_mail.log'))
ACCOUNTANTS = {'gdbookkeeping.com', 'maxeisner.ca'}


def sender(m):
    return parseaddr(m['from'] or '')[1].lower()


RULES = {  # account -> (event, does this message match?)
    'partners': ('sponsor_email', lambda m: sender(m) != 'partners@thejonmac.com'),
    'jon': ('accounting_email', lambda m: sender(m).rpartition('@')[2] in ACCOUNTANTS),
}


def log(text):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write('%s %s\n' % (time.strftime('%Y-%m-%dT%H:%M:%S'), text))


def load_state():
    try:
        return json.loads(STATE.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {}
    except ValueError:
        log('state file unreadable; starting from the current position')
        return {}


def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(state), encoding='utf-8')
    os.replace(tmp, STATE)


def new_inbox_ids(g, since):
    """Message ids added to INBOX after history id `since`, and the newest history id."""
    ids, page, newest = [], None, since
    while True:
        q = {'startHistoryId': since, 'historyTypes': 'messageAdded', 'labelId': 'INBOX', 'maxResults': 500}
        if page:
            q['pageToken'] = page
        r = g.call('GET', google_api.GMAIL + '/history', query=q)
        for h in r.get('history') or []:
            ids += [a['message']['id'] for a in h.get('messagesAdded') or []]
        newest = r.get('historyId', newest)
        page = r.get('nextPageToken')
        if not page:
            return list(dict.fromkeys(ids)), newest


def headers(g, msg_id):
    """From/Subject/Date of one message, or None if it was deleted since it arrived."""
    try:
        m = g.call('GET', google_api.GMAIL + '/messages/' + msg_id,
                   query={'format': 'metadata', 'metadataHeaders': ['From', 'Subject', 'Date']})
    except google_api.Fail as err:
        if 'Google 404' in str(err):
            return None
        raise
    h = {x['name'].lower(): x['value'] for x in m.get('payload', {}).get('headers', [])}
    return {'id': msg_id, 'from': h.get('from'), 'subject': h.get('subject'), 'date': h.get('date')}


def deliver(acc, account):
    """Send the saved batch (same key every try). Raises if a routine didn't take it."""
    b = acc['pending']
    res = hook.fire(b['event'], {'account': account, 'count': len(b['messages']), 'messages': b['messages']}, key=b['key'])
    if any(s not in (200, 202) for s in res.values()):
        raise RuntimeError('%s not delivered: %s' % (b['event'], res))
    log('%s: %s for %d message(s)' % (account, b['event'], len(b['messages'])))
    acc.pop('pending')


def check(account, g, state, save=lambda: None):
    """One check of one account. state[account] = {'history': id, 'pending': batch or absent}."""
    acc = state.get(account)
    if acc is None:
        state[account] = {'history': g.call('GET', google_api.GMAIL + '/profile')['historyId']}
        log('%s: starting from history %s' % (account, state[account]['history']))
        return
    if acc.get('pending'):
        deliver(acc, account)
        save()
    try:
        ids, newest = new_inbox_ids(g, acc['history'])
    except google_api.Fail as err:
        if 'Google 404' not in str(err):
            raise
        acc['history'] = g.call('GET', google_api.GMAIL + '/profile')['historyId']  # log expired: start again
        log('%s: history too old, restarted from %s' % (account, acc['history']))
        return
    event, match = RULES[account]
    hits = [m for m in (headers(g, i) for i in ids) if m and match(m)]
    acc['history'] = newest
    if hits:
        acc['pending'] = {'event': event, 'messages': hits,
                          'key': '%s:%s' % (account, ','.join(sorted(m['id'] for m in hits)))}
    save()
    if hits:
        deliver(acc, account)
        save()


def main():
    state = load_state()
    fails = {a: 0 for a in RULES}
    log('watching %s every %ds' % (', '.join(RULES), CHECK_SECS))
    while True:
        for account in RULES:
            try:
                try:
                    g = google_api.Google(account)
                except google_api.Fail as err:
                    if err.code == 2:  # not connected yet: nothing to watch
                        continue
                    raise
                check(account, g, state, lambda: save_state(state))
                fails[account] = 0
            except Exception as err:  # keep watching the other account; report a streak once
                fails[account] += 1
                log('%s: check failed (%d in a row): %s' % (account, fails[account], str(err)[:300]))
                if fails[account] == FAIL_AFTER:
                    try:
                        hook.fire('script_failure', {'script': 'watch_mail', 'account': account,
                                                     'error': str(err)[:500], 'failures': fails[account]},
                                  key='watch_mail-%s-%d' % (account, int(time.time())))
                    except Exception as e:
                        log('script_failure not sent: %s' % e)
        save_state(state)
        time.sleep(min(BACKOFF_MAX, CHECK_SECS * 2 ** max(fails.values())))


if __name__ == '__main__':
    main()
