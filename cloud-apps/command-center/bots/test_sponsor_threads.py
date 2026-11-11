"""python -I bots/test_sponsor_threads.py  (stdlib only; Gmail is faked)"""
import base64
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sponsor_threads as st  # noqa: E402
from google_api import Fail  # noqa: E402


def b64(s):
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')


def msg(ms, frm, plain=None, html=None, labels=('INBOX',), subject='Campaign'):
    parts = []
    if plain is not None:
        parts.append({'mimeType': 'text/plain', 'body': {'data': b64(plain)}})
    if html is not None:
        parts.append({'mimeType': 'text/html', 'body': {'data': b64(html)}})
    return {'internalDate': str(ms), 'labelIds': list(labels), 'payload': {
        'mimeType': 'multipart/alternative', 'parts': parts,
        'headers': [{'name': 'From', 'value': frm}, {'name': 'Subject', 'value': subject}]}}


class FoldQuotes(unittest.TestCase):
    def test_gmail_attribution_cut(self):
        text, quoted = st.fold_quotes('Sounds good.\r\n\r\nOn Mon, Oct 5, 2026 at 9:00 AM Viktor <v@x.com> wrote:\r\n> old\r\n> older')
        self.assertEqual((text, quoted), ('Sounds good.', True))

    def test_wrapped_attribution_and_outlook_block(self):
        self.assertEqual(st.fold_quotes('Hi\n\nOn Mon, Oct 5, 2026 at 9:00 AM Viktor\n<v@x.com> wrote:\n> x'), ('Hi', True))
        self.assertEqual(st.fold_quotes('Hi\n\nFrom: A <a@x.com>\nSent: Monday\nTo: b')[0], 'Hi')
        self.assertEqual(st.fold_quotes('Hi\n-----Original Message-----\nold')[0], 'Hi')

    def test_trailing_quote_lines_and_no_quote(self):
        self.assertEqual(st.fold_quotes('Hi\n> quoted\n>\n'), ('Hi', True))
        self.assertEqual(st.fold_quotes('Just words\n\n\n\nmore'), ('Just words\n\nmore', False))

    def test_long_body_cut(self):
        text, _ = st.fold_quotes('x' * (st.MAX_CHARS + 50))
        self.assertTrue(text.endswith(' …') and len(text) <= st.MAX_CHARS + 2)


class Bodies(unittest.TestCase):
    def test_plain_wins_over_html(self):
        self.assertEqual(st.body_of(msg(1, 'a', plain='plain words', html='<p>html words</p>')['payload']), 'plain words')

    def test_html_only_stripped_and_blockquote_dropped(self):
        p = msg(1, 'a', html='<style>x{}</style><div>Hello&amp;bye<br>line2</div><blockquote>old quoted</blockquote>')['payload']
        out = st.body_of(p)
        self.assertIn('Hello&bye', out)
        self.assertIn('line2', out)
        self.assertNotIn('old quoted', out)
        self.assertNotIn('x{}', out)

    def test_attachment_part_ignored(self):
        p = {'mimeType': 'text/plain', 'filename': 'a.txt', 'body': {'data': b64('secret file')}}
        self.assertEqual(st.body_of(p), '')


class ThreadOf(unittest.TestCase):
    def test_sorted_oldest_first_drafts_skipped_dates_utc(self):
        t = {'messages': [
            msg(1759483118000, 'Viktor <v@x.com>', plain='THIRD'),
            msg(1759300000000, 'Viktor <v@x.com>', plain='FIRST'),
            msg(1759400000000, 'Jon <p@x.com>', plain='DRAFT TEXT', labels=('DRAFT',)),
            msg(1759350000000, 'Jon <p@x.com>', plain='SECOND\n\nOn Tue, Sep 30 Viktor wrote:\n> FIRST'),
        ]}
        out = st.thread_of(t)
        self.assertEqual([m['body'] for m in out['messages']], ['FIRST', 'SECOND', 'THIRD'])
        self.assertEqual([m['quoted'] for m in out['messages']], [False, True, False])
        self.assertEqual(out['messages'][2]['date'], '2025-10-03T09:18:38Z')
        self.assertNotIn('_ms', out['messages'][0])
        self.assertEqual(out['subject'], 'Campaign')

    def test_keeps_newest_25(self):
        t = {'messages': [msg(1000 + i, 'a', plain='m%d' % i) for i in range(30)]}
        out = st.thread_of(t)['messages']
        self.assertEqual((len(out), out[0]['body'], out[-1]['body']), (25, 'm5', 'm29'))


class Quota(unittest.TestCase):
    class G:
        def __init__(self, fails, error):
            self.fails, self.error, self.calls = fails, error, 0

        def call(self, method, url, body=None, query=None):
            self.calls += 1
            assert method == 'GET' and query == {'format': 'full'}  # read only
            if self.calls <= self.fails:
                raise Fail(1, self.error)
            return {'messages': [msg(1, 'a', plain='ok')]}

    def test_quota_403_retried_with_waits(self):
        waits = []
        g = self.G(2, 'Google 403 Units per minute quota exceeded')
        self.assertEqual(st._get_thread(g, 'abc', waits.append)['messages'][0]['internalDate'], '1')
        self.assertEqual((g.calls, waits), (3, [20, 40]))

    def test_gives_up_after_three(self):
        g = self.G(9, 'Google 429 rate limit')
        with self.assertRaises(Fail):
            st._get_thread(g, 'abc', lambda s: None)
        self.assertEqual(g.calls, 3)

    def test_other_errors_not_retried(self):
        g = self.G(9, 'Google 500 backend')
        with self.assertRaises(Fail):
            st._get_thread(g, 'abc', lambda s: None)
        self.assertEqual(g.calls, 1)

    def test_one_5xx_thread_does_not_abort_the_rest(self):
        class G:
            def call(self, method, url, body=None, query=None):
                if url.endswith('/bad'):
                    raise Fail(1, 'Google 500 backend')
                return {'messages': [msg(1, 'a', plain='ok')]}
        out = st.collect(G(), ['good', 'bad'], lambda s: None)
        self.assertEqual(out['threads']['good']['messages'][0]['body'], 'ok')
        self.assertIn('500', out['threads']['bad']['error'])

    def test_every_thread_failing_still_raises(self):
        class G:
            def call(self, *a, **k):
                raise Fail(1, 'Google 500 backend')
        with self.assertRaises(Fail):
            st.collect(G(), ['a', 'b'], lambda s: None)

    def test_message_ids_carried(self):
        m = msg(1, 'a', plain='x'); m['id'] = 'abc123'
        self.assertEqual(st.thread_of({'messages': [m]})['messages'][0]['id'], 'abc123')

    def test_missing_thread_listed_not_fatal(self):
        class G404:
            def call(self, *a, **k):
                raise Fail(1, 'Google 404 not found')
        self.assertEqual(st.collect(G404(), ['abc'], lambda s: None), {'threads': {}, 'missing': ['abc']})


# From the Money deal view branch (#247): same module, its own message helper.
def msg_m(frm, ms, text=None, html=None, labels=('INBOX',), subject='Rates'):
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


class SponsorThreadsMoney(unittest.TestCase):
    def test_fold_quotes(self):
        body, quoted = st.fold_quotes('Sounds good.\n\nOn Mon, Nov 2, 2026 at 9:00 AM Ann <a@x.com>\nwrote:\n> old text')
        self.assertEqual((body, quoted), ('Sounds good.', True))
        self.assertEqual(st.fold_quotes('Hi\n> quoted line\n'), ('Hi', True))
        self.assertEqual(st.fold_quotes('Plain note'), ('Plain note', False))
        self.assertEqual(st.fold_quotes('Top\n-----Original Message-----\nFrom: x')[0], 'Top')

    def test_body_plain_then_html(self):
        self.assertEqual(st.body_of(msg_m('a', 1, text='plain words', html='<p>html</p>')['payload']), 'plain words')
        out = st.body_of(msg_m('a', 1, html='<p>Hello<br>there</p><blockquote>old</blockquote>')['payload'])
        self.assertEqual(out.strip(), 'Hello\nthere')

    def test_thread_oldest_first_drafts_left_out(self):
        t = {'messages': [
            msg_m('Ann <a@x.com>', 3000, text='Third'),
            msg_m('Ann <a@x.com>', 1000, text='First'),
            msg_m('Jon <partners@jonmac.ai>', 2000, text='Second\n\nOn Mon Ann wrote:\n> First'),
            msg_m('Jon <partners@jonmac.ai>', 4000, text='Unsent draft', labels=('DRAFT',)),
        ]}
        out = st.thread_of(t)
        self.assertEqual([m['body'] for m in out['messages']], ['First', 'Second', 'Third'])
        self.assertEqual([m['quoted'] for m in out['messages']], [False, True, False])
        self.assertEqual(out['messages'][0]['date'], '1970-01-01T00:00:01Z')
        self.assertEqual(out['subject'], 'Rates')

    def test_collect_reads_only_and_marks_missing(self):
        g = FakeGoogle({'abc123': {'messages': [msg_m('Ann', 1000, text='Hi')]}})
        out = st.collect(g, ['abc123', 'def456'], sleep=lambda s: None)
        self.assertEqual(list(out['threads']), ['abc123'])
        self.assertEqual(out['missing'], ['def456'])
        self.assertTrue(all(c[0] == 'GET' for c in g.calls))
        self.assertEqual(g.calls[0][2], {'format': 'full'})

    def test_quota_refusal_waits_then_retries(self):
        waits = []
        g = FakeGoogle({'abc123': {'messages': [msg_m('Ann', 1000, text='Hi')]}},
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
