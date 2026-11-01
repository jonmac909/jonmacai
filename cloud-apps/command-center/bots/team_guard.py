"""Team guard: notices frozen bots, waiting QC, low packs and usage limits, needing no bot to be awake.

Runs hidden every 10 minutes (see HOOKS.md). Reads OpenBot's database and transcripts, read-only.
- A bot's open turn with no activity and no transcript write for 30 minutes, messages queued behind a turn
  over 2 hours old, a message queued 2 hours, or queued 30 minutes with no open turn: bot_stuck to Ana.
  Past the queue limit Ana can't alert herself, so hers go on Jon's Questions page.
- A video proof pending over 30 minutes: wakes the other QC bot.
- Fewer than 2 packs ready for Olivia: wakes Elle and Scarlett. Preflight runs at most hourly.
- A bot whose current or main account is capped by a usage limit: bot_stuck to Ana. If it's Ana's own
  current account she can't read that, so it also goes on Jon's Questions page.
- Ana's open turn quiet 45 minutes, or a message queued 45 minutes with no open turn: restarts OpenBot,
  unless her own account is capped: a restart can't lift a limit.
  Jon gets a question instead if a prompt is open, OpenBot restarted in the last 3 hours, or a render still
  blocks it at 90 minutes. His "Restart OpenBot now" button restarts it, whatever was in the way.

Each incident alerts once and takes one restart from Jon's button; a freeze that outlasts the 3-hour cap
restarts again. A failed send stays unmarked and retries next run. A check that crashes reports script_failure
once and the others still run.

python -I team_guard.py [--dry-run]    (--dry-run prints what it would do and sends nothing; crashes still log)
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

IDLE_MIN, QUEUE_MIN, QC_MIN, ANA_MIN, BLOCKED_MIN, MIN_PACKS = 30, 120, 30, 45, 90, 2
PREFLIGHT_S = 280
PACKS_RECHECK_S = 3600
PACKS_BUDGET_S = 600  # preflight time per run; packs past it count as unchecked
RESTART_CAP_S = 3 * 3600
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
SEEN = ['Seen']  # the answer button of a question that is information only
RESTART_NOW = 'Restart OpenBot now (Recommended)'  # exact: the buttons fill a text box, so words can follow
PACK_USED = {'doing', 'waiting_on_jon', 'qc', 'review', 'done'}
VIDEO_LINK = re.compile(r'youtube\.com|youtu\.be|jonmac\.ai/(dashboard/)?review', re.I)

OPEN_TURNS = """
select t.turn_id, h.agent_id, t.started_at,
  coalesce((select max(a.created_at) from projection_thread_activities a
    where a.turn_id = t.turn_id and a.created_at <= :now
      and a.activity_type not like 'routine.%' and a.activity_type not like 'queue.%'
      and a.activity_type not in ('conversation.mailbox-reconciled', 'thread.memory-reviewed')), t.started_at)
from projection_turns t join projection_threads h on h.thread_id = t.thread_id
where t.started_at <= :now and (t.completed_at is null or t.completed_at > :now)"""

OPEN_PROMPTS = """
select turn_id from projection_thread_activities where activity_type like 'prompt.%' group by 1
having sum(activity_type = 'prompt.requested') > sum(activity_type = 'prompt.resolved')"""


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


def render_proc(p, psutil):
    """render_logged.py and finish_*.sh skip gpuq's locks. ffmpeg also runs for clips and transcodes all day: only aieditor's counts."""
    if p.info['name'] == 'chrome-headless-shell.exe':
        return True
    with contextlib.suppress(psutil.Error):
        return p.info['name'] == 'ffmpeg.exe' and 'aieditor' in (p.cwd() or '').lower()
    return False


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
    return any(render_proc(p, psutil) for p in psutil.process_iter(['name']))


def restart_openbot(before_kill):
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
    before_kill()
    main[0].kill()
    if psutil.wait_procs(main, timeout=30)[1]:
        raise RuntimeError('OpenBot main process still alive after the kill')
    subprocess.Popen([str(EXE)], creationflags=DETACHED)


def preflight(folder):
    try:
        return subprocess.run([PY, '-I', str(TOOLS / 'preflight.py'), str(folder)], capture_output=True,
                              creationflags=NO_WINDOW, timeout=PREFLIGHT_S).returncode
    except subprocess.TimeoutExpired:
        return None


def project_roots():
    roots = [(DEFAULT_ACCOUNT, DEFAULT_PROJECTS)]
    if ACCOUNTS.is_dir():
        roots += [(d.name, d / 'projects') for d in ACCOUNTS.iterdir()]
    return roots


def transcript_at(agent):
    """When this bot last wrote a transcript, sub-agents included: a long tool call adds no activity rows."""
    newest = 0
    for _, root in project_roots():
        for f in root.glob('*OpenBot-Agents-%s/**/*.jsonl' % agent):
            with contextlib.suppress(OSError):
                newest = max(newest, f.stat().st_mtime)
    return newest


def jon_said_restart(state, key):
    qid = state.get('questions', {}).get(key)
    if not qid:
        return False
    try:
        q = dash('question', qid)['question']
    except Exception as err:  # the dashboard being down must not stop the alerts
        log('could not read %s: %r' % (key, err))
        return False
    return q['status'] == 'answered' and (q['answer'] or '').strip() == RESTART_NOW


def ana_frozen(found, tag, idle, prompt, held, now, state):
    """Alert, then restart OpenBot. A prompt, a recent restart or a long render asks Jon instead."""
    found['turns:ana:' + tag] = (URGENT, 'Ana quiet %d minutes. OpenBot restarts once no render is running.' % idle)
    restart, asked, jon = 'turns:restart:' + tag, 'turns:blocked:' + tag, 'turns:jon:' + tag
    for key in (asked, jon):
        if key in state['seen']:  # one question, and one restart from his answer, per incident
            found[key] = None
    if jon_said_restart(state, asked):  # first: his button beats a hold
        found[jon] = (RESTART, 'Restarting OpenBot, as Jon chose.')
    if held:  # check_limits tells Jon
        return
    capped = now - state.get('last_restart', 0) < RESTART_CAP_S
    render = not prompt and not capped and render_running()
    why = ('a prompt is waiting for an answer' if prompt else 'OpenBot already restarted in the last 3 hours'
           if capped else 'a running render would be lost' if render else None)
    if not why:
        found[restart] = (RESTART, 'Restarting OpenBot.')
        return
    if not render or idle >= BLOCKED_MIN:
        found[asked] = (JON, 'Ana is frozen and %s. Restart OpenBot?' % why,
                        [RESTART_NOW, 'Wait (restarts by itself when clear)'])


def check_turns(now, state):
    with contextlib.closing(db()) as con:
        rows = open_turns(con, iso(now))
        queued = {a: (n, oldest) for a, n, oldest in con.execute(
            "select recipient_agent_id, count(*), min(created_at) from projection_deliveries "
            "where status = 'queued' group by 1")}
        prompts = {t for t, in con.execute(OPEN_PROMPTS)}
        team = agents(con)
    names = {a: j.get('name', a) for a, j in team.items()}
    held = state.get('holds', {}).get(team.get(ANA, {}).get('providerAccountId') or DEFAULT_ACCOUNT, 0) > now

    def alert(agent, text):  # Ana can't alert herself
        return (JON, text, SEEN) if agent == ANA else (URGENT, text)

    found, covered = {}, set()
    for turn, agent, started, last in rows:
        idle, age = (now - ts(last)) / 60, (now - ts(started)) / 60
        if idle >= (ANA_MIN if agent == ANA else IDLE_MIN):
            idle = min(idle, (now - transcript_at(agent)) / 60)
        name = names.get(agent, agent)
        if agent == ANA:
            if idle >= ANA_MIN:
                ana_frozen(found, turn, idle, turn in prompts, held, now, state)
        elif idle >= IDLE_MIN:
            found['turns:idle:' + turn] = (URGENT, '%s quiet %d minutes in an open turn.' % (name, idle))
        if age >= QUEUE_MIN:  # one alert per turn, even if its queue empties and fills again
            n = queued.get(agent, (0,))[0]
            found['turns:queue:' + turn] = alert(agent, '%s has %d queued behind a turn running %d minutes.'
                                                 % (name, n, age)) if n else None
            covered.add(agent)
    working = {r[1] for r in rows}
    for agent, (n, oldest) in queued.items():
        wait, free = (now - ts(oldest)) / 60, agent not in working
        if agent == ANA and free:
            if wait >= ANA_MIN:
                ana_frozen(found, 'queue', wait, False, held, now, state)
        elif wait >= (IDLE_MIN if free else QUEUE_MIN) and agent not in covered:
            found['turns:waiting:' + agent] = alert(agent, '%s has %d queued, the oldest %d minutes old%s.' % (
                names.get(agent, agent), n, wait, ', with no open turn' if free else ''))
    return found


def check_qc(now, state):
    found = {}
    for p in dash('proofs', '--status', 'pending', '--limit', '200')['proofs']:
        age = (now - ts(p['createdAt'])) / 60
        video = p['kind'] == 'render' or (p['kind'] == 'url' and VIDEO_LINK.search(p['link'] or ''))
        if video and age >= QC_MIN:
            key = 'qc:' + p['id']
            if key in state['seen']:
                found[key] = None
                continue
            owner = dash('task', p['taskId'])['task']['owner']  # long-form is Jessica's, the rest Nina's
            found[key] = (NINA if owner == 'video-editor' else JESSICA,
                          'Video proof %s on card %s has waited %d minutes for QC. '
                          'Its usual QC bot has not taken it, so please check it now.' % (p['id'], p['taskId'], age))
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
    for account, root in project_roots():
        for f in root.glob('*OpenBot-Agents-agent-*/*.jsonl'):
            with contextlib.suppress(OSError):
                stat = f.stat()
                if stat.st_mtime < since:
                    continue
                with open(f, 'rb') as h:
                    h.seek(max(0, stat.st_size - TAIL))
                    for line in h:
                        try:
                            reset = refusal_reset(line)
                        except (ValueError, TypeError, KeyError, AttributeError):  # one bad line, not a dead check
                            continue
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
            found['limits:%s:%s' % (agent, current)] = (
                URGENT, '%s is held by a usage limit until %s. The bot list can still show ready with 0 queued.'
                % (name, until))
            if agent == ANA:
                found['limits:ana-held'] = (JON, 'Ana is on a capped account until %s, so she cannot read alerts.'
                                            % until, SEEN)
        elif main in holds:
            found['limits:%s:%s' % (agent, main)] = (
                URGENT, "%s is on a backup account: their main account is capped until %s." % (name, local(holds[main])))
    return found


def pack_started(folder, titles):
    """A numbered folder is that video only: theo-2 is not on a Theo #1 card. A title with no number is video 1."""
    name, number = re.fullmatch(r'(?:hgp-)?(.+?)(?:-(\d+))?', folder).groups()
    for title in titles:
        if re.search(r'\b%s\b' % re.escape(name.replace('-', ' ')), title, re.I):
            numbers = re.findall(r'#(\d+)', title)
            if (number or '1') in (numbers or ['1']):
                return True
    return False


def waiting_packs():
    """Edit folders Olivia has not started: no finished video and no card of hers. Other cards just share the author's name."""
    titles = [t['title'] for t in dash('tasks', '--owner', 'video-editor', '--limit', '500')['tasks']
              if t['status'] in PACK_USED]
    return [d for d in sorted(EDITS.iterdir()) if re.fullmatch(r'hgp-.+|.+-\d+', d.name)
            and (d / 'edit-plan.json').exists() and not any((d / 'final').glob('*.mp4'))
            and not pack_started(d.name, titles)]


def pack_alerts(state):
    found = {'packs:low:' + a: (a, state['packs_short']) for a in (ELLE, SCARLETT)}
    if state.get('packs_unknown'):
        found['packs:unchecked'] = (FAILURE, 'preflight could not check ' + ', '.join(state['packs_unknown']))
    return found


def check_packs(now, state):
    if now - state.get('packs_at', 0) < PACKS_RECHECK_S:  # a failing pack costs minutes of CPU; a failed wake retries
        return pack_alerts(state) if state.get('packs_short') else None
    state['packs_at'], state['packs_short'] = now, None
    ready, unknown = 0, []
    for folder in waiting_packs():
        code = preflight(folder) if time.time() < now + PACKS_BUDGET_S else None
        ready += code == 0
        if ready >= MIN_PACKS:
            return {}
        if code not in (0, 1):
            unknown.append(folder.name)
    state['packs_unknown'] = unknown  # an unchecked pack hasn't passed
    state['packs_short'] = ('Only %d pack(s) pass preflight and wait for Olivia. The team keeps at least %d, '
                            'so build the next one.' % (ready, MIN_PACKS))
    if unknown:
        state['packs_short'] += ' Could not check: %s.' % ', '.join(unknown)
    return pack_alerts(state)


CHECKS = [('turns', check_turns), ('qc', check_qc), ('limits', check_limits), ('packs', check_packs)]  # slowest last


def send_urgent(texts, tag):
    import hook
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
    return dash(*args)['question']['id']


def send_failure(texts, tag):
    import hook
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
    tags = state.setdefault('tags', {})

    def tag_for(keys):
        """A retry reuses its id, so a send that landed but looked failed can't arrive twice."""
        group = '\n'.join(sorted(keys))
        return tags.setdefault(group, hashlib.sha256((group + iso(time.time())).encode()).hexdigest()[:32])

    def before_kill():
        state['last_restart'] = time.time()
        save(state)

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
        tags.pop('\n'.join(sorted(keys)), None)
        log('sent %s' % keys)
        return True

    for target, keys in sorted(groups.items(), key=lambda g: g[0] == RESTART):  # alerts go out before a restart
        texts = [new[k][1] for k in keys]
        if target == RESTART:  # even if the alert failed: a hung OpenBot is why webhooks fail
            attempt(keys, lambda: restart_openbot(before_kill))
        elif target == URGENT:
            attempt(keys, lambda: send_urgent(texts, tag_for(keys)))
        elif target == FAILURE:
            attempt(keys, lambda: send_failure(texts, tag_for(keys)))
        elif target == JON:
            for k in keys:
                def ask(k=k):
                    state.setdefault('questions', {})[k] = send_question(new[k][1], new[k][2],
                                                                         'team-guard-' + tag_for([k]))
                attempt([k], ask)
        else:
            attempt(keys, lambda: send_wake(target, texts, tag_for(keys)))
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
    failed, live = 0, set()
    for name, check in CHECKS:
        try:
            found = check(now, state)
        except Exception as err:
            log('check %s crashed: %s' % (name, traceback.format_exc()))
            found = {'fail:' + name: (FAILURE, '%s check: %r' % (name, err))}
        else:
            if found is None:  # not its hour: everything stays as it was
                continue
            for k in list(state['seen']):  # the incident is over, so the next one alerts again
                if k == 'fail:' + name or (k.startswith(name + ':') and k not in found):
                    del state['seen'][k]
                    state.get('questions', {}).pop(k, None)
        live.update(found)
        if dry:
            print(name, 'found', len(found), 'already handled', sum(k in state['seen'] for k in found))
        failed += act(found, state, dry)
        if not dry:
            save(state)
    if dry:
        return
    state['tags'] = {g: t for g, t in state.get('tags', {}).items() if live.issuperset(g.split('\n'))}
    state['send_fails'] = state.get('send_fails', 0) + 1 if failed else 0
    if not failed:
        state['jon_told'] = False
    elif state['send_fails'] >= SEND_FAILS_TO_JON and not state.get('jon_told'):
        try:  # OpenBot itself may be down: the dashboard doesn't depend on it
            send_question('The team guard could not reach the bots for 30 minutes.', SEEN,
                          'team-guard-unreachable-' + iso(now)[:13])
            state['jon_told'] = True
        except Exception as err:
            log('could not tell Jon: %r' % err)
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
        try:
            send_failure([repr(err)[:300]], 'team_guard:' + iso(time.time())[:10])
        except Exception:
            log(traceback.format_exc())
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
