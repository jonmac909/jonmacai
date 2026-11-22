"""reminders_feed.py [--print] [--force] [--db PATH] [--now ISO]
Posts OpenBot's reminder routines to the dashboard feed `reminders`, which Jon's Home page (jonmac.ai/dash/#home) draws in its
calendar and schedule list marked "Reminder". Read only: it opens OpenBot's database with mode=ro and never creates, changes,
pauses or deletes a routine. No model call, no new schedule: dash_live_feed.py (started by card_dispatch every 2 minutes) calls
sync() at the end of its own run.

A reminder is an ACTIVE routine of any bot whose name contains "reminder" (Reminder: Sunday meals, Workout reminder (...), Net worth
reminder, a future "Reminder: Telus bill"). Name a new reminder routine that way and it appears; pause or delete the routine and it is
gone from Home on the next post (the feed always holds the whole list, newest post wins).

Each entry: {id, title, repeat, next, times}. `times` are the occurrences from a week ago to six weeks ahead and `next` is the next
one however far off, all as Vancouver wall-clock "YYYY-MM-DDTHH:MM" (no zone: Home applies none). BC stays on UTC-7 all year from
Nov 2026 (CORE.md), so the zone is fixed at -7; python -I has no tzdata. OpenBot's own next_run_at is the truth for `next`.

Posts only when the list changed or the last post is 30 minutes old (the feed keeps 2 days). A failure is reported to Ana once an
hour through auto_continue.report_failure; "Unknown feed" (the Worker with the reminders feed is not deployed yet) is silent.
Exit 0 = posted or unchanged, 1 = failed, 2 = bad usage."""
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

TOOLS = Path(__file__).resolve().parent
GUARD = Path.home() / '.team-guard'
STATE = GUARD / 'reminders-feed.json'
DB = Path(os.environ.get('APPDATA', '')) / 'OpenBot' / 'openbot.db'
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
VAN = timezone(timedelta(hours=-7), 'Vancouver')
FIXED = {'America/Vancouver': -7, 'America/Kelowna': -7, 'America/Creston': -7, 'UTC': 0, 'Etc/UTC': 0}
NAME = re.compile(r'reminder', re.I)
PAST_DAYS, AHEAD_DAYS, NEXT_SEARCH_DAYS = 7, 42, 800
MAX_ITEMS, MAX_TIMES, REPOST_S = 60, 120, 1800
SUNDAY_FIRST = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
HHMM = re.compile(r'^(\d{1,2}):(\d{2})$')


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def utc_offset(tz):
    """Hours east of UTC for a routine's zone, or None when unknown (then the routine is left out rather than shown at a wrong time)."""
    if tz in FIXED:
        return FIXED[tz]
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(tz).utcoffset(datetime(2026, 12, 1)).total_seconds() / 3600
    except Exception:
        return None


def clock(s):
    m = HHMM.match(str(s or ''))
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        return None
    return int(m.group(1)), int(m.group(2))


def sunday_index(d):
    return (d.weekday() + 1) % 7  # OpenBot counts Sunday as 0


def ordinal(n):
    return '%d%s' % (n, 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th'))


def day_matcher(sch):
    """-> (function date -> bool, hh, mm) for the schedule kinds with a fixed time of day, or None when this kind is not understood."""
    kind = sch.get('kind')
    if kind == 'advanced':
        t = sch.get('time') or {}
        hm = clock(t.get('time')) if t.get('kind') == 'at-time' else None
        days = sch.get('days') or {}
        months = set(sch.get('months') or range(1, 13))
        which = set(days.get('days') or [])
        if not hm or not which or days.get('kind') not in ('days-of-month', 'days-of-week'):
            return None
        if days['kind'] == 'days-of-month':
            return (lambda d: d.month in months and d.day in which), hm[0], hm[1]
        return (lambda d: d.month in months and sunday_index(d) in which), hm[0], hm[1]
    hm = clock(sch.get('time'))
    if not hm:
        return None
    if kind == 'daily':
        return (lambda d: True), hm[0], hm[1]
    if kind == 'weekdays':
        return (lambda d: d.weekday() < 5), hm[0], hm[1]
    if kind == 'weekly' and isinstance(sch.get('weekday'), int):
        return (lambda d: sunday_index(d) == sch['weekday']), hm[0], hm[1]
    if kind == 'monthly' and isinstance(sch.get('day'), int):
        return (lambda d: d.day == sch['day']), hm[0], hm[1]
    if kind == 'once':
        try:
            when = date.fromisoformat(str(sch.get('date')))
        except ValueError:
            return None
        return (lambda d: d == when), hm[0], hm[1]
    return None


def occurrences(sch, tz_hours, first, last):
    """Vancouver wall-clock datetimes (naive) of one schedule whose DATE in Vancouver is between first and last (dates)."""
    got = day_matcher(sch)
    if not got:
        return []
    match, hh, mm = got
    out = []
    # the routine's own day, then converted: a UTC routine at 16:00 is 09:00 here, on the same or the day before
    d = first - timedelta(days=2)
    while d <= last + timedelta(days=2):
        if match(d):
            at = (datetime(d.year, d.month, d.day, hh, mm, tzinfo=timezone(timedelta(hours=tz_hours))) .astimezone(VAN)).replace(tzinfo=None)
            if first <= at.date() <= last:
                out.append(at)
        d += timedelta(days=1)
    return sorted(out)


def repeat_text(sch):
    kind = sch.get('kind')
    if kind == 'daily':
        return 'Every day'
    if kind == 'weekdays':
        return 'Every weekday'
    if kind == 'weekly' and isinstance(sch.get('weekday'), int) and 0 <= sch['weekday'] <= 6:
        return 'Every ' + SUNDAY_FIRST[sch['weekday']]
    if kind == 'monthly' and isinstance(sch.get('day'), int):
        return 'Monthly, the ' + ordinal(sch['day'])
    if kind == 'once':
        return 'Once'
    if kind == 'advanced':
        days = (sch.get('days') or {})
        months = sorted(set(sch.get('months') or range(1, 13)))
        which = sorted(set(days.get('days') or []))
        if days.get('kind') == 'days-of-week':
            names = [SUNDAY_FIRST[i][:3] for i in which if isinstance(i, int) and 0 <= i <= 6]
            return ('Every ' + ', '.join(names)) if len(months) == 12 else 'Some months: ' + ', '.join(names)
        if days.get('kind') == 'days-of-month':
            nth = ', '.join(ordinal(i) for i in which)
            if len(months) == 12:
                return 'Monthly, the ' + nth
            return ('Yearly' if len(months) == 1 else 'Every %d months' % (12 // len(months)) if 12 % len(months) == 0 else 'Some months') + ', the ' + nth
    return 'Repeats'


def title_of(name):
    t = re.sub(r'^\s*reminder\s*[:\-]\s*', '', name, flags=re.I)
    t = re.sub(r'\s*\([^()]*\)\s*$', '', t).strip()  # "(Mon, Wed, Fri 11:00)": the calendar shows the time
    return (t[:1].upper() + t[1:])[:200] if t else name[:200]


def wall(dt):
    return dt.strftime('%Y-%m-%dT%H:%M')


def from_db_next(value):
    """OpenBot's next_run_at ('2026-11-22T16:00:00.000Z') as a Vancouver wall-clock datetime, or None."""
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).astimezone(VAN).replace(tzinfo=None)
    except ValueError:
        return None


QUERY = """select r.routine_id, r.name, r.timezone, t.schedule_json, t.next_run_at
           from projection_agent_routines r join projection_routine_triggers t on t.routine_id = r.routine_id
           where r.active = 1 order by r.name, r.routine_id"""


def read_routines(db_path):
    with closing(sqlite3.connect('file:%s?mode=ro' % quote(str(db_path).replace('\\', '/'), safe='/:'), uri=True, timeout=10)) as con:
        return con.execute(QUERY).fetchall()


def build(rows, now):
    """rows from read_routines, now = epoch seconds -> the feed body {at, reminders}. Pure: no files, no network."""
    here = datetime.fromtimestamp(now, VAN).replace(tzinfo=None)
    first, last = here.date() - timedelta(days=PAST_DAYS), here.date() + timedelta(days=AHEAD_DAYS)
    items, seen = [], set()  # a routine with two triggers comes back twice from the join: one entry per id
    for rid, name, tz, sched, nxt in rows:
        if rid in seen or not NAME.search(name or ''):
            continue
        try:
            sch = json.loads(sched)
        except (TypeError, ValueError):
            continue
        hours = utc_offset(tz)
        if hours is None or not isinstance(sch, dict):
            continue
        times = [wall(t) for t in occurrences(sch, hours, first, last)][:MAX_TIMES]
        nxt_wall = from_db_next(nxt)
        # OpenBot's own next run is the truth for `next`; without one in the future, the first computed occurrence after now
        future = nxt_wall if nxt_wall and nxt_wall > here else None
        if future is None:
            later = [t for t in occurrences(sch, hours, here.date(), here.date() + timedelta(days=NEXT_SEARCH_DAYS)) if t > here]
            future = later[0] if later else None
        if not times and future is None:
            continue  # a one-off that has already run
        seen.add(rid)
        items.append({'id': rid, 'title': title_of(name), 'repeat': repeat_text(sch), 'next': wall(future) if future else None, 'times': times})
    items.sort(key=lambda i: ((i['next'] or '9999'), i['title']))
    return {'at': iso(now), 'reminders': items[:MAX_ITEMS]}


def signature(body):
    return hashlib.sha256(json.dumps(body['reminders'], sort_keys=True).encode('utf-8')).hexdigest()


def post(body):
    env = dict(os.environ, DASH_BOT='developer')
    GUARD.mkdir(parents=True, exist_ok=True)
    tmp = GUARD / ('reminders-feed-%d.json' % os.getpid())
    tmp.write_text(json.dumps(body), encoding='utf-8')
    try:
        p = subprocess.run([sys.executable, '-I', str(TOOLS / 'dash.py'), 'feed-put', 'reminders', '--data-file', str(tmp)],
                           capture_output=True, text=True, timeout=60, env=env, cwd=str(TOOLS), creationflags=NO_WINDOW)
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass
    if p.returncode:
        raise RuntimeError('dash.py feed-put reminders failed (%d): %s' % (p.returncode, (p.stderr or p.stdout)[-300:]))


def sync(db_path=None, now=None, force=False, poster=post, state=STATE):
    """Read, build and post when due. Returns 'posted', 'unchanged' or 'none' (no database to read). Raises on a real failure."""
    now = now or time.time()
    path = Path(db_path or DB)
    if not path.exists():
        return 'none'
    body = build(read_routines(path), now)
    sig = signature(body)
    try:
        last = json.loads(Path(state).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        last = {}
    if not force and last.get('sig') == sig and now - float(last.get('at') or 0) < REPOST_S:
        return 'unchanged'
    poster(body)
    Path(state).parent.mkdir(parents=True, exist_ok=True)
    Path(state).write_text(json.dumps({'sig': sig, 'at': now}), encoding='utf-8')
    return 'posted'


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    db = None
    if '--db' in argv:
        i = argv.index('--db')
        if i + 1 >= len(argv):
            print('--db needs a path', file=sys.stderr)
            return 2
        db = argv[i + 1]
    if '--print' in argv:  # --now (tests): the moment to compute from, an ISO time with Z
        now = time.time()
        if '--now' in argv:
            now = datetime.fromisoformat(argv[argv.index('--now') + 1].replace('Z', '+00:00')).timestamp()
        print(json.dumps(build(read_routines(Path(db or DB)), now), indent=1))
        return 0
    try:
        sync(db, force='--force' in argv)
    except Exception as err:
        if 'Unknown feed' in str(err):
            return 1  # the Worker with the reminders feed is not deployed yet; nothing to tell Ana
        try:
            sys.path.insert(0, str(TOOLS))
            import auto_continue as ac
            ac.report_failure('reminders_feed: %s' % err, 'reminders_feed:' + iso(time.time())[:13])
        except Exception:
            pass
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
