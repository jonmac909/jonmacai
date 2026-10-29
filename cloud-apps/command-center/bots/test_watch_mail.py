"""python -I bots/test_watch_mail.py  (stdlib only; Gmail and the webhooks are faked)"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import google_api  # noqa: E402
import watch_mail  # noqa: E402


class FakeGmail:
    """history id 100 at start; `added` maps message id -> From for mail that arrived since."""
    def __init__(self, added, history_404=False):
        self.added, self.history_404 = added, history_404

    def call(self, method, url, body=None, query=None):
        if url.endswith('/profile'):
            return {'historyId': '100'}
        if url.endswith('/history'):
            if self.history_404:
                raise google_api.Fail(1, 'Google 404: not found')
            return {'historyId': '105', 'history': [{'messagesAdded': [{'message': {'id': i}}]} for i in self.added]}
        mid = url.rsplit('/', 1)[1]
        return {'payload': {'headers': [{'name': 'From', 'value': self.added[mid]}, {'name': 'Subject', 'value': 's ' + mid}]}}


class WatchMail(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        log = mock.patch.object(watch_mail, 'LOG', Path(d.name) / 'w.log')
        fire = mock.patch.object(watch_mail.hook, 'fire', return_value={'sponsors': 202, 'ana': 202})
        log.start()
        self.fire = fire.start()
        self.addCleanup(log.stop)
        self.addCleanup(fire.stop)

    def test_first_check_only_records_the_position(self):
        state = {}
        watch_mail.check('partners', FakeGmail({'m1': 'a@b.com'}), state)
        self.assertEqual(state, {'partners': '100'})
        self.fire.assert_not_called()

    def test_partners_mail_wakes_sponsors_once_per_check(self):
        state = {'partners': '100'}
        watch_mail.check('partners', FakeGmail({'m1': 'Sponsor <a@b.com>', 'm2': 'partners@thejonmac.com'}), state)
        self.assertEqual(state, {'partners': '105'})
        (event, data), kw = self.fire.call_args
        self.assertEqual((event, data['count'], data['messages'][0]['id'], kw['key']), ('sponsor_email', 1, 'm1', 'partners:m1'))

    def test_jon_mail_wakes_accounting_only_for_jennifer_or_max(self):
        state = {'jon': '100'}
        self.fire.return_value = {'accounting': 202}
        watch_mail.check('jon', FakeGmail({'m1': 'news@shop.com', 'm2': 'Jennifer <jennifer@gdbookkeeping.com>',
                                           'm3': 'max@maxeisner.ca'}), state)
        (event, data), _ = self.fire.call_args
        self.assertEqual((event, [m['id'] for m in data['messages']]), ('accounting_email', ['m2', 'm3']))
        self.fire.reset_mock()
        watch_mail.check('jon', FakeGmail({'m4': 'news@shop.com'}), state)
        self.fire.assert_not_called()

    def test_undelivered_event_keeps_the_position_for_a_retry(self):
        state = {'partners': '100'}
        self.fire.return_value = {'sponsors': 503, 'ana': 202}
        with self.assertRaises(RuntimeError):
            watch_mail.check('partners', FakeGmail({'m1': 'a@b.com'}), state)
        self.assertEqual(state, {'partners': '100'})

    def test_expired_history_restarts_without_waking_anyone(self):
        state = {'partners': '1'}
        watch_mail.check('partners', FakeGmail({}, history_404=True), state)
        self.assertEqual(state, {'partners': '100'})
        self.fire.assert_not_called()


if __name__ == '__main__':
    unittest.main()
