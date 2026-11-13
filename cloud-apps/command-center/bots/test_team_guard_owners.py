r"""Tests for the Home Guide Press step owners in team_guard.py (Jon, 2026-11-08): Sydney gets a-roll wakes, Scarlett alone gets
pack, clip and GPU wakes, channels outside focus-channels.txt are parked. Needs pipeline.py from D:\AgentTeam\tools.
Run: python test_team_guard_owners.py"""
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

# the repo's team_guard.py comes first; pipeline.py lives only in the tools folder, so that goes last
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.append(r'D:\AgentTeam\tools')
import team_guard as g  # noqa: E402  (first: pipeline.py puts the tools folder ahead on sys.path, which would load the live copy)
import pipeline  # noqa: E402

NOW = time.time()
S, V, E, O = 'agent-sydney', g.SCARLETT, g.ELLE, 'agent-olivia'  # Sydney, Scarlett, Elle, Olivia
BOTS = {'jon-mac-youtube': [S], 'viral-view': [V], 'home-guide-press': [E], 'video-editor': [O]}


def card(cid, owner='jon-mac-youtube', status='todo', title=None, note='', project='home-guide-press'):
    return {'id': cid, 'owner': owner, 'status': status, 'title': title or 'Video %s - Naomi Takeda Japan' % cid, 'note': note,
            'project': project}


def at(cid, stage, age_h=5, **kw):
    return (stage, NOW - age_h * 3600, card(cid, **kw))


class Base(unittest.TestCase):
    def setUp(self):
        self.state = {'seen': {}}
        self.free = {S, V, E, O}
        for target, val in [('bots', lambda: BOTS), ('free_bots', lambda now, state: set(self.free))]:
            p = mock.patch.object(g, target, val)
            p.start()
            self.addCleanup(p.stop)

    def cards(self, cards):
        p = mock.patch.object(g, 'pipeline_cards', lambda now: cards)
        p.start()
        self.addCleanup(p.stop)


class ARoll(Base):
    def test_any_passed_script_wakes_sydney_even_with_many_arolls(self):
        self.cards([at('a', g.SCRIPT_PASSED)] + [at('r%d' % i, g.AROLL_DONE) for i in range(5)])  # 5 a-rolls: the old rule stayed quiet
        found = g.check_aroll(NOW, self.state)
        self.assertEqual([(k, v[0]) for k, v in found.items()], [('aroll:%s:a' % S, S)])
        self.assertIn('1 passed scripts have no a-roll', found['aroll:%s:a' % S][1])
        self.assertIn('card a', found['aroll:%s:a' % S][1])

    def test_whoever_holds_the_card_the_wake_goes_to_sydney(self):
        for owner in ('home-guide-press', 'viral-view', 'qc', 'jon-mac-youtube'):
            with self.subTest(owner=owner):
                self.cards([at('a', g.SCRIPT_PASSED, owner=owner, status='review' if owner == 'qc' else 'todo')])
                found = g.check_aroll(NOW, {'seen': {}})
                self.assertEqual([v[0] for v in found.values()], [S])

    def test_oldest_first(self):
        self.cards([at('new', g.SCRIPT_PASSED, 2), at('old', g.SCRIPT_PASSED, 9), at('mid', g.SCRIPT_PASSED, 4)])
        self.assertEqual(list(g.check_aroll(NOW, self.state)), ['aroll:%s:old' % S])

    def test_only_passed_scripts_count(self):
        self.cards([at('a', g.SCRIPT_WRITTEN), at('b', g.AROLL_DONE), at('c', g.PREFLIGHT_PASSED)])
        self.assertEqual(g.check_aroll(NOW, self.state), {})

    def test_busy_sydney_or_a_wake_in_the_last_30_minutes_waits(self):
        self.cards([at('a', g.SCRIPT_PASSED)])
        self.free.discard(S)
        self.assertEqual(g.check_aroll(NOW, self.state), {})
        self.free.add(S)
        self.state['seen']['buffer:%s:x' % S] = g.iso(NOW - 600)  # another check woke her 10 minutes ago
        self.assertEqual(g.check_aroll(NOW, self.state), {})

    def test_no_repeat_for_the_same_card_within_30_minutes_then_again(self):
        self.cards([at('a', g.SCRIPT_PASSED), at('b', g.SCRIPT_PASSED, 4)])
        key = 'aroll:%s:a' % S
        self.state['seen'][key] = g.iso(NOW - 600)
        self.assertEqual(g.check_aroll(NOW, self.state), {key: None})  # already sent: marked, nothing new, and no second wake for b
        self.state['seen'][key] = g.iso(NOW - 1900)
        self.assertEqual(list(g.check_aroll(NOW, self.state)), [key])

    def test_a_card_named_lately_goes_behind_the_ones_never_named(self):
        self.cards([at('old', g.SCRIPT_PASSED, 9), at('mid', g.SCRIPT_PASSED, 5), at('new', g.SCRIPT_PASSED, 2)])
        picked = []
        for step in range(4):  # a wake every 31 minutes: each card is named once before the oldest comes round again
            now = NOW + step * 1860
            self.state['seen'] = {}
            picked.append(next(iter(g.check_aroll(now, self.state))).split(':')[2])
        self.assertEqual(picked, ['old', 'mid', 'new', 'old'])

    def test_rotation_forgets_cards_that_got_their_aroll(self):
        self.cards([at('old', g.SCRIPT_PASSED, 9), at('mid', g.SCRIPT_PASSED, 5)])
        g.check_aroll(NOW, self.state)
        self.assertEqual(set(self.state['aroll_woke']), {'old'})
        self.cards([at('mid', g.SCRIPT_PASSED, 5)])
        self.state['seen'] = {}
        g.check_aroll(NOW + 1860, self.state)
        self.assertEqual(set(self.state['aroll_woke']), {'mid'})

    def test_a_card_waiting_external_is_skipped(self):
        self.cards([at('a', g.SCRIPT_PASSED, note='Waiting external'), at('b', g.SCRIPT_PASSED, 3)])
        self.assertEqual(list(g.check_aroll(NOW, self.state)), ['aroll:%s:b' % S])


class PackWakes(Base):
    def test_pack_buffer_wakes_scarlett_for_a_card_elle_still_holds(self):
        self.cards([at('a', g.AROLL_DONE, owner='home-guide-press', status='todo')])
        with mock.patch.object(g, 'topic_cards', lambda now: []), mock.patch.object(g, 'pack_order', lambda: []):
            found = g.check_buffers(NOW, self.state)
        self.assertEqual([(k, v[0]) for k, v in found.items()], [('buffer:%s:a' % V, V)])

    def test_pack_buffer_never_wakes_elle_when_scarlett_is_busy(self):
        self.cards([at('a', g.AROLL_DONE, owner='home-guide-press')])
        self.free.discard(V)
        with mock.patch.object(g, 'topic_cards', lambda now: []), mock.patch.object(g, 'pack_order', lambda: []):
            self.assertEqual(g.check_buffers(NOW, self.state), {})

    def test_a_card_sydney_or_the_editor_holds_is_not_a_pack_to_build(self):
        self.cards([at('a', g.AROLL_DONE, owner='video-editor'), at('b', g.AROLL_DONE, owner='qc')])
        with mock.patch.object(g, 'pack_order', lambda: []):
            self.assertEqual(g.packs_needing_clips(g.pipeline_cards(NOW), NOW), [])

    def test_script_buffer_still_wakes_sydney(self):
        self.cards([at('p', g.SCRIPT_PASSED)])
        with mock.patch.object(g, 'topic_cards', lambda now: [card('t1', status='todo')]), mock.patch.object(g, 'pack_order', lambda: []):
            found = g.check_buffers(NOW, self.state)
        self.assertIn('buffer:%s:t1' % S, found)

    def test_gpu_gap_wakes_scarlett(self):
        self.cards([at('a', g.AROLL_DONE, owner='home-guide-press')])
        with mock.patch.object(g, 'gpu1_idle_min', lambda now: 30), mock.patch.object(g, 'pack_order', lambda: []):
            found = g.check_gpu(NOW, self.state)
        self.assertEqual([v[0] for v in found.values()], [V])

    def test_gpu_queue_wakes_scarlett_only(self):
        with mock.patch.object(g, 'gpu_queue', lambda name: (1, True, 0)):
            found = g.check_gpuq(NOW, self.state)
            self.assertEqual({v[0] for v in found.values()}, {V})
            self.free.discard(V)
            self.assertEqual(g.check_gpuq(NOW, {'seen': {}}), {})  # Elle is free and gets nothing

    def test_low_packs_alert_goes_to_scarlett_only(self):
        found = g.pack_alerts({'packs_short': 'Only 0 pack(s) pass preflight'})
        self.assertEqual([v[0] for v in found.values()], [V])


class Next(Base):
    def run_next(self, cards):
        self.cards(cards)
        return {k: v for k, v in g.check_next(NOW, self.state).items() if v}

    def test_a_failed_script_goes_to_sydney_whoever_holds_the_card(self):
        for owner in ('home-guide-press', 'viral-view', 'jon-mac-youtube'):
            with self.subTest(owner=owner):
                self.state = {'seen': {}}
                found = self.run_next([at('a', g.SCRIPT_WRITTEN, 3, owner=owner)])
                self.assertEqual([v[0] for v in found.values()], [S])

    def test_an_aroll_with_no_clips_goes_to_scarlett_whoever_holds_the_card(self):
        for owner in ('home-guide-press', 'viral-view', 'jon-mac-youtube'):
            with self.subTest(owner=owner):
                self.state = {'seen': {}}
                found = self.run_next([at('a', g.AROLL_DONE, 3, owner=owner)])
                self.assertEqual([v[0] for v in found.values()], [V])

    def test_other_owners_and_doing_cards_are_left_alone(self):
        self.assertEqual(self.run_next([at('a', g.AROLL_DONE, 3, owner='video-editor'), at('b', g.SCRIPT_WRITTEN, 3, status='doing')]), {})


class Failed(Base):
    def test_slug_routing(self):
        t = lambda owner, project='home-guide-press': {'owner': owner, 'project': project, 'title': 'X - Naomi Takeda Japan'}
        p = lambda link: {'link': link}
        cases = [(t('home-guide-press'), r'D:\HGP-work\packs\naomi-5\script.md', 'jon-mac-youtube'),
                 (t('viral-view'), 'D:/HGP-work/packs/naomi-5/aroll/x.mp4', 'jon-mac-youtube'),
                 (t('home-guide-press'), 'https://app.heygen.com/videos/abc', 'jon-mac-youtube'),
                 (t('home-guide-press'), r'D:\HGP-work\packs\naomi-5\preflight-result.txt', 'viral-view'),
                 (t('jon-mac-youtube'), 'C:/Users/jonst/aieditor/edits/hgp-naomi-5/omni/jobs.json', 'viral-view'),
                 (t('home-guide-press'), r'D:\HGP-work\upload\thumb.png', 'home-guide-press'),  # Elle's own thumbnail
                 (t('viral-view', 'jonmacai'), r'D:\HGP-work\packs\x\preflight.txt', 'viral-view'),
                 (t('jon-mac-youtube', 'jonmacai'), r'D:\HGP-work\packs\x\script.md', 'jon-mac-youtube'),
                 (t('developer'), r'D:\HGP-work\packs\x\script.md', 'developer')]
        for task, link, want in cases:
            with self.subTest(link=link, owner=task['owner']):
                self.assertEqual(g.failed_slug(task, p(link)), want)

    def run_failed(self, task, link, free=None):
        proof = {'id': 'p1', 'taskId': 'T', 'status': 'failed', 'checkedAt': g.iso(NOW - 600), 'checkNote': 'bad', 'link': link}
        reply = lambda *a: {'proofs': [proof]} if a[0] == 'proofs' else {'task': task}
        with mock.patch.object(g, 'dash', side_effect=reply), mock.patch.object(g, 'pipeline_parked', lambda: {'naomi-takeda-japan', 'jack-mercer'}):
            return g.check_failed(NOW, self.state)

    def test_failed_pack_proof_wakes_scarlett_even_on_elles_card(self):
        task = dict(card('T', 'home-guide-press', 'doing'), project='home-guide-press')
        found = self.run_failed(task, r'D:\HGP-work\packs\naomi-5\preflight-result.txt')
        self.assertEqual([v[0] for v in found.values()], [V])

    def test_failed_script_wakes_sydney(self):
        task = card('T', 'viral-view', 'doing')
        found = self.run_failed(task, r'D:\HGP-work\packs\naomi-5\script.md')
        self.assertEqual([v[0] for v in found.values()], [S])

    def test_parked_channel_gets_no_failed_wake(self):
        task = card('T', 'jon-mac-youtube', 'doing', title='A video - Frank Bennett Dogs')
        self.assertEqual(self.run_failed(task, r'D:\HGP-work\packs\frank-5\script.md'), {})


class Parking(Base):
    def test_parked_card_is_home_guide_press_only(self):
        focus = {'naomi-takeda-japan'}
        self.assertTrue(g.parked_card(card('a', title='X - Frank Bennett Dogs'), focus))
        self.assertFalse(g.parked_card(card('a', title='X - Naomi Takeda'), focus))  # a short host form of a listed channel
        for project, title in (('short-form', 'X - Short-form'), ('jon-mac', 'X - Jon Mac'), ('sponsors', 'X - Acme Corp'), ('coding', 'Fix X - Y')):
            self.assertFalse(g.parked_card(card('a', title=title, project=project), focus), project)

    def test_failed_proof_on_a_non_affiliate_card_still_wakes_its_owner(self):
        task = card('T', 'jon-mac-youtube', 'doing', title='A short - Short-form', project='short-form')
        proof = {'id': 'p1', 'taskId': 'T', 'status': 'failed', 'checkedAt': g.iso(NOW - 600), 'checkNote': 'bad', 'link': 'https://x/y'}
        reply = lambda *a: {'proofs': [proof]} if a[0] == 'proofs' else {'task': task}
        with mock.patch.object(g, 'dash', side_effect=reply), mock.patch.object(g, 'pipeline_parked', lambda: {'naomi-takeda-japan'}):
            found = g.check_failed(NOW, self.state)
        self.assertEqual([v[0] for v in found.values()], [S])

    def test_hgp_script_qc_note_is_sydneys(self):
        task = {'owner': 'home-guide-press', 'project': 'home-guide-press', 'title': 'X - Naomi Takeda Japan'}
        self.assertEqual(g.failed_slug(task, {'link': r'D:\HGP-work\hgp-scripts\x\qc3.txt'}), 'jon-mac-youtube')

    def test_a_work_card_that_is_not_a_video_is_not_parked_and_not_rerouted(self):
        focus = {'naomi-takeda-japan'}
        for owner, title in (('developer', 'Landing page QC - Home Guide Press'), ('ana', 'Rules proposal - Home Guide Press'),
                             ('home-guide-press', 'Ebook ad and QR for Claudine Marchand - Home Guide Press'),
                             ('home-guide-press', 'Checkout: all 13 affiliate channels'), ('developer', 'Clipmaker: X - Eleanor Christmas pack')):
            with self.subTest(title=title):
                self.assertFalse(g.parked_card(card('a', owner, title=title), focus))
        task = {'owner': 'home-guide-press', 'project': 'home-guide-press', 'title': 'Ebook ad and QR for Claudine - Home Guide Press'}
        self.assertEqual(g.failed_slug(task, {'link': r'D:\HGP-work\packs\claudine\ad\ad.mp4'}), 'home-guide-press')  # Elle's own card
        # a parked video held by a pipeline bot is parked; the same title held by Lucy is not
        self.assertTrue(g.parked_card(card('a', 'viral-view', title='X - Frank Bennett Dogs'), focus))
        self.assertFalse(g.parked_card(card('a', 'developer', title='X - Frank Bennett Dogs'), focus))

    def test_idle_nudge_never_picks_a_parked_card(self):
        doing = [dict(card('park', 'viral-view', 'doing', title='X - Frank Bennett Dogs'), updatedAt='2026-11-08T10:00:00Z', createdAt='x'),
                 dict(card('keep', 'viral-view', 'doing', title='X - Naomi Takeda'), updatedAt='2026-11-08T09:00:00Z', createdAt='x')]
        reply = lambda *a: {'tasks': doing if a[2] == 'doing' else []}
        con = mock.MagicMock()
        con.execute.return_value = []
        with mock.patch.object(g, 'dash', side_effect=reply), mock.patch.object(g, 'pipeline_parked', lambda: {'naomi-takeda-japan'}), \
                mock.patch.object(g, 'db', lambda: mock.MagicMock(execute=lambda *a, **k: [])), \
                mock.patch.object(g, 'open_turns', lambda con, now: []), mock.patch.object(g, 'agents', lambda con: {V: {}}):
            found = g.check_idle(NOW, self.state)
        texts = [v[1] for v in found.values() if v]
        self.assertEqual(texts, ['continue X - Naomi Takeda'])


class Balancer(Base):
    def balance(self, owner, n_doing=5):
        doing = [dict(card('c%d' % i, owner, 'doing', title='V%d - Naomi Takeda Japan' % i), createdAt='2026-11-0%dT00:00:00Z' % (i + 1),
                      updatedAt=g.iso(NOW - 60)) for i in range(n_doing)]
        moves = []
        reply = lambda *a: {'tasks': doing if a[2] == 'doing' else []} if a[0] == 'tasks' else moves.append(a) or {}
        team = {a: {} for a in (S, V, E, O)}
        db = mock.MagicMock()
        db.execute.return_value = []
        with mock.patch.object(g, 'dash', side_effect=reply), mock.patch.object(g, 'pipeline_parked', lambda: None), \
                mock.patch.object(g, 'db', lambda: mock.MagicMock(__enter__=lambda s: db, __exit__=lambda *a: None, close=lambda: None, execute=lambda *a, **k: [])), \
                mock.patch.object(g, 'agents', lambda con: team):
            found = g.check_balance(NOW, self.state)
        return found, [m for m in moves if m[0] == 'task-update']

    def test_overloaded_scarlett_has_no_backup_so_ana_is_told_and_nothing_moves(self):
        found, moves = self.balance('viral-view')
        self.assertEqual(moves, [])
        self.assertEqual(list(found), ['balance:viral-view:none'])
        self.assertEqual(found['balance:viral-view:none'][0], g.URGENT)

    def test_overloaded_sydney_keeps_her_cards(self):
        found, moves = self.balance('jon-mac-youtube')
        self.assertEqual(moves, [])
        self.assertEqual(list(found), ['balance:jon-mac-youtube:none'])

    def test_backups_table(self):
        self.assertEqual(g.BACKUPS['viral-view'], ())
        self.assertEqual(g.BACKUPS['jon-mac-youtube'], ())
        self.assertNotIn('home-guide-press', g.BACKUPS['viral-view'])


class PipelineCards(unittest.TestCase):
    def test_parked_channels_are_dropped_from_cards_and_topics(self):
        cards = [card('keep', title='Keep - Naomi Takeda Japan'), card('park', title='Park - Frank Bennett Dogs'),
                 card('topic-keep', title='T1 - Ruth Calder', status='todo'), card('topic-park', title='T2 - Walter Brandt Dogs', status='todo')]
        by_title = {'keep': (2, 1.0), 'park': (2, 2.0)}
        g._pipe.clear()
        with mock.patch.object(pipeline, 'load', lambda live: cards), mock.patch.object(pipeline, 'live_titles', lambda: set()), \
                mock.patch.object(pipeline, 'classify', lambda c: by_title.get(c['id'])), \
                mock.patch.object(g, 'pipeline_parked', lambda: {'naomi-takeda-japan', 'ruth-calder'}):
            out = g.pipeline_cards(123.0)
            topics = g.topic_cards(123.0)
        g._pipe.clear()
        self.assertEqual([c[2]['id'] for c in out], ['keep'])
        self.assertEqual([c['id'] for c in topics], ['topic-keep'])


class FocusFile(unittest.TestCase):
    def test_reads_the_focus_file_and_parks_the_rest(self):
        with mock.patch.object(pipeline, 'focus_channels', lambda: {'ruth-calder'}):
            focus = g.pipeline_parked()
        self.assertEqual(focus, {'ruth-calder'})
        self.assertFalse(g.host_parked('X - Ruth Calder', focus))
        self.assertTrue(g.host_parked('X - Frank Bennett Dogs', focus))

    def test_an_unreadable_or_empty_file_parks_nothing(self):
        for err in (OSError('gone'), ValueError('empty')):
            with mock.patch.object(pipeline, 'focus_channels', side_effect=err):
                focus = g.pipeline_parked()
            self.assertIsNone(focus)
            self.assertFalse(g.host_parked('X - Frank Bennett Dogs', focus))


if __name__ == '__main__':
    unittest.main()
