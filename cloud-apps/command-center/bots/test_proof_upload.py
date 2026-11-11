"""python -I bots/test_proof_upload.py  (stdlib only): proof_upload.py refuses bad files and posts only https links;
dash.py proof-add warns on a local path."""
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dash  # noqa: E402
import proof_upload as pu  # noqa: E402

CARD = 't_0123456789abcdef'
URL = 'https://jonmac.ai/dashboard/f/' + 'a' * 32 + '.png'


class Res(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class ProofUpload(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.err = mock.patch('sys.stderr', new_callable=io.StringIO)
        self.stderr = self.err.start()
        self.addCleanup(self.err.stop)

    def file(self, name, data=b'\x89PNG data'):
        p = Path(self.dir.name) / name
        p.write_bytes(data)
        return str(p)

    def run_pu(self, argv):
        with mock.patch.object(pu.subprocess, 'run') as run, \
                mock.patch.object(dash, 'which_bot', return_value='developer'), \
                mock.patch.object(dash, 'read_token', return_value='ccb_x'), \
                mock.patch.object(dash.OPENER, 'open', return_value=Res(json.dumps({'ok': True, 'url': URL}).encode())) as op, \
                mock.patch('sys.stdout', new_callable=io.StringIO) as out:
            run.return_value = mock.Mock(returncode=0, stdout='', stderr='')
            code = pu.main(argv)
        return code, run, op, out.getvalue()

    def test_png_uploads_then_proof_add_gets_the_https_link(self):
        code, run, op, out = self.run_pu([CARD, self.file('sheet.png'), '--kind', 'render', '--note', 'test'])
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), URL)
        req = op.call_args[0][0]
        self.assertEqual(req.get_method(), 'POST')
        self.assertTrue(req.full_url.startswith('https://jonmac.ai/dashboard/api/v1/files?name=sheet.png'))
        self.assertEqual(req.get_header('Authorization'), 'Bearer ccb_x')
        cmd = run.call_args[0][0]
        self.assertEqual(cmd[3:], ['proof-add', CARD, '--kind', 'render', '--link', URL, '--note', 'test'])

    def test_missing_empty_and_unlisted_files_post_nothing(self):
        for path in [str(Path(self.dir.name) / 'nope.png'), self.file('empty.png', b''), self.file('page.html'), self.dir.name]:
            code, run, op, _ = self.run_pu([CARD, path, '--kind', 'url'])
            self.assertEqual(code, 2, path)
            run.assert_not_called()
            op.assert_not_called()
        self.assertIn('no proof posted', self.stderr.getvalue())
        self.assertIn('empty (0 bytes)', self.stderr.getvalue())
        self.assertIn('.html is not a proof type', self.stderr.getvalue())

    def test_bad_card_id_posts_nothing(self):
        code, run, op, _ = self.run_pu(['t_1/../x', self.file('a.png'), '--kind', 'url'])
        self.assertEqual(code, 2)
        run.assert_not_called()
        op.assert_not_called()

    def test_over_95_mb_is_refused_before_upload(self):
        p = self.file('big.pdf', b'%PDF')
        with mock.patch.object(pu, 'MAX_BYTES', 3):
            code, run, op, _ = self.run_pu([CARD, p, '--kind', 'pdf'])
        self.assertEqual(code, 2)
        op.assert_not_called()

    def test_server_refusal_posts_nothing(self):
        err = pu.urllib.error.HTTPError(dash.BASE + '/files', 401, 'Unauthorized', {}, io.BytesIO(b'{"error":"Unauthorized"}'))
        with mock.patch.object(pu.subprocess, 'run') as run, \
                mock.patch.object(dash, 'which_bot', return_value='developer'), \
                mock.patch.object(dash, 'read_token', return_value='ccb_x'), \
                mock.patch.object(dash.OPENER, 'open', side_effect=err):
            code = pu.main([CARD, self.file('a.png'), '--kind', 'url'])
        self.assertEqual(code, 1)
        run.assert_not_called()
        self.assertIn('HTTP 401', self.stderr.getvalue())

    def test_mp4_render_needs_review_args_then_posts_the_review_page(self):
        clip = self.file('v3.mp4', b'\x00\x00\x00\x18ftypmp42')
        code, run, op, _ = self.run_pu([CARD, clip, '--kind', 'render'])
        self.assertEqual(code, 2)
        run.assert_not_called()
        page = 'https://jonmac.ai/review/diane-1-v3'
        with mock.patch.object(pu.subprocess, 'run') as run, mock.patch('sys.stdout', new_callable=io.StringIO):
            run.side_effect = [mock.Mock(returncode=0, stdout='{"ok": true, "page_url": "%s"}' % page, stderr=''),
                               mock.Mock(returncode=0)]
            code = pu.main([CARD, clip, '--kind', 'render', '--note', 'v3', '--', '--slug', 'diane-1-v3'])
        self.assertEqual(code, 0)
        publish, add = run.call_args_list[0][0][0], run.call_args_list[1][0][0]
        self.assertEqual(publish[0], 'node')
        self.assertEqual(publish[2:], ['--file', clip, '--task', CARD, '--slug', 'diane-1-v3'])
        self.assertIn(page, add)


class LocalLinkWarning(unittest.TestCase):
    CTX = {'bot': 'developer', 'token': 'x', 'base': 'https://jonmac.ai/dashboard/api/v1'}

    def proof_add(self, link):
        args = dash.parser().parse_args(['proof-add', CARD, '--kind', 'url', '--link', link])
        with mock.patch.object(dash, 'call', return_value={'ok': True}) as call, \
                mock.patch.object(dash, 'look_gate_check'), mock.patch.object(dash, 'qc_limit'), \
                mock.patch.object(dash, 'wake_qc'), mock.patch('sys.stderr', new_callable=io.StringIO) as err:
            dash.run(args, self.CTX)
        call.assert_called_once()  # warning only: the proof still posts
        return err.getvalue()

    def test_local_paths_warn_and_name_proof_upload(self):
        for link in [r'D:\AgentTeam\qc-work\sheet.png', 'D:/x.png', r'\\gpu2\share\a.png', '/tmp/a.png', 'file:///D:/a.png']:
            self.assertIn('proof_upload.py', self.proof_add(link), link)

    def test_https_links_do_not_warn(self):
        self.assertEqual(self.proof_add('https://jonmac.ai/review/diane-1-v3'), '')


if __name__ == '__main__':
    unittest.main()
