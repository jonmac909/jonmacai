"""python -I bots/test_review_source.py from cloud-apps/command-center. Uses real ffmpeg; touches nothing live."""
import io
import json
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import review_source as rs  # noqa: E402

HIDDEN = 0x08000000


def make(path, *codec):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=1:s=64x64:r=10', '-f', 'lavfi', '-i', 'sine=d=1',
                    '-shortest', *codec, str(path)], check=True, capture_output=True, creationflags=HIDDEN)


def codecs(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'json', str(path)],
                         capture_output=True, encoding='utf-8', check=True, creationflags=HIDDEN).stdout
    return [s['codec_name'] for s in json.loads(out)['streams']]


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        for name, value in (('HGP_PACKS', 'packs'), ('VV', 'vv'), ('REMAKES', 'remakes'), ('CACHE', 'cache')):
            patch = mock.patch.object(rs, name, self.root / value)
            patch.start()
            self.addCleanup(patch.stop)

    def file(self, *parts):
        path = self.root.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'x')
        return path


class Original(Base):
    def test_first_video_uses_the_hosts_pack(self):
        pack = self.file('packs', 'gail', 'source', 'source.mp4')
        self.assertEqual(rs.original('gail-1'), pack)

    def test_a_second_video_never_borrows_the_first_ones_original(self):
        self.file('packs', 'gail', 'source', 'source.mp4')
        self.assertIsNone(rs.original('gail-2'))

    def test_a_second_video_with_its_own_pack(self):
        self.file('packs', 'gail', 'source', 'source.mp4')
        own = self.file('packs', 'gail-2', 'source', 'source.mp4')
        self.assertEqual(rs.original('gail-2'), own)

    def test_viral_view_with_one_reference(self):
        only = self.file('vv', 'theo-1', 'reference', 'source_a.mp4')
        self.assertEqual(rs.original('theo-1'), only)

    def test_several_references_are_not_a_guess(self):
        self.file('vv', 'aria-1', 'reference', 'source_a.mp4')
        self.file('vv', 'aria-1', 'reference', 'source_b.mp4')
        self.assertIsNone(rs.original('aria-1'))

    def test_short_form_remake(self):
        remake = self.file('remakes', 'aygramm', 'src', 'source.mp4')
        self.assertEqual(rs.original('aygramm-selfie'), remake)

    def test_nothing_stored(self):
        self.assertIsNone(rs.original('topview-2'))


class WebCopy(Base):
    def test_av1_like_sources_become_h264_aac_and_the_original_stays(self):
        src = self.root / 'in.mp4'
        make(src, '-c:v', 'mpeg4', '-c:a', 'mp3')
        before = src.read_bytes()
        out = rs.web_copy(src, 'gail-1')
        self.assertEqual(codecs(out), ['h264', 'aac'])
        self.assertEqual(src.read_bytes(), before)

    def test_h264_aac_is_only_remuxed_with_moov_first(self):
        src = self.root / 'in.mp4'
        make(src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac')
        with mock.patch.object(rs.subprocess, 'run', wraps=subprocess.run) as ran:
            data = rs.web_copy(src, 'zane-1').read_bytes()
        self.assertLess(data.find(b'moov'), data.find(b'mdat'))
        self.assertNotIn('libx264', ran.call_args.args[0])

    def test_a_source_with_no_sound_still_copies(self):
        src = self.root / 'in.mp4'
        src.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=1:s=64x64:r=10', '-c:v', 'mpeg4', str(src)],
                       check=True, capture_output=True, creationflags=HIDDEN)
        self.assertEqual(codecs(rs.web_copy(src, 'gail-1')), ['h264'])

    def test_odd_picture_sizes_encode(self):
        src = self.root / 'in.mp4'
        make(src, '-c:v', 'mpeg4', '-c:a', 'mp3', '-vf', 'scale=63:63')
        self.assertEqual(codecs(rs.web_copy(src, 'gail-1')), ['h264', 'aac'])

    def test_the_first_video_stream_decides_like_the_map(self):
        src = self.root / 'in.mp4'
        make(src, '-c:v', 'mpeg4', '-c:a', 'mp3')
        listing = json.dumps({'streams': [
            {'codec_type': 'video', 'codec_name': 'mpeg4', 'pix_fmt': 'yuv420p'},
            {'codec_type': 'video', 'codec_name': 'h264', 'pix_fmt': 'yuv420p'},
            {'codec_type': 'audio', 'codec_name': 'aac'}]})
        real = subprocess.run

        def probe_then_ffmpeg(args, **kw):
            if args[0] == 'ffprobe':
                return subprocess.CompletedProcess(args, 0, listing, '')
            return real(args, **kw)
        with mock.patch.object(rs.subprocess, 'run', probe_then_ffmpeg):
            out = rs.web_copy(src, 'gail-1')
        self.assertEqual(codecs(out), ['h264', 'aac'])

    def test_a_failed_encode_says_why(self):
        src = self.root / 'in.mp4'
        src.write_bytes(b'not a video')
        listing = json.dumps({'streams': [{'codec_type': 'video', 'codec_name': 'mpeg4', 'pix_fmt': 'yuv420p'}]})
        real = subprocess.run

        def probe_then_ffmpeg(args, **kw):
            if args[0] == 'ffprobe':
                return subprocess.CompletedProcess(args, 0, listing, '')
            return real(args, **kw)
        with mock.patch.object(rs.subprocess, 'run', probe_then_ffmpeg):
            with self.assertRaisesRegex(RuntimeError, '(?s)ffmpeg failed: .*Invalid data'):
                rs.web_copy(src, 'gail-1')

    def test_a_corrected_original_gets_its_own_copy(self):
        src = self.root / 'source.mp4'
        make(src, '-c:v', 'mpeg4', '-c:a', 'mp3')
        first = rs.web_copy(src, 'gail-1')
        make(src, '-c:v', 'mpeg4', '-c:a', 'mp3', '-vf', 'scale=32:32')
        self.assertNotEqual(rs.web_copy(src, 'gail-1'), first)

    def test_a_same_size_original_with_another_name_gets_its_own_copy(self):
        src = self.root / 'a.mp4'
        make(src, '-c:v', 'mpeg4', '-c:a', 'mp3')
        first = rs.web_copy(src, 'gail-1')
        other = self.root / 'b.mp4'
        other.write_bytes(src.read_bytes())
        self.assertNotEqual(rs.web_copy(other, 'gail-1'), first)

    def test_second_call_uses_the_copy_and_leaves_no_temp_file(self):
        src = self.root / 'in.mp4'
        make(src, '-c:v', 'mpeg4', '-c:a', 'mp3')
        out = rs.web_copy(src, 'gail-1')
        with mock.patch.object(rs.subprocess, 'run', side_effect=AssertionError('ran again')):
            self.assertEqual(rs.web_copy(src, 'gail-1'), out)
        self.assertEqual([p for p in rs.CACHE.iterdir()], [out])


class Add(Base):
    def api(self, video=None, fail_on=None):
        calls = []

        def fake(method, path, body=None, raw=None):
            calls.append((method, path))
            if fail_on and fail_on in path:
                raise OSError('boom')
            if path == '/videos':
                return {'videos': []}
            if method == 'GET':
                return {'video': video or {}}
            if path.endswith('/uploads'):
                return {'key': 'review/gail-1-v3/source-a.mp4', 'uploadId': 'u/1'}
            if raw is not None:
                return {'partNumber': 1, 'etag': 'e'}
            return {}
        patch = mock.patch.object(rs, 'api', fake)
        patch.start()
        self.addCleanup(patch.stop)
        return calls

    def stored(self):
        src = self.root / 'packs' / 'gail' / 'source' / 'source.mp4'
        make(src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac')

    def test_a_page_with_a_source_is_left_alone(self):
        calls = self.api({'source_url': 'https://x'})
        self.assertEqual(rs.add('gail-1-v3'), 'has source')
        self.assertEqual(len(calls), 1)

    def test_no_stored_original_uploads_nothing(self):
        calls = self.api()
        self.assertEqual(rs.add('topview-2-v5'), 'not stored')
        self.assertEqual(calls, [('GET', '/topview-2-v5'), ('GET', '/videos')])

    def carry(self, sent=b'the original', promised=None):
        rows = {'videos': [{'slug': 'mina-1-v9', 'source_url': 'https://x/old'}, {'slug': 'mina-1-v11', 'source_url': 'https://x/new'},
                           {'slug': 'mina-1-v10', 'source_url': None}, {'slug': 'mina-2-v99', 'source_url': 'https://x/other'},
                           {'slug': 'mina-1-v13', 'source_url': 'https://x/later'}]}
        asked, attached = [], []

        def fake(method, path, body=None, raw=None):
            attached.extend([path] if path.endswith('/source') else [])
            if path == '/videos':
                return rows
            return {'video': {}} if method == 'GET' else {'key': 'k', 'uploadId': 'u', 'partNumber': 1, 'etag': 'e'}

        def urlopen(request, timeout):
            asked.append((request.full_url, request.get_header('Authorization')))
            reply = io.BytesIO(sent)
            reply.headers = {'Content-Length': str(len(sent) if promised is None else promised)}
            return reply
        with mock.patch.object(rs, 'api', fake), mock.patch.object(rs, 'token', return_value='tok'), \
                mock.patch.object(rs.urllib.request, 'urlopen', urlopen), \
                mock.patch.object(rs, 'web_copy', side_effect=lambda src, video: src) as web_copy:
            try:
                return asked, attached, web_copy, rs.add('mina-1-v12')
            except RuntimeError as err:
                return asked, attached, web_copy, str(err)

    def test_a_new_version_with_nothing_stored_uses_the_newest_earlier_source(self):
        asked, attached, web_copy, result = self.carry()
        self.assertEqual(result, 'added')
        self.assertEqual(asked, [('https://x/new', 'Bearer tok')])
        carried = rs.CACHE / 'carried-mina-1-v12.mp4'
        self.assertEqual(carried.read_bytes(), b'the original')
        web_copy.assert_called_once_with(carried, 'mina-1')  # an old upload may not play on an iPhone
        self.assertEqual(attached, ['/mina-1-v12/source'])

    def test_another_videos_source_is_never_carried(self):
        rows = {'videos': [{'slug': 'mina-2-v1', 'source_url': 'https://x/other'}]}
        with mock.patch.object(rs, 'api', return_value=rows), mock.patch.object(rs, 'token', return_value='t'), \
                mock.patch.object(rs.urllib.request, 'urlopen', side_effect=AssertionError('downloaded')):
            self.assertIsNone(rs.carried('mina-1-v12'))

    def test_a_cut_off_download_is_never_attached(self):
        _, attached, _, result = self.carry(sent=b'the', promised=1000)
        self.assertIn('cut off', result)
        self.assertEqual(attached, [])

    def test_several_references_never_fall_back_to_an_older_version(self):
        self.file('vv', 'aria-1', 'reference', 'source_a.mp4')
        self.file('vv', 'aria-1', 'reference', 'source_b.mp4')
        calls = self.api()
        self.assertEqual(rs.add('aria-1-v6'), 'not stored')
        self.assertNotIn(('GET', '/videos'), calls)

    def test_a_stored_original_beats_an_earlier_version(self):
        calls = self.api()
        self.stored()
        self.assertEqual(rs.add('gail-1-v3'), 'added')
        self.assertNotIn(('GET', '/videos'), calls)

    def test_upload_then_attach_in_order(self):
        calls = self.api()
        self.stored()
        self.assertEqual(rs.add('gail-1-v3'), 'added')
        self.assertEqual(calls[1:3], [('POST', '/gail-1-v3/uploads'), ('PUT', '/gail-1-v3/uploads/u%2F1/1?key=review%2Fgail-1-v3%2Fsource-a.mp4')])
        self.assertEqual(calls[-2:], [('POST', '/gail-1-v3/uploads/u%2F1/complete'), ('POST', '/gail-1-v3/source')])

    def test_a_failed_upload_is_aborted_and_never_attached(self):
        calls = self.api(fail_on='/complete')
        self.stored()
        with self.assertRaises(OSError):
            rs.add('gail-1-v3')
        self.assertEqual(calls[-1][0], 'DELETE')
        self.assertNotIn(('POST', '/gail-1-v3/source'), calls)

    def test_publish_survives_and_ana_hears(self):
        self.api(fail_on='/gail-1-v3')
        with mock.patch.object(rs.hook, 'fire') as fire:
            self.assertEqual(rs.add_or_report('gail-1-v3'), 'failed')
        self.assertEqual(fire.call_args.args[0], 'script_failure')

    def test_a_page_left_with_no_source_is_reported(self):
        self.api()
        with mock.patch.object(rs.hook, 'fire') as fire:
            self.assertEqual(rs.add_or_report('topview-2-v5'), 'not stored')
        self.assertIn('topview-2-v5: no stored original', fire.call_args.args[1]['error'])

    def test_a_page_with_a_source_reports_nothing(self):
        self.api({'source_url': 'https://x'})
        with mock.patch.object(rs.hook, 'fire') as fire:
            self.assertEqual(rs.add_or_report('gail-1-v3'), 'has source')
        fire.assert_not_called()

    def test_a_broken_report_never_reaches_the_publisher(self):
        self.api(fail_on='/gail-1-v3')
        with mock.patch.object(rs.hook, 'fire', side_effect=rs.hook.Fail('webhooks', 'unreadable')), mock.patch('sys.stderr', io.StringIO()) as err:
            self.assertEqual(rs.add_or_report('gail-1-v3'), 'failed')
        self.assertIn('could not report', err.getvalue())


class Requests(Base):
    def test_api_sends_the_token_and_reads_json(self):
        seen = []

        class Reply(io.BytesIO):
            def __enter__(self):
                return self

        def urlopen(request, timeout):
            seen.append(request)
            return Reply(b'{"ok": true}')
        env = self.root / '.jonmac-review.env'
        env.write_text('OTHER=1\nREVIEW_API_TOKEN="tok"\n', encoding='utf-8')
        with mock.patch.object(rs.Path, 'home', return_value=self.root), mock.patch.object(rs.urllib.request, 'urlopen', urlopen):
            self.assertEqual(rs.api('POST', '/a/source', {'source_key': 'k'}), {'ok': True})
        self.assertEqual(seen[0].full_url, rs.BASE + '/a/source')
        self.assertEqual(seen[0].get_header('Authorization'), 'Bearer tok')
        self.assertEqual(json.loads(seen[0].data), {'source_key': 'k'})

    def test_a_dropped_part_is_sent_again(self):
        replies = [OSError('reset'), urllib.error.HTTPError('u', 502, 'bad', {}, None), {'partNumber': 1}]
        with mock.patch.object(rs, 'api', side_effect=replies) as api, mock.patch.object(rs.time, 'sleep'):
            self.assertEqual(rs.put_part('/p', b'x'), {'partNumber': 1})
        self.assertEqual(api.call_count, 3)

    def test_a_part_stops_after_three_tries(self):
        with mock.patch.object(rs, 'api', side_effect=OSError('reset')) as api, mock.patch.object(rs.time, 'sleep'):
            with self.assertRaises(OSError):
                rs.put_part('/p', b'x')
        self.assertEqual(api.call_count, 3)

    def test_a_refused_part_is_not_sent_again(self):
        refused = urllib.error.HTTPError('u', 400, 'bad', {}, None)
        with mock.patch.object(rs, 'api', side_effect=refused) as api:
            with self.assertRaises(urllib.error.HTTPError):
                rs.put_part('/p', b'x')
        self.assertEqual(api.call_count, 1)


class Backfill(Base):
    def rows(self, *rows):
        return {'videos': [{'slug': s, 'source_url': u} for s, u in rows]}

    def test_one_failure_does_not_stop_the_rest_and_reports_once(self):
        listing = self.rows(('a-1-v1', None), ('b-1-v1', None), ('c-1-v1', 'https://x'))
        done = []

        def add(slug):
            done.append(slug)
            if slug == 'a-1-v1':
                raise OSError('boom')
            return 'added'
        with mock.patch.object(rs, 'api', return_value=listing), mock.patch.object(rs, 'add', add), mock.patch.object(rs.hook, 'fire') as fire:
            self.assertEqual(rs.backfill(False), 1)
        self.assertEqual(done, ['a-1-v1', 'b-1-v1'])
        self.assertEqual(fire.call_count, 1)

    def test_dry_run_changes_nothing(self):
        with mock.patch.object(rs, 'api', return_value=self.rows(('a-1-v1', None))), mock.patch.object(rs, 'add', side_effect=AssertionError('added')):
            self.assertEqual(rs.backfill(True), 0)

    def test_videos_with_nothing_stored_are_listed_once_and_are_no_failure(self):
        with mock.patch.object(rs, 'api', return_value=self.rows(('a-1-v1', None), ('b-1-v1', None))), \
                mock.patch.object(rs, 'add', return_value='not stored'), mock.patch.object(rs.hook, 'fire') as fire:
            self.assertEqual(rs.backfill(False), 0)
        self.assertEqual(fire.call_count, 1)
        self.assertIn('a-1-v1, b-1-v1', fire.call_args.args[1]['error'])

    def test_a_typo_in_the_command_runs_nothing(self):
        with mock.patch.object(rs, 'backfill', side_effect=AssertionError('ran')), mock.patch.object(rs, 'api', side_effect=AssertionError('called')):
            for args in (['backfill', '--dryrun'], ['clear'], ['clear', 'a', 'b'], []):
                with self.assertRaises(SystemExit) as stopped:
                    rs.main(args)
                self.assertIn('backfill [--dry-run]', stopped.exception.code)

    def test_clear_takes_one_slugs_source_off(self):
        with mock.patch.object(rs, 'api', return_value={'video': {}}) as api:
            self.assertEqual(rs.main(['clear', 'gail-1-v3']), 0)
        api.assert_called_once_with('DELETE', '/gail-1-v3/source')

    def test_a_failed_clear_is_reported(self):
        with mock.patch.object(rs, 'api', side_effect=OSError('down')), mock.patch.object(rs.hook, 'fire') as fire:
            with self.assertRaises(OSError):
                rs.main(['clear', 'gail-1-v3'])
        self.assertIn('clear: down', fire.call_args.args[1]['error'])


if __name__ == '__main__':
    unittest.main()
