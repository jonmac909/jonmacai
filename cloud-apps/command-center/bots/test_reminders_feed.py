"""python -I bots/test_reminders_feed.py  (stdlib only): reminders_feed.py builds the Home reminders feed from a planted OpenBot database."""
import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reminders_feed as rf  # noqa: E402

NOW = datetime.fromisoformat('2026-11-12T18:00:00+00:00').timestamp()  # Thu Nov 12, 11:00 Vancouver


def plant(rows):
    """A throwaway database with OpenBot's two tables (the columns the script reads): (routine_id, name, active, tz, schedule, next_run_at)."""
    d = tempfile.mkdtemp()
    path = Path(d) / 'openbot.db'
    con = sqlite3.connect(path)
    con.execute('create table projection_agent_routines (routine_id text primary key, agent_id text, name text, instruction text, active integer, timezone text)')
    con.execute('create table projection_routine_triggers (trigger_id text primary key, routine_id text unique, schedule_json text, next_run_at text)')
    for rid, name, active, tz, sched, nxt in rows:
        con.execute('insert into projection_agent_routines values (?,?,?,?,?,?)', (rid, 'a', name, 'x', active, tz))
        if sched:
            con.execute('insert into projection_routine_triggers values (?,?,?,?)', ('t-' + rid, rid, json.dumps(sched), nxt))
    con.commit()
    con.close()
    return path


WEEKLY = ('w1', 'Reminder: Sunday meals', 1, 'America/Vancouver', {'kind': 'weekly', 'weekday': 0, 'time': '09:00'}, '2026-11-15T16:00:00.000Z')
ONCE = ('o1', 'Reminder: Telus bill', 1, 'America/Vancouver', {'kind': 'once', 'date': '2027-02-22', 'time': '09:00'}, '2027-02-22T16:00:00.000Z')
OTHER = ('x1', 'Daily brief page 09:00', 1, 'UTC', {'kind': 'daily', 'time': '16:00'}, '2026-11-13T16:00:00.000Z')
PAUSED = ('p1', 'Reminder: Old thing', 0, 'America/Vancouver', {'kind': 'weekly', 'weekday': 2, 'time': '07:30'}, '2026-11-17T14:30:00.000Z')


def build(rows):
    return rf.build(rf.read_routines(plant(rows)), NOW)


class Reminders(unittest.TestCase):
    def test_a_weekly_and_a_one_off_come_out_with_title_repeat_and_times(self):
        body = build([WEEKLY, ONCE, OTHER, PAUSED])
        self.assertEqual([r['title'] for r in body['reminders']], ['Sunday meals', 'Telus bill'])  # not the daily brief, not the paused one
        weekly, once = body['reminders']
        self.assertEqual(weekly['repeat'], 'Every Sunday')
        self.assertEqual(weekly['next'], '2026-11-15T09:00')
        self.assertEqual(weekly['times'], ['2026-11-08T09:00', '2026-11-15T09:00', '2026-11-22T09:00', '2026-11-29T09:00', '2026-12-06T09:00', '2026-12-13T09:00', '2026-12-20T09:00'])  # a week back to six weeks ahead
        self.assertEqual((once['repeat'], once['next'], once['times']), ('Once', '2027-02-22T09:00', []))  # far off: only `next`

    def test_a_removed_routine_is_gone_from_the_next_feed(self):
        self.assertEqual(len(build([WEEKLY, ONCE])['reminders']), 2)
        self.assertEqual([r['title'] for r in build([ONCE])['reminders']], ['Telus bill'])
        self.assertEqual(build([])['reminders'], [])
        self.assertEqual([r['title'] for r in build([(WEEKLY[0], WEEKLY[1], 0) + WEEKLY[3:], ONCE])['reminders']], ['Telus bill'])  # paused = gone

    def test_a_one_off_that_already_ran_is_left_out(self):
        past = ('o2', 'Reminder: done already', 1, 'America/Vancouver', {'kind': 'once', 'date': '2026-11-01', 'time': '09:00'}, '2026-11-01T16:00:00.000Z')
        self.assertEqual(build([past])['reminders'], [])

    def test_monthly_quarterly_and_a_utc_routine_land_on_the_right_vancouver_time(self):
        monthly = ('m1', 'Net worth reminder - 1st of month', 1, 'America/Vancouver', {'kind': 'monthly', 'day': 1, 'time': '09:00'}, '2026-12-01T16:00:00.000Z')
        quarterly = ('q1', 'Rock reminder', 1, 'America/Vancouver', {'kind': 'advanced', 'months': [3, 6, 9, 12], 'days': {'kind': 'days-of-month', 'days': [14]}, 'time': {'kind': 'at-time', 'time': '09:30'}}, '2026-12-14T16:30:00.000Z')
        utc = ('u1', 'Evening reminder', 1, 'UTC', {'kind': 'daily', 'time': '04:00'}, '2026-11-13T04:00:00.000Z')  # 04:00 UTC = 21:00 the day before, here
        mwf = ('f1', 'Workout reminder (Mon, Wed, Fri 11:00)', 1, 'America/Vancouver', {'kind': 'advanced', 'months': list(range(1, 13)), 'days': {'kind': 'days-of-week', 'days': [1, 3, 5]}, 'time': {'kind': 'at-time', 'time': '11:00'}}, '2026-11-13T18:00:00.000Z')
        got = {r['title']: r for r in build([monthly, quarterly, utc, mwf])['reminders']}
        self.assertEqual((got['Net worth reminder - 1st of month']['next'], got['Net worth reminder - 1st of month']['times']), ('2026-12-01T09:00', ['2026-12-01T09:00']))
        self.assertEqual((got['Rock reminder']['next'], got['Rock reminder']['repeat']), ('2026-12-14T09:30', 'Every 3 months, the 14th'))
        self.assertEqual(got['Evening reminder']['times'][0], '2026-11-05T21:00')  # a week back, the evening before 04:00 UTC
        self.assertIn('2026-11-13T21:00', got['Evening reminder']['times'])
        self.assertEqual(got['Workout'.replace('Workout', 'Workout reminder')]['times'][:3], ['2026-11-06T11:00', '2026-11-09T11:00', '2026-11-11T11:00'])
        self.assertEqual(got['Workout reminder']['repeat'], 'Every Mon, Wed, Fri')

    def test_sync_posts_when_changed_and_stays_quiet_otherwise(self):
        path = plant([WEEKLY])
        state = Path(tempfile.mkdtemp()) / 'state.json'
        sent = []
        self.assertEqual(rf.sync(path, NOW, poster=sent.append, state=state), 'posted')
        self.assertEqual(rf.sync(path, NOW + 120, poster=sent.append, state=state), 'unchanged')
        con = sqlite3.connect(path)
        con.execute("update projection_agent_routines set active = 0 where routine_id = 'w1'")
        con.commit()
        con.close()
        self.assertEqual(rf.sync(path, NOW + 240, poster=sent.append, state=state), 'posted')  # a removed routine goes out at once
        self.assertEqual([len(b['reminders']) for b in sent], [1, 0])
        self.assertEqual(rf.sync(path, NOW + 240 + rf.REPOST_S, poster=sent.append, state=state), 'posted')  # and a heartbeat every 30 minutes
        self.assertEqual(rf.sync(Path(tempfile.mkdtemp()) / 'missing.db', NOW, poster=sent.append, state=state), 'none')

    def test_the_database_is_opened_read_only(self):
        path = plant([WEEKLY])
        with rf.closing(sqlite3.connect('file:%s?mode=ro' % str(path).replace('\\', '/'), uri=True)) as con, self.assertRaises(sqlite3.OperationalError):
            con.execute('delete from projection_agent_routines')
        self.assertIn('mode=ro', Path(rf.__file__).read_text(encoding='utf-8'))
        self.assertEqual(len(rf.read_routines(path)), 1)

    def test_a_feed_the_worker_does_not_know_yet_is_silent_but_a_real_failure_is_reported_to_ana(self):
        ana = mock.Mock()
        with mock.patch.dict(sys.modules, {'auto_continue': ana}):
            with mock.patch.object(rf, 'sync', side_effect=RuntimeError('dash.py: HTTP 404: Unknown feed. Feeds: morning_summary')):
                self.assertEqual(rf.main([]), 1)
            ana.report_failure.assert_not_called()  # the Worker with the reminders feed is not deployed yet
            with mock.patch.object(rf, 'sync', side_effect=RuntimeError('dash.py: HTTP 500')):
                self.assertEqual(rf.main([]), 1)
            ana.report_failure.assert_called_once()

if __name__ == '__main__':
    unittest.main()
