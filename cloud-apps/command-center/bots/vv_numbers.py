"""Viral View morning numbers: cancellations in the last 24 hours and MRR.

Read-only, from the app's own database. The Commas webhook and the app's daily Commas sync keep it
current, so no Commas key is needed. Prints one JSON line. 3+ cancellations fires cancellation_spike
(once a day); any failure fires script_failure and exits 1.
"""
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # the team runs scripts with python -I
import hook  # noqa: E402

APP = r'D:\AgentTeam\worktrees\viralview'  # wrangler reads the database name from this checkout
SPIKE = 3
MONTHS = {30: 1, 90: 3, 180: 6, 365: 12}  # Commas payment_frequency in days; anything else fails loudly


def field(*paths):
    return 'COALESCE(%s)' % ', '.join("json_extract(raw_json, '$.%s')" % p for p in paths)


# raw_json is a sync record or, until the next sync, a webhook body. One line: npx is a .cmd on Windows.
SQL = ("SELECT COALESCE(fanbasis_subscription_id, id) sid, lower(trim(status)) status, %s cancelled_at, %s days, "
       "%s price FROM subscriptions WHERE fanbasis_product_id != 'manual_free'") % (
    field('subscription.cancelled_at', 'data.subscription.cancelled_at'),
    field('subscription.payment_frequency', 'data.subscription.payment_frequency'),
    field('product.price', 'data.unit_price'))


def d1_rows():
    r = subprocess.run([shutil.which('npx'), '--yes', 'wrangler', 'd1', 'execute', 'viralview-prod', '--remote',
                        '--json', '--command', SQL], cwd=APP, env=dict(os.environ, CI='1'), capture_output=True,
                       encoding='utf-8', timeout=120, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if r.returncode:
        raise RuntimeError('wrangler failed: %s' % (r.stderr or r.stdout)[-200:])
    return json.loads(r.stdout)[0]['results']


def monthly(row):
    return float(row['price']) / MONTHS[int(row['days'])]


def summarize(rows, now):
    since = now - timedelta(days=1)
    cancelled = {r['sid'] for r in rows if r['cancelled_at']
                 and datetime.fromisoformat(r['cancelled_at'].replace('Z', '+00:00')) > since}  # sync: Z, webhook: -05:00
    active = {r['sid']: r for r in rows if r['status'] == 'active'}
    past_due = {r['sid']: r for r in rows if r['status'] == 'past_due'}
    return {'as_of': now.strftime('%Y-%m-%d %H:%M UTC'), 'cancellations_24h': len(cancelled),
            'mrr': round(sum(map(monthly, active.values())), 2), 'paying': len(active),
            'past_due': len(past_due), 'past_due_mrr': round(sum(map(monthly, past_due.values())), 2)}


def main():
    try:
        now = datetime.now(timezone.utc)
        out = summarize(d1_rows(), now)
        if out['cancellations_24h'] >= SPIKE:
            res = hook.fire('cancellation_spike', out, key='cancellation-spike-%s' % now.date())
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
