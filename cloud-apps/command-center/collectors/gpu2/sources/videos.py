import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'lib'))
from videos_state import collect as collect_videos


def source(_machine):
    return 'videos'


def collect(_machine):
    return collect_videos()
