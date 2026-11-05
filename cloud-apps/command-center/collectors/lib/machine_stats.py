"""Read-only machine heartbeat for GPU1 and GPU2.

Only cheap reads: nvidia-smi, Win32 memory/disk calls, a Win32 process snapshot, one
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
import threading
import time
from collections import Counter
from pathlib import Path

NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
GB = 1024 ** 3
PORTS_LOW = 10000  # of Windows' 16384 per protocol


def bounded(fn, secs, default, errors=None, label=''):
    """Run fn in a daemon thread and give up after secs. A child process stuck inside Windows
    (seen with tasklist on Oct 15) can't even be killed, so never wait on one."""
    box = {}

    def go():
        try:
            box['v'] = fn()
        except Exception as e:
            box['e'] = e

    t = threading.Thread(target=go, daemon=True)
    t.start()
    t.join(secs)
    if 'v' in box:
        return box['v']
    if errors is not None:
        errors.append('%s %s' % (label or getattr(fn, '__name__', 'step'), 'timed out' if t.is_alive() else type(box.get('e')).__name__))
    return default


def process_snapshot():
    """(name, pid) for every process via CreateToolhelp32Snapshot: names only, no tasklist, no WMI."""
    if os.name != 'nt':
        return []
    import ctypes
    from ctypes import wintypes

    class PE(ctypes.Structure):
        _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD), ('th32ProcessID', wintypes.DWORD),
                    ('th32DefaultHeapID', ctypes.c_void_p), ('th32ModuleID', wintypes.DWORD),
                    ('cntThreads', wintypes.DWORD), ('th32ParentProcessID', wintypes.DWORD),
                    ('pcPriClassBase', ctypes.c_long), ('dwFlags', wintypes.DWORD), ('szExeFile', ctypes.c_wchar * 260)]

    k32 = ctypes.windll.kernel32
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = k32.CreateToolhelp32Snapshot(2, 0)  # TH32CS_SNAPPROCESS
    if not snap or snap == wintypes.HANDLE(-1).value:
        return []
    rows = []
    try:
        e = PE()
        e.dwSize = ctypes.sizeof(PE)
        ok = k32.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            rows.append((e.szExeFile.lower(), int(e.th32ProcessID)))
            ok = k32.Process32NextW(snap, ctypes.byref(e))
    finally:
        k32.CloseHandle(snap)
    return rows


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


def gaming(names, tools_dir=None):
    """gaming_mode.py's rule (its GAMES / GAME_PREFIXES lists and manual flag) applied to the
    process names we already have, so it never runs its own tasklist."""
    tools = Path(tools_dir or os.environ.get('CC_GAMING_TOOLS') or (Path.home() / 'my-agent' / 'tools'))
    if not (tools / 'gaming_mode.py').is_file():
        return None
    sys.path.insert(0, str(tools))
    try:
        import gaming_mode
        games = sorted({n for n in names if n in gaming_mode.GAMES or n.startswith(gaming_mode.GAME_PREFIXES)})
        if games:
            return {'on': True, 'why': ('game running: ' + ', '.join(games))[:80]}
        if gaming_mode.manual_on():
            return {'on': True, 'why': 'manual gaming mode on'}
        return {'on': False, 'why': 'free'}
    except Exception:
        return None
    finally:
        try:
            sys.path.remove(str(tools))
        except ValueError:
            pass


def parse_netstat(text):
    """{'TCP': {pid: sockets}, 'UDP': {pid: sockets}} from `netstat -ano`, IPv4 and IPv6 together."""
    out = {'TCP': Counter(), 'UDP': Counter()}
    for line in (text or '').splitlines():
        cols = line.split()
        if len(cols) >= 4 and cols[0] in out and cols[-1].isdigit():
            out[cols[0]][int(cols[-1])] += 1
    return out


def watch_ports(rows, log=None):
    """Sockets per protocol with the biggest holders. When ports run low, keep who holds them in
    ports.log: a reboot wipes that, and team_guard.py alerts Ana from the file's last line.
    The holder's command line stays on this machine. PID 0 is closed connections: they count, nobody holds them."""
    names = {pid: n for n, pid in rows}
    text = _run(['netstat', '-ano'], timeout=10)
    if not text:
        raise RuntimeError('netstat gave no data')
    seen = parse_netstat(text)
    out = {k.lower(): {'used': sum(c.values()),
                       'top': [[names.get(pid, str(pid)), n, pid] for pid, n in c.most_common(4) if pid][:3]}
           for k, c in seen.items()}
    low = [k for k in ('udp', 'tcp') if out[k]['used'] >= PORTS_LOW]
    if low:
        top = out[low[0]]['top']
        ps = '(Get-CimInstance Win32_Process -Filter "ProcessId=%d").CommandLine' % (top[0][2] if top else 0)
        cmd = _run(['powershell', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], timeout=8)
        path = Path(log or Path.home() / '.command-center' / 'logs' / 'ports.log')
        with path.open('a', encoding='utf-8') as f:
            f.write(json.dumps({'at': time.time(), 'low': low, 'cmd': cmd.strip()[:300], **out}) + '\n')
    return out


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
    started = time.time()
    errors = []
    data = {'machine': machine, 'hostname': socket.gethostname()}
    data['gpus'] = bounded(gpus, 15, [], errors, 'nvidia-smi')
    if not data['gpus'] and not any(e.startswith('nvidia-smi') for e in errors):
        errors.append('nvidia-smi gave no data')
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
    rows = bounded(process_snapshot, 10, [], errors, 'process list')
    if not rows:
        errors.append('process list gave no data')
    names = [n for n, _ in rows]
    pyjobs = bounded(python_jobs, 20, [], errors, 'python list') if ('python.exe' in names or 'pythonw.exe' in names) else []
    titles = bounded(lambda: resolve_titles({pid for n, pid in rows if n == 'resolve.exe'}), 5, [], errors, 'resolve titles')
    data['running'] = summarize(names, pyjobs, titles)
    if machine == 'gpu2':
        data['gaming'] = gaming(names)
        bounded(lambda: watch_ports(rows), max(1, 35 - (time.time() - started)), None, errors, 'ports')  # leaves main() time to send
    data['errors'] = errors
    return data


def main(machine):
    # Hard stop: a heartbeat must never outlive its 60 s slot or pile up behind a stuck child.
    stop = threading.Timer(50, lambda: os._exit(3))
    stop.daemon = True
    stop.start()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from cc import cfg, ingest
    data = collect(machine)
    if '--dry-run' in sys.argv:
        print(json.dumps(data, indent=1))
        return
    base, token = cfg(machine)
    ingest(base, token, 'machine_%s' % machine, data)
