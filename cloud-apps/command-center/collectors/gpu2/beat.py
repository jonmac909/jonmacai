"""60 s heartbeat for GPU2. Runs hidden from the CommandCenterMachineBeat task.
Sends the machine stats and a copy of the production feed (read-only)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from machine_stats import main
from production_feed import collect as production

if __name__ == '__main__':
    main('gpu2')
    if '--dry-run' not in sys.argv:
        from cc import cfg, ingest
        base, token = cfg('gpu2')
        try:
            ingest(base, token, 'videos', production())
        except Exception as e:
            sys.stderr.write('ingest videos: %s\n' % type(e).__name__)
