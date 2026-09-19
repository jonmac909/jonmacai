import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'lib'))
from support_mail import collect_snapshot


def source(_machine):
    return 'support'


def collect(_machine):
    return collect_snapshot()
