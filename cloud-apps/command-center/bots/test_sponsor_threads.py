"""python -I bots/test_sponsor_threads.py  (stdlib only; Gmail is faked, nothing is read or sent)"""
import base64
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sponsor_threads as st  # noqa: E402
from google_api import Fail  # noqa: E402


def b64(s):
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')


def msg(frm, ms, text=None, html=None, labels=('INBOX',), subject='Rates'):
    parts = []
    if text is not None:
        parts.append({'mimeType': 'text/plain', 'body': {'data': b64(text)}})
    if html is not None:
        parts.append({'mimeType': 'text/html', 'body': {'data': b64(html)}})
    return {'labelIds': list(labels), 'internalDate': str(ms),
            'payload': {'mimeType': 'multipart/alternative', 'parts': parts,
                        'headers': [{'name': 'From', 'value': frm}, {'name': 'Subject', 'value': subject}]}}


class FakeGoogle:
    """Answers GET /threads/<id>; records every call so the test proves reads only."""
    def __init__(self, threads, fail=None):
        self.threads, self.fail, self.calls = threads, list(fail or []), []

    def call(self, method, url, body=None, query=None):
        self.calls.append((method, url, query))
        if self.fail:
            raise self.fail.pop(0)
        tid = url.rsplit('/', 1)[1]
        if tid not in self.threads:
            raise Fail(1, 'Google 404: Requested entity was not found.')
        return self.threads[tid]


class SponsorThreads(unittest.TestCase):
    def test_fold_quotes(self):
        body, quoted = st.fold_quotes('Sounds good.\n\nOn Mon, Nov 2, 2026 at 9:00 AM Ann <a@x.com>\nwrote:\n> old text')
        self.assertEqual((body, quoted), ('Sounds good.', True))
        self.assertEqual(st.fold_quotes('Hi\n> quoted line\n'), ('Hi', True))
        self.assertEqual(st.fold_quotes('Plain note'), ('Plain note', False))
        self.assertEqual(st.fold_quotes('Top\n-----Original Message-----\nFrom: x')[0], 'Top')

    def test_body_plain_then_html(self):
        self.assertEqual(st.body_of(msg('a', 1, text='plain words', html='<p>html</p>')['payload']), 'plain words')
        out = st.body_of(msg('a', 1, html='<p>Hello<br>there</p><blockquote>old</blockquote>')['payload'])
        self.assertEqual(out.strip(), 'Hello\nthere')

    def test_thread_oldest_first_drafts_left_out(self):
        t = {'messages': [
            msg('Ann <a@x.com>', 3000, text='Third'),
            msg('Ann <a@x.com>', 1000, text='First'),
            msg('Jon <partners@jonmac.ai>', 2000, text='Second\n\nOn Mon Ann wrote:\n> First'),
            msg('Jon <partners@jonmac.ai>', 4000, text='Unsent draft', labels=('DRAFT',)),
        ]}
        out = st.thread_of(t)
        self.assertEqual([m['body'] for m in out['messages']], ['First', 'Second', 'Third'])
        self.assertEqual([m['quoted'] for m in out['messages']], [False, True, False])
        self.assertEqual(out['messages'][0]['date'], '1970-01-01T00:00:01Z')
        self.assertEqual(out['subject'], 'Rates')

    def test_collect_reads_only_and_marks_missing(self):
        g = FakeGoogle({'abc123': {'messages': [msg('Ann', 1000, text='Hi')]}})
        out = st.collect(g, ['abc123', 'def456'], sleep=lambda s: None)
        self.assertEqual(list(out['threads']), ['abc123'])
        self.assertEqual(out['missing'], ['def456'])
        self.assertTrue(all(c[0] == 'GET' for c in g.calls))
        self.assertEqual(g.calls[0][2], {'format': 'full'})

    def test_quota_refusal_waits_then_retries(self):
        waits = []
        g = FakeGoogle({'abc123': {'messages': [msg('Ann', 1000, text='Hi')]}},
                       fail=[Fail(1, 'Google 403: Quota exceeded for quota metric Units per minute per user'),
                             Fail(1, 'Google 429: rate limit')])
        out = st.collect(g, ['abc123'], sleep=waits.append)
        self.assertEqual(waits, [20, 40])
        self.assertIn('abc123', out['threads'])
        g = FakeGoogle({}, fail=[Fail(1, 'Google 403: quota')] * 3)
        with self.assertRaises(Fail):
            st.collect(g, ['abc123'], sleep=lambda s: None)
        with self.assertRaises(Fail):  # a refusal that isn't quota is not retried
            st.collect(FakeGoogle({}, fail=[Fail(1, 'Google 401: invalid token')]), ['abc123'], sleep=waits.append)
        self.assertEqual(waits, [20, 40])


if __name__ == '__main__':
    unittest.main()
