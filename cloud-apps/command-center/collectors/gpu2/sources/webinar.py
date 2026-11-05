import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'lib'))
from webinar_results import collect as collect_webinar


def source(_machine):
    return 'webinar'


def collect(_machine):
    return collect_webinar()
