"""python -I collectors/lib/test_machine_ports.py"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import machine_stats as ms  # noqa: E402

NETSTAT = """
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1408
  TCP    [::]:135               [::]:0                 LISTENING       1408
  TCP    192.168.1.248:49700    20.1.1.1:443           TIME_WAIT       0
  UDP    0.0.0.0:500            *:*                                    5
  UDP    [::]:500               *:*                                    5
  UDP    127.0.0.1:1900         *:*                                    6
"""


def rows(n, pid=7):
    return '\n'.join('  UDP    0.0.0.0:%d    *:*    %d' % (i, pid) for i in range(n))


class Ports(unittest.TestCase):
    def test_counts_both_address_families_per_owner(self):
        got = ms.parse_netstat(NETSTAT)
        self.assertEqual({1408: 2, 0: 1}, dict(got['TCP']))
        self.assertEqual({5: 2, 6: 1}, dict(got['UDP']))

    def test_quiet_machine_writes_nothing(self):
        log = Path(tempfile.mkdtemp()) / 'ports.log'
        with mock.patch.object(ms, '_run', return_value=NETSTAT):
            out = ms.watch_ports([('svchost.exe', 5)], log)
        self.assertEqual({'used': 3, 'top': [['svchost.exe', 2, 5], ['6', 1, 6]]}, out['udp'])
        self.assertFalse(log.exists())

    def test_low_ports_log_the_holder_and_its_command_line(self):
        log = Path(tempfile.mkdtemp()) / 'ports.log'
        answers = {'netstat': rows(ms.PORTS_LOW), 'powershell': 'python serve.py\n'}
        with mock.patch.object(ms, '_run', side_effect=lambda a, timeout=0: answers[a[0]]):
            ms.watch_ports([('python.exe', 7)], log)
        line = json.loads(log.read_text(encoding='utf-8'))
        self.assertEqual(['udp'], line['low'])
        self.assertEqual('python serve.py', line['cmd'])
        self.assertEqual([['python.exe', ms.PORTS_LOW, 7]], line['udp']['top'])

    def test_closed_connections_count_but_nobody_holds_them(self):
        log = Path(tempfile.mkdtemp()) / 'ports.log'
        closed = '\n'.join('  TCP    10.0.0.1:%d    20.1.1.1:443    TIME_WAIT    0' % i for i in range(ms.PORTS_LOW))
        answers = {'netstat': closed + '\n  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    7\n', 'powershell': 'python serve.py\n'}
        with mock.patch.object(ms, '_run', side_effect=lambda a, timeout=0: answers[a[0]]):
            ms.watch_ports([('python.exe', 7)], log)
        line = json.loads(log.read_text(encoding='utf-8'))
        self.assertEqual(ms.PORTS_LOW + 1, line['tcp']['used'])
        self.assertEqual([['python.exe', 1, 7]], line['tcp']['top'])

    def test_only_closed_connections_still_log(self):
        log = Path(tempfile.mkdtemp()) / 'ports.log'
        closed = '\n'.join('  TCP    10.0.0.1:%d    20.1.1.1:443    TIME_WAIT    0' % i for i in range(ms.PORTS_LOW))
        answers = {'netstat': closed, 'powershell': ''}
        with mock.patch.object(ms, '_run', side_effect=lambda a, timeout=0: answers[a[0]]):
            ms.watch_ports([], log)
        line = json.loads(log.read_text(encoding='utf-8'))
        self.assertEqual([], line['tcp']['top'])

    def test_a_failed_netstat_is_an_error_not_zero(self):
        with mock.patch.object(ms, '_run', return_value=''):
            self.assertRaises(RuntimeError, ms.watch_ports, [], 'unused')


if __name__ == '__main__':
    unittest.main()
