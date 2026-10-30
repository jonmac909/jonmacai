"""python -I bots/test_short_post.py  (stdlib only; Meta, TikTok, Google and the dashboard are faked)"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import google_connect  # noqa: E402
import short_post as sp  # noqa: E402
import youtube_upload as yu  # noqa: E402
from test_youtube_upload import TOKEN_URI, FakeGoogle  # noqa: E402

REAL_PROBE = sp.probe
TT_UPLOAD = 'https://open-upload.tiktokapis.com/video/?upload_id=1'
PERMALINK = 'https://www.instagram.com/reel/abc/'
TEXT = 'None of it is real.\n\n#aiugc #ai'


def ok(data):
    return 200, {}, json.dumps(data).encode()


def sha_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class FakeSocial:
    """Meta, TikTok and (through FakeGoogle) YouTube. Status lists play in order; the last one repeats."""
    def __init__(self, size):
        self.size, self.calls, self.got, self.fail = size, [], {}, {}
        self.ig_status, self.fb_status, self.tt_status = ['FINISHED'], ['complete'], [{'status': 'SEND_TO_USER_INBOX'}]
        self.fb_video_status, self.fb_finished, self.lose_finish_answer = 'processing', False, False
        self.published = self.finishes = self.containers = self.inits = self.tt_puts = 0
        self.ig_form = self.fb_form = self.tt_init = self.tt_path = None
        self.tt_break_on, self.yt_privacy = None, 'public'
        self.google = FakeGoogle(size)

    @staticmethod
    def next(seq):
        return seq.pop(0) if len(seq) > 1 else seq[0]

    def __call__(self, method, url, data=None, headers=None):
        self.calls.append((method, url))
        headers = headers or {}
        for key, resp in self.fail.items():
            if key in url:
                return resp
        if url.startswith(yu.API + '/channels'):
            return ok({'items': [{'snippet': {'title': 'Jon Mac | AI UGC'}}]})
        if url.startswith(yu.API + '/videos') and method == 'GET':  # the read-back after the upload
            return ok({'items': [{'id': 'VIDEO000001', 'status': {'privacyStatus': self.yt_privacy}}]})
        if url == TOKEN_URI or url.startswith(yu.UPLOAD):
            return self.google(method, url, data, headers)
        if url.startswith(sp.RUPLOAD):
            assert headers['Authorization'] == 'OAuth pt' and headers['offset'] == '0', headers
            assert headers['file_size'] == str(self.size)
            self.got[url] = data
            return ok({'success': True})
        if url.startswith(sp.GRAPH):
            return self.meta(method, url[len(sp.GRAPH):].split('?')[0], dict(urllib.parse.parse_qsl(data.decode())) if data else {}, headers)
        if url.startswith(sp.TIKTOK):
            return self.tiktok(url[len(sp.TIKTOK):].split('?')[0], data, headers)
        if url == TT_UPLOAD:
            self.tt_puts += 1
            if self.tt_puts == self.tt_break_on:
                raise OSError('network gone')
            have = self.got.get(url, b'')
            assert headers['Content-Range'] == 'bytes %d-%d/%d' % (len(have), len(have) + len(data) - 1, self.size), headers
            self.got[url] = have + data
            return (201 if len(self.got[url]) == self.size else 206), {}, b''
        raise AssertionError('unexpected %s %s' % (method, url))

    def meta(self, method, path, form, headers):
        assert headers['Authorization'] == 'OAuth pt', headers
        if path == '/IG1/media':
            self.ig_form, self.containers = form, self.containers + 1
            return ok({'id': 'C%d' % self.containers, 'uri': sp.RUPLOAD + '/ig-api-upload/v23.0/C%d' % self.containers})
        if path.startswith('/C'):
            return ok({'status_code': self.next(self.ig_status), 'status': 'x'})
        if path == '/IG1/media_publish':
            assert form == {'creation_id': 'C%d' % self.containers}
            self.published += 1
            self.ig_status = ['PUBLISHED']
            if 'crash_after_publish' in self.fail:
                raise KeyboardInterrupt  # the run is killed right after Instagram published
            return ok({'id': 'M1'})
        if path == '/M1':
            return ok({'permalink': PERMALINK})
        if path == '/PAGE1/video_reels' and form['upload_phase'] == 'start':
            return ok({'video_id': 'V1', 'upload_url': sp.RUPLOAD + '/video-upload/v23.0/V1'})
        if path == '/PAGE1/video_reels':
            self.fb_form, self.fb_finished, self.finishes = form, True, self.finishes + 1
            if self.lose_finish_answer:
                self.lose_finish_answer = False
                raise OSError('connection reset')  # Facebook got it, the answer was lost
            return ok({'success': True})
        if path == '/V1':
            return ok({'status': {'video_status': self.fb_video_status, 'uploading_phase': {'status': 'complete'},
                                  'publishing_phase': {'status': self.next(self.fb_status) if self.fb_finished else 'not_started'}}})
        if path == '/IG1':
            return ok({'username': 'jonmac'})
        if path == '/PAGE1':
            return ok({'name': 'Jon Mac'})
        raise AssertionError('unexpected Meta %s %s' % (method, path))

    def tiktok(self, path, data, headers):
        if path == '/oauth/token/':
            return ok({'access_token': 'tat', 'refresh_token': 'trt', 'open_id': 'o1', 'expires_in': 86400,
                       'scope': 'user.info.basic,video.upload,video.publish'})
        assert headers['Authorization'] == 'Bearer tat', headers
        if path in ('/post/publish/inbox/video/init/', '/post/publish/video/init/'):
            self.tt_path, self.tt_init, self.inits = path, json.loads(data), self.inits + 1
            self.got.pop(TT_UPLOAD, None)
            return ok({'data': {'publish_id': 'P%d' % self.inits, 'upload_url': TT_UPLOAD}, 'error': {'code': 'ok'}})
        if path == '/post/publish/creator_info/query/':
            return ok({'data': {'creator_username': 'jonmac', 'privacy_level_options': [
                'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY']}, 'error': {'code': 'ok'}})
        if path == '/post/publish/status/fetch/':
            assert json.loads(data) == {'publish_id': 'P%d' % self.inits}
            return ok({'data': self.next(self.tt_status), 'error': {'code': 'ok'}})
        if path == '/user/info/':
            return ok({'data': {'user': {'display_name': 'Jon Mac'}}, 'error': {'code': 'ok'}})
        raise AssertionError('unexpected TikTok %s' % path)

    def posting_calls(self, start=0):
        """Calls that create or upload something (token refreshes and reads don't count)."""
        return [c for c in self.calls[start:] if c[0] in ('POST', 'PUT') and not c[1].endswith('/oauth/token/')
                and c[1] != TOKEN_URI and not c[1].endswith('/status/fetch/')]


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        social, google = self.tmp / 'social', self.tmp / 'google'
        social.mkdir()
        google.mkdir()
        for target, name, value in ((sp, 'DIR', social), (yu, 'DIR', google), (google_connect, 'DIR', google),
                                    (sp.time, 'sleep', mock.Mock()), (sp, 'probe', mock.Mock(return_value=(1080, 1920, 15.0))),
                                    (yu, 'AUDITED', True)):
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.sleep = sp.time.sleep
        (social / 'meta.json').write_text(json.dumps({'page_token': 'pt', 'page_id': 'PAGE1', 'ig_id': 'IG1',
                                                      'ig_username': 'jonmac'}))
        (social / 'tiktok-client.json').write_text(json.dumps({'client_key': 'ck', 'client_secret': 'cs'}))
        (social / 'tiktok.json').write_text(json.dumps({'client_key': 'ck', 'refresh_token': 'trt', 'open_id': 'o1'}))
        (google / 'client.json').write_text(json.dumps({'installed': {
            'client_id': 'cid', 'client_secret': 'cs', 'token_uri': TOKEN_URI}}))
        (google / 'yt-jonmacai.json').write_text(json.dumps({'channel': yu.CHANNELS['jonmacai'][2], 'client_id': 'cid',
                                                             'refresh_token': 'rt'}))
        self.clip = self.tmp / 'clip1.mp4'
        self.clip.write_bytes(os.urandom(300 * 1024))
        self.fake = FakeSocial(self.clip.stat().st_size)
        self.dash_calls = []
        self.approval = self.make()
        p = mock.patch.object(yu, 'http', self.fake)
        p.start()
        self.addCleanup(p.stop)
        for name, value in (('which_bot', mock.Mock(return_value='short-form')), ('read_token', mock.Mock(return_value='tok')),
                            ('call', self.dash)):
            p = mock.patch.object(yu.dash, name, value)
            p.start()
            self.addCleanup(p.stop)

    def dash(self, ctx, method, path, body=None, query=None):
        self.dash_calls.append((method, path))
        return {'ok': True, 'approval': self.approval}

    def make(self, file=None, platforms=sp.PLATFORMS, **kw):
        file = file or self.clip
        a = {'id': 'a_0123abcd', 'action': 'post_clips', 'status': 'approved', 'requestedBy': 'short-form', 'payload': {
            'platforms': list(platforms), 'youtube_channel': 'jonmacai',
            'clips': [{'file': str(file), 'sha256': sha_of(file), 'title': 'Real or AI? None of it is real',
                       'caption': 'None of it is real.', 'hashtags': '#aiugc #ai', 'synthetic': True}]}}
        a.update(kw)
        return a

    def record(self, platform, account):
        return json.loads(sp.record_path(sha_of(self.clip), platform, account).read_text())


class Post(Base):
    def test_posts_one_clip_everywhere_and_marks_the_approval_done(self):
        out = sp.post('a_0123abcd')
        self.assertTrue(out['complete'])
        r = out['clips'][0]
        self.assertEqual(r['instagram_reels'], {'state': 'posted', 'id': 'M1', 'link': PERMALINK})
        self.assertEqual(r['facebook_reels'], {'state': 'posted', 'id': 'V1', 'link': 'https://www.facebook.com/reel/V1'})
        self.assertEqual(r['tiktok']['state'], 'inbox')  # before TikTok's audit: Jon finishes it in the app
        self.assertEqual(r['youtube_shorts'], {'state': 'posted', 'id': 'VIDEO000001',
                                               'link': 'https://youtube.com/shorts/VIDEO000001'})
        self.assertEqual(self.dash_calls, [('GET', '/approvals/a_0123abcd'), ('POST', '/approvals/a_0123abcd/claim'),
                                           ('POST', '/approvals/a_0123abcd/done')])
        self.assertEqual(self.fake.ig_form, {'media_type': 'REELS', 'upload_type': 'resumable', 'caption': TEXT,
                                             'share_to_feed': 'true'})
        self.assertEqual(self.fake.fb_form, {'upload_phase': 'finish', 'video_id': 'V1', 'video_state': 'PUBLISHED',
                                             'description': TEXT})
        size = self.clip.stat().st_size
        self.assertEqual(self.fake.tt_path, '/post/publish/inbox/video/init/')
        self.assertEqual(self.fake.tt_init, {'source_info': {'source': 'FILE_UPLOAD', 'video_size': size,
                                                             'chunk_size': size, 'total_chunk_count': 1}})
        for url in (sp.RUPLOAD + '/ig-api-upload/v23.0/C1', sp.RUPLOAD + '/video-upload/v23.0/V1', TT_UPLOAD):
            self.assertEqual(self.fake.got[url], self.clip.read_bytes())
        self.assertEqual(self.fake.google.got, self.clip.read_bytes())
        meta = self.fake.google.meta
        self.assertEqual(meta['status'], {'privacyStatus': 'public', 'selfDeclaredMadeForKids': False,
                                          'containsSyntheticMedia': True})
        self.assertEqual(meta['snippet']['title'], 'Real or AI? None of it is real')
        self.assertEqual(meta['snippet']['description'], TEXT + ' #Shorts')
        rec = self.record('instagram_reels', 'IG1')
        self.assertEqual((rec['state'], rec['id'], rec['link'], rec['approval']), ('posted', 'M1', PERMALINK, 'a_0123abcd'))
        self.assertEqual(list((sp.DIR / 'posts').glob('*.lock')), [])

    def test_waits_while_each_platform_processes(self):
        self.fake.ig_status = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']
        self.fake.fb_status = ['in_progress', 'complete']
        self.fake.tt_status = [{'status': 'PROCESSING_UPLOAD'}, {'status': 'PROCESSING_DOWNLOAD'}, {'status': 'SEND_TO_USER_INBOX'}]
        out = sp.post('a_0123abcd')
        self.assertTrue(out['complete'])
        self.assertEqual((self.fake.published, self.fake.finishes), (1, 1))
        self.assertEqual(self.sleep.call_count, 5)

    def test_a_platform_error_is_recorded_the_rest_post_and_a_rerun_posts_only_what_is_missing(self):
        self.fake.fail['/IG1/media_publish'] = (400, {}, json.dumps({'error': {
            'code': 9, 'message': 'Application request limit reached'}}).encode())
        out = sp.post('a_0123abcd')
        self.assertFalse(out['complete'])
        r = out['clips'][0]
        self.assertEqual(r['instagram_reels'], {'error': 'Meta said 400: Application request limit reached'})
        self.assertEqual(self.record('instagram_reels', 'IG1')['error'], 'Meta said 400: Application request limit reached')
        self.assertEqual([r[p]['state'] for p in sp.PLATFORMS[1:]], ['posted', 'inbox', 'posted'])
        self.assertEqual(self.dash_calls[-1], ('POST', '/approvals/a_0123abcd/release'))
        del self.fake.fail['/IG1/media_publish']
        before = len(self.fake.calls)
        out = sp.post('a_0123abcd')  # Jon's approval was given back, so it is "approved" again
        self.assertTrue(out['complete'])
        self.assertEqual(out['clips'][0]['instagram_reels']['state'], 'posted')
        self.assertTrue(all(out['clips'][0][p]['already_posted'] for p in sp.PLATFORMS[1:]))
        self.assertEqual(self.fake.posting_calls(before), [('POST', sp.GRAPH + '/IG1/media_publish')])  # same container
        self.assertEqual(self.dash_calls[-1], ('POST', '/approvals/a_0123abcd/done'))

    def test_refuses_without_an_approved_post_clips_approval_that_lists_the_exact_clip(self):
        missing = self.make()
        missing['payload']['clips'][0]['file'] = str(self.tmp / 'nope.mp4')
        no_synthetic, rerendered, no_hash, bad_platform = self.make(), self.make(), self.make(), self.make()
        del no_synthetic['payload']['clips'][0]['synthetic']
        rerendered['payload']['clips'][0]['sha256'] = hashlib.sha256(b'the version Jon watched').hexdigest()
        del no_hash['payload']['clips'][0]['sha256']
        bad_platform['payload']['platforms'] = ['instagram_reels', 'x']
        for bad in (self.make(status='pending'), self.make(status='rejected'), self.make(status='done'),
                    self.make(status='running'), self.make(action='publish_video'), missing, no_synthetic, rerendered,
                    no_hash, bad_platform):
            self.approval, self.dash_calls = bad, []
            with self.assertRaises(sp.Fail) as e:
                sp.post('a_0123abcd')
            self.assertEqual(e.exception.code, 2)
            self.assertEqual(self.dash_calls, [('GET', '/approvals/a_0123abcd')])  # never claimed
        self.assertEqual(self.fake.calls, [])  # no platform touched

    def test_a_file_changed_after_the_check_is_not_uploaded(self):
        _, _, clips = sp.clips_of(self.approval['payload'])
        self.clip.write_bytes(os.urandom(300 * 1024))  # re-rendered while the run was starting
        out = sp.post_one('instagram_reels', clips[0], (sp.Meta(), 'IG1'), 'a_0123abcd')
        self.assertIn('the file changed after Jon approved it', out['error'])
        self.assertEqual(self.fake.calls, [])

    def test_a_horizontal_or_too_long_clip_is_refused_before_the_claim(self):
        for shape in ((1920, 1080, 15.0), (1080, 1920, 120.0)):
            sp.probe.return_value, self.dash_calls = shape, []
            with self.assertRaises(sp.Fail) as e:
                sp.post('a_0123abcd')
            self.assertIn('vertical and 3 to 90 s', str(e.exception))
            self.assertEqual(self.dash_calls, [('GET', '/approvals/a_0123abcd')])

    def test_ffprobe_rotation_is_applied(self):
        rotated = json.dumps({'programs': [], 'streams': [{'width': 1920, 'height': 1080, 'side_data_list': [
            {}, {'rotation': -90}]}], 'format': {'duration': '12.500000'}})
        plain = json.dumps({'programs': [], 'streams': [{'width': 1080, 'height': 1920}], 'format': {'duration': '16.636'}})
        for out, want in ((rotated, (1080, 1920, 12.5)), (plain, (1080, 1920, 16.636))):
            with mock.patch.object(sp.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, out.encode(), b'')):
                self.assertEqual(REAL_PROBE(self.clip), want)
        with mock.patch.object(sp.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'bad')), \
                self.assertRaises(sp.Fail):
            REAL_PROBE(self.clip)

    def test_never_posts_the_same_clip_twice_even_from_a_copy(self):
        sp.post('a_0123abcd')
        first = len(self.fake.calls)
        copy = self.tmp / 'elsewhere.mp4'
        shutil.copy(self.clip, copy)
        self.approval = self.make(file=copy, id='a_4567abcd')
        out = sp.post('a_4567abcd')
        self.assertTrue(out['complete'])
        self.assertTrue(all(out['clips'][0][p]['already_posted'] for p in sp.PLATFORMS))
        self.assertEqual(self.fake.posting_calls(first), [])
        self.assertEqual(self.fake.published, 1)

    def test_another_account_is_not_already_posted(self):
        sp.post('a_0123abcd')
        tok = json.loads((sp.DIR / 'tiktok.json').read_text())
        (sp.DIR / 'tiktok.json').write_text(json.dumps(dict(tok, open_id='o2')))  # a different TikTok account
        out = sp.post('a_0123abcd')
        self.assertEqual(out['clips'][0]['tiktok']['state'], 'inbox')
        self.assertNotIn('already_posted', out['clips'][0]['tiktok'])
        self.assertTrue(out['clips'][0]['instagram_reels']['already_posted'])
        self.assertEqual(self.fake.inits, 2)

    def test_a_second_run_on_the_same_clip_waits_its_turn(self):
        self.approval = self.make(platforms=['instagram_reels'])
        lock = sp.record_path(sha_of(self.clip), 'instagram_reels', 'IG1').with_suffix('.lock')
        lock.parent.mkdir(parents=True)
        lock.write_bytes(b'')  # another run is posting it right now
        out = sp.post('a_0123abcd')
        self.assertIn('another run is posting', out['clips'][0]['instagram_reels']['error'])
        self.assertEqual(self.fake.calls, [])
        old = time.time() - sp.STALE - 60
        os.utime(lock, (old, old))  # that run was killed hours ago
        self.assertEqual(sp.post('a_0123abcd')['clips'][0]['instagram_reels']['state'], 'posted')
        self.assertFalse(lock.exists())

    def test_a_run_killed_right_after_instagram_published_never_publishes_again(self):
        self.approval = self.make(platforms=['instagram_reels'])
        self.fake.fail['crash_after_publish'] = None
        with self.assertRaises(KeyboardInterrupt):
            sp.post('a_0123abcd')
        del self.fake.fail['crash_after_publish']
        lock = sp.record_path(sha_of(self.clip), 'instagram_reels', 'IG1').with_suffix('.lock')
        self.assertFalse(lock.exists())
        out = sp.post('a_0123abcd')
        self.assertEqual(out['clips'][0]['instagram_reels'], {'state': 'posted', 'link': 'https://www.instagram.com/jonmac/'})
        self.assertEqual(self.fake.published, 1)

    def test_instagram_error_or_expiry_starts_over_with_a_new_container(self):
        self.approval = self.make(platforms=['instagram_reels'])
        for status in ('ERROR', 'EXPIRED'):
            self.fake.ig_status = [status]
            out = sp.post('a_0123abcd')
            self.assertIn('Instagram could not process the clip', out['clips'][0]['instagram_reels']['error'])
            self.assertNotIn('container', self.record('instagram_reels', 'IG1'))
        self.fake.ig_status = ['FINISHED']
        self.assertEqual(sp.post('a_0123abcd')['clips'][0]['instagram_reels']['state'], 'posted')
        self.assertEqual((self.fake.containers, self.fake.published), (3, 1))
        self.assertEqual(self.sleep.call_count, 0)

    def test_facebook_lost_finish_answer_is_not_finished_twice_and_expired_starts_over(self):
        self.approval = self.make(platforms=['facebook_reels'])
        self.fake.lose_finish_answer = True
        out = sp.post('a_0123abcd')
        self.assertIn('connection reset', out['clips'][0]['facebook_reels']['error'])
        self.assertEqual(sp.post('a_0123abcd')['clips'][0]['facebook_reels']['state'], 'posted')
        self.assertEqual(self.fake.finishes, 1)  # the rerun saw Facebook publishing it and didn't ask again
        self.clip.write_bytes(os.urandom(300 * 1024))
        self.approval, self.fake.fb_finished, self.fake.fb_video_status = self.make(platforms=['facebook_reels']), False, 'expired'
        out = sp.post('a_0123abcd')
        self.assertIn('Facebook could not process the reel', out['clips'][0]['facebook_reels']['error'])
        self.assertNotIn('video', self.record('facebook_reels', 'PAGE1'))
        self.assertEqual(self.sleep.call_count, 0)  # no 10-minute wait on a dead video

    def test_tiktok_failed_starts_over(self):
        self.approval = self.make(platforms=['tiktok'])
        self.fake.tt_status = [{'status': 'FAILED', 'fail_reason': 'file_format_check_failed'}]
        out = sp.post('a_0123abcd')
        self.assertIn('file_format_check_failed', out['clips'][0]['tiktok']['error'])
        self.fake.tt_status = [{'status': 'SEND_TO_USER_INBOX'}]
        self.assertEqual(sp.post('a_0123abcd')['clips'][0]['tiktok']['state'], 'inbox')
        self.assertEqual(self.fake.inits, 2)

    def test_tiktok_multi_chunk_upload_and_a_run_that_stopped_mid_upload(self):
        self.approval = self.make(platforms=['tiktok'])
        with mock.patch.object(sp, 'TIKTOK_CHUNK', 128 * 1024):
            self.fake.tt_break_on = 2  # the network drops on the second of two chunks
            out = sp.post('a_0123abcd')
            self.assertIn('network gone', out['clips'][0]['tiktok']['error'])
            self.fake.tt_status = [{'status': 'PROCESSING_UPLOAD'}]
            out = sp.post('a_0123abcd')  # within the hour: TikTok still holds the half upload
            self.assertIn('stopped part way', out['clips'][0]['tiktok']['error'])
            self.assertEqual((self.fake.inits, self.sleep.call_count), (1, 0))
            rp = sp.record_path(sha_of(self.clip), 'tiktok', 'o1')
            rec = json.loads(rp.read_text())
            rp.write_text(json.dumps(dict(rec, started=rec['started'] - 4000)))  # its upload link has expired
            self.fake.tt_status = [{'status': 'PROCESSING_UPLOAD'}, {'status': 'SEND_TO_USER_INBOX'}]
            out = sp.post('a_0123abcd')
        self.assertEqual(out['clips'][0]['tiktok']['state'], 'inbox')
        self.assertEqual(self.fake.inits, 2)
        size = self.clip.stat().st_size
        self.assertEqual(self.fake.tt_init['source_info'], {'source': 'FILE_UPLOAD', 'video_size': size,
                                                            'chunk_size': 128 * 1024, 'total_chunk_count': 2})
        self.assertEqual(self.fake.got[TT_UPLOAD], self.clip.read_bytes())  # 128 KiB, then the last 172 KiB

    def test_dry_run_checks_the_accounts_and_posts_nothing(self):
        out = sp.post('a_0123abcd', dry_run=True)
        self.assertEqual(out['accounts'], {'instagram_reels': {'account': 'Instagram @jonmac'},
                                           'facebook_reels': {'account': 'Facebook Page Jon Mac'},
                                           'tiktok': {'account': 'TikTok Jon Mac'},
                                           'youtube_shorts': {'account': 'YouTube Jon Mac | AI UGC'}})
        self.assertEqual({p: out['clips'][0][p] for p in sp.PLATFORMS}, dict.fromkeys(sp.PLATFORMS, 'would post'))
        self.assertEqual(self.dash_calls, [('GET', '/approvals/a_0123abcd')])
        self.assertEqual(self.fake.posting_calls(), [])

    def test_youtube_waits_for_its_audit_and_tiktok_posts_publicly_after_its_audit(self):
        self.fake.tt_status = [{'status': 'PUBLISH_COMPLETE', 'publicaly_available_post_id': [7400000000000000001]}]
        with mock.patch.object(yu, 'AUDITED', False), mock.patch.object(sp, 'TIKTOK_AUDITED', True):
            out = sp.post('a_0123abcd')
        r = out['clips'][0]
        self.assertIn("YouTube API audit", r['youtube_shorts']['error'])
        self.assertEqual(r['tiktok'], {'state': 'posted', 'id': '7400000000000000001',
                                       'link': 'https://www.tiktok.com/@jonmac/video/7400000000000000001'})
        self.assertEqual(self.fake.tt_path, '/post/publish/video/init/')
        self.assertEqual(self.fake.tt_init['post_info'], {'title': TEXT, 'privacy_level': 'PUBLIC_TO_EVERYONE', 'is_aigc': True})
        self.assertFalse(out['complete'])
        self.assertEqual(self.dash_calls[-1], ('POST', '/approvals/a_0123abcd/release'))

    def test_a_short_youtube_keeps_private_is_not_reported_as_posted(self):
        self.approval = self.make(platforms=['youtube_shorts'])
        self.fake.yt_privacy = 'private'
        r = sp.post('a_0123abcd')['clips'][0]['youtube_shorts']
        self.assertIn('kept the Short private', r['error'])
        self.assertNotIn('state', r)

    def test_a_platform_that_is_not_connected_fails_alone(self):
        (sp.DIR / 'tiktok.json').unlink()
        out = sp.post('a_0123abcd')
        self.assertIn('TikTok is not connected yet', out['clips'][0]['tiktok']['error'])
        self.assertEqual(out['clips'][0]['instagram_reels']['state'], 'posted')
        check = sp.run(sp.parser().parse_args(['check']))['accounts']
        self.assertEqual((check['instagram_reels'], sorted(check)), ({'account': 'Instagram @jonmac'}, sorted(sp.PLATFORMS[:3])))
        self.assertIn('not connected', check['tiktok']['error'])


class Connect(Base):
    def test_meta_saves_the_one_page_with_instagram(self):
        answers = {}

        def meta(method, url, data=None, headers=None):
            if '/oauth/access_token?' in url:
                q = dict(urllib.parse.parse_qsl(url.split('?', 1)[1]))
                assert q['grant_type'] == 'fb_exchange_token' and q['fb_exchange_token'] == 'EAAshort' + 'x' * 30
                return ok(answers.get('exchange', {'access_token': 'EAAlong'}))
            assert url.startswith(sp.GRAPH + '/me/accounts?limit=100') and headers['Authorization'] == 'OAuth EAAlong'
            return ok({'data': pages})
        (sp.DIR / 'meta.json').unlink()
        pages = [{'id': 'P0', 'name': 'Old Page', 'access_token': 'x'},
                 {'id': 'P9', 'name': 'No token', 'instagram_business_account': {'id': 'IG9'}},
                 {'id': 'PAGE1', 'name': 'Jon Mac', 'access_token': 'pt',
                  'instagram_business_account': {'id': 'IG1', 'username': 'jonmac'}}]
        args = ('1234567890', 'a' * 32, 'EAAshort' + 'x' * 30)
        with mock.patch.object(yu, 'http', meta):
            self.assertEqual(sp.meta_connect(*args), '')
            saved = json.loads((sp.DIR / 'meta.json').read_text())
            self.assertEqual((saved['page_id'], saved['page_token'], saved['ig_id']), ('PAGE1', 'pt', 'IG1'))
            self.assertTrue(google_connect.connected('meta'))
            pages.append(dict(pages[2], id='PAGE2'))
            self.assertIn('exactly one', sp.meta_connect(*args))
            answers['exchange'] = {'token_type': 'bearer'}  # no access_token in the answer
            self.assertIn('unexpected', sp.meta_connect(*args))
        self.assertIn('not an App ID', sp.meta_connect('abc', 'a' * 32, 'x'))

    def test_tiktok_consent_saves_a_refresh_token(self):
        (sp.DIR / 'tiktok.json').unlink()
        self.assertFalse(google_connect.connected('tiktok'))
        flow = google_connect.Flow()
        url = flow.start('tiktok')
        q = dict(urllib.parse.parse_qsl(url.split('?', 1)[1]))
        self.assertEqual((q['client_key'], q['redirect_uri'], q['code_challenge_method']),
                         ('ck', 'http://localhost:8765/tiktok-callback/', 'S256'))
        verifier = flow.pending[q['state']][1]
        self.assertEqual(q['code_challenge'], hashlib.sha256(verifier.encode()).hexdigest())
        self.assertEqual(flow.finish(q['state'], 'code1'), ('tiktok', ''))
        self.assertTrue(google_connect.connected('tiktok'))
        saved = json.loads((sp.DIR / 'tiktok.json').read_text())
        self.assertEqual((saved['refresh_token'], saved['open_id']), ('trt', 'o1'))
        with mock.patch.object(yu, 'http', return_value=ok({'access_token': 'tat', 'scope': 'video.upload'})):
            self.assertIn('no long-lived sign-in', sp.tiktok_connect('code2', verifier))
        sp.tiktok_client_save('newkey12345', 's' * 32)  # a new TikTok app needs a new sign-in
        self.assertFalse(google_connect.connected('tiktok'))

    def test_the_page_shows_the_new_steps_and_saves_the_tiktok_app(self):
        srv = google_connect.ThreadingHTTPServer(('127.0.0.1', 0), google_connect.handler(google_connect.Flow(),
                                                                                          threading.Event()))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        base, host = 'http://127.0.0.1:%d' % srv.server_address[1], {'Host': 'localhost:8765'}
        with mock.patch.object(google_connect, 'log'):
            index = urllib.request.urlopen(urllib.request.Request(base + '/', headers=host)).read().decode()
            self.assertIn('Connect TikTok', index)
            self.assertIn('Graph API Explorer', index)
            key = index.split('name="key" value="', 1)[1].split('"', 1)[0]
            form = urllib.parse.urlencode({'key': key, 'client_key': 'awkey123456', 'client_secret': 'z' * 32}).encode()
            saved = urllib.request.urlopen(urllib.request.Request(base + '/tiktok-client', form, host)).read().decode()
            self.assertIn('TikTok app saved', saved)
            form = urllib.parse.urlencode({'key': 'wrong', 'client_key': 'evilkey1234', 'client_secret': 'z' * 32}).encode()
            self.assertIn('Not saved', urllib.request.urlopen(urllib.request.Request(base + '/tiktok-client', form, host)).read().decode())
        self.assertEqual(json.loads((sp.DIR / 'tiktok-client.json').read_text())['client_key'], 'awkey123456')


if __name__ == '__main__':
    unittest.main()
