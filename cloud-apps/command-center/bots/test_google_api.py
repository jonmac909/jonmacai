"""python -I bots/test_google_api.py  (stdlib only; Gmail is faked)"""
import base64
import email
import email.policy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import google_api  # noqa: E402


def headers(*pairs):
    return {'payload': {'headers': [{'name': k, 'value': v} for k, v in pairs]}}


class FakeGmail:
    """One thread: the sponsor's mail, our sent reply, their answer, then an old draft of ours."""
    def __init__(self, messages=None):
        self.posted = []
        self.messages = messages if messages is not None else [
            dict(headers(('Subject', 'Rates for a video'), ('Message-ID', '<a@x.com>')), labelIds=['INBOX']),
            dict(headers(('Subject', 'Re: Rates for a video'), ('Message-ID', '<b@thejonmac.com>'),
                         ('References', '<a@x.com>')), labelIds=['SENT']),
            dict(headers(('Subject', 'Re: Rates for a video'), ('Message-ID', '<c@x.com>'),
                         ('References', '<a@x.com> <b@thejonmac.com>')), labelIds=['INBOX']),
            dict(headers(('Subject', 'Re: Rates for a video'), ('Message-ID', '<d@thejonmac.com>')), labelIds=['DRAFT']),
        ]

    def call(self, method, url, body=None, query=None):
        if method == 'GET' and '/threads/' in url:
            return {'id': url.rsplit('/', 1)[1], 'messages': self.messages}
        if method == 'POST' and url.endswith('/drafts'):
            self.posted.append(body)
            return {'id': 'r123', 'message': {'id': 'm1', 'threadId': body['message'].get('threadId', 'new')}}
        raise AssertionError('unexpected call %s %s' % (method, url))


def sent_mail(fake):
    raw = base64.urlsafe_b64decode(fake.posted[-1]['message']['raw'])
    return email.message_from_bytes(raw, policy=email.policy.default)


class Draft(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = mock.patch.object(google_api, 'DIR', Path(tmp.name))
        p.start()
        self.addCleanup(p.stop)

    def test_reply_lands_in_the_thread_with_reply_headers(self):
        g = FakeGmail()
        out = google_api.draft(g, 'dana@x.com', None, 'Thanks, $2,500 works.', '18c2f0a1b2c3d4e5')
        self.assertEqual(g.posted[-1]['message']['threadId'], '18c2f0a1b2c3d4e5')
        m = sent_mail(g)
        self.assertEqual(m['Subject'], 'Re: Rates for a video')  # no "Re: Re:"
        self.assertEqual(m['In-Reply-To'], '<c@x.com>')  # their last message, not our old draft
        self.assertEqual(m['References'], '<a@x.com> <b@thejonmac.com> <c@x.com>')
        self.assertEqual(m['To'], 'dana@x.com')
        self.assertEqual(out, {'draft': 'r123', 'to': 'dana@x.com', 'subject': 'Re: Rates for a video',
                               'thread': '18c2f0a1b2c3d4e5'})
        self.assertEqual(google_api.drafts_made(), ['r123'])  # draft-delete still allowed

    def test_first_reply_adds_re(self):
        g = FakeGmail([dict(headers(('Subject', 'Partnership'), ('Message-ID', '<a@x.com>')), labelIds=['INBOX'])])
        google_api.draft(g, 'a@x.com', None, 'Hi', 'abc')
        m = sent_mail(g)
        self.assertEqual(m['Subject'], 'Re: Partnership')
        self.assertEqual(m['References'], '<a@x.com>')

    def test_thread_with_only_drafts_is_refused(self):
        g = FakeGmail([dict(headers(('Subject', 'x'),), labelIds=['DRAFT'])])
        with self.assertRaises(google_api.Fail) as e:
            google_api.draft(g, 'a@x.com', None, 'Hi', 'abc')
        self.assertEqual(e.exception.code, 2)
        self.assertEqual(g.posted, [])

    def test_new_email_unchanged(self):
        g = FakeGmail()
        google_api.draft(g, 'a@x.com', 'Rates', 'Hi')
        self.assertNotIn('threadId', g.posted[-1]['message'])
        m = sent_mail(g)
        self.assertEqual(m['Subject'], 'Rates')
        self.assertIsNone(m['In-Reply-To'])


class Args(unittest.TestCase):
    def run_cli(self, *argv):
        with mock.patch.object(google_api.dash, 'which_bot', return_value='sponsors'), \
                mock.patch.object(google_api, 'Google', return_value=FakeGmail()), \
                mock.patch.object(google_api, 'DIR', Path(tempfile.gettempdir()) / 'no-such-google-dir'):
            return google_api.run(google_api.parser().parse_args(['draft', 'partners', '--to', 'a@x.com', '--body', 'Hi', *argv]))

    def test_subject_or_thread_not_both_or_neither(self):
        for extra in ([], ['--subject', 'S', '--thread-id', 'abc']):
            with self.assertRaises(google_api.Fail) as e:
                self.run_cli(*extra)
            self.assertEqual(e.exception.code, 2)

    def test_thread_id_must_be_hex(self):
        with self.assertRaises(google_api.Fail) as e:
            self.run_cli('--thread-id', '../drafts')
        self.assertEqual(e.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
