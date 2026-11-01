"""python -I bots/test_hook.py  (stdlib only; the footage test runs watch_footage.ps1 for ~10 s)"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dash  # noqa: E402
import hook  # noqa: E402

CTX = {'bot': 'developer'}


class Receiver(BaseHTTPRequestHandler):
    """Checks requests the way the OpenBot webhook does: 202 new, 200 repeat, 401 bad signature."""
    def do_POST(self):
        srv, route = self.server, self.path.strip('/')
        body = self.rfile.read(int(self.headers['Content-Length']))
        ts, delivery = self.headers['x-openbot-timestamp'], self.headers['x-openbot-delivery-id']
        want = 'sha256=' + hmac.new(srv.secrets[route].encode(), ('%s.%s.' % (ts, delivery)).encode() + body,
                                    hashlib.sha256).hexdigest()
        if srv.busy.get(route):
            srv.busy[route] -= 1
            code = 503
        elif not hmac.compare_digest(want, self.headers['x-openbot-signature'] or '') or abs(time.time() - int(ts)) > 300:
            code = 401
        elif (route, delivery) in srv.seen:
            code = 200
        else:
            srv.seen.add((route, delivery))
            srv.events.append((route, json.loads(body)))
            code = 202
        self.send_response(code)
        self.end_headers()

    def log_message(self, *args):
        pass


class Hooks(unittest.TestCase):
    def setUp(self):
        self.srv = ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
        self.srv.secrets = {r: 'secret-' + r for r in hook.ROUTES}
        self.srv.busy, self.srv.seen, self.srv.events = {}, set(), []
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.dir = tempfile.TemporaryDirectory()
        self.secrets = Path(self.dir.name) / 'webhooks.json'
        self.write_secrets(self.srv.secrets)
        self.owner = 'developer'
        patches = [mock.patch.object(hook, 'SECRETS', self.secrets), mock.patch.object(hook.time, 'sleep'),
                   mock.patch.object(dash, 'WAKE_DIR', Path(self.dir.name) / 'wakes'),
                   mock.patch.object(dash, 'call', lambda *a, **k: {'task': {'owner': self.owner}})]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        self.srv.shutdown()
        self.dir.cleanup()

    def write_secrets(self, secrets):
        url = 'http://127.0.0.1:%d/' % self.srv.server_address[1]
        self.secrets.write_text(json.dumps({r: {'url': url + r, 'secret': s} for r, s in secrets.items()}))

    def test_event_wakes_each_of_its_routines_signed(self):
        self.assertEqual(hook.fire('script_failure', {'script': 'x', 'error': 'boom'}),
                         {'developer': 202, 'ana': 202})
        self.assertEqual([(r, e['type'], e['data']['error']) for r, e in self.srv.events],
                         [('developer', 'script_failure', 'boom'), ('ana', 'script_failure', 'boom')])
        self.assertTrue(self.srv.events[0][1]['occurredAt'].endswith('+00:00'))

    def test_same_key_is_delivered_once(self):
        self.assertEqual(hook.fire('raw_footage', {}, key='drop-1'), {'video-editor': 202})
        self.assertEqual(hook.fire('raw_footage', {}, key='drop-1'), {'video-editor': 200})
        self.assertEqual(hook.fire('raw_footage', {}, key='drop-2'), {'video-editor': 202})

    def test_503_is_retried(self):
        self.srv.busy['qc'] = 2
        self.assertEqual(hook.fire('proof_posted', {}), {'qc': 202})

    def test_exit_codes(self):
        with mock.patch('sys.stdout'), mock.patch('sys.stderr'):
            self.assertEqual(hook.main(['test']), 0)
            self.assertEqual(len(self.srv.events), 8)
            self.write_secrets({'qc': 'wrong'})
            self.assertEqual(hook.main(['fire', 'proof_posted']), 1)  # 401
            self.assertEqual(hook.main(['fire', 'raw_footage']), 2)  # no secret for video-editor
            self.assertEqual(hook.main(['fire', 'proof_posted', '--data', '{bad']), 2)
            self.secrets.unlink()
            self.assertEqual(hook.main(['test', 'qc']), 2)

    def proof(self, pid, **out):
        dash.wake_qc(dict({'ok': True, 'proof': {'id': pid, 'kind': 'url', 'link': 'https://x'}}, **out), 't_1', CTX)

    def woken(self):
        return [(r, e['data']['proof']) for r, e in self.srv.events]

    def test_proof_wakes_the_right_qc_bot(self):
        self.owner = 'video-editor'
        self.proof('p_1')
        self.owner = 'developer'
        self.proof('p_2')
        self.assertEqual(self.woken(), [('qc', 'p_1'), ('nina', 'p_2')])
        self.assertEqual(self.srv.events[0][1]['data']['task'], 't_1')
        self.assertNotIn('forOwner', self.srv.events[1][1]['data'])

    def test_without_a_nina_route_her_proofs_go_to_ana_marked_for_nina(self):
        self.write_secrets({'qc': 'secret-qc', 'ana': 'secret-ana'})
        self.proof('p_1')
        self.assertEqual(self.woken(), [('ana', 'p_1')])
        self.assertEqual(self.srv.events[0][1]['data']['forOwner'], 'nina')
        self.assertEqual(sorted(p.name for p in dash.WAKE_DIR.iterdir()), ['nina'])

    def test_a_nina_route_with_no_secret_is_not_used(self):
        self.write_secrets({'nina': '', 'qc': 'secret-qc', 'ana': 'secret-ana'})
        self.proof('p_1')
        self.assertEqual(self.woken(), [('ana', 'p_1')])

    def test_without_a_nina_route_videos_still_go_to_jessica(self):
        self.write_secrets({'qc': 'secret-qc', 'ana': 'secret-ana'})
        self.owner = 'video-editor'
        self.proof('p_1')
        self.assertEqual(self.woken(), [('qc', 'p_1')])
        self.assertNotIn('forOwner', self.srv.events[0][1]['data'])

    def test_a_ping_through_ana_collapses_until_nina_reads(self):
        self.write_secrets({'qc': 'secret-qc', 'ana': 'secret-ana'})
        for n in range(20):
            self.proof('p_%d' % n)
        self.assertEqual(self.woken(), [('ana', 'p_0')])
        with mock.patch('os.getcwd', return_value=r'C:\\Agents\\' + dash.NINA_WORKSPACE):
            dash.wake_read()
        self.proof('p_20')
        self.assertEqual(self.woken(), [('ana', 'p_0'), ('ana', 'p_20')])

    def test_a_failed_ping_through_ana_warns_and_the_next_proof_tries_again(self):
        self.write_secrets({'qc': 'secret-qc', 'ana': 'wrong'})
        with mock.patch('sys.stderr') as err:
            self.proof('p_1')
        self.assertIn('QC was not woken', ''.join(c.args[0] for c in err.write.call_args_list))
        self.assertFalse((dash.WAKE_DIR / 'nina').exists())
        self.write_secrets({'qc': 'secret-qc', 'ana': 'secret-ana'})
        self.proof('p_2')
        self.assertEqual(self.woken(), [('ana', 'p_2')])

    def test_duplicate_proof_wakes_no_one(self):
        self.proof('p_1', duplicate=True)
        self.assertEqual(self.woken(), [])

    def test_unread_wake_collapses_until_read(self):
        for n in range(20):
            self.proof('p_%d' % n)
        self.assertEqual(self.woken(), [('nina', 'p_0')])
        with mock.patch('os.getcwd', return_value=r'C:\\Agents\\' + dash.NINA_WORKSPACE):
            dash.wake_read()
        self.proof('p_20')
        self.assertEqual(self.woken(), [('nina', 'p_0'), ('nina', 'p_20')])

    def test_each_bot_reads_only_its_own_wake(self):
        self.owner = 'video-editor'
        self.proof('p_1')
        with mock.patch('os.getcwd', return_value=r'C:\\Agents\\' + dash.NINA_WORKSPACE):
            dash.wake_read()  # Nina reading must leave Jessica's wake unread
        self.proof('p_2')
        self.assertEqual(self.woken(), [('qc', 'p_1')])
        with mock.patch('os.getcwd', return_value=r'C:\\Agents\\jessica'):
            dash.wake_read()
        self.proof('p_3')
        self.assertEqual(self.woken(), [('qc', 'p_1'), ('qc', 'p_3')])

    def test_unread_wake_expires(self):
        self.proof('p_1')
        old = time.time() - dash.WAKE_EXPIRES_S - 1
        os.utime(dash.WAKE_DIR / 'nina', (old, old))
        self.proof('p_2')
        self.assertEqual(self.woken(), [('nina', 'p_1'), ('nina', 'p_2')])

    def test_only_a_full_pending_read_by_qc_clears_the_wake(self):
        self.owner = 'video-editor'
        self.proof('p_1')
        marker = dash.WAKE_DIR / 'qc'
        read = lambda bot, *argv: dash.run(dash.parser().parse_args(['proofs'] + list(argv)), {'bot': bot})
        read('qc', '--status', 'pending', '--task', 't_1')
        read('qc', '--status', 'pending', '--limit', '1')
        read('developer', '--status', 'pending')
        read('qc', '--status', 'passed')
        self.assertTrue(marker.exists())
        read('qc', '--status', 'pending')
        self.assertFalse(marker.exists())

    def test_dashboard_down_after_the_save_still_wakes_jessica(self):
        with mock.patch.object(dash, 'call', side_effect=dash.Fail(3, 'down')):
            self.proof('p_1')
        self.assertEqual(self.woken(), [('qc', 'p_1')])

    def test_a_bad_task_reply_still_wakes_jessica(self):
        with mock.patch.object(dash, 'call', return_value=['not', 'a', 'task']):
            self.proof('p_1')
        self.assertEqual(self.woken(), [('qc', 'p_1')])

    def test_send_crash_warns_and_leaves_no_stuck_wake(self):
        with mock.patch.object(hook, 'fire', side_effect=RuntimeError('boom')), mock.patch('sys.stderr') as err:
            self.proof('p_1')
        self.assertIn('QC was not woken', ''.join(c.args[0] for c in err.write.call_args_list))
        self.assertFalse((dash.WAKE_DIR / 'nina').exists())

    def test_failed_wake_warns_and_the_next_proof_tries_again(self):
        self.write_secrets({'nina': 'wrong', 'qc': 'secret-qc'})
        with mock.patch('sys.stderr') as err:  # the proof call still succeeds, with a warning
            self.proof('p_1')
        self.assertIn('QC was not woken', ''.join(c.args[0] for c in err.write.call_args_list))
        self.assertFalse((dash.WAKE_DIR / 'nina').exists())
        self.write_secrets({'nina': 'secret-nina', 'qc': 'secret-qc'})
        self.proof('p_2')
        self.assertEqual(self.woken(), [('nina', 'p_2')])

    def test_footage_watcher_fires_once_per_drop(self):
        folder, log = Path(self.dir.name) / 'footage', Path(self.dir.name) / 'w.log'
        env = dict(os.environ, HOOK_SECRETS=str(self.secrets))
        ps = subprocess.Popen(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                               str(HERE / 'watch_footage.ps1'), '-Folder', str(folder), '-QuietSeconds', '2',
                               '-Python', sys.executable, '-Log', str(log)],
                              env=env, creationflags=0x08000000)  # CREATE_NO_WINDOW
        try:
            deadline = time.time() + 30
            def started():
                try:
                    return 'watching' in log.read_text(encoding='utf-8-sig')
                except OSError:  # missing, or locked while PowerShell writes it
                    return False
            while not started() and time.time() < deadline:
                time.sleep(0.2)
            def drop(action, events):
                action()
                end = time.time() + 15
                while len(self.srv.events) < events and time.time() < end:
                    time.sleep(0.2)
                time.sleep(3)  # nothing else may arrive for the same drop

            def first_drop():
                (folder / 'jon').mkdir()
                for name in ('take1.mp4', 'take2.MOV', 'notes.txt'):
                    (folder / 'jon' / name).write_bytes(b'x' * 1000)
            drop(first_drop, 1)
            drop(lambda: (folder / 'jon' / 'done').mkdir() or (folder / 'jon' / 'take1.mp4').rename(
                folder / 'jon' / 'done' / 'take1.mp4'), 2)  # already announced: no new event

            def file_being_deleted():  # Windows answers "Access is denied" for it; it stopped the watcher
                import ctypes
                from ctypes import wintypes
                k = ctypes.WinDLL('kernel32', use_last_error=True)
                k.CreateFileW.restype = wintypes.HANDLE
                k.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                          wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
                h = k.CreateFileW(str(folder / 'part.m4a'), 0xC0010000, 7, None, 1, 0, None)  # read/write/delete, new
                if h in (None, wintypes.HANDLE(-1).value):
                    raise ctypes.WinError(ctypes.get_last_error())
                wait = threading.Event().wait  # time.sleep is patched out in setUp
                try:
                    if not k.SetFileInformationByHandle(h, 4, ctypes.byref(ctypes.c_ubyte(1)), 1):  # delete on close
                        raise ctypes.WinError(ctypes.get_last_error())
                    for _ in range(4):  # changes the watcher sees while the file is in that state
                        k.WriteFile(h, b'z' * 100, 100, ctypes.byref(wintypes.DWORD()), None)
                        k.FlushFileBuffers(h)
                        wait(0.5)
                    wait(4)  # and a quiet spell (2 s) that finds it still there
                finally:
                    k.CloseHandle(h)
            drop(file_being_deleted, 1)  # gone when closed: no new event

            def folder_moved_in():
                outside = Path(self.dir.name) / 'screen'
                outside.mkdir()
                (outside / 'rec1.mp4').write_bytes(b'y' * 500)
                outside.rename(folder / 'screen')
            drop(folder_moved_in, 2)
        finally:
            ps.kill()
        names = [sorted(Path(f['path']).name for f in e['data']['files']) for _, e in self.srv.events]
        self.assertEqual(names, [['take1.mp4', 'take2.MOV'], ['rec1.mp4']])
        self.assertEqual({(r, e['type']) for r, e in self.srv.events}, {('video-editor', 'raw_footage')})


class DashComment(unittest.TestCase):
    """dash.py comment: checked locally, then one POST with the trimmed text."""
    CTX = {'bot': 'qc', 'token': 't', 'base': 'https://x'}

    def comment(self, *argv):
        return dash.run(dash.parser().parse_args(['comment'] + list(argv)), self.CTX)

    def test_posts_the_trimmed_text(self):
        with mock.patch.object(dash, 'call', return_value={'ok': True}) as call, tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.comment('t_0123456789abcdef', '  On it  '), {'ok': True})
            reply = Path(d) / 'reply.txt'
            reply.write_text('From a file\n', encoding='utf-8')
            self.comment('t_0123456789abcdef', '--text-file', str(reply))
        self.assertEqual([c.args[1:] for c in call.call_args_list], [
            ('POST', '/tasks/t_0123456789abcdef/comments', {'body': 'On it'}),
            ('POST', '/tasks/t_0123456789abcdef/comments', {'body': 'From a file'})])

    def test_bad_text_never_reaches_the_dashboard(self):
        with mock.patch.object(dash, 'call') as call:
            for argv in (['t_1'], ['t_1', '   '], ['t_1', 'x' * 4001], ['t_1', 'hi', '--text-file', 'x.txt'],
                         ['t_1', '--text-file', 'missing.txt']):
                with self.assertRaises(dash.Fail) as err:
                    self.comment(*argv)
                self.assertEqual(err.exception.code, 2, argv[1:])
        call.assert_not_called()


class DashTaskUpdate(unittest.TestCase):
    """dash.py task-update: review is a bot's to set; done is Jon's, refused locally."""
    CTX = {'bot': 'qc', 'token': 't', 'base': 'https://x'}

    def update(self, *argv):
        return dash.run(dash.parser().parse_args(['task-update', 't_0123456789abcdef'] + list(argv)), self.CTX)

    def test_review_is_sent(self):
        with mock.patch.object(dash, 'call', return_value={'ok': True}) as call:
            self.update('--status', 'review')
        call.assert_called_once_with(self.CTX, 'PATCH', '/tasks/t_0123456789abcdef', {'status': 'review'})

    def test_done_is_refused_locally(self):
        with mock.patch.object(dash, 'call') as call, self.assertRaises(dash.Fail) as err:
            self.update('--status', 'done')
        self.assertEqual(err.exception.code, 2)
        self.assertIn('Jon approves', str(err.exception))
        call.assert_not_called()


class DashChannels(unittest.TestCase):
    """dash.py channel, calendar and outlier commands: checked locally, then one call each."""
    CTX = {'bot': 'viral-view', 'token': 't', 'base': 'https://x'}

    def run_cmd(self, *argv):
        return dash.run(dash.parser().parse_args(list(argv)), self.CTX)

    def test_each_command_sends_one_call(self):
        with mock.patch.object(dash, 'call', return_value={'ok': True}) as call:
            self.run_cmd('channels')
            self.run_cmd('channel-set', 'mina-creates', '--schedule', 'Tue and Fri 9 am PT')
            self.run_cmd('calendar', '--channel', 'mina-creates', '--from', '2026-11-01')
            self.run_cmd('calendar-add', 'mina-creates', 'Video 2', '--date', '2026-11-03', '--status', 'planned', '--key', 'mina-2')
            self.run_cmd('calendar-update', 'v_0123456789abcdef', '--status', 'published', '--link', 'https://youtu.be/x')
            self.run_cmd('calendar-update', 'v_0123456789abcdef', '--link', '')
            self.run_cmd('outlier-add', 'mina-creates', 'Big one', '--link', 'https://youtu.be/y', '--views', '42000',
                         '--avg', '10000', '--published', '2026-10-27', '--thumb', 'https://i.ytimg.com/vi/y/hq.jpg', '--key', 'y')
            self.run_cmd('outliers', '--channel', 'mina-creates', '--selected')
            self.run_cmd('outlier-select', 'o_0123456789abcdef', 'on')
            self.run_cmd('outlier-select', 'o_0123456789abcdef', 'off')
        self.assertEqual([c.args[1:] + tuple(c.kwargs.values()) for c in call.call_args_list], [
            ('GET', '/channels'),
            ('PUT', '/channels/mina-creates', {'schedule': 'Tue and Fri 9 am PT'}),
            ('GET', '/calendar', {'channel': 'mina-creates', 'from': '2026-11-01', 'to': None, 'limit': None}),
            ('POST', '/calendar', {'channel': 'mina-creates', 'title': 'Video 2', 'date': '2026-11-03', 'status': 'planned', 'key': 'mina-2'}),
            ('PATCH', '/calendar/v_0123456789abcdef', {'status': 'published', 'link': 'https://youtu.be/x'}),
            ('PATCH', '/calendar/v_0123456789abcdef', {'link': ''}),
            ('POST', '/outliers', {'channel': 'mina-creates', 'title': 'Big one', 'link': 'https://youtu.be/y',
                                   'thumb': 'https://i.ytimg.com/vi/y/hq.jpg', 'views': 42000, 'avg': 10000,
                                   'published': '2026-10-27', 'key': 'y'}),
            ('GET', '/outliers', {'channel': 'mina-creates', 'selected': '1', 'limit': None}),
            ('POST', '/outliers/o_0123456789abcdef/select', {'selected': True}),
            ('POST', '/outliers/o_0123456789abcdef/select', {'selected': False})])

    def test_bad_input_never_reaches_the_dashboard(self):
        add = ['outlier-add', 'mina-creates', 'T', '--link', 'https://youtu.be/y', '--views', '5', '--avg', '2', '--published', '2026-10-27']
        cal = ['calendar-add', 'mina-creates', 'T', '--date', '2026-11-03', '--status', 'planned']
        with mock.patch.object(dash, 'call') as call:
            for argv in ([*cal[:4], 'Tuesday', *cal[5:]], [*cal, '--link', 'javascript:alert(1)'],
                         [*cal, '--link', 'D:\\video.mp4'], ['calendar-update', 'v_1'], ['calendar', '--to', '11/03'],
                         [*add[:4], 'ftp://x', *add[5:]], [*add, '--thumb', 'data:image/png;base64,AA'],
                         [*add[:6], '-1', *add[7:]], [*add[:8], '0', *add[9:]], [*add[:10], '2026-1-1']):
                with self.assertRaises(dash.Fail) as err:
                    self.run_cmd(*argv)
                self.assertEqual(err.exception.code, 2, argv)
            for argv in ([*cal[:6], 'live'], ['outlier-select', 'o_1', 'yes'], cal[:5]):  # argparse refuses these
                with self.assertRaises(SystemExit), mock.patch('sys.stderr'):
                    self.run_cmd(*argv)
        call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
