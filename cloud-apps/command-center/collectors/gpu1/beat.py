"""60 s machine heartbeat for GPU1. Runs hidden from the CommandCenterMachineBeat task.
Read-only: never touches DaVinci Resolve, renders or app windows."""
import os
import sys
from pathlib import Path

os.environ.setdefault('CC_SECRETS', str(Path.home() / '.command-center' / 'gpu1-loop.env'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from machine_stats import main
from team import main as team_main

if __name__ == '__main__':
    main('gpu1')
    # Team page slice: OpenMausBot's own bots, routines and thread events. Read-only.
    try:
        team_main()
    except Exception as e:
        sys.stderr.write('team collector: %s\n' % type(e).__name__)
