import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'lib'))
from video_edit import collect_queue


def source(_machine):
    return 'video'


def collect(_machine):
    return collect_queue()
