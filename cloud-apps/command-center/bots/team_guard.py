"""Team guard: notices frozen bots, waiting QC, low packs and usage limits, needing no bot to be awake.

Runs hidden every 10 minutes (see HOOKS.md). Reads OpenBot's database and transcripts, read-only.
- A bot's open turn quiet 30 minutes, or messages queued behind a turn over 2 hours old: bot_stuck to Ana.
- A video proof pending over 30 minutes: wakes the other QC bot.
- Fewer than 2 packs ready for Olivia: wakes Elle and Scarlett.
- A bot whose current or main account is capped by a usage limit: bot_stuck to Ana. If it's Ana's own
  current account she can't read that, so it also goes on Jon's Questions page.
- Ana's open turn quiet 45 minutes: restarts OpenBot, unless a render is running. If a render still
  blocks it at 90 minutes, Jon gets a question.

Each incident acts once. A failed send stays unmarked and retries next run. A check that crashes
reports script_failure once and the others still run.

python -I team_guard.py [--dry-run]    (--dry-run prints what it would do and changes nothing)
"""
import argparse
import contextlib
import hashlib
import json
import msvcrt
import os
import re
import sqlite3
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path[:0] = [str(TOOLS), r'D:\AgentTeam\grok-voice']  # -I leaves the script's own folder off sys.path
import hook  # noqa: E402

IDLE_MIN, QUEUE_MIN, QC_MIN, ANA_MIN, BLOCKED_MIN, MIN_PACKS = 30, 120, 30, 45, 90, 2
PREFLIGHT_S = 280
PACKS_RECHECK_S = 3600
TAIL = 2_000_000  # a refusal is at the end of a transcript; don't read the rest
FIRST_SCAN_S = 7 * 86400
SEND_FAILS_TO_JON = 3
NO_WINDOW = 0x08000000
DETACHED = 0x00000008

ANA = 'agent-f48f578a-c9a6-4e93-9294-e4a0cbbb17e2'
JESSICA = 'agent-9d685941-71c8-424e-8ae5-d85e06521a3d'
NINA = 'agent-2661cbff-8f2f-4c2a-a493-4d0cb59a201f'
ELLE = 'agent-4b804e4d-e84f-4a71-9571-82a52563f984'
SCARLETT = 'agent-4b98853d-53f7-4521-8e94-9221b3c2c342'

APPDATA = Path(os.environ.get('APPDATA', ''))
DB = APPDATA / 'OpenBot' / 'openbot.db'
ACCOUNTS = APPDATA / 'OpenBot' / 'provider-accounts'
DEFAULT_PROJECTS = Path.home() / '.claude' / 'projects'
DEFAULT_ACCOUNT = 'default sign-in'
EXE = Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'OpenBot' / 'OpenBot.exe'
EDITS = Path(r'C:\Users\jonst\aieditor\edits')
GPUQ = Path(r'D:\gpu-queue')
STATE = Path(r'D:\AgentTeam\logs\team-guard.json')
LOG = Path(r'D:\AgentTeam\logs\team-guard.log')
PY = str(Path(sys.executable).with_name('python.exe'))  # pythonw has no output to read back

URGENT, RESTART, JON, FAILURE = 'urgent', 'restart', 'jon', 'failure'  # other targets are agent ids
PACK_USED = {'doing', 'qc', 'review', 'done'}

OPEN_TURNS = """
select t.turn_id, h.agent_id, t.started_at,
  coalesce((select max(a.created_at) from projection_thread_activities a
    where a.turn_id = t.turn_id and a.created_at <= :now
      and a.activity_type not like 'routine.%' and a.activity_type not like 'queue.%'
      and a.activity_type not in ('conversation.mailbox-reconciled', 'thread.memory-reviewed')), t.started_at)
from projection_turns t join projection_threads h on h.thread_id = t.thread_id
where t.started_at <= :now and (t.completed_at is null or t.completed_at > :now)"""


def ts(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def local(t):
    return datetime.fromtimestamp(t).strftime('%b %d %H:%M')


def log(line):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write('%s %s\n' % (iso(time.time()), line))


def db():
    con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True, timeout=5)
    con.execute('PRAGMA query_only=ON')
    return con


def open_turns(con, now_iso):
    return con.execute(OPEN_TURNS, {'now': now_iso}).fetchall()


def agents(con):
    return {a: json.loads(j) for a, j in con.execute('select agent_id, agent_json from projection_agents')}


def dash(*args):
    r = subprocess.run([PY, '-I', str(TOOLS / 'dash.py'), *args], capture_output=True, encoding='utf-8',
                       errors='replace', env={**os.environ, 'DASH_BOT': 'developer'},
                       creationflags=NO_WINDOW, timeout=60)
    if r.returncode:
        raise RuntimeError('dash %s exit %s' % (args[0], r.returncode))
    return json.loads(r.stdout)


def render_running():
    import psutil
    for f in GPUQ.glob('cpu-render-*.lock'):
        with open(f, 'a+') as h:
            h.seek(0)
            try:
                msvcrt.locking(h.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                return True
            h.seek(0)
            msvcrt.locking(h.fileno(), msvcrt.LK_UNLCK, 1)
    return any(p.info['name'] == 'chrome-headless-shell.exe' for p in psutil.process_iter(['name']))


def restart_openbot():
    """Card t_269f9216508148e3 allows this one kill: OpenBot's main process, by PID, never by name."""
    import psutil
    main = []
    for p in psutil.process_iter(['name']):
        if p.info['name'] == 'OpenBot.exe':
            with contextlib.suppress(psutil.Error):
                if not any(a.startswith('--type=') for a in p.cmdline()):
                    main.append(p)
    if len(main) != 1:
        raise RuntimeError('expected one OpenBot main process, found %d' % len(main))
    main[0].kill()
    psutil.wait_procs(main, timeout=30)
    subprocess.Popen([str(EXE)], creationflags=DETACHED)


def preflight(folder):
    try:
        return subprocess.run([PY, '-I', str(TOOLS / 'preflight.py'), str(folder)], capture_output=True,
                              creationflags=NO_WINDOW, timeout=PREFLIGHT_S).returncode
    except subprocess.TimeoutExpired:
        return None


def check_turns(now, state):
    with contextlib.closing(db()) as con:
        rows = open_turns(con, iso(now))
        queued = dict(con.execute("select recipient_agent_id, count(*) from projection_deliveries "
                                  "where status = 'queued' group by 1"))
        names = {a: j.get('name', a) for a, j in agents(con).items()}
    found = {}
    for turn, agent, started, last in rows:
        idle, age = (now - ts(last)) / 60, (now - ts(started)) / 60
        if agent == ANA:
            if idle >= ANA_MIN:
                busy = render_running()
                found['turns:ana:' + turn] = (URGENT, 'Ana quiet %d minutes in an open turn. '
                                              'OpenBot restarts once no render is running.' % idle)
                found['turns:restart:' + turn] = None if busy else (RESTART, 'Restarting OpenBot.')
                if busy and idle >= BLOCKED_MIN:
                    found['turns:blocked:' + turn] = (
                        JON, 'Ana is frozen and a running render is blocking the OpenBot restart. Restart anyway?',
                        ['Restart OpenBot now, the render is lost (Recommended)', 'Wait for the render to finish'])
            continue
        name = names.get(agent, agent)
        if idle >= IDLE_MIN:
            found['turns:idle:' + turn] = (URGENT, '%s quiet %d minutes in an open turn.' % (name, idle))
        if age >= QUEUE_MIN:  # one alert per turn, even if its queue empties and fills again
            n = queued.get(agent, 0)
            found['turns:queue:' + turn] = (URGENT, '%s has %d queued behind a turn running %d minutes.'
                                            % (name, n, age)) if n else None
    return found


def check_qc(now, state):
    found = {}
    for p in dash('proofs', '--status', 'pending', '--limit', '200')['proofs']:
        age = (now - ts(p['createdAt'])) / 60
        if p['kind'] == 'render' and age >= QC_MIN:
            other = NINA if p['createdBy'] == 'video-editor' else JESSICA  # long-form is Jessica's, the rest Nina's
            found['qc:' + p['id']] = (other, 'Video proof %s on card %s has waited %d minutes for QC. '
                                      'Its usual QC bot has not taken it, so please check it now.'
                                      % (p['id'], p['taskId'], age))
    return found


def refusal_reset(line):
    """When a transcript line is a real usage limit refusal, the time the limit resets. Else None."""
    if b'isApiErrorMessage' not in line:
        return None
    try:
        j = json.loads(line)
    except ValueError:
        return None
    if not isinstance(j, dict) or j.get('isApiErrorMessage') is not True:  # a bot quoting the words isn't refused
        return None
    content = (j.get('message') or {}).get('content')
    text = content if isinstance(content, str) else ' '.join(
        c.get('text', '') for c in content or [] if isinstance(c, dict))
    if j.get('apiError') != 'usage_limit_reached' and 'hit your' not in text:
        return None
    reset = (j.get('quotaLimits') or {}).get('resetsAt')
    return float(reset) if reset else ts(j['timestamp']) + 5 * 3600


def scan_holds(now, state):
    """OpenBot keeps limits in memory only, so read them from the transcripts changed since the last scan."""
    since = state.get('scanned', now - FIRST_SCAN_S) - 300
    holds = {a: r for a, r in state.get('holds', {}).items() if r > now}
    roots = [(DEFAULT_ACCOUNT, DEFAULT_PROJECTS)]
    if ACCOUNTS.is_dir():
        roots += [(d.name, d / 'projects') for d in ACCOUNTS.iterdir()]
    for account, root in roots:
        for f in root.glob('*OpenBot-Agents-agent-*/*.jsonl'):
            with contextlib.suppress(OSError):
                stat = f.stat()
                if stat.st_mtime < since:
                    continue
                with open(f, 'rb') as h:
                    h.seek(max(0, stat.st_size - TAIL))
                    for line in h:
                        reset = refusal_reset(line)
                        if reset and reset > now:
                            holds[account] = max(reset, holds.get(account, 0))
    state['holds'], state['scanned'] = holds, now
    return holds


def check_limits(now, state):
    holds = scan_holds(now, state)
    with contextlib.closing(db()) as con:
        team = agents(con)
    found = {}
    for agent, j in team.items():
        current = j.get('providerAccountId') or DEFAULT_ACCOUNT
        back = j.get('usageLimitReturn')  # set while on a backup; its account is the one to return to
        main = (back.get('providerAccountId') or DEFAULT_ACCOUNT) if back else current
        name = j.get('name', agent)
        if current in holds:
            until = local(holds[current])
            found['limits:%s:%s:%d' % (agent, current, holds[current])] = (
                URGENT, '%s is held by a usage limit until %s. The bot list can still show ready with 0 queued.'
                % (name, until))
            if agent == ANA:
                found['limits:ana-held:%d' % holds[current]] = (
                    JON, 'Ana is on a capped account until %s, so she cannot read alerts. Move her to the team account?'
                    % until, ['Move Ana to the team account (Recommended)', 'Wait for the reset'])
        elif main in holds:
            found['limits:%s:%s:%d' % (agent, main, holds[main])] = (
                URGENT, "%s is on a backup account: their main account is capped until %s." % (name, local(holds[main])))
    return found


def waiting_packs():
    """Edit folders Olivia has not started. Only her cards count: other cards just share the author's name."""
    titles = [t['title'] for t in dash('tasks', '--owner', 'video-editor')['tasks'] if t['status'] in PACK_USED]
    packs = []
    for d in sorted(EDITS.iterdir()):
        if re.fullmatch(r'hgp-.+|.+-\d+', d.name) and (d / 'edit-plan.json').exists():
            word = re.sub(r'-\d+$', '', re.sub(r'^hgp-', '', d.name)).replace('-', ' ')
            if not any(re.search(r'\b%s\b' % re.escape(word), t, re.I) for t in titles):
                packs.append(d)
    return packs


def check_packs(now, state):
    known = [k for k in state['seen'] if k.startswith('packs:')]
    if known and now - state.get('packs_at', 0) < PACKS_RECHECK_S:  # both woken; a failing pack costs minutes of CPU
        return dict.fromkeys(known)
    state['packs_at'] = now
    ready, unknown = 0, []
    for folder in waiting_packs():
        code = preflight(folder)
        ready += code == 0
        if ready >= MIN_PACKS:
            return {}
        if code not in (0, 1):
            unknown.append(folder.name)
    if unknown:  # never guess a shortage; report it so this rule can't go quiet for good
        raise RuntimeError('preflight could not check ' + ', '.join(unknown))
    text = ('Only %d pack(s) pass preflight and wait for Olivia. The team keeps at least %d, so build the next one.'
            % (ready, MIN_PACKS))
    return {'packs:low:' + a: (a, text) for a in (ELLE, SCARLETT)}


CHECKS = [('turns', check_turns), ('qc', check_qc), ('limits', check_limits), ('packs', check_packs)]  # slowest last


def send_urgent(texts, tag):
    out = hook.fire('bot_stuck', {'alerts': texts}, key=tag, routes=['ana'])
    if not all(s in (200, 202) for s in out.values()):
        raise RuntimeError('bot_stuck refused: %s' % out)


def send_wake(agent, texts, tag):
    import openbot_api
    openbot_api.send(agent, '\n'.join(texts), 'team-guard-' + tag)


def send_question(text, options, key):
    args = ['ask', text, '--project', 'coding', '--key', key, '--context', 'From the team guard script.']
    for option in [*options, 'Other (type your own)']:
        args += ['--option', option]
    dash(*args)


def send_failure(texts, tag):
    out = hook.fire('script_failure', {'script': 'team_guard', 'error': ' | '.join(texts)}, key=tag)
    if not all(s in (200, 202) for s in out.values()):
        raise RuntimeError('script_failure refused: %s' % out)


def act(found, state, dry):
    """Act on what's new and mark it, once it really went out. Returns how many sends failed."""
    seen = state['seen']
    new = {k: a for k, a in found.items() if a and k not in seen}
    groups = {}
    for k, a in new.items():
        groups.setdefault(a[0], []).append(k)
    failed = 0

    def attempt(keys, send):
        nonlocal failed
        if dry:
            print('WOULD', keys[0].split(':')[0], '->', new[keys[0]][0], '|', ' / '.join(new[k][1] for k in keys))
            return
        try:
            send()
        except Exception as err:
            failed += 1
            log('send failed %s: %r' % (keys, err))
            return False
        for k in keys:
            seen[k] = iso(time.time())
        log('sent %s' % keys)
        return True

    # Each send has its own id: a same-key alert from a later incident must not count as a repeat of this one.
    tag = hashlib.sha256((' '.join(sorted(new)) + iso(time.time())).encode()).hexdigest()[:32]
    for target, keys in sorted(groups.items(), key=lambda g: g[0] == RESTART):  # alerts go out before a restart
        texts = [new[k][1] for k in keys]
        if target == RESTART:  # even if the alert failed: a hung OpenBot is why webhooks fail
            attempt(keys, restart_openbot)
        elif target == URGENT:
            attempt(keys, lambda: send_urgent(texts, tag))
        elif target == FAILURE:
            attempt(keys, lambda: send_failure(texts, tag))
        elif target == JON:
            for k in keys:
                attempt([k], lambda k=k: send_question(new[k][1], new[k][2], k))
        else:
            attempt(keys, lambda: send_wake(target, texts, tag))
    return failed


def save(state):
    tmp = STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(state), encoding='utf-8')
    os.replace(tmp, STATE)


def load():
    try:
        state = json.loads(STATE.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        state = {}
    state.setdefault('seen', {})
    return state


def run(dry=False):
    now = time.time()
    state = load()
    failed = 0
    for name, check in CHECKS:
        try:
            found = check(now, state)
        except Exception as err:
            log('check %s crashed: %s' % (name, traceback.format_exc()))
            found = {'fail:' + name: (FAILURE, '%s check: %r' % (name, err))}
        else:
            for k in list(state['seen']):  # the incident is over, so the next one alerts again
                if k == 'fail:' + name or (k.startswith(name + ':') and k not in found):
                    del state['seen'][k]
        if dry:
            print(name, 'found', len(found), 'already handled', sum(k in state['seen'] for k in found))
        failed += act(found, state, dry)
        if not dry:
            save(state)
    if dry:
        return
    state['send_fails'] = state.get('send_fails', 0) + 1 if failed else 0
    if state['send_fails'] == SEND_FAILS_TO_JON:  # OpenBot itself may be down: the dashboard doesn't depend on it
        with contextlib.suppress(Exception):
            send_question('The team guard could not reach the bots for 30 minutes. Restart OpenBot?',
                          ['Restart OpenBot (Recommended)', 'Leave it'], 'team-guard-unreachable-' + iso(now)[:13])
    save(state)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(argv)
    try:
        run(args.dry_run)
    except Exception as err:
        log(traceback.format_exc())
        if args.dry_run:
            raise
        hook.fire('script_failure', {'script': 'team_guard', 'error': repr(err)[:300]},
                  key='team_guard:' + iso(time.time())[:10])
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
