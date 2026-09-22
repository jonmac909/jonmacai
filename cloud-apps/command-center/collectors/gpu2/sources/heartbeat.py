import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'lib'))
from agents_collect import collect_report


def source(machine):
    return 'agents_mac' if machine == 'mac' else 'agents_gpu2'


def collect(machine):
    data = {'machine': machine, 'hostname': socket.gethostname(), 'ok': True, 'unreachable': False, 'agents': []}
    try:
        data.update(collect_report(machine))
    except Exception:
        data['ok'] = False
        data['unreachable'] = True
        data['agents'] = []
    return data
