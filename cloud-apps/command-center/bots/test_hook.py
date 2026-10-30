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
        patches = [mock.patch.object(hook, 'SECRETS', self.secrets), mock.patch.object(hook.time, 'sleep')]
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
            self.assertEqual(len(self.srv.events), 7)
            self.write_secrets({'qc': 'wrong'})
            self.assertEqual(hook.main(['fire', 'proof_posted']), 1)  # 401
            self.assertEqual(hook.main(['fire', 'raw_footage']), 2)  # no secret for video-editor
            self.assertEqual(hook.main(['fire', 'proof_posted', '--data', '{bad']), 2)
            self.secrets.unlink()
            self.assertEqual(hook.main(['test', 'qc']), 2)

    def test_dash_proof_add_wakes_qc_once(self):
        dash.wake_qc({'ok': True, 'proof': {'id': 'p_1', 'kind': 'url', 'link': 'https://x'}}, 't_1', 'developer')
        dash.wake_qc({'ok': True, 'proof': {'id': 'p_1'}, 'duplicate': True}, 't_1', 'developer')
        self.assertEqual([(r, e['data']['proof'], e['data']['task']) for r, e in self.srv.events], [('qc', 'p_1', 't_1')])
        self.write_secrets({})
        with mock.patch('sys.stderr') as err:  # no secret: the proof call still succeeds, with a warning
            dash.wake_qc({'ok': True, 'proof': {'id': 'p_2'}}, 't_1', 'developer')
        self.assertIn('QC was not woken', ''.join(c.args[0] for c in err.write.call_args_list))

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
                try:
                    k.SetFileInformationByHandle(h, 4, ctypes.byref(ctypes.c_ubyte(1)), 1)  # delete when closed
                    for _ in range(4):  # changes the watcher sees while the file is in that state
                        k.WriteFile(h, b'z' * 100, 100, ctypes.byref(wintypes.DWORD()), None)
                        k.FlushFileBuffers(h)
                        time.sleep(0.5)
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


if __name__ == '__main__':
    unittest.main()
