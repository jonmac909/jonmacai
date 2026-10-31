"""python -I bots/test_vv_numbers.py  (stdlib only; runs the real query on an in-memory SQLite table)"""
import contextlib
import io
import json
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vv_numbers as vv  # noqa: E402

NOW = datetime(2026, 10, 31, 16, 0, tzinfo=timezone.utc)


def stamp(hours_ago):
    return (NOW - timedelta(hours=hours_ago)).strftime('%Y-%m-%dT%H:%M:%S.000000Z')


def synced(status, price, days, cancelled_at=None):
    return status, {'product': {'price': price}, 'subscription': {'payment_frequency': days, 'cancelled_at': cancelled_at}}


def webhook(status, price=None, days=30, cancelled_at=None):
    return status, {'data': {'unit_price': price, 'subscription': {'payment_frequency': days, 'cancelled_at': cancelled_at}}}


def query(*subs, product='vmqDX'):
    """Run the real SQL. Each sub is (status, raw) or (sid, status, raw)."""
    con = sqlite3.connect(':memory:')
    con.row_factory = sqlite3.Row
    con.execute('CREATE TABLE subscriptions (id TEXT, fanbasis_subscription_id TEXT, fanbasis_product_id TEXT, '
                'status TEXT, raw_json TEXT)')
    for n, sub in enumerate(subs):
        sid, status, raw = sub if len(sub) == 3 else ('sub%d' % n, *sub)
        con.execute('INSERT INTO subscriptions VALUES (?, ?, ?, ?, ?)', ('row%d' % n, sid, product, status, json.dumps(raw)))
    return [dict(r) for r in con.execute(vv.SQL)]


def run_main(rows, fire_result=None):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(vv, 'd1_rows', return_value=rows), mock.patch.object(vv.hook, 'fire', return_value=fire_result or {}) as fire, \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = vv.main()
    return code, out.getvalue(), [c.args[0] for c in fire.call_args_list], fire


class Numbers(unittest.TestCase):
    def test_mrr_counts_active_only_and_spreads_annual_plans(self):
        rows = query(synced('active', '39.00', 30), synced('active', '39.00', 30), synced('active', '228.00', 365),
                     synced('active', '588.00', 365), synced('past_due', '39.00', 30),
                     synced('cancel_scheduled', '99.00', 30), synced('completed', '39.00', 30, stamp(500)))
        got = vv.summarize(rows, NOW)
        self.assertEqual((got['mrr'], got['paying'], got['past_due'], got['past_due_mrr']), (146.0, 4, 1, 39.0))

    def test_free_accounts_are_left_out(self):
        self.assertEqual(query(synced('active', '0.00', 30), product='manual_free'), [])

    def test_a_row_last_written_by_a_webhook_still_reads(self):
        rows = query(webhook('active', '39.00'), webhook('completed', cancelled_at=stamp(2)))
        got = vv.summarize(rows, NOW)
        self.assertEqual((got['mrr'], got['cancellations_24h']), (39.0, 1))

    def test_only_the_last_24_hours_count(self):
        rows = query(synced('completed', '39.00', 30, stamp(23)), synced('completed', '39.00', 30, stamp(25)))
        self.assertEqual(vv.summarize(rows, NOW)['cancellations_24h'], 1)

    def test_a_webhook_time_in_another_zone_is_not_misread(self):
        local = timezone(timedelta(hours=-5))
        recent = (NOW - timedelta(hours=23)).astimezone(local).isoformat()
        old = (NOW - timedelta(hours=25)).astimezone(local).isoformat()
        rows = query(webhook('completed', cancelled_at=recent), webhook('completed', cancelled_at=old))
        self.assertEqual(vv.summarize(rows, NOW)['cancellations_24h'], 1)

    def test_two_rows_for_one_subscription_count_once(self):
        rows = query(('s1', *synced('completed', '39.00', 30, stamp(1))), ('s1', *webhook('cancelled', cancelled_at=stamp(1))),
                     ('s2', *synced('active', '39.00', 30)), ('s2', *synced('active', '39.00', 30)))
        got = vv.summarize(rows, NOW)
        self.assertEqual((got['cancellations_24h'], got['mrr'], got['paying']), (1, 39.0, 1))


class Alerts(unittest.TestCase):
    cancelled = [synced('completed', '39.00', 30, stamp(1))]

    def rows(self, n):
        return query(*self.cancelled * n)

    def now_patch(self):
        real = datetime

        class Fixed(real):
            @classmethod
            def now(cls, tz=None):
                return NOW
        return mock.patch.object(vv, 'datetime', Fixed)

    def test_two_cancellations_stay_quiet(self):
        with self.now_patch():
            code, out, fired, _ = run_main(self.rows(2))
        self.assertEqual((code, fired, json.loads(out)['cancellations_24h']), (0, [], 2))

    def test_three_cancellations_alert_once_a_day(self):
        with self.now_patch():
            code, out, fired, fire = run_main(self.rows(3), {'viral-view': 202, 'ana': 202})
        self.assertEqual((code, fired), (0, ['cancellation_spike']))
        self.assertEqual(fire.call_args.kwargs['key'], 'cancellation-spike-2026-10-31')
        self.assertEqual(json.loads(out)['cancellations_24h'], 3)

    def test_an_alert_that_was_not_delivered_is_reported(self):
        with self.now_patch():
            code, out, fired, _ = run_main(self.rows(3), {'viral-view': 202, 'ana': 503})
        self.assertEqual((code, out, fired), (1, '', ['cancellation_spike', 'script_failure']))

    def test_an_unknown_plan_length_fails_instead_of_misstating_mrr(self):
        code, out, fired, fire = run_main(query(synced('active', '39.00', 7)))
        self.assertEqual((code, out, fired), (1, '', ['script_failure']))
        self.assertEqual(fire.call_args.args[1]['script'], 'vv_numbers')

    def test_a_database_failure_is_reported(self):
        with mock.patch.object(vv, 'd1_rows', side_effect=RuntimeError('wrangler failed: 10000')), \
                mock.patch.object(vv.hook, 'fire', return_value={}) as fire, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(vv.main(), 1)
        self.assertEqual(fire.call_args.args[0], 'script_failure')


if __name__ == '__main__':
    unittest.main()
