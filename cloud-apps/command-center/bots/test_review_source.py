"""python -I bots/test_review_source.py from cloud-apps/command-center. Uses real ffmpeg; touches nothing live."""
import json
import subprocess
import sys
import tempfile
import unittest
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

    def test_viral_view_takes_the_first_reference_like_preflight(self):
        self.file('vv', 'theo-1', 'reference', 'source_b.mp4')
        first = self.file('vv', 'theo-1', 'reference', 'source_a.mp4')
        self.assertEqual(rs.original('theo-1'), first)

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
        data = rs.web_copy(src, 'zane-1').read_bytes()
        self.assertLess(data.find(b'moov'), data.find(b'mdat'))

    def test_second_call_uses_the_copy_and_leaves_no_temp_file(self):
        src = self.root / 'in.mp4'
        make(src, '-c:v', 'mpeg4', '-c:a', 'mp3')
        out = rs.web_copy(src, 'gail-1')
        with mock.patch.object(rs.subprocess, 'run', side_effect=AssertionError('ran again')):
            self.assertEqual(rs.web_copy(src, 'gail-1'), out)
        self.assertEqual([p.name for p in rs.CACHE.iterdir()], ['gail-1.mp4'])


class Add(Base):
    def api(self, video=None, fail_on=None):
        calls = []

        def fake(method, path, body=None, raw=None):
            calls.append((method, path))
            if fail_on and fail_on in path:
                raise OSError('boom')
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
        self.assertEqual(len(calls), 1)

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


if __name__ == '__main__':
    unittest.main()
