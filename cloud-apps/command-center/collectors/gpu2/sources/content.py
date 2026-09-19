import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'lib'))
from content_queue import collect_queue


def source(_machine):
    return 'content_queue'


def collect(_machine):
    return collect_queue()
