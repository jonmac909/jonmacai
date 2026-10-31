"""Viral View morning numbers: cancellations in the last 24 hours and MRR.

Read-only, from the app's own database, so no Commas key is needed. Cancellations come from the live
Commas webhook log. MRR comes from the subscriptions table, which the app's daily Commas sync refreshes,
and counts every subscription Commas bills. Prints one JSON line. 3+ cancellations fires
cancellation_spike (once a day); any failure fires script_failure and exits 1.
"""
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # the team runs scripts with python -I
import hook  # noqa: E402

APP = r'D:\AgentTeam\worktrees\viralview'  # wrangler reads the database name from this checkout
SPIKE = 3
TIMEOUT_S = 120
MONTHS = {30: 1, 365: 12}  # Commas payment_frequency in days; anything else fails loudly
NOWIN = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

SUBS = ("SELECT COALESCE(fanbasis_subscription_id, id) sid, lower(trim(status)) status, "
        "json_extract(raw_json, '$.subscription.payment_frequency') days, json_extract(raw_json, '$.product.price') price "
        "FROM subscriptions WHERE fanbasis_product_id != 'manual_free' ORDER BY updated_at")
CANCELS = ("SELECT payload_json FROM fanbasis_webhook_events "
           "WHERE event_type = 'subscription.canceled' AND received_at > %d")


def d1(sql):
    p = subprocess.Popen([shutil.which('npx'), '--yes', 'wrangler', 'd1', 'execute', 'viralview-prod', '--remote',
                          '--json', '--command', sql], cwd=APP, env=dict(os.environ, CI='1'), stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, encoding='utf-8', creationflags=NOWIN)
    try:
        out, err = p.communicate(timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:  # npx is a .cmd: wrangler outlives a plain kill and holds the pipes open
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(p.pid)], capture_output=True, creationflags=NOWIN)
        raise
    if p.returncode:
        raise RuntimeError('wrangler failed: %s' % (err or out)[-200:])
    return json.loads(out)[0]['results']


def monthly(row):
    return float(row['price']) / MONTHS[int(row['days'])]


def summarize(subs, cancel_events):
    latest = {r['sid']: r for r in subs}  # oldest first, so the newest row for a subscription wins
    active = [r for r in latest.values() if r['status'] == 'active']
    cancelled = {e['data']['subscription']['id'] for e in cancel_events
                 if e['data']['item']['title'].lower().startswith('viral view')}  # the app's own test for its products
    return {'cancellations_24h': len(cancelled), 'mrr': round(sum(map(monthly, active)), 2), 'paying': len(active)}


def main():
    try:
        since_ms = int(time.time() - 86400) * 1000
        out = summarize(d1(SUBS), [json.loads(r['payload_json']) for r in d1(CANCELS % since_ms)])
        if out['cancellations_24h'] >= SPIKE:
            res = hook.fire('cancellation_spike', out, key='cancellation-spike-%s' % time.strftime('%Y-%m-%d'))
            bad = {r: s for r, s in res.items() if s not in (200, 202)}
            if bad:
                raise RuntimeError('alert not sent: %s' % bad)
    except Exception as err:
        hook.fire('script_failure', {'script': 'vv_numbers', 'error': str(err)[:200]})
        print('vv_numbers: %s' % err, file=sys.stderr)
        return 1
    print(json.dumps(out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
