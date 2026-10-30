"""python -I bots/test_youtube_upload.py  (stdlib only; Google and the dashboard are faked)"""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import google_connect  # noqa: E402
import youtube_upload as yu  # noqa: E402

TOKEN_URI = 'https://oauth2.example/token'
SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=s1'
MINA = yu.CHANNELS['mina'][2]
NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)


class FakeGoogle:
    """Google's side: token refresh, one resumable session that keeps the bytes it got, and the video endpoints."""
    def __init__(self, size, quota=False, thumb_status=200, breaks=0):
        self.size, self.quota, self.thumb_status, self.breaks = size, quota, thumb_status, breaks
        self.got, self.sessions, self.calls, self.meta, self.updated = b'', 0, [], None, None

    def __call__(self, method, url, data=None, headers=None):
        self.calls.append((method, url))
        headers = headers or {}
        if url == TOKEN_URI:
            return 200, {}, b'{"access_token": "at"}'
        assert headers.get('Authorization') == 'Bearer at', url
        if url.startswith(yu.UPLOAD + '/videos?uploadType=resumable'):
            if self.quota:
                return 403, {}, json.dumps({'error': {'message': 'quota', 'errors': [{'reason': 'quotaExceeded'}]}}).encode()
            self.meta, self.sessions = json.loads(data), self.sessions + 1
            assert headers['X-Upload-Content-Length'] == str(self.size)
            return 200, {'location': SESSION}, b''
        if url == SESSION:
            held = {'range': 'bytes=0-%d' % (len(self.got) - 1)} if self.got else {}
            rng = headers['Content-Range']
            if rng == 'bytes */%d' % self.size:
                return (200, {}, b'{"id": "VIDEO000001"}') if len(self.got) == self.size else (308, held, b'')
            if self.breaks:
                self.breaks -= 1
                raise OSError('connection reset')
            assert rng == 'bytes %d-%d/%d' % (len(self.got), len(self.got) + len(data) - 1, self.size), rng
            self.got += data
            if len(self.got) == self.size:
                return 200, {}, b'{"id": "VIDEO000001"}'
            return 308, {'range': 'bytes=0-%d' % (len(self.got) - 1)}, b''
        if url.startswith(yu.UPLOAD + '/thumbnails/set'):
            return self.thumb_status, {}, (b'{}' if self.thumb_status == 200 else json.dumps(
                {'error': {'message': 'no permission', 'errors': [{'reason': 'forbidden'}]}}).encode())
        if url.startswith(yu.API + '/playlistItems'):
            return 200, {}, b'{"id": "pi1"}'
        if url.startswith(yu.API + '/videos') and method == 'GET':
            return 200, {}, json.dumps({'items': [{'id': 'VIDEO000001', 'status': {
                'privacyStatus': 'private', 'uploadStatus': 'processed', 'license': 'youtube', 'embeddable': True,
                'publicStatsViewable': True, 'selfDeclaredMadeForKids': False, 'madeForKids': False,
                'containsSyntheticMedia': True}}]}).encode()
        if url.startswith(yu.API + '/videos') and method == 'PUT':
            self.updated = json.loads(data)
            return 200, {}, data
        if url.startswith(yu.API + '/videos') and method == 'DELETE':
            return 204, {}, b''
        raise AssertionError('unexpected %s %s' % (method, url))

    def uploaded_chunks(self):
        return sum(1 for m, u in self.calls if u == SESSION and m == 'PUT')


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        for target, value in ((yu, 'DIR'), (google_connect, 'DIR')):
            p = mock.patch.object(target, value, self.dir)
            p.start()
            self.addCleanup(p.stop)
        for name, value in (('CHUNK', 256 * 1024), ('RETRIES', 0)):
            p = mock.patch.object(yu, name, value)
            p.start()
            self.addCleanup(p.stop)
        sleep = mock.patch.object(yu.time, 'sleep')
        sleep.start()
        self.addCleanup(sleep.stop)
        (self.dir / 'client.json').write_text(json.dumps({'installed': {
            'client_id': 'cid', 'client_secret': 'cs', 'token_uri': TOKEN_URI}}))
        (self.dir / 'yt-mina.json').write_text(json.dumps({'channel': MINA, 'client_id': 'cid', 'refresh_token': 'rt'}))
        self.video = self.dir / 'mina-1.mp4'
        self.video.write_bytes(os.urandom(600 * 1024))  # 3 chunks of 256 KiB

    def cli(self, google, *argv):
        with mock.patch.object(yu, 'http', google):
            return yu.run(yu.parser().parse_args(list(argv)))

    def up(self, google, *extra):
        return self.cli(google, 'upload', 'mina', str(self.video), '--title', 'I Cloned a Viral Ad', '--synthetic', 'yes',
                        '--description', 'Made with Viral View', '--tags', 'ai ugc, viral view', '--test-clip', *extra)


class Upload(Base):
    def test_uploads_the_whole_file_as_private_with_the_metadata(self):
        g = FakeGoogle(self.video.stat().st_size)
        out = self.up(g)
        self.assertEqual(g.got, self.video.read_bytes())
        self.assertEqual(g.uploaded_chunks(), 3)
        self.assertIn(('POST', yu.UPLOAD + '/videos?uploadType=resumable&part=snippet,status'), g.calls)
        self.assertEqual(g.meta['status'], {'privacyStatus': 'private', 'selfDeclaredMadeForKids': False,
                                            'containsSyntheticMedia': True})
        self.assertEqual(g.meta['snippet']['tags'], ['ai ugc', 'viral view'])
        self.assertEqual(out['video'], 'VIDEO000001')
        self.assertEqual(out['privacy'], 'private')
        self.assertEqual(out['problems'], [])

    def test_a_killed_upload_resumes_where_google_stopped_and_a_rerun_never_uploads_twice(self):
        g = FakeGoogle(self.video.stat().st_size)
        g.breaks = 0
        real = g.__call__

        def die_on_second_chunk(method, url, data=None, headers=None):
            if url == SESSION and len(g.got) == 256 * 1024 and data:
                raise OSError('network gone')
            return real(method, url, data, headers)
        with self.assertRaises(yu.Fail) as e:
            self.up(die_on_second_chunk)
        self.assertIn('Run the same command again', str(e.exception))
        self.assertEqual(len(g.got), 256 * 1024)
        out = self.up(g)  # next run: asks Google how far it got, sends only the rest, same session
        self.assertEqual(g.got, self.video.read_bytes())
        self.assertEqual(g.sessions, 1)
        self.assertEqual(out['video'], 'VIDEO000001')
        before = len(g.calls)
        again = self.up(g)
        self.assertTrue(again['already_uploaded'])
        self.assertEqual([c for c in g.calls[before:] if c[1].startswith(yu.UPLOAD)], [])

    def test_a_run_killed_after_google_got_the_last_byte_returns_that_video_next_time(self):
        g = FakeGoogle(self.video.stat().st_size)

        def die_after_last_chunk(method, url, data=None, headers=None):
            out = g(method, url, data, headers)
            if url == SESSION and data and len(g.got) == g.size:
                raise OSError('killed before the video id was saved')
            return out
        with self.assertRaises(yu.Fail):
            self.up(die_after_last_chunk)
        sent = g.uploaded_chunks()
        out = self.up(g)
        self.assertEqual(out['video'], 'VIDEO000001')
        self.assertFalse(out['already_uploaded'])
        self.assertEqual(g.sessions, 1)
        self.assertEqual(g.uploaded_chunks(), sent + 1)  # only the "how far did you get" question

    def test_a_network_blip_is_retried_within_the_run(self):
        g = FakeGoogle(self.video.stat().st_size, breaks=1)
        with mock.patch.object(yu, 'RETRIES', 3):
            out = self.up(g)
        self.assertEqual(out['video'], 'VIDEO000001')
        self.assertEqual(g.got, self.video.read_bytes())

    def test_quota_used_up_says_so_plainly(self):
        g = FakeGoogle(self.video.stat().st_size, quota=True)
        with self.assertRaises(yu.Fail) as e:
            self.up(g)
        self.assertEqual(e.exception.code, 1)
        self.assertIn('quota for today is used up', str(e.exception))
        self.assertIn('midnight Pacific', str(e.exception))

    def test_refused_thumbnail_is_reported_and_retried_on_the_next_run(self):
        thumb = self.dir / 't.jpg'
        thumb.write_bytes(b'\xff\xd8jpg')
        g = FakeGoogle(self.video.stat().st_size, thumb_status=403)
        out = self.up(g, '--thumbnail', str(thumb), '--playlist', 'PLabcdefghij')
        self.assertEqual(out['video'], 'VIDEO000001')
        self.assertEqual(len(out['problems']), 1)
        self.assertIn('phone verification', out['problems'][0])
        g.thumb_status = 200
        before = len(g.calls)
        out = self.up(g, '--thumbnail', str(thumb), '--playlist', 'PLabcdefghij')
        self.assertEqual(out['problems'], [])
        self.assertEqual([u for _, u in g.calls[before:] if u != TOKEN_URI],
                         [yu.UPLOAD + '/thumbnails/set?videoId=VIDEO000001'])  # no 2nd playlist add

    def test_real_videos_wait_for_the_audit_but_dry_run_still_shows_the_plan(self):
        args = ['upload', 'mina', str(self.video), '--title', 'T', '--synthetic', 'no']
        with self.assertRaises(yu.Fail) as e:
            self.cli(FakeGoogle(0), *args)
        self.assertEqual(e.exception.code, 2)
        self.assertIn('audit', str(e.exception))

        def no_network(*a, **k):
            raise AssertionError('dry run touched the network')
        out = self.cli(no_network, *args, '--dry-run')
        self.assertTrue(out['dry_run'])
        self.assertEqual(out['metadata']['status']['privacyStatus'], 'private')
        self.assertIn('audit', out['blocked'])

    def test_bad_metadata_is_refused_before_any_byte(self):
        with self.assertRaises(yu.Fail) as e:
            self.cli(FakeGoogle(0), 'upload', 'mina', str(self.video), '--title', 'a <b>', '--synthetic', 'no', '--test-clip')
        self.assertEqual(e.exception.code, 2)

    def test_delete_only_takes_test_clips_this_tool_uploaded(self):
        g = FakeGoogle(self.video.stat().st_size)
        self.up(g)
        with self.assertRaises(yu.Fail):
            self.cli(g, 'delete', 'mina', 'OTHERVIDEO1')
        self.assertEqual(self.cli(g, 'delete', 'mina', 'VIDEO000001'), {'deleted': 'VIDEO000001', 'channel': 'mina'})
        rec = next((self.dir / 'youtube-uploads').glob('*.json'), None)
        self.assertIsNone(rec)

    def test_unconnected_channel_is_a_local_problem(self):
        with self.assertRaises(yu.Fail) as e:
            self.cli(FakeGoogle(0), 'upload', 'theo', str(self.video), '--title', 'T', '--synthetic', 'no', '--test-clip')
        self.assertEqual(e.exception.code, 2)


class Schedule(Base):
    def dash(self, approval):
        calls = []

        def call(ctx, method, path, body=None, query=None):
            calls.append((method, path))
            return {'ok': True, 'approval': approval}
        patches = [mock.patch.object(yu.dash, 'which_bot', return_value='viral-view'),
                   mock.patch.object(yu.dash, 'read_token', return_value='tok'),
                   mock.patch.object(yu.dash, 'call', side_effect=call)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        return calls

    def approval(self, **kw):
        a = {'id': 'a_0123abcd', 'action': 'publish_video', 'status': 'approved', 'requestedBy': 'viral-view',
             'payload': {'channel': 'mina', 'video': 'VIDEO000001', 'publishAt': '2026-11-02T09:00:00-08:00'}}
        a.update(kw)
        return a

    def test_refuses_without_an_approved_publish_video_approval(self):
        for bad in (self.approval(status='pending'), self.approval(status='rejected'), self.approval(status='done'),
                    self.approval(action='send_pitches'),
                    self.approval(payload={'channel': 'mina', 'video': 'VIDEO000001', 'publishAt': '2026-10-01T00:00:00Z'})):
            calls = self.dash(bad)
            g = FakeGoogle(0)
            with mock.patch.object(yu, 'http', g), self.assertRaises(yu.Fail) as e:
                yu.schedule('a_0123abcd', now=NOW)
            self.assertEqual(e.exception.code, 2)
            self.assertEqual(calls, [('GET', '/approvals/a_0123abcd')])  # never claimed
            self.assertEqual(g.calls, [])  # YouTube untouched

    def test_approved_claims_schedules_and_finishes(self):
        calls = self.dash(self.approval())
        g = FakeGoogle(0)
        with mock.patch.object(yu, 'http', g):
            out = yu.schedule('a_0123abcd', now=NOW)
        self.assertEqual(g.updated['status'], {'privacyStatus': 'private', 'publishAt': '2026-11-02T17:00:00Z',
                                               'license': 'youtube', 'embeddable': True, 'publicStatsViewable': True,
                                               'selfDeclaredMadeForKids': False, 'containsSyntheticMedia': True})
        self.assertEqual(calls, [('GET', '/approvals/a_0123abcd'), ('POST', '/approvals/a_0123abcd/claim'),
                                 ('POST', '/approvals/a_0123abcd/done')])
        self.assertEqual(out['publish'], '2026-11-02T17:00:00Z')
        self.assertIn(('PUT', yu.API + '/videos?part=status'), g.calls)

    def test_a_video_youtube_keeps_private_is_not_reported_as_published(self):
        calls = self.dash(self.approval(payload={'channel': 'mina', 'video': 'VIDEO000001', 'publishAt': 'now'}))
        g = FakeGoogle(0)

        def locked(method, url, data=None, headers=None):
            if method == 'PUT':
                body = json.loads(data)
                body['status']['privacyStatus'] = 'private'
                return 200, {}, json.dumps(body).encode()
            return g(method, url, data, headers)
        with mock.patch.object(yu, 'http', locked), self.assertRaises(yu.Fail) as e:
            yu.schedule('a_0123abcd', now=NOW)
        self.assertIn('locked private', str(e.exception))
        self.assertEqual(calls[-1], ('POST', '/approvals/a_0123abcd/release'))

    def test_dashboard_hiccup_after_youtube_succeeded_is_a_warning_not_a_failure(self):
        approval = self.approval()

        def call(ctx, method, path, body=None, query=None):
            if path.endswith('/done'):
                raise yu.dash.Fail(3, 'Dashboard not reachable')
            return {'ok': True, 'approval': approval}
        self.dash(approval)
        with mock.patch.object(yu.dash, 'call', side_effect=call), mock.patch.object(yu, 'http', FakeGoogle(0)):
            out = yu.schedule('a_0123abcd', now=NOW)
        self.assertIn('approval-done', out['warning'])

    def test_now_makes_it_public(self):
        self.dash(self.approval(payload={'channel': 'mina', 'video': 'VIDEO000001', 'publishAt': 'now'}))
        g = FakeGoogle(0)
        with mock.patch.object(yu, 'http', g):
            yu.schedule('a_0123abcd', now=NOW)
        self.assertEqual(g.updated['status']['privacyStatus'], 'public')
        self.assertNotIn('publishAt', g.updated['status'])

    def test_youtube_refusal_gives_the_approval_back(self):
        calls = self.dash(self.approval())
        g = FakeGoogle(0)

        def refuse_update(method, url, data=None, headers=None):
            if method == 'PUT':
                return 403, {}, b'{"error": {"message": "forbidden", "errors": [{"reason": "forbidden"}]}}'
            return g(method, url, data, headers)
        with mock.patch.object(yu, 'http', refuse_update), self.assertRaises(yu.Fail):
            yu.schedule('a_0123abcd', now=NOW)
        self.assertEqual(calls[-1], ('POST', '/approvals/a_0123abcd/release'))

    def test_dry_run_checks_the_approval_and_changes_nothing(self):
        calls = self.dash(self.approval())
        with mock.patch.object(yu, 'http', side_effect=AssertionError('network')):
            out = yu.schedule('a_0123abcd', dry_run=True, now=NOW)
        self.assertTrue(out['dry_run'])
        self.assertEqual(calls, [('GET', '/approvals/a_0123abcd')])


class Connect(Base):
    def finish(self, channel):
        flow = google_connect.Flow()
        url = flow.start('yt-mina')
        state = dict(p.split('=', 1) for p in url.split('?', 1)[1].split('&'))['state']
        tok = {'access_token': 'at', 'refresh_token': 'rt', 'scope': yu.SCOPE}
        with mock.patch.object(google_connect, 'post', return_value=tok), \
                mock.patch.object(google_connect, 'channel_id', return_value=channel):
            return flow.finish(state, 'code')

    def test_wrong_channel_is_refused_and_the_right_one_saved(self):
        (self.dir / 'yt-mina.json').unlink()
        self.assertEqual(self.finish(yu.CHANNELS['theo'][2]), ('yt-mina', mock.ANY))
        self.assertFalse(google_connect.connected('yt-mina'))
        self.assertEqual(self.finish(MINA), ('yt-mina', ''))
        self.assertTrue(google_connect.connected('yt-mina'))
        self.assertTrue(yu.connected('mina'))

    def test_youtube_links_use_the_youtube_app_once_jon_saves_it(self):
        self.assertIn('client_id=cid', google_connect.Flow().start('yt-mina'))
        self.assertTrue(google_connect.save_youtube_client('123-abc.apps.googleusercontent.com', 'GOCSPX-' + 'x' * 28) == '')
        self.assertIn('client_id=123-abc.apps.googleusercontent.com', google_connect.Flow().start('yt-mina'))
        self.assertIn('client_id=cid', google_connect.Flow().start('partners'))  # Gmail keeps its own app
        self.assertNotEqual(google_connect.save_youtube_client('evil', 'x'), '')
        self.assertFalse(yu.connected('mina'))  # made with the old app: Jon reconnects it with the new one


if __name__ == '__main__':
    unittest.main()
