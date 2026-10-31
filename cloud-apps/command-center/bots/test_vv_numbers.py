"""python -I bots/test_vv_numbers.py  (stdlib only; runs the real queries on an in-memory SQLite table)"""
import contextlib
import io
import json
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vv_numbers as vv  # noqa: E402

NOW = 1793400000
HOUR_MS = 3600 * 1000


class Db:
    def __init__(self):
        self.con = sqlite3.connect(':memory:')
        self.con.row_factory = sqlite3.Row
        self.con.execute('CREATE TABLE subscriptions (id TEXT, fanbasis_subscription_id TEXT, fanbasis_product_id TEXT, '
                         'status TEXT, raw_json TEXT, updated_at TEXT)')
        self.con.execute('CREATE TABLE fanbasis_webhook_events (event_type TEXT, payload_json TEXT, received_at INTEGER)')
        self.n = 0

    def sub(self, status, price='39.00', days=30, sid=None, product='vmqDX', updated='2026-10-31 14:00:00'):
        self.n += 1
        raw = {'product': {'price': price}, 'subscription': {'payment_frequency': days}}
        self.con.execute('INSERT INTO subscriptions VALUES (?, ?, ?, ?, ?, ?)',
                         ('row%d' % self.n, sid or 'sub%d' % self.n, product, status, json.dumps(raw), updated))
        return self

    def cancel(self, sub, hours_ago=1, title='Viral View Pro', event='subscription.canceled'):
        body = {'type': event, 'data': {'item': {'title': title}, 'subscription': {'id': sub}}}
        self.con.execute('INSERT INTO fanbasis_webhook_events VALUES (?, ?, ?)',
                         (event, json.dumps(body), NOW * 1000 - hours_ago * HOUR_MS))
        return self

    def d1(self, sql):
        return [dict(r) for r in self.con.execute(sql)]

    def main(self, fire_result=None):
        out = io.StringIO()
        with mock.patch.object(vv, 'd1', self.d1), mock.patch.object(vv.time, 'time', return_value=NOW), \
                mock.patch.object(vv.hook, 'fire', return_value=fire_result or {}) as fire, \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = vv.main()
        self.code, self.fire, self.fired = code, fire, [c.args[0] for c in fire.call_args_list]
        return json.loads(out.getvalue()) if out.getvalue() else None


class Numbers(unittest.TestCase):
    def test_mrr_counts_active_only_and_spreads_annual_plans(self):
        db = Db().sub('active').sub('active').sub('active', '228.00', 365).sub('active', '588.00', 365)
        db.sub('past_due').sub('cancel_scheduled', '99.00').sub('completed')
        self.assertEqual(db.main(), {'cancellations_24h': 0, 'mrr': 146.0, 'paying': 4})

    def test_free_accounts_are_left_out(self):
        self.assertEqual(Db().sub('active', '99.00', product='manual_free').main()['mrr'], 0)

    def test_the_newest_row_for_a_subscription_wins(self):
        db = Db().sub('completed', sid='s1', updated='2026-10-31 14:00:00').sub('active', sid='s1', updated='2026-10-01 14:00:00')
        self.assertEqual(db.main()['paying'], 0)

    def test_a_cancel_sent_twice_counts_once(self):
        self.assertEqual(Db().sub('completed').cancel('a').cancel('a').main()['cancellations_24h'], 1)

    def test_only_the_last_24_hours_count(self):
        self.assertEqual(Db().sub('completed').cancel('a', 23).cancel('b', 25).main()['cancellations_24h'], 1)

    def test_other_products_and_other_events_do_not_count(self):
        db = Db().sub('completed').cancel('a', title='Some Other Course').cancel('b', event='subscription.renewed')
        self.assertEqual(db.main()['cancellations_24h'], 0)

    def test_a_viral_view_plan_with_no_subscription_row_still_counts(self):
        self.assertEqual(Db().cancel('a', title='Viral View Discount').main()['cancellations_24h'], 1)

    def test_an_empty_receipt_row_is_ignored(self):
        db = Db().sub('completed')
        db.con.execute("INSERT INTO fanbasis_webhook_events VALUES ('receipt', '', ?)", (NOW * 1000,))
        self.assertEqual(db.main()['cancellations_24h'], 0)


class Alerts(unittest.TestCase):
    def three(self):
        return Db().sub('completed').cancel('a').cancel('b').cancel('c')

    def test_two_cancellations_stay_quiet(self):
        db = Db().sub('completed').cancel('a').cancel('b')
        db.main()
        self.assertEqual((db.code, db.fired), (0, []))

    def test_three_cancellations_alert_once_a_day(self):
        db = self.three()
        got = db.main({'viral-view': 202, 'ana': 202})
        self.assertEqual((db.code, db.fired, got['cancellations_24h']), (0, ['cancellation_spike'], 3))
        self.assertTrue(db.fire.call_args.kwargs['key'].startswith('cancellation-spike-20'))

    def test_an_alert_that_was_not_delivered_is_reported(self):
        db = self.three()
        self.assertIsNone(db.main({'viral-view': 202, 'ana': 503}))
        self.assertEqual((db.code, db.fired), (1, ['cancellation_spike', 'script_failure']))

    def test_an_unknown_plan_length_fails_instead_of_misstating_mrr(self):
        db = Db().sub('active', days=7)
        self.assertIsNone(db.main())
        self.assertEqual((db.code, db.fired), (1, ['script_failure']))
        self.assertEqual(db.fire.call_args.args[1]['script'], 'vv_numbers')

    def test_a_changed_webhook_shape_fails_instead_of_reading_zero(self):
        db = Db().sub('completed')
        db.con.execute("INSERT INTO fanbasis_webhook_events VALUES ('subscription.canceled', '{}', ?)", (NOW * 1000,))
        self.assertIsNone(db.main())
        self.assertEqual((db.code, db.fired), (1, ['script_failure']))

    def test_a_database_failure_is_reported(self):
        with mock.patch.object(vv, 'd1', side_effect=RuntimeError('wrangler failed: 10000')), \
                mock.patch.object(vv.hook, 'fire', return_value={}) as fire, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(vv.main(), 1)
        self.assertEqual(fire.call_args.args[0], 'script_failure')


class Hang(unittest.TestCase):
    def test_a_hung_wrangler_is_killed_and_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            slow = Path(tmp) / 'slow.cmd'
            slow.write_text('@ping -n 30 127.0.0.1 >nul\r\n', encoding='ascii')
            start = time.monotonic()
            with mock.patch.object(vv.shutil, 'which', return_value=str(slow)), mock.patch.object(vv, 'APP', tmp), \
                    mock.patch.object(vv, 'TIMEOUT_S', 1), self.assertRaises(subprocess.TimeoutExpired):
                vv.d1('SELECT 1')
            self.assertLess(time.monotonic() - start, 10)


if __name__ == '__main__':
    unittest.main()
