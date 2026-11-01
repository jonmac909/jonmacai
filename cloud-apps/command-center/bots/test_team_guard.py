"""python -I bots/test_team_guard.py  (a temp SQLite with OpenBot's real columns; nothing is sent or restarted)"""
import json
import msvcrt
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import team_guard as tg  # noqa: E402

T0 = tg.ts('2026-11-01T12:00:00.000Z')
LUCY = 'agent-lucy'
SCHEMA = """
create table projection_agents (agent_id text, agent_json text);
create table projection_threads (thread_id text, agent_id text);
create table projection_turns (turn_id text, thread_id text, status text, started_at text, completed_at text);
create table projection_thread_activities (activity_id integer primary key, thread_id text, turn_id text,
  activity_type text, payload_json text, created_at text);
create table projection_deliveries (delivery_id integer primary key, recipient_agent_id text, status text,
  turn_id text, error text, created_at text);
"""


def ago(minutes):
    return tg.iso(T0 - minutes * 60)


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.t = T0
        self.sent, self.proofs, self.cards, self.pass_codes, self.keys = [], [], [], {}, set()
        self.status, self.render, self.restart_error = 202, False, None
        (self.root / 'edits').mkdir()
        (self.root / 'accounts').mkdir()
        self.db = sqlite3.connect(self.root / 'o.db', isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.executescript(SCHEMA)
        self.agent(LUCY, 'Lucy')
        self.agent(tg.ANA, 'Ana')
        self.pack('hgp-one')
        self.pack('hgp-two')
        fake_api = types.SimpleNamespace(send=lambda a, text, cid: self.sent.append(('wake', a, text)))
        for target, name, value in [
                (tg, 'DB', self.root / 'o.db'), (tg, 'STATE', self.root / 'state.json'),
                (tg, 'LOG', self.root / 'guard.log'), (tg, 'ACCOUNTS', self.root / 'accounts'),
                (tg, 'DEFAULT_PROJECTS', self.root / 'default'), (tg, 'EDITS', self.root / 'edits'),
                (tg, 'dash', self.fake_dash), (tg, 'preflight', lambda d: self.pass_codes.get(d.name, 0)),
                (tg, 'render_running', lambda: self.render), (tg, 'restart_openbot', self.fake_restart),
                (tg.hook, 'fire', self.fake_fire), (tg.time, 'time', lambda: self.t)]:
            patcher = mock.patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch.dict(sys.modules, {'openbot_api': fake_api})
        patcher.start()
        self.addCleanup(patcher.stop)

    def agent(self, agent, name, **extra):
        self.db.execute('insert into projection_agents values (?, ?)',
                        (agent, json.dumps({'name': name, 'providerAccountId': 'team', **extra})))

    def pack(self, name):
        (self.root / 'edits' / name).mkdir()
        (self.root / 'edits' / name / 'edit-plan.json').write_text('{}')

    def turn(self, agent, turn, started, last=None, kind='tool.completed'):
        self.db.execute('insert into projection_threads values (?, ?)', ('th-' + turn, agent))
        self.db.execute("insert into projection_turns values (?, ?, 'running', ?, null)", (turn, 'th-' + turn, ago(started)))
        if last is not None:
            self.activity(turn, last, kind)

    def activity(self, turn, minutes, kind='tool.completed'):
        self.db.execute('insert into projection_thread_activities (thread_id, turn_id, activity_type, created_at) '
                        'values (?, ?, ?, ?)', ('th-' + turn, turn, kind, tg.iso(self.t - minutes * 60)))

    def queue(self, agent, status='queued'):
        self.db.execute('insert into projection_deliveries (recipient_agent_id, status) values (?, ?)', (agent, status))

    def transcript(self, account, agent, line, name='a.jsonl'):
        root = self.root / 'default' if account == tg.DEFAULT_ACCOUNT else self.root / 'accounts' / account / 'projects'
        folder = root / ('C--OpenBot-Agents-' + agent)
        folder.mkdir(parents=True, exist_ok=True)
        with open(folder / name, 'a', encoding='utf-8') as f:
            f.write(json.dumps(line) + '\n')

    def refused(self, hours=24):
        return {'isApiErrorMessage': True, 'apiError': 'usage_limit_reached', 'timestamp': ago(1),
                'quotaLimits': {'status': 'rejected', 'resetsAt': int(T0 + hours * 3600)},
                'message': {'content': [{'type': 'text', 'text': "You've hit your weekly limit"}]}}

    def fake_dash(self, *args):
        if args[0] == 'proofs':
            return {'proofs': self.proofs}
        if args[0] == 'tasks':
            return {'tasks': [c for c in self.cards if c['owner'] == args[2]]}
        self.assertEqual(args[0], 'ask')
        self.sent.append(('ask', args[1], list(args)))
        return {'ok': True}

    def fake_fire(self, event, data=None, key=None, routes=None):
        self.assertTrue(key)
        if self.status in (200, 202) and key not in self.keys:  # like the real route: a repeated key delivers once
            self.keys.add(key)
            self.sent.append(('fire', event, data))
        return {r: self.status for r in routes or ['developer', 'ana']}

    def fake_restart(self):
        if self.restart_error:
            raise self.restart_error
        self.sent.append(('restart',))

    def run_guard(self):
        """One 10-minute tick. Returns what it sent."""
        before = len(self.sent)
        tg.run()
        self.t += 600
        return self.sent[before:]

    def proof(self, pid='p1', minutes=31, kind='render', by='video-editor'):
        self.proofs.append({'id': pid, 'kind': kind, 'createdBy': by, 'taskId': 't1',
                            'createdAt': tg.iso(self.t - minutes * 60)})


class Turns(Base):
    def test_quiet_bot_alerts_once(self):
        self.turn(LUCY, 'u1', 40, last=31)
        out = self.run_guard()
        self.assertEqual([('fire', 'bot_stuck')], [s[:2] for s in out])
        self.assertIn('Lucy quiet 31 minutes', out[0][2]['alerts'][0])
        self.assertEqual([], self.run_guard())

    def test_alert_goes_to_ana_route_only(self):
        self.turn(LUCY, 'u1', 40, last=31)
        with mock.patch.object(tg.hook, 'fire', return_value={'ana': 202}) as fire:
            tg.run()
        self.assertEqual(['ana'], fire.call_args.kwargs['routes'])

    def test_29_minutes_is_fine(self):
        self.turn(LUCY, 'u1', 40, last=29)
        self.assertEqual([], self.run_guard())

    def test_a_queued_routine_is_not_activity(self):
        self.turn(LUCY, 'u1', 60, last=31)
        self.activity('u1', 1, 'routine.run-queued')
        self.assertEqual(1, len(self.run_guard()))

    def test_a_turn_with_no_activity_counts_from_its_start(self):
        self.turn(LUCY, 'u1', 31)
        self.assertEqual(1, len(self.run_guard()))

    def test_a_finished_turn_is_ignored(self):
        self.turn(LUCY, 'u1', 300, last=200)
        self.db.execute("update projection_turns set completed_at = ?", (ago(100),))
        self.assertEqual([], self.run_guard())

    def test_quiet_again_is_a_new_incident(self):
        self.turn(LUCY, 'u1', 40, last=31)
        self.assertEqual(1, len(self.run_guard()))
        self.activity('u1', 0)
        self.assertEqual([], self.run_guard())
        self.t += 1800
        self.assertEqual(1, len(self.run_guard()))

    def test_queue_behind_a_two_hour_turn_alerts_once(self):
        self.turn(LUCY, 'u1', 121, last=1)
        self.queue(LUCY)
        out = self.run_guard()
        self.assertEqual(1, len(out))
        self.assertIn('1 queued behind a turn running 121 minutes', out[0][2]['alerts'][0])
        self.activity('u1', 0)
        self.assertEqual([], self.run_guard())

    def test_no_alert_for_a_busy_turn_without_a_queue(self):
        self.turn(LUCY, 'u1', 200, last=1)
        self.queue(LUCY, 'delivered')
        self.assertEqual([], self.run_guard())

    def test_queue_that_empties_and_refills_stays_one_alert(self):
        self.turn(LUCY, 'u1', 121, last=1)
        self.queue(LUCY)
        self.assertEqual(1, len(self.run_guard()))
        self.db.execute("update projection_deliveries set status = 'delivered'")
        self.activity('u1', 0)
        self.assertEqual([], self.run_guard())
        self.queue(LUCY)
        self.activity('u1', 0)
        self.assertEqual([], self.run_guard())

    def test_long_turn_can_still_freeze_later(self):
        self.turn(LUCY, 'u1', 200, last=1)
        self.queue(LUCY)
        self.assertEqual(1, len(self.run_guard()))
        self.t += 1800
        self.assertEqual(1, len(self.run_guard()))


class AnaRestart(Base):
    def test_46_minutes_restarts_once_and_alerts_first(self):
        self.turn(tg.ANA, 'a1', 60, last=46)
        out = self.run_guard()
        self.assertEqual(['fire', 'restart'], [s[0] for s in out])
        self.assertIn('Ana quiet 46 minutes', out[0][2]['alerts'][0])
        self.assertEqual([], self.run_guard())

    def test_44_minutes_does_nothing(self):
        self.turn(tg.ANA, 'a1', 60, last=44)
        self.assertEqual([], self.run_guard())

    def test_ana_is_not_sent_her_own_stuck_alert(self):
        self.turn(tg.ANA, 'a1', 200, last=31)
        self.queue(tg.ANA)
        self.assertEqual([], self.run_guard())

    def test_a_render_blocks_it_then_it_fires_when_free(self):
        self.turn(tg.ANA, 'a1', 60, last=46)
        self.render = True
        self.assertEqual(['fire'], [s[0] for s in self.run_guard()])
        self.render = False
        self.assertEqual(['restart'], [s[0] for s in self.run_guard()])

    def test_a_render_blocking_90_minutes_asks_jon_once(self):
        self.turn(tg.ANA, 'a1', 100, last=91)
        self.render = True
        out = self.run_guard()
        self.assertEqual(['fire', 'ask'], [s[0] for s in out])
        self.assertIn('Other (type your own)', out[1][2])
        self.assertEqual([], self.run_guard())

    def test_a_failed_restart_retries(self):
        self.turn(tg.ANA, 'a1', 60, last=46)
        self.restart_error = RuntimeError('found 2')
        self.assertEqual(['fire'], [s[0] for s in self.run_guard()])
        self.restart_error = None
        self.assertEqual(['restart'], [s[0] for s in self.run_guard()])

    def test_restart_goes_ahead_when_the_alert_cannot_be_sent(self):
        self.turn(tg.ANA, 'a1', 60, last=46)
        self.status = 503
        self.assertEqual(['restart'], [s[0] for s in self.run_guard()])


class Qc(Base):
    def test_olivias_proof_wakes_nina_once(self):
        self.proof(by='video-editor')
        out = self.run_guard()
        self.assertEqual([('wake', tg.NINA)], [s[:2] for s in out])
        self.assertIn('p1', out[0][2])
        self.assertEqual([], self.run_guard())

    def test_other_proofs_wake_jessica(self):
        self.proof(by='home-guide-press')
        self.assertEqual([('wake', tg.JESSICA)], [s[:2] for s in self.run_guard()])

    def test_29_minutes_waits(self):
        self.proof(minutes=29)
        self.assertEqual([], self.run_guard())

    def test_non_video_proof_is_ignored(self):
        self.proof(kind='url', minutes=500)
        self.assertEqual([], self.run_guard())

    def test_several_proofs_are_one_wake(self):
        self.proof('p1')
        self.proof('p2')
        out = self.run_guard()
        self.assertEqual(1, len(out))
        self.assertIn('p2', out[0][2])
        self.assertEqual([], self.run_guard())

    def test_a_new_proof_wakes_again(self):
        self.proof('p1')
        self.run_guard()
        self.proof('p2')
        self.assertEqual(1, len(self.run_guard()))


class Packs(Base):
    def card(self, title, status='doing', owner='video-editor'):
        self.cards.append({'title': title, 'status': status, 'owner': owner})

    def test_low_wakes_elle_and_scarlett_once(self):
        self.pass_codes['hgp-two'] = 1
        out = self.run_guard()
        self.assertEqual({tg.ELLE, tg.SCARLETT}, {s[1] for s in out})
        self.assertEqual(2, len(out))
        self.assertIn('Only 1 pack', out[0][2])
        self.assertEqual([], self.run_guard())

    def test_two_ready_is_enough(self):
        self.assertEqual([], self.run_guard())

    def test_a_pack_olivia_started_does_not_count(self):
        self.card('Edit HGP first video: One')
        self.assertEqual(2, len(self.run_guard()))

    def test_todo_card_still_counts_as_ready(self):
        self.card('Edit HGP first video: One', 'todo')
        self.assertEqual([], self.run_guard())

    def test_another_owners_card_does_not_use_up_a_pack(self):
        self.card('30-second ebook ad - One', 'done', 'home-guide-press')
        self.assertEqual([], self.run_guard())

    def test_a_longer_word_is_not_the_pack(self):
        self.card('Edit Twofold', 'done')
        self.assertEqual([], self.run_guard())

    def test_folders_that_are_not_packs_are_skipped(self):
        self.pack('topview-v2')
        self.card('Edit One', 'done')
        self.assertEqual(2, len(self.run_guard()))

    def test_recovering_clears_it_so_the_next_shortage_alerts(self):
        self.pass_codes['hgp-two'] = 1
        self.assertEqual(2, len(self.run_guard()))
        self.pass_codes['hgp-two'] = 0
        self.t += tg.PACKS_RECHECK_S
        self.assertEqual([], self.run_guard())
        self.pass_codes['hgp-two'] = 1
        self.t += tg.PACKS_RECHECK_S
        self.assertEqual(2, len(self.run_guard()))

    def test_a_known_shortage_rechecks_hourly_not_every_run(self):
        self.pass_codes['hgp-two'] = 1
        self.assertEqual(2, len(self.run_guard()))
        with mock.patch.object(tg, 'preflight') as preflight:
            self.assertEqual([], self.run_guard())
            preflight.assert_not_called()
            self.t += tg.PACKS_RECHECK_S
            preflight.return_value = 1
            self.assertEqual([], self.run_guard())
            preflight.assert_called()

    def test_a_pack_that_cannot_be_checked_reports_instead_of_guessing(self):
        self.pass_codes.update({'hgp-one': 2, 'hgp-two': None})
        out = self.run_guard()
        self.assertEqual([('fire', 'script_failure')], [s[:2] for s in out])
        self.assertEqual([], self.run_guard())


class Limits(Base):
    def alerts(self, out):
        return [t for s in out if s[1] == 'bot_stuck' for t in s[2]['alerts']]

    def test_idle_bot_on_a_capped_account_is_flagged_once(self):
        self.transcript('team', 'agent-x', self.refused())
        self.assertEqual(['Lucy', 'Ana'], [t.split()[0] for t in self.alerts(self.run_guard()) if 'held' in t])
        self.assertEqual([], self.run_guard())

    def test_a_bot_on_backup_with_a_capped_main_account_is_flagged(self):
        self.agent('agent-o', 'Olivia', usageLimitReturn={'provider': 'claude'})
        self.transcript(tg.DEFAULT_ACCOUNT, 'agent-x', self.refused())
        self.assertEqual(['Olivia is on a backup account'],
                         [t.split(':')[0] for t in self.alerts(self.run_guard())])

    def test_a_bot_with_no_account_uses_the_default_sign_in(self):
        self.db.execute("insert into projection_agents values ('agent-e', ?)", (json.dumps({'name': 'Emma'}),))
        self.transcript(tg.DEFAULT_ACCOUNT, 'agent-x', self.refused())
        self.assertEqual(['Emma'], [t.split()[0] for t in self.alerts(self.run_guard())])

    def test_ana_on_a_capped_account_also_goes_to_jon(self):
        self.transcript('team', 'agent-x', self.refused())
        out = self.run_guard()
        self.assertEqual(1, len([s for s in out if s[0] == 'ask']))
        self.assertIn('Ana', [s for s in out if s[0] == 'ask'][0][1])

    def test_ana_with_only_her_main_account_capped_does_not_ask_jon(self):
        self.db.execute('delete from projection_agents where agent_id = ?', (tg.ANA,))
        self.agent(tg.ANA, 'Ana', usageLimitReturn={'provider': 'claude'})
        self.transcript(tg.DEFAULT_ACCOUNT, 'agent-x', self.refused())
        self.assertEqual(['fire'], [s[0] for s in self.run_guard()])

    def test_a_bot_quoting_the_phrase_does_not_count(self):
        self.transcript('team', 'agent-x', {'type': 'assistant', 'timestamp': ago(1),
                                            'message': {'content': "isApiErrorMessage: You've hit your limit"}})
        self.assertEqual([], self.run_guard())

    def test_an_old_refusal_past_its_reset_does_not_count(self):
        self.transcript('team', 'agent-x', self.refused(hours=-1))
        self.assertEqual([], self.run_guard())

    def test_five_hour_limit_with_no_reset_uses_the_time(self):
        self.transcript('team', 'agent-x', {'isApiErrorMessage': True, 'timestamp': ago(1), 'message': {
            'content': [{'type': 'text', 'text': "You've hit your 5-hour limit"}]}})
        self.assertEqual(2, len(self.alerts(self.run_guard())))

    def test_cap_ends_at_reset_and_a_new_one_alerts_again(self):
        self.db.execute('delete from projection_agents where agent_id = ?', (tg.ANA,))
        self.transcript('team', 'agent-x', self.refused(hours=1))
        self.assertEqual(1, len(self.alerts(self.run_guard())))
        self.t = T0 + 2 * 3600
        self.assertEqual([], self.run_guard())
        self.assertEqual({}, tg.load()['holds'])
        line = dict(self.refused(), quotaLimits={'resetsAt': int(self.t + 3600)})
        self.transcript('team', 'agent-x', line, 'b.jsonl')
        self.assertEqual(1, len(self.alerts(self.run_guard())))


class Failures(Base):
    def test_crashed_check_reports_once_and_the_others_run(self):
        self.proof()
        with mock.patch.object(tg, 'CHECKS', [('turns', mock.Mock(side_effect=ValueError('boom'))),
                                              ('qc', tg.check_qc)]):
            out = self.run_guard()
            self.assertEqual(['fire', 'wake'], [s[0] for s in out])
            self.assertEqual('script_failure', out[0][1])
            self.assertIn('boom', out[0][2]['error'])
            self.assertEqual([], self.run_guard())

    def test_a_crashed_check_keeps_its_open_incidents(self):
        self.turn(LUCY, 'u1', 40, last=31)
        self.assertEqual(1, len(self.run_guard()))
        with mock.patch.object(tg, 'CHECKS', [('turns', mock.Mock(side_effect=ValueError('boom')))]):
            self.run_guard()
        self.assertEqual([], self.run_guard())

    def test_a_refused_alert_stays_unmarked_and_retries(self):
        self.turn(LUCY, 'u1', 40, last=31)
        self.status = 503
        self.assertEqual([], self.run_guard())
        self.status = 202
        self.assertEqual(1, len(self.run_guard()))
        self.assertEqual([], self.run_guard())

    def test_a_failed_wake_retries(self):
        self.proof()
        with mock.patch.dict(sys.modules, {'openbot_api': types.SimpleNamespace(
                send=mock.Mock(side_effect=RuntimeError('http 500')))}):
            self.assertEqual([], self.run_guard())
        self.assertEqual(1, len(self.run_guard()))

    def test_three_failed_runs_ask_jon_once(self):
        self.turn(LUCY, 'u1', 40, last=31)
        self.status = 503
        outs = [self.run_guard() for _ in range(5)]
        self.assertEqual([[], [], ['ask'], [], []], [[s[0] for s in o] for o in outs])

    def test_dry_run_sends_nothing_and_saves_nothing(self):
        self.turn(LUCY, 'u1', 40, last=31)
        self.turn(tg.ANA, 'a1', 60, last=46)
        self.proof()
        self.pass_codes['hgp-two'] = 1
        self.transcript('team', 'agent-x', self.refused())
        with mock.patch('builtins.print'):
            tg.run(dry=True)
        self.assertEqual([], self.sent)
        self.assertFalse(tg.STATE.exists())

    def test_a_crash_outside_the_checks_is_reported(self):
        with mock.patch.object(tg, 'run', side_effect=ValueError('boom')):
            self.assertEqual(1, tg.main([]))
        self.assertEqual('script_failure', self.sent[0][1])


class RealFunctions(unittest.TestCase):
    """The two functions that touch the real machine, with psutil stubbed. Nothing is killed."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def proc(self, name, args=()):
        p = mock.Mock(info={'name': name})
        p.cmdline.return_value = ['OpenBot.exe', *args]
        return p

    def psutil(self, procs):
        return mock.patch.dict(sys.modules, {'psutil': types.SimpleNamespace(
            process_iter=lambda attrs: procs, wait_procs=mock.Mock(), Error=OSError)})

    def test_a_held_render_lock_counts_and_a_free_one_does_not(self):
        lock = self.root / 'cpu-render-0.lock'
        lock.write_text('')
        with mock.patch.object(tg, 'GPUQ', self.root), self.psutil([]):
            self.assertFalse(tg.render_running())
            with open(lock, 'a+') as held:
                held.seek(0)
                msvcrt.locking(held.fileno(), msvcrt.LK_NBLCK, 1)
                self.assertTrue(tg.render_running())
                held.seek(0)
                msvcrt.locking(held.fileno(), msvcrt.LK_UNLCK, 1)
            self.assertFalse(tg.render_running())

    def test_a_headless_browser_counts_as_a_render(self):
        with mock.patch.object(tg, 'GPUQ', self.root), self.psutil([self.proc('chrome-headless-shell.exe')]):
            self.assertTrue(tg.render_running())

    def test_restart_kills_only_the_main_process(self):
        main, child = self.proc('OpenBot.exe', ['--updated']), self.proc('OpenBot.exe', ['--type=renderer'])
        other = self.proc('python.exe')
        with self.psutil([child, main, other]), mock.patch.object(tg.subprocess, 'Popen') as popen:
            tg.restart_openbot()
        main.kill.assert_called_once_with()
        child.kill.assert_not_called()
        other.kill.assert_not_called()
        popen.assert_called_once()

    def test_restart_refuses_unless_exactly_one_main_process(self):
        a, b = self.proc('OpenBot.exe'), self.proc('OpenBot.exe')
        with self.psutil([a, b]), mock.patch.object(tg.subprocess, 'Popen') as popen:
            with self.assertRaises(RuntimeError):
                tg.restart_openbot()
        a.kill.assert_not_called()
        b.kill.assert_not_called()
        popen.assert_not_called()


class EachTriggerOnce(Base):
    def test_every_trigger_fires_once_across_two_runs(self):
        self.turn(LUCY, 'u1', 40, last=31)
        self.agent('agent-b', 'Blake')
        self.turn('agent-b', 'u2', 121, last=1)
        self.queue('agent-b')
        self.proof()
        self.pass_codes['hgp-two'] = 1
        self.turn(tg.ANA, 'a1', 60, last=46)
        self.db.execute('delete from projection_agents where agent_id = ?', (tg.ANA,))
        self.agent('agent-c', 'Casey')
        self.db.execute("update projection_agents set agent_json = ? where agent_id = 'agent-c'",
                        (json.dumps({'name': 'Casey', 'providerAccountId': 'capped'}),))
        self.transcript('capped', 'agent-x', self.refused())

        def count(out):
            alerts = [t for s in out if s[0] == 'fire' for t in s[2]['alerts']]
            wakes = [s[1] for s in out if s[0] == 'wake']
            return {'Bot quiet 30 minutes': sum('Lucy quiet' in t for t in alerts),
                    'Queue behind a 2 hour turn': sum('queued behind' in t for t in alerts),
                    'Video proof waiting 30 minutes': wakes.count(tg.NINA),
                    'Under 2 packs: Elle': wakes.count(tg.ELLE),
                    'Under 2 packs: Scarlett': wakes.count(tg.SCARLETT),
                    'Ana quiet 45 minutes: restart': sum(s[0] == 'restart' for s in out),
                    'Bot held by a usage limit': sum('held by a usage limit' in t for t in alerts)}

        first, second = count(self.run_guard()), count(self.run_guard())
        print('\n%-34s %5s %5s' % ('Trigger', 'run 1', 'run 2'))
        for name in first:
            print('%-34s %5d %5d' % (name, first[name], second[name]))
        self.assertEqual({1}, set(first.values()))
        self.assertEqual({0}, set(second.values()))


if __name__ == '__main__':
    unittest.main(verbosity=1)
