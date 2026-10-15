"""Read-only machine heartbeat for GPU1 and GPU2.

Only cheap reads: nvidia-smi, Win32 memory/disk calls, tasklist, one
Get-CimInstance for python command lines, and window titles of DaVinci Resolve.
Never opens, focuses, moves or resizes a window. Every child process runs with
CREATE_NO_WINDOW so nothing flashes on screen.
"""
import csv
import io
import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
GB = 1024 ** 3


def _run(args, timeout=15):
    try:
        res = subprocess.run(args, capture_output=True, text=True, timeout=timeout, creationflags=NO_WINDOW)
        return res.stdout if res.returncode == 0 else ''
    except Exception:
        return ''


def _gb(n):
    return round(n / GB, 1)


def parse_gpus(text):
    gpus = []
    for row in csv.reader(io.StringIO(text or '')):
        if len(row) < 4:
            continue
        name, util, used, total = [c.strip() for c in row[:4]]
        try:
            gpus.append({
                'name': name,
                'util': int(float(util)),
                'memUsedGb': round(float(used) / 1024, 1),
                'memTotalGb': round(float(total) / 1024, 1),
                'tempC': int(float(row[4])) if len(row) > 4 and row[4].strip().replace('.', '', 1).isdigit() else None,
            })
        except ValueError:
            continue
    return gpus


def gpus():
    out = _run(['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
                '--format=csv,noheader,nounits'])
    return parse_gpus(out)


def memory():
    if os.name != 'nt':
        return None, None
    import ctypes
    from ctypes import wintypes

    class PERF(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('CommitTotal', ctypes.c_size_t), ('CommitLimit', ctypes.c_size_t),
                    ('CommitPeak', ctypes.c_size_t), ('PhysicalTotal', ctypes.c_size_t),
                    ('PhysicalAvailable', ctypes.c_size_t), ('SystemCache', ctypes.c_size_t),
                    ('KernelTotal', ctypes.c_size_t), ('KernelPaged', ctypes.c_size_t),
                    ('KernelNonpaged', ctypes.c_size_t), ('PageSize', ctypes.c_size_t),
                    ('HandleCount', wintypes.DWORD), ('ProcessCount', wintypes.DWORD),
                    ('ThreadCount', wintypes.DWORD)]

    p = PERF()
    p.cb = ctypes.sizeof(PERF)
    if not ctypes.windll.psapi.GetPerformanceInfo(ctypes.byref(p), p.cb):
        return None, None
    page = p.PageSize
    total = p.PhysicalTotal * page
    used = total - p.PhysicalAvailable * page
    commit, limit = p.CommitTotal * page, p.CommitLimit * page
    ram = {'usedGb': _gb(used), 'totalGb': _gb(total)}
    com = {'usedGb': _gb(commit), 'limitGb': _gb(limit), 'pct': round(commit * 100 / limit) if limit else None}
    return ram, com


def drives():
    letters = []
    if os.name == 'nt':
        import ctypes
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for i in range(26):
            if mask & (1 << i):
                root = '%s:\\' % chr(65 + i)
                if ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(root)) == 3:  # fixed disk
                    letters.append(root)
    else:
        letters = ['/']
    out = []
    for root in letters:
        try:
            u = shutil.disk_usage(root)
        except OSError:
            continue
        out.append({'drive': root.rstrip('\\'), 'freeGb': _gb(u.free), 'totalGb': _gb(u.total)})
    return out


def uptime_hours():
    if os.name != 'nt':
        return None
    import ctypes
    ctypes.windll.kernel32.GetTickCount64.restype = ctypes.c_ulonglong
    return round(ctypes.windll.kernel32.GetTickCount64() / 3600000, 1)


def process_rows(text):
    rows = []
    for row in csv.reader(io.StringIO(text or '')):
        if len(row) > 1:
            try:
                rows.append((row[0].strip().lower(), int(row[1])))
            except ValueError:
                continue
    return rows


def python_jobs():
    """Short labels for running python scripts. Only the script file name leaves the machine."""
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='pythonw.exe'\" | "
          "Select-Object -ExpandProperty CommandLine | ConvertTo-Json -Compress")
    out = _run(['powershell', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], timeout=20)
    try:
        lines = json.loads(out) if out.strip() else []
    except ValueError:
        return []
    if isinstance(lines, str):
        lines = [lines]
    return [label_python(c) for c in lines if c]


def label_python(cmdline):
    low = cmdline.lower()
    kind = 'qwen' if 'qwen' in low else 'python'
    script = ''
    for tok in cmdline.replace('"', ' ').split():
        if tok.lower().endswith('.py'):
            script = tok.replace('\\', '/').rsplit('/', 1)[-1]
            break
    if not script and ' -m ' in low:
        script = cmdline.split(' -m ', 1)[1].split()[0]
    return {'kind': kind, 'script': script[:40] or 'python'}


def resolve_titles(pids):
    """Visible window titles owned by Resolve.exe. GetWindowText on another process's window
    reads the cached caption and sends it nothing."""
    if os.name != 'nt' or not pids:
        return []
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    titles = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value not in pids:
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n <= 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        titles.append(buf.value[:120])
        return True

    try:
        user32.EnumWindows(each, 0)
    except Exception:
        return []
    return titles


def gaming(tools_dir=None):
    tools = Path(tools_dir or os.environ.get('CC_GAMING_TOOLS') or (Path.home() / 'my-agent' / 'tools'))
    if not (tools / 'gaming_mode.py').is_file():
        return None
    sys.path.insert(0, str(tools))
    try:
        import gaming_mode
        on, why = gaming_mode.gaming()
        return {'on': bool(on), 'why': str(why)[:80]}
    except Exception:
        return None
    finally:
        try:
            sys.path.remove(str(tools))
        except ValueError:
            pass


def summarize(names, pyjobs, titles):
    has = set(names)
    resolve_open = 'resolve.exe' in has
    project = ''
    for t in titles:
        if ' - ' in t:
            project = t.split(' - ', 1)[1][:80]
            break
    return {
        'resolve': {'open': resolve_open, 'project': project if resolve_open else '', 'windows': len(titles)},
        'ffmpeg': names.count('ffmpeg.exe') + names.count('ffmpeg'),
        'python': [j for j in pyjobs if j['kind'] == 'python'][:8],
        'pythonCount': len([j for j in pyjobs if j['kind'] == 'python']),
        'qwen': len([j for j in pyjobs if j['kind'] == 'qwen']),
        'docker': bool(has & {'com.docker.backend.exe', 'docker desktop.exe', 'dockerd.exe'}),
        'orca': 'orca.exe' in has,
    }


def collect(machine):
    errors = []
    data = {'machine': machine, 'hostname': socket.gethostname()}
    try:
        data['gpus'] = gpus()
        if not data['gpus']:
            errors.append('nvidia-smi gave no data')
    except Exception as e:
        data['gpus'] = []
        errors.append('gpu %s' % type(e).__name__)
    try:
        data['ram'], data['commit'] = memory()
    except Exception as e:
        data['ram'], data['commit'] = None, None
        errors.append('memory %s' % type(e).__name__)
    try:
        data['disks'] = drives()
    except Exception as e:
        data['disks'] = []
        errors.append('disks %s' % type(e).__name__)
    try:
        data['uptimeH'] = uptime_hours()
    except Exception:
        data['uptimeH'] = None
    rows = process_rows(_run(['tasklist', '/fo', 'csv', '/nh']))
    if not rows:
        errors.append('tasklist gave no data')
    names = [n for n, _ in rows]
    pyjobs = python_jobs() if ('python.exe' in names or 'pythonw.exe' in names) else []
    try:
        titles = resolve_titles({pid for n, pid in rows if n == 'resolve.exe'})
    except Exception:
        titles = []
    data['running'] = summarize(names, pyjobs, titles)
    if machine == 'gpu2':
        data['gaming'] = gaming()
    data['errors'] = errors
    return data


def main(machine):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from cc import cfg, ingest
    data = collect(machine)
    if '--dry-run' in sys.argv:
        print(json.dumps(data, indent=1))
        return
    base, token = cfg(machine)
    ingest(base, token, 'machine_%s' % machine, data)
