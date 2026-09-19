import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from cc import main_run

if __name__ == '__main__':
    main_run('mac')
