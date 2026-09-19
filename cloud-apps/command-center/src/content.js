const TZ = 'America/Vancouver';
export const PLATFORMS = ['X', 'Instagram', 'Facebook', 'LinkedIn'];
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GOAL = 3;
const GOAL_TODAY = 12;
const GOAL_WEEK = 84;

export function platformOf(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'x' || s.startsWith('twitter') || s === 'x.com') return 'X';
  if (s.includes('insta')) return 'Instagram';
  if (s.includes('face') || s === 'fb') return 'Facebook';
  if (s.includes('linked')) return 'LinkedIn';
  if (s.includes('you') || s.includes('short')) return 'YouTube';
  return String(raw || '').trim() || 'X';
}

export function normalizePost(item = {}, source = 'agent', collectedAt) {
  return {
    id: String(item.id || crypto.randomUUID()),
    platform: platformOf(item.platform),
    posted_at: String(item.postedAt || item.posted_at || collectedAt || new Date().toISOString()),
    url: String(item.url || item.postUrl || item.post_url || '').trim(),
    first_line: String(item.firstLine ?? item.first_line ?? '').trim(),
    source: String(item.source || source),
  };
}

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

function dayKey(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function weekday(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(ms));
}

function addDay(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function weekDays(nowMs) {
  const idx = Math.max(0, DAY.indexOf(weekday(nowMs)));
  const monday = nowMs - idx * 86400000;
  return {
    idx,
    days: DAY.map((name, n) => ({
      name,
      key: dayKey(monday + n * 86400000),
      future: n > idx,
      today: n === idx,
    })),
  };
}

function pgOf(n, goal) {
  const pct = Math.max(0, Math.min(100, Math.round((n / goal) * 100)));
  const pg = n <= 0 ? 'crit' : n < goal ? (n / goal < 0.5 ? 'risk' : '') : 'ok';
  return { pct, pg };
}

function streakFrom(keys, todayKey) {
  const set = new Set(keys);
  let start = set.has(todayKey) ? todayKey : addDay(todayKey, -1);
  let n = 0;
  while (set.has(start)) {
    n += 1;
    start = addDay(start, -1);
  }
  return n;
}

function bestStreak(keys) {
  const uniq = [...new Set(keys)].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const k of uniq) {
    run = prev && addDay(prev, 1) === k ? run + 1 : 1;
    if (run > best) best = run;
    prev = k;
  }
  return best;
}

function clock(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: false }).format(new Date(t));
}

function tip(p, day, n, today) {
  if (today) return n ? `${p} · today · ${n} so far` : `${p} · today · none yet`;
  return n ? `${p} · ${day} · ${n}` : `${p} · ${day} · none`;
}

function overlayGrid(page, posts, nowMs, queuedN, platforms = PLATFORMS) {
  const list = platforms.length ? platforms : PLATFORMS;
  const goalToday = list.length * GOAL;
  const goalWeek = goalToday * 7;
  const week = weekDays(nowMs);
  const todayKey = week.days[week.idx].key;
  const weekKeys = new Set(week.days.map((d) => d.key));
  const byDay = {};
  const dayList = [];
  for (const p of posts) {
    const plat = platformOf(p.platform);
    if (!list.includes(plat)) continue;
    const t = Date.parse(p.posted_at);
    if (!Number.isFinite(t)) continue;
    const key = dayKey(t);
    dayList.push(key);
    byDay[key] ??= Object.fromEntries(list.map((x) => [x, 0]));
    byDay[key][plat] += 1;
  }
  const todayCounts = byDay[todayKey] || Object.fromEntries(list.map((x) => [x, 0]));
  const todayN = list.reduce((n, p) => n + todayCounts[p], 0);
  let weekN = 0;
  for (const key of weekKeys) {
    const row = byDay[key];
    if (row) weekN += list.reduce((n, p) => n + row[p], 0);
  }
  const todayPg = pgOf(todayN, goalToday);
  const weekPg = pgOf(weekN, goalWeek);
  const streak = streakFrom(dayList, todayKey);
  const best = bestStreak(dayList);
  page.tiles = [
    { icon: 'pen', label: 'Posts today', value: String(todayN), goal: `/ ${goalToday}`, ...todayPg, sub: queuedN ? `${queuedN} in the queue` : `${Math.max(0, goalToday - todayN)} to go` },
    { icon: 'chart', label: 'Posts this week', value: String(weekN), goal: `/ ${goalWeek}`, ...weekPg, sub: `Should be at ${(week.idx + 1) * goalToday} by ${week.idx >= 4 ? 'Friday' : DAY[week.idx]}` },
    page.tiles[2] || { icon: 'film', label: 'YouTube this week', value: '0', goal: '/ 3', pct: 0, sub: 'None in the editor' },
    { icon: 'fire', label: 'Days in a row with a post', value: String(streak), sub: `Best ever: ${best}` },
  ];
  page.todayPlatforms = {
    title: 'Today by platform',
    meta: `${GOAL} each`,
    rows: list.map((label) => {
      const n = todayCounts[label] || 0;
      return { label, value: `${n} of ${GOAL}`, tall: true, ...pgOf(n, GOAL) };
    }),
  };
  page.heat = {
    title: 'This week',
    meta: 'Number in each box is posts that day',
    days: DAY,
    rows: list.map((p) => ({
      p,
      cells: week.days.map((d) => {
        if (d.future) return { future: true };
        const n = (byDay[d.key] || {})[p] || 0;
        return { n, today: d.today, tip: tip(p, d.name, n, d.today) };
      }),
    })),
  };
}

function overlayQueue(page, data) {
  const queued = Array.isArray(data?.queued) ? data.queued : [];
  const rows = queued.map((item) => {
    const platform = platformOf(item.platform);
    const when = clock(item.at || item.postedAt || '');
    const title = when ? `${platform} · ${when}` : platform;
    return {
      title,
      quote: String(item.firstLine || item.first_line || item.body || '').trim(),
      msg: `${platform} post approved for ${when || 'later'}`,
      kind: 'content.approve',
      payload: { id: item.id, platform, at: item.at, firstLine: item.firstLine || item.first_line || '' },
    };
  });
  const shown = rows.slice(0, 3);
  const rest = rows.slice(3);
  const counts = {};
  for (const r of rest) counts[r.payload.platform] = (counts[r.payload.platform] || 0) + 1;
  page.queue = {
    title: "Today's queue",
    meta: queued.length ? `${queued.length} left` : 'None queued',
    approveAll: 'Approve all',
    approveAllKind: 'content.approve_all',
    approveAllMsg: `All ${queued.length} posts approved and scheduled`,
    approveAllPayload: { ids: queued.map((x) => x.id).filter(Boolean) },
    rows: shown,
  };
  if (rest.length) {
    page.queue.more = {
      title: `${rest.length} more`,
      sub: Object.entries(counts).map(([p, n]) => (n > 1 ? `${p} ×${n}` : p)).join(' · '),
      btn: 'Show all',
      msg: `Showing all ${queued.length} queued posts`,
    };
  }
  page.queueCount = queued.length;
}

function overlayYtWeek(page, video) {
  const queue = video?.queue || [];
  const editing = queue.filter((q) => q.status === 'editing' || q.status === 'queued');
  const ready = queue.filter((q) => q.status === 'ready');
  const done = queue.filter((q) => q.status === 'done');
  const n = done.length;
  const sub = editing.length ? `${editing.length} in the editor now` : ready.length ? `${ready.length} ready to watch` : 'None in the editor';
  page.tiles[2] = { icon: 'film', label: 'YouTube this week', value: String(n), goal: '/ 3', ...pgOf(n, 3), sub };
  page.ytWeek = {
    title: 'YouTube this week',
    note: page.ytWeek?.note || 'Steps: record · edit · your review · live',
    rows: [...editing, ...ready, ...done].map((q) => ({
      title: q.title,
      sub: q.status === 'editing' ? `Editing · ${q.progress || 0}%` : String(q.status || ''),
      pct: Number(q.progress) || 0,
      pill: q.status === 'editing' ? 'Editing' : q.status === 'ready' ? 'Ready' : q.status === 'done' ? 'Done' : '',
      pillCls: q.status === 'editing' ? 'blue' : q.status === 'ready' ? 'ok' : '',
    })),
  };
}

function overlayBest(page, viral) {
  const posts = viral?.posts || viral?.topPosts || [];
  page.bestPosts = {
    title: 'Best posts · last 30 days',
    meta: posts.length ? 'Ranked by clicks to Viral View' : 'No posts ranked yet',
    btn: 'Remix it',
    msg: 'Remix sent to Content Marketing agent',
    rows: posts.slice(0, 8).map((row) => {
      const platform = platformOf(row.platform);
      const line = String(row.firstLine || row.first_line || row.post || '').trim()
        || String(row.postUrl || row.post_url || row.url || 'Post');
      return {
        post: line,
        platform,
        views: fmtNum(row.views),
        clicks: fmtNum(row.clicks ?? row.manual_link_clicks),
        sales: String(row.sales ?? 0),
        kind: 'content.remix',
        payload: { id: row.id, platform, url: row.postUrl || row.post_url || row.url, firstLine: line },
      };
    }),
  };
}

export function overlayContent(page, {
  posts = [], queue = null, viral = null, video = null, drafts = [], nowMs = Date.now(),
  platforms = PLATFORMS, draftsError = '',
} = {}) {
  page.actions = [
    { label: 'Log a post', log: true, msg: 'Post logged' },
    { label: "Fill today's drafts", kind: 'content.generate_drafts', msg: "Filling today's drafts" },
  ];
  const queuedN = queue && !queue.missing && Array.isArray(queue.queued) ? queue.queued.length : 0;
  overlayGrid(page, posts, nowMs, queuedN, platforms);
  overlayYtWeek(page, video);
  overlayQueue(page, queue && !queue.missing ? queue : { queued: [] });
  overlayBest(page, viral);
  const today = dayKey(nowMs);
  if (draftsError) {
    page.unverified = true;
    page.sourceNote = 'Draft storage failed · not an empty queue';
    page.drafts = {
      title: "Today's drafts",
      meta: 'Storage error',
      error: String(draftsError),
      rows: [],
    };
    return;
  }
  const rows = (drafts || []).filter((d) => d.day === today && d.status !== 'discarded');
  page.drafts = {
    title: "Today's drafts",
    meta: `${rows.length} persisted · 3 per platform`,
    rows: rows.map((d) => ({
      id: d.id,
      platform: d.platform,
      title: d.first_line || d.body || 'Draft',
      body: d.body || '',
      subject: d.subject || '',
      slot: d.slot,
      day: d.day,
      saveKind: 'content.save_draft',
      sendKind: 'content.approve',
      discardKind: 'content.discard_draft',
    })),
  };
}
