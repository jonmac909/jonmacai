#!/usr/bin/env python3
"""watch_mail.py - wake bots on new mail in partners@ and jon@ (stdlib only, no Claude tokens).

Every CHECK_SECS it asks Gmail's history log what reached each inbox since the last check (Ana's call,
2026-10-29: a timed check by a script, no bot, no Pub/Sub). Only a match wakes anyone, one event per
account per check:
  partners@  any new inbox mail                 -> sponsor_email (Sponsors + Ana)
  jon@       mail from Jennifer or Max          -> accounting_email (Accounting)
The first check only records where the log is, so old mail never wakes anyone. An undelivered event is
retried next check (same key, so it arrives once). Errors back off up to BACKOFF_MAX; FAIL_AFTER failures
in a row send one script_failure. Runs hidden (pythonw) until stopped. See HOOKS.md.
"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import google_api  # noqa: E402
import hook  # noqa: E402

CHECK_SECS, BACKOFF_MAX, FAIL_AFTER = 120, 1800, 3
STATE = Path(os.environ.get('WATCH_MAIL_STATE', r'D:\AgentTeam\logs\watch_mail.state.json'))
LOG = Path(os.environ.get('WATCH_MAIL_LOG', r'D:\AgentTeam\logs\watch_mail.log'))
ACCOUNTANTS = ('gdbookkeeping.com', 'maxeisner.ca')
RULES = {  # account -> (event, does this message match?)
    'partners': ('sponsor_email', lambda m: 'partners@thejonmac.com' not in (m['from'] or '').lower()),
    'jon': ('accounting_email', lambda m: any('@' + d in (m['from'] or '').lower() for d in ACCOUNTANTS)),
}


def log(text):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write('%s %s\n' % (time.strftime('%Y-%m-%dT%H:%M:%S'), text))


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
    m = g.call('GET', google_api.GMAIL + '/messages/' + msg_id,
               query={'format': 'metadata', 'metadataHeaders': ['From', 'Subject', 'Date']})
    h = {x['name'].lower(): x['value'] for x in m.get('payload', {}).get('headers', [])}
    return {'id': msg_id, 'from': h.get('from'), 'subject': h.get('subject'), 'date': h.get('date')}


def check(account, g, state):
    """One check of one account. Updates state[account] only once its matches are delivered."""
    if account not in state:
        state[account] = g.call('GET', google_api.GMAIL + '/profile')['historyId']
        log('%s: starting from history %s' % (account, state[account]))
        return
    try:
        ids, newest = new_inbox_ids(g, state[account])
    except google_api.Fail as err:
        if 'Google 404' not in str(err):
            raise
        state[account] = g.call('GET', google_api.GMAIL + '/profile')['historyId']  # log expired: start again
        log('%s: history too old, restarted from %s' % (account, state[account]))
        return
    event, match = RULES[account]
    hits = [m for m in (headers(g, i) for i in ids) if match(m)]
    if hits:
        res = hook.fire(event, {'account': account, 'count': len(hits), 'messages': hits},
                        key='%s:%s' % (account, ','.join(sorted(m['id'] for m in hits))))
        if any(s not in (200, 202) for s in res.values()):
            raise RuntimeError('%s not delivered: %s' % (event, res))
        log('%s: %s for %d message(s)' % (account, event, len(hits)))
    state[account] = newest


def main():
    state = json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else {}
    fails, wait = 0, CHECK_SECS
    log('watching %s every %ds' % (', '.join(RULES), CHECK_SECS))
    while True:
        try:
            for account in RULES:
                try:
                    g = google_api.Google(account)
                except google_api.Fail as err:
                    if err.code == 2:  # not connected yet: nothing to watch
                        continue
                    raise
                check(account, g, state)
            STATE.write_text(json.dumps(state), encoding='utf-8')
            fails, wait = 0, CHECK_SECS
        except Exception as err:  # keep watching; report a streak once
            fails += 1
            wait = min(BACKOFF_MAX, CHECK_SECS * 2 ** fails)
            log('check failed (%d in a row): %s' % (fails, str(err)[:300]))
            if fails == FAIL_AFTER:
                try:
                    hook.fire('script_failure', {'script': 'watch_mail', 'error': str(err)[:500], 'failures': fails},
                              key='watch_mail-%d' % int(time.time()))
                except Exception as e:
                    log('script_failure not sent: %s' % e)
        time.sleep(wait)


if __name__ == '__main__':
    main()
