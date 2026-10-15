"""60 s machine heartbeat for GPU2. Runs hidden from the CommandCenterMachineBeat task."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from machine_stats import main

if __name__ == '__main__':
    main('gpu2')
