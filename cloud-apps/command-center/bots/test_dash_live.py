"""python -I bots/test_dash_live.py  (stdlib only): dash.py yt-live-done sends one POST to /tasks/<id>/live."""
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dash  # noqa: E402

CTX = {'bot': 'developer', 'token': 'x', 'base': 'https://jonmac.ai/dashboard/api/v1'}
WATCH = 'https://www.youtube.com/watch?v=R9dtH4r9Yl4'


class YtLiveDone(unittest.TestCase):
    def test_posts_the_link_to_the_live_path(self):
        args = dash.parser().parse_args(['yt-live-done', 't_a4d0bce911a34c42', '--link', WATCH])
        with mock.patch.object(dash, 'call', return_value={'ok': True}) as call:
            self.assertEqual(dash.run(args, CTX), {'ok': True})
        call.assert_called_once_with(CTX, 'POST', '/tasks/t_a4d0bce911a34c42/live', {'link': WATCH})

    def test_the_task_id_is_quoted(self):
        args = dash.parser().parse_args(['yt-live-done', 't_1/../x', '--link', WATCH])
        with mock.patch.object(dash, 'call', return_value={}) as call:
            dash.run(args, CTX)
        self.assertEqual(call.call_args[0][2], '/tasks/t_1%2F..%2Fx/live')

    def test_link_is_required(self):
        with self.assertRaises(SystemExit), mock.patch('sys.stderr'):
            dash.parser().parse_args(['yt-live-done', 't_a4d0bce911a34c42'])

    def test_close_posts_to_the_close_path_with_its_note(self):
        args = dash.parser().parse_args(['close', 't_a4d0bce911a34c42', '--note', 'Live: PR merged and deployed'])
        with mock.patch.object(dash, 'call', return_value={'ok': True}) as call:
            dash.run(args, CTX)
        call.assert_called_once_with(CTX, 'POST', '/tasks/t_a4d0bce911a34c42/close', {'note': 'Live: PR merged and deployed'})
        args = dash.parser().parse_args(['close', 't_1/../x'])
        with mock.patch.object(dash, 'call', return_value={}) as call:
            dash.run(args, CTX)
        call.assert_called_once_with(CTX, 'POST', '/tasks/t_1%2F..%2Fx/close', {})

    def test_task_update_still_refuses_done(self):
        args = dash.parser().parse_args(['task-update', 't_a4d0bce911a34c42', '--status', 'done'])
        with mock.patch.object(dash, 'call') as call, self.assertRaises(dash.Fail):
            dash.run(args, CTX)
        call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
