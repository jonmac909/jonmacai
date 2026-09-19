import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'lib'))
from mastermind_picks import picks_from_state

DEFAULT_STATE = Path(os.environ.get('CC_AGENT_STATE', r'C:\Users\partn\my-agent\state'))


def source(_machine):
    return 'mastermind'


def collect(_machine):
    return picks_from_state(DEFAULT_STATE)
