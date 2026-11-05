"""60 s machine heartbeat for GPU1. Runs hidden from the CommandCenterMachineBeat task.
Read-only: never touches DaVinci Resolve, renders or app windows."""
import os
import sys
from pathlib import Path

os.environ.setdefault('CC_SECRETS', str(Path.home() / '.command-center' / 'gpu1-loop.env'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from machine_stats import main

if __name__ == '__main__':
    main('gpu1')
