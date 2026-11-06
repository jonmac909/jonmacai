"""Team guard: notices frozen bots, waiting QC, low packs and usage limits, needing no bot to be awake.

Runs hidden every 10 minutes (see HOOKS.md). Reads OpenBot's database and transcripts, read-only.
- A bot's open turn with no activity and no transcript write for 30 minutes, messages queued behind a turn
  over 2 hours old, a message queued 2 hours, or queued 30 minutes with no open turn: bot_stuck to Ana.
  Past the queue limit Ana can't alert herself, so hers go on Jon's Questions page.
- A video proof pending over 30 minutes: wakes the other QC bot.
- Fewer than 2 packs ready for Olivia: wakes Elle and Scarlett. Preflight runs at most hourly.
- A bot whose current or main account is capped by a usage limit: bot_stuck to Ana. If it's Ana's own
  current account she can't read that, so it also goes on Jon's Questions page.
- A bot with a Doing card, no open turn, nothing queued, not capped, and no turn for 10 minutes: wakes it with
  "continue <its newest Doing card>". Once per bot and card per 30 minutes. A slug two bots share (QC)
  wakes one, and none while either is working.
- A card whose note has a line "Waiting external" (optionally "until 2026-11-12") is waiting on a third party: the
  idle nudge skips it, and the load balancer must too. A bot with no Doing card but a Todo card is told to
  "start <its oldest Todo card>".
- Fewer than 3 a-rolls rendered (pipeline.py's buffer) with passed scripts waiting: wakes the owner (Elle or
  Scarlett) of the oldest passed script. A bot is woken at most once per 30 minutes, whichever check wakes it.
- Buffers: fewer than 6 passed scripts wakes Sydney with her oldest Todo topic card; fewer than 3 preflight-passed packs
  wakes the owner (Elle or Scarlett) of the first pack in D:\AgentTeam\pack-order.txt whose a-roll is in and clips are not
  done. At once, no 30-minute wait; none for a card that is Doing, held, or says Waiting external.
- Next-step wakes: an affiliate card that sat 30 minutes at a hand-off wakes the free bot that takes it next: a failed or
  unsent script to its owner, a script with a pending proof to a QC bot, an a-roll with no clips to its owner, a
  preflight-passed pack to Olivia (unless she has an edit in hand). Doing cards are the idle nudge's, video QC is the QC check's.
- Load balancer: a bot is overloaded with more than 3 non-waiting Doing cards, 3 or more queued messages, or a Todo
  card untouched for 2 hours. Its oldest card moves to the first backup that is not overloaded and stays lighter than it
  (Lucy to Mila to Emma, Elle and Scarlett swap, Sydney to Scarlett), with a card comment and a wake. Each bot gives up at
  most one card per 30 minutes. No backup: bot_stuck to Ana. QC has one dashboard slug for Jessica and Nina, so no move.
- GPU2's heartbeat logged low UDP or TCP ports in the last 30 minutes: bot_stuck to Ana, naming who holds them.
- GPU1's D: under 30 GB free: bot_stuck to Ana.
- Ana's open turn quiet 45 minutes, or a message queued 45 minutes with no open turn: restarts OpenBot,
  unless her own account is capped: a restart can't lift a limit.
  Jon gets a question instead if a prompt is open, OpenBot restarted in the last 3 hours, or a render still
  blocks it at 90 minutes. His "Restart OpenBot now" button restarts it, whatever was in the way.

Each incident alerts once and takes one restart from Jon's button; a freeze that outlasts the 3-hour cap
restarts again. A failed send stays unmarked and retries next run. A check that crashes reports script_failure
once and the others still run; one that times out reports only after 3 runs in a row.

python -I team_guard.py [--dry-run]    (--dry-run prints what it would do and sends nothing; crashes still log)
"""
import argparse
import contextlib
import hashlib
import json
import msvcrt
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path[:0] = [str(TOOLS), r'D:\AgentTeam\grok-voice']  # -I leaves the script's own folder off sys.path

IDLE_MIN, QUEUE_MIN, QC_MIN, ANA_MIN, BLOCKED_MIN, MIN_PACKS = 30, 120, 30, 45, 90, 2
READY_MIN, NUDGE_EVERY_S = 10, 1800  # Jon, 2026-11-05: the team works 24/7; no wake storms
AROLL_MIN = 3  # pipeline.py's a-roll buffer target
AROLL_STAGES = (3, 4, 5)  # a-roll rendered, clips building, preflight passed: not yet with the editor
BC = timezone(timedelta(hours=-7))  # Kelowna, permanent UTC-7 since Nov 2026 (no tzdata on this Python)
WAITING = re.compile(r'(?im)^\W*waiting[ _]external\b(?:[^\n]*?\buntil\s+(\d{4}-\d{2}-\d{2}))?')
SCRIPT_PASSED = 2
SCRIPTS_MIN, PACKS_MIN = 6, 3  # pipeline.py's targets for passed scripts and preflight-passed packs
WRITER = 'jon-mac-youtube'  # dashboard slug of Sydney, who writes the scripts
PACK_ORDER = Path(r'D:\AgentTeam\pack-order.txt')  # Jon's queue order, one pack folder per line, top first
AROLL_OWNERS = ('home-guide-press', 'viral-view')  # dashboard slugs of Elle and Scarlett
SCRIPT_OWNERS = AROLL_OWNERS + ('jon-mac-youtube',)  # Sydney writes the scripts, Elle and Scarlett fix the ones on their packs
WAKES = ('idle', 'aroll', 'buffer', 'balance', 'next')  # check names whose keys read 'name:agent:card'
NEXT_MIN = 30  # a card waits this long at a hand-off before the bot that takes it next is woken
HELD = ('qc', 'review', 'waiting_on_jon')  # statuses of a card someone else is checking: nothing to do for its owner
SCRIPT_WRITTEN, SCRIPT_QC, AROLL_DONE, PREFLIGHT_PASSED, EDITING = 0, 1, 3, 5, 6  # pipeline.py's stage numbers
CLIPS_BUILDING = 4
MAX_DOING, MAX_QUEUED, WAIT_S = 3, 3, 7200  # overloaded: more Doing cards, as many queued messages, a Todo this old
BACKUPS = {'developer': ('moneyclaw', 'historient'), 'moneyclaw': ('historient',),  # dashboard slugs, best backup first
           'home-guide-press': ('viral-view',), 'viral-view': ('home-guide-press',), 'jon-mac-youtube': ('viral-view',)}
NAMES = {'developer': 'Lucy', 'moneyclaw': 'Mila', 'historient': 'Emma', 'home-guide-press': 'Elle',
         'viral-view': 'Scarlett', 'jon-mac-youtube': 'Sydney'}
PREFLIGHT_S = 280
PACKS_RECHECK_S = 3600
PACKS_BUDGET_S = 600  # preflight time per run; packs past it count as unchecked
TIMEOUTS_TO_REPORT = 3  # runs in a row, half an hour: one slow moment isn't a failure, a stuck dashboard is
PORTS_FRESH_S = 1800
DISK_LOW_GB = 30  # about two days of team output
DISK_CLEAR_GB = 35  # the incident ends here, so hovering at the line doesn't alert again and again
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
QC_BOTS = (NINA, JESSICA)  # best first: Nina takes scripts, Jessica long-form videos (qc.md); the dashboard shows both as 'qc'

APPDATA = Path(os.environ.get('APPDATA', ''))
DB = APPDATA / 'OpenBot' / 'openbot.db'
ACCOUNTS = APPDATA / 'OpenBot' / 'provider-accounts'
DEFAULT_PROJECTS = Path.home() / '.claude' / 'projects'
DEFAULT_ACCOUNT = 'default sign-in'
EXE = Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'OpenBot' / 'OpenBot.exe'
EDITS = Path(r'C:\Users\jonst\aieditor\edits')
GPUQ = Path(r'D:\gpu-queue')
PORTS_LOG = 'C:/Users/partn/.command-center/logs/ports.log'  # on GPU2, written by its heartbeat
STATE = Path.home() / '.team-guard' / 'team-guard.json'  # on C:, so the guard still works when D: is full
LOG = STATE.with_suffix('.log')
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

LAST_TURNS = """
select h.agent_id, max(coalesce(t.completed_at, t.started_at))
from projection_turns t join projection_threads h on h.thread_id = t.thread_id group by 1"""

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
        return subprocess.run([PY, '-I', str(TOOLS / 'preflight.py'), '--quick', str(folder)], capture_output=True,
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


def video_proof(p):
    return p.get('kind') == 'render' or (p.get('kind') == 'url' and bool(VIDEO_LINK.search(p.get('link') or '')))


def check_qc(now, state):
    found = {}
    for p in dash('proofs', '--status', 'pending', '--limit', '200')['proofs']:
        age = (now - ts(p['createdAt'])) / 60
        if video_proof(p) and age >= QC_MIN:
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


def bots():
    """{dashboard owner slug: [agent ids]} from BOTS.md, the table dash.py reads."""
    import dash as dash_py
    out = {}
    for slug, workspace in dash_py.bots_table():
        out.setdefault(slug, []).append(Path(workspace).name)
    return out


def waiting_external(card, now):
    """The note says the card waits on a third party: no nudge, no reassigning. A date ends it at the end of that day in Kelowna."""
    m = WAITING.search(card.get('note') or '')
    if not m:
        return False
    try:
        return not m.group(1) or now < (datetime.strptime(m.group(1), '%Y-%m-%d') + timedelta(days=1)).replace(tzinfo=BC).timestamp()
    except (ValueError, OverflowError):  # a date like 2026-13-45 or 9999-12-31 is a typo: treat the card as waiting rather than nudge a sponsor thread
        return True


def check_idle(now, state):
    seen = state['seen']
    found = {k: None for k, t in seen.items() if k.startswith('idle:') and now - ts(t) < NUDGE_EVERY_S - 60}  # the send lands after `now`
    newest, oldest_todo = {}, {}
    for c in dash('tasks', '--status', 'doing', '--limit', '500')['tasks']:
        if c.get('owner') and not waiting_external(c, now) and c['updatedAt'] > newest.get(c['owner'], {}).get('updatedAt', ''):
            newest[c['owner']] = c
    for c in dash('tasks', '--status', 'todo', '--limit', '500')['tasks']:  # a bot with no Doing card starts its oldest Todo
        if c.get('owner') and not waiting_external(c, now) and c.get('createdAt', '') < oldest_todo.get(c['owner'], {}).get('createdAt', '~'):
            oldest_todo[c['owner']] = c
    if not newest and not oldest_todo:
        return found
    with contextlib.closing(db()) as con:
        busy = {r[1] for r in open_turns(con, iso(now))}
        busy |= {a for a, in con.execute("select distinct recipient_agent_id from projection_deliveries "
                                         "where status = 'queued'")}
        last = dict(con.execute(LAST_TURNS))
        team = agents(con)
    holds = state.get('holds', {})
    for slug, ids in bots().items():
        card = newest.get(slug) or oldest_todo.get(slug)
        verb = 'continue ' if slug in newest else 'start '
        if (not card or busy.intersection(ids)  # a slug's bots share the card: any one working, or nudged lately, covers it
                or any('idle:%s:%s' % (a, card['id']) in found or woke_lately(seen, a, now, ('aroll', 'balance', 'next')) for a in ids)
                or any(last.get(a) and now - ts(last[a]) < READY_MIN * 60 for a in ids)):
            continue
        for agent in ids:
            j = team.get(agent)
            if j is None or holds.get(j.get('providerAccountId') or DEFAULT_ACCOUNT, 0) > now:
                continue
            key = 'idle:%s:%s' % (agent, card['id'])
            seen.pop(key, None)  # its last nudge is over 30 minutes old
            found[key] = (agent, verb + card['title'])
            break
    return found


def free_bots(now, state):
    """Agent ids with no open turn, nothing queued, no turn in the last 10 minutes and no usage limit."""
    with contextlib.closing(db()) as con:
        busy = {r[1] for r in open_turns(con, iso(now))}
        busy |= {a for a, in con.execute("select distinct recipient_agent_id from projection_deliveries "
                                         "where status = 'queued'")}
        busy |= {a for a, t in con.execute(LAST_TURNS) if t and now - ts(t) < READY_MIN * 60}
        team = agents(con)
    holds = state.get('holds', {})
    return {a for a, j in team.items() if a not in busy and holds.get(j.get('providerAccountId') or DEFAULT_ACCOUNT, 0) <= now}


def woke_lately(seen, agent, now, names=WAKES):
    """One of these checks sent this bot something in the last 30 minutes (keys read 'name:agent:card')."""
    return any(k.split(':')[0] in names and k.split(':')[1:2] == [agent] and now - ts(t) < NUDGE_EVERY_S - 60
               for k, t in seen.items())


def check_balance(now, state):
    """Move an overloaded bot's oldest card to a backup that is lighter. One move per bot per 30 minutes; --dry-run moves nothing."""
    seen, moves, found = state['seen'], state.setdefault('moves', {}), {}
    moved = state.setdefault('moved', {})  # card id -> when this check moved it: its age restarts, so it can't bounce back
    for card_id in [i for i, at in moved.items() if now - at > 2 * WAIT_S]:
        del moved[card_id]
    for slug, m in list(moves.items()):
        if now - m['at'] < NUDGE_EVERY_S:
            found[m['key']] = (m['to'], m['text'])  # the card already moved: a failed wake retries, a sent one stays marked
        else:
            del moves[slug]
    cards, ours = {}, set(BACKUPS).union(*BACKUPS.values())
    for status in ('doing', 'todo'):
        for c in dash('tasks', '--status', status, '--limit', '500')['tasks']:
            if c.get('owner') in ours and not waiting_external(c, now):
                cards.setdefault(c['owner'], []).append(c)
    ids = bots()
    with contextlib.closing(db()) as con:
        queued = dict(con.execute("select recipient_agent_id, count(*) from projection_deliveries "
                                  "where status = 'queued' group by 1"))
        team = agents(con)
    holds = state.get('holds', {})

    def load(slug):
        mine = cards.get(slug, [])
        doing = sum(c['status'] == 'doing' for c in mine)
        waiting = sum(queued.get(a, 0) for a in ids.get(slug, []))
        old = any(c['status'] == 'todo' and c['id'] not in moved and now - ts(c['updatedAt']) > WAIT_S for c in mine)
        return doing, waiting, old, doing > MAX_DOING or waiting >= MAX_QUEUED or old

    def usable(slug):  # an agent that exists, is not capped and was not woken by any guard check in the last 30 minutes
        return next((a for a in ids.get(slug, []) if a in team and not woke_lately(seen, a, now) and holds.get(
            team[a].get('providerAccountId') or DEFAULT_ACCOUNT, 0) <= now), None)

    def room(slug, doing):  # takes one more card and one more message, is still not overloaded, and stays lighter than the source
        d, w, _, over = load(slug)
        return usable(slug) and not over and (not d or (d + 1 <= MAX_DOING and d + 2 < doing)) and w + 1 < MAX_QUEUED

    for slug, backups in BACKUPS.items():
        doing, waiting, old, over = load(slug)
        if not over or slug in moves or not cards.get(slug):
            continue
        reason = '%d Doing, %d queued%s' % (doing, waiting, ', a Todo untouched for 2 hours' if old else '')
        to = next((b for b in backups if room(b, doing)), None)
        if to is None:
            found['balance:%s:none' % slug] = (URGENT, 'Load balancer: %s is overloaded (%s) and no backup is free.'
                                               % (NAMES[slug], reason))
            continue
        card = min(cards[slug], key=lambda c: c.get('createdAt', ''))
        key = 'balance:%s:%s' % (usable(to), card['id'])
        text = 'Card moved to you from %s, who is overloaded (%s). continue %s' % (NAMES[slug], reason, card['title'])
        if not state.get('dry'):
            dash('task-update', card['id'], '--owner', to)
            moves[slug], moved[card['id']] = {'at': now, 'key': key, 'to': usable(to), 'text': text}, now  # before anything can fail
            seen.pop(key, None)
            with contextlib.suppress(Exception):  # the comment is a courtesy: the card has moved and the wake must go out
                dash('comment', card['id'], 'Moved from %s to %s: overloaded (%s).' % (NAMES[slug], NAMES[to], reason))
        cards[slug].remove(card)
        cards.setdefault(to, []).append(dict(card, updatedAt=iso(now)))  # the move resets its age: it must not cascade on
        found[key] = (usable(to), text)
    return found


_pipe = {}


def pipeline_cards(now):
    """[(stage index, entry time, card)] for open affiliate video cards, read once per run by pipeline.py's own code."""
    if _pipe.get('at') != now:
        import pipeline  # D:\AgentTeam	ools, the code Ana's hourly report runs
        out, topics = [], []
        for card in pipeline.load(pipeline.live_titles()):
            with contextlib.suppress(Exception):  # one odd card must not stop the check
                live = any(pipeline.LIVE.search(link) for link in pipeline.links(card))  # already on YouTube: no a-roll waits for the editor
                r = None if live else pipeline.classify(card)
                if r:
                    out.append((r[0], r[1], card))
                elif not live and card.get('owner') == WRITER and card.get('status') == 'todo':  # a topic with no script yet
                    topics.append(card)
        _pipe.update(at=now, cards=out, topics=topics)
    return _pipe['cards']


def topic_cards(now):
    """Sydney's Todo cards with no script yet, from the same read as pipeline_cards."""
    pipeline_cards(now)
    return _pipe['topics']


def check_aroll(now, state):
    """Fewer than 3 a-rolls in the pipeline: wake the owner of the oldest passed script. Bots with a wake in the last 30 minutes wait."""
    seen = state['seen']
    found = {k: None for k, t in seen.items() if k.startswith('aroll:') and now - ts(t) < NUDGE_EVERY_S - 60}
    cards = pipeline_cards(now)
    have = sum(stage in AROLL_STAGES for stage, _, _ in cards)
    if have >= AROLL_MIN:
        return found
    ids, free = bots(), free_bots(now, state)
    for _, _, card in sorted((c for c in cards if c[0] == SCRIPT_PASSED), key=lambda c: c[1]):
        agent = next(iter(ids.get(card.get('owner')) or []), None)
        key = 'aroll:%s:%s' % (agent, card['id'])
        if card.get('owner') in AROLL_OWNERS and agent in free and key not in found and not woke_lately(seen, agent, now):
            seen.pop(key, None)  # its last wake is over 30 minutes old
            found[key] = (agent, 'A-roll buffer is %d of %d. Start the HeyGen a-roll for %s, your longest-waiting passed '
                          'script. If its render is already submitted, do not submit it again.' % (have, AROLL_MIN, card['title']))
            break
    return found


def pack_name(card):
    try:
        import pipeline
        return pipeline.pack_of(card) or ''
    except Exception:  # one odd card must not stop the check
        return ''


def pack_order():
    """Pack folders in Jon's queue order, top first (lowercase); comments and blank lines skipped."""
    try:
        lines = PACK_ORDER.read_text(encoding='utf-8-sig', errors='replace').splitlines()
    except OSError:
        return []
    return [n for n in (line.split('#')[0].strip().lower() for line in lines) if n]


def check_buffers(now, state):
    """Fewer than 6 passed scripts: wake Sydney to write the script of her oldest Todo topic. Fewer than 3 preflight-passed
    packs: wake the owner (Elle or Scarlett) of the first pack in Jon's order whose a-roll is in and clips are not done.
    No 30-minute wait at the hand-off. A free bot only, one wake per bot per 30 minutes, none for a card that waits on a
    third party, and none while Sydney has a script to finish or fix (the idle and next-step checks')."""
    seen = state['seen']
    found = {k: None for k, t in seen.items() if k.startswith('buffer:') and now - ts(t) < NUDGE_EVERY_S - 60}
    cards = pipeline_cards(now)
    ids, free, used = bots(), free_bots(now, state), set()

    def wake(who, card, text):
        agent = next((a for a in who if a in free and a not in used and not woke_lately(seen, a, now)), None)
        key = 'buffer:%s:%s' % (agent, card['id'])
        if agent:
            seen.pop(key, None)  # its last wake is over 30 minutes old
            used.add(agent)
            found[key] = (agent, text)
            return True

    passed = sum(stage == SCRIPT_PASSED for stage, _, _ in cards)
    writing = any(stage == SCRIPT_WRITTEN and c.get('owner') == WRITER and c.get('status') not in HELD and not waiting_external(c, now)
                  for stage, _, c in cards)  # a script in hand, or one to fix after a QC fail, comes before a new topic
    topics = [c for c in topic_cards(now) if not waiting_external(c, now)]
    if passed < SCRIPTS_MIN and topics and not writing:
        card = min(topics, key=lambda c: str(c.get('createdAt') or ''))  # oldest first: the card list has no other order
        wake(ids.get(WRITER) or (), card, 'Script buffer is %d of %d. Write the script for "%s" (card %s), the next topic '
             "in Jon's queue order, and send it to QC." % (passed, SCRIPTS_MIN, card['title'], card['id']))
    ready = sum(stage == PREFLIGHT_PASSED for stage, _, _ in cards)
    if ready < PACKS_MIN:
        order = pack_order()

        def rank(item):
            name = pack_name(item[2]).lower()
            return (order.index(name) if name in order else len(order), item[1])
        todo = sorted((c for c in cards if c[0] in (AROLL_DONE, CLIPS_BUILDING) and c[2].get('owner') in AROLL_OWNERS
                       and c[2].get('status') not in HELD + ('doing',) and not waiting_external(c[2], now)), key=rank)
        left = PACKS_MIN - ready
        for _, _, card in todo:
            if left and wake(ids.get(card['owner']) or (), card, 'Pack buffer is %d of %d. Build the clips for "%s" (card %s), '
                             "the next pack in Jon's order, and run preflight." % (ready, PACKS_MIN, card['title'], card['id'])):
                left -= 1
    return found


HANDOFF = {  # stage -> what the bot that takes the card next is told
    SCRIPT_WRITTEN: 'The script for "%s" (card %s) failed QC or was never sent to it. Fix it and send it to QC.',
    SCRIPT_QC: 'The script for "%s" (card %s) has waited for QC over %d minutes. Check its pending proof now.',
    AROLL_DONE: 'The a-roll for "%s" (card %s) is done and waits for clips. Build them and run preflight.',
    PREFLIGHT_PASSED: 'The pack for "%s" (card %s) passed preflight and has no editor. Take its card and start the edit.'}


def check_next(now, state):
    """A card that sat 30 minutes at a hand-off wakes the bot that takes it next, if free: a failed or unsent script to its
    owner, a script waiting in QC to a QC bot, an a-roll with no clips to its owner, a preflight-passed pack to Olivia.
    One wake per card per 30 minutes, whichever bot of a slug took it. A Doing card is the idle nudge's, a video proof
    waiting in QC is check_qc's, and a card QC or Jon holds is nobody's to nudge."""
    seen = state['seen']
    found = {k: None for k, t in seen.items() if k.startswith('next:') and now - ts(t) < NUDGE_EVERY_S - 60}
    woken = {k.split(':', 2)[2] for k in found}  # card ids
    cards = pipeline_cards(now)
    ids, free, used = bots(), free_bots(now, state), set()
    editing = any(stage == EDITING for stage, _, _ in cards)  # Olivia has an edit in hand: the idle nudge covers her
    for stage, entered, card in sorted(cards, key=lambda c: c[1]):
        if (stage not in HANDOFF or now - entered < NEXT_MIN * 60 or card['id'] in woken or waiting_external(card, now)
                or (stage != SCRIPT_QC and card.get('status') in HELD)):
            continue
        owner = card.get('owner')
        if stage == SCRIPT_QC:  # a pending proof that is not a video one: check_qc wakes for those
            who = QC_BOTS if any(p.get('status') == 'pending' and not video_proof(p) for p in card.get('proofs') or []) else ()
        elif stage == PREFLIGHT_PASSED:
            who = () if editing else ids.get('video-editor') or ()
        elif card.get('status') == 'doing' or owner not in (AROLL_OWNERS if stage == AROLL_DONE else SCRIPT_OWNERS):
            who = ()
        else:
            who = ids.get(owner) or ()
        agent = next((a for a in who if a in free and a not in used and not woke_lately(seen, a, now)), None)
        if agent:
            key = 'next:%s:%s' % (agent, card['id'])
            seen.pop(key, None)  # its last wake is over 30 minutes old
            used.add(agent)
            text = HANDOFF[stage] % ((card['title'], card['id'], (now - entered) // 60) if stage == SCRIPT_QC else (card['title'], card['id']))
            found[key] = (agent, text)
    return found


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
    folders = waiting_packs()  # first: a timeout here must leave the last result and retry next run
    state['packs_at'], state['packs_short'] = now, None
    seen = set(state.pop('packs_unchecked', None) or [])  # last check's unchecked packs; a passing check clears them
    ready, unknown = 0, []
    for folder in folders:
        code = preflight(folder) if time.time() < now + PACKS_BUDGET_S else None
        ready += code == 0
        if ready >= MIN_PACKS:
            return {}
        if code not in (0, 1):
            unknown.append(folder.name)
    # an unchecked pack hasn't passed, but one slow preflight on a busy machine isn't a failure: report two in a row
    state['packs_unchecked'] = unknown
    state['packs_unknown'] = [n for n in unknown if n in seen]
    state['packs_short'] = ('Only %d pack(s) pass preflight and wait for Olivia. The team keeps at least %d, '
                            'so build the next one.' % (ready, MIN_PACKS))
    if unknown:
        state['packs_short'] += ' Could not check: %s.' % ', '.join(unknown)
    return pack_alerts(state)


def gpu2_ports_line():
    """The last line of GPU2's ports log, '' if it has none, None if GPU2 can't be reached."""
    ps = "Get-Content %s -Tail 1 -ErrorAction SilentlyContinue; exit 0" % PORTS_LOG
    try:
        r = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'gpu2',
                            'powershell -NoProfile -NonInteractive -OutputFormat Text -Command "%s"' % ps],
                           capture_output=True, encoding='utf-8', errors='replace', creationflags=NO_WINDOW, timeout=30)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode:
        return None
    return next((x for x in reversed(r.stdout.splitlines()) if x.startswith('{')), '')


def check_ports(now, state):
    line = gpu2_ports_line()
    if line is None:  # GPU2 is off the network: everything stays as it was
        return None
    p = json.loads(line) if line else None
    if not p or now - p['at'] > PORTS_FRESH_S:
        return {}
    kind = p['low'][0]
    used, top = p[kind]['used'], p[kind]['top']
    if top and top[0][1] * 2 >= used:
        who = 'mostly %s with %d. Its command line is in ports.log on GPU2' % (top[0][0], top[0][1])
    else:  # closed connections or many small holders: naming the biggest would blame the wrong process
        who = 'no single process holds most of them'
    return {'ports:gpu2': (URGENT, 'GPU2 is running low on %s ports: %d of 16384 in use, %s.' % (kind.upper(), used, who))}


def disk_free_gb():
    return shutil.disk_usage('D:\\').free / 1024 ** 3


def check_disk(now, state):
    free = disk_free_gb()
    if free >= DISK_CLEAR_GB or (free >= DISK_LOW_GB and 'disk:d' not in state['seen']):
        return {}
    return {'disk:d': (URGENT, 'GPU1 D: has %.1f GB free. The team writes about 15 GB a day and saves fail at zero.' % free)}


# aroll and next run before idle: idle skips a bot they just woke, and a "start <Todo>" nudge must not block the a-roll wake
CHECKS = [('disk', check_disk), ('turns', check_turns), ('qc', check_qc), ('limits', check_limits),
          ('aroll', check_aroll), ('buffer', check_buffers), ('next', check_next), ('balance', check_balance), ('idle', check_idle), ('ports', check_ports), ('packs', check_packs)]  # slowest last
try:  # Emma's stall checks (heartbeats, disk_early, money, sites, tokens) live in the tools folder, not this repo
    import stall_gates
    CHECKS += stall_gates.CHECKS
except ImportError as err:  # a missing or broken stall_gates must not stop the other checks
    log('stall_gates not loaded: %r' % err)


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
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(state), encoding='utf-8')
    os.replace(tmp, STATE)


def load():
    try:
        state = json.loads(STATE.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        state = {}
    state.setdefault('seen', {})
    state.setdefault('timeouts', {})
    return state


def run(dry=False):
    now = time.time()
    state = load()
    state['dry'] = dry  # checks that change the dashboard read it
    failed, live = 0, set()
    for name, check in CHECKS:
        try:
            found = check(now, state)
        except subprocess.TimeoutExpired as err:
            state['timeouts'][name] = state['timeouts'].get(name, 0) + 1
            log('check %s timed out, %d in a row: %r' % (name, state['timeouts'][name], err))
            if state['timeouts'][name] < TIMEOUTS_TO_REPORT:
                continue
            found = {'fail:' + name: (FAILURE, '%s check: %r' % (name, err))}
        except Exception as err:
            log('check %s crashed: %s' % (name, traceback.format_exc()))
            found = {'fail:' + name: (FAILURE, '%s check: %r' % (name, err))}
        else:
            if found is None:  # not its hour: everything stays as it was
                continue
            state['timeouts'].pop(name, None)
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
