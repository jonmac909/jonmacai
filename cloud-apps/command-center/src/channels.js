// Calendar and Content pages (2026-10-30): one tab per YouTube channel Jon owns. The channel bots
// post each channel's schedule, calendar videos and outliers through /v1 (src/bots.js).

// The one list of channels, in tab order, from D:\AgentTeam\rules\facts\channels.md. Each `group`
// is one row of tabs. Slugs are what bots pass to dash.py.
export const CHANNELS = [
  ['Jon\'s own', [['jon-mac', 'Jon Mac'], ['jonmacai', '@JonMacAI'], ['complete-histories', 'Complete Histories']]],
  ['Viral View', [['theo-creates', 'Theo Creates'], ['sienna-creates', 'Sienna Creates'], ['zane-creates', 'Zane Creates'],
    ['aria-creates', 'Aria Creates'], ['ash-creates', 'Ash Creates'], ['mina-creates', 'Mina Creates'], ['max-creates', 'Max Creates']]],
  ['Home Guide Press', [['peter-collins', 'Peter Collins'], ['jack-mercer', 'Jack Mercer'], ['rosa-cooks', 'Rosa Cooks'],
    ['rosas-clean-home', 'Rosa\'s Clean Home'], ['rosas-house-hacks', 'Rosa\'s House Hacks'], ['giovanni-moretti', 'Giovanni Moretti'],
    ['frank-bennett-dogs', 'Frank Bennett Dogs'], ['ruth-calder', 'Ruth Calder'], ['dale-whitaker-pitbulls', 'Dale Whitaker Pitbulls'],
    ['nora-fairweather-cats', 'Nora Fairweather Cats'], ['gail-merriman-golf', 'Gail Merriman Golf'],
    ['naomi-takeda-japan', 'Naomi Takeda Japan'], ['walter-brandt-dogs', 'Walter Brandt Dogs'], ['eleanor-whitfield', 'Eleanor Whitfield']]],
].flatMap(([group, list]) => list.map(([slug, label]) => ({ slug, label, group })));

// Channels dash.py registered from a CSV file name (yt_channels rows with a label), after the fixed list.
export const GROUPS = [...new Set(CHANNELS.map((c) => c.group))];
export function allChannels(rows) {
  const fixed = new Set(CHANNELS.map((c) => c.slug));
  const extra = (rows || []).filter((r) => r.label && !fixed.has(r.slug))
    .map((r) => ({ slug: r.slug, label: r.label, group: GROUPS.includes(r.grp) ? r.grp : 'Home Guide Press' }));
  return [...CHANNELS, ...extra.sort((a, b) => a.label.localeCompare(b.label))];
}

// Outliers rank by views over their channel's average.
export const MULTIPLE_SQL = 'CAST(views AS REAL) / avg_views DESC, views DESC';
// Spotify only: out of Track and every YouTube count, and YouTube data never touches its Calendar rows.
const NOT_ON_YOUTUBE = ['complete-histories'];
export const YOUTUBE_CHANNELS = CHANNELS.filter((c) => !NOT_ON_YOUTUBE.includes(c.slug));

export const byMultiple = (a, b) => b.views / b.avg - a.views / a.avg || b.views - a.views;

// What YouTube says for the rows on show, plus rows its date brings into the window. CROSS JOIN fixes the order so
// the first side walks its index; the second scans yt_stats, one row per video. Before migration 0018 this is empty, and the Calendar shows the rows as planned.
async function youtubeRows(db, since) {
  try {
    const { results } = await db.prepare(`SELECT v.*, s.scheduled_at AS yt_scheduled_at, s.scheduled_date AS yt_scheduled_date, s.status AS yt_status
      FROM yt_calendar v CROSS JOIN yt_stats s ON s.youtube_id = v.youtube_id WHERE v.day >= ?1
      UNION ALL SELECT v.*, s.scheduled_at, s.scheduled_date, s.status
      FROM yt_stats s CROSS JOIN yt_calendar v ON v.youtube_id = s.youtube_id WHERE (s.scheduled_at >= ?1 OR (s.status = 'scheduled' AND s.scheduled_date >= ?1)) AND v.day < ?1 LIMIT 3000`).bind(since).all();
    return (results || []).filter((r) => !NOT_ON_YOUTUBE.includes(r.channel));
  } catch (err) {
    console.error('youtubeRows', err);
    return [];
  }
}

// The rows both pages need: last 60 days of calendar and every outlier. Null when the tables can't
// be read (migration 0014 not applied), so the pages say so instead of failing.
export async function channelData(db, nowMs) {
  if (!db) return null;
  const since = pacific(nowMs - 60 * DAY_MS).day;
  try {
    const [channels, calendar, outliers, youtube] = await Promise.all([
      db.prepare('SELECT * FROM yt_channels').all(),
      db.prepare("SELECT * FROM yt_calendar WHERE day >= ? ORDER BY day, IFNULL(time_pt, '99'), created_at LIMIT 3000").bind(since).all(),
      db.prepare(`SELECT * FROM yt_outliers ORDER BY ${MULTIPLE_SQL} LIMIT 3000`).all(),
      youtubeRows(db, since),
    ]);
    const rows = new Map((calendar.results || []).map((r) => [r.id, r]));
    for (const r of youtube) rows.set(r.id, r);
    return { channels: channels.results || [], calendar: [...rows.values()], outliers: outliers.results || [] };
  } catch (err) {
    console.error('channelData', err);
    return null;
  }
}

const DAY_MS = 86400000;
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

// "Today", "Tomorrow", "Yesterday", else "Tue, Nov 3" (with the year when it isn't this year).
export function dayLabel(day, today) {
  const n = daysBetween(today, day);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const year = day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {};
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', ...year }).format(new Date(`${day}T12:00:00Z`));
}

export function ageLabel(day, today) {
  const n = daysBetween(day, today);
  if (n <= 0) return 'today';
  if (n === 1) return '1 day ago';
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.floor(n / 7)} weeks ago`;
  if (n < 730) return `${Math.floor(n / 30.44)} months ago`;
  return `${Math.floor(n / 365.25)} years ago`;
}

// "09:00" -> "9:00 AM"
export function timeLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// Kelowna time (Jon, 2026-11-03): BC stays on UTC-7 from Nov 2026, an hour ahead of US Pacific in winter.
const PACIFIC = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// A moment as the calendar's own Pacific day and time: the one zone for the Calendar's dates, times and "today".
export function pacific(iso) {
  const p = Object.fromEntries(PACIFIC.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// A UTC moment YouTube could hold: a real calendar day (2026-02-30 is not), since YouTube began. The stats route
// refuses anything else and the pages ignore it, so one bad stored value can't break a snapshot.
export function realUtc(iso) {
  if (typeof iso !== 'string' || iso < '2005') return false;
  const t = new Date(iso);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso.slice(0, 10);
}

export const stamp = (at, today) => {
  if (!realUtc(at)) return '';
  const { day, time } = pacific(at);
  return `${dayLabel(day, today)}, ${timeLabel(time)} PT`;
};

const YOUTUBE_STATUS = { scheduled: 'scheduled', live: 'published', private: 'private', unlisted: 'unlisted' };

// YouTube's date, time and status win over the calendar's, on read only. differs names what they disagree on;
// a row with no time planned has no time to disagree with.
export function withYoutube(r, today) {
  const scheduled = realUtc(r.yt_scheduled_at);
  if (!scheduled && !r.yt_status) return r;
  const exact = scheduled ? pacific(r.yt_scheduled_at) : null;
  // Studio's date with no time: only while it's scheduled, so the calendar's time stands and an old date can't move a live video.
  const date = r.yt_status === 'scheduled' ? r.yt_scheduled_date : null;
  const at = date && exact?.day !== date ? { day: date, time: r.time_pt } : exact || { day: r.day, time: r.time_pt };
  const status = YOUTUBE_STATUS[r.yt_status] || r.status;
  const differs = [];
  if (at.day !== r.day) differs.push('date');
  if (r.time_pt && at.time !== r.time_pt) differs.push('time');
  const heldBack = ['private', 'unlisted'].includes(status) && ['qc', 'review'].includes(r.status); // uploaded, not out yet: as expected
  if (status !== r.status && !heldBack) differs.push('status');
  const planned = { date: dayLabel(r.day, today), time: r.time_pt ? `${timeLabel(r.time_pt)} PT` : '', status: r.status };
  return { ...r, day: at.day, time_pt: at.time, status, differs, planned };
}

// With no schedule set, the weekdays its coming videos post on: "Tue, Fri".
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function postingDays(upcoming) {
  const days = new Set(upcoming.map((v) => new Date(`${v.date}T12:00:00Z`).getUTCDay()));
  return days.size ? [1, 2, 3, 4, 5, 6, 0].filter((d) => days.has(d)).map((d) => WEEKDAYS[d]).join(', ') : null;
}

const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const multipleLabel = (m) => `${m >= 10 ? Math.round(m) : m.toFixed(1)}× avg`;

export function buildChannelPages(out, data, nowMs = Date.now()) {
  const today = pacific(nowMs).day;
  const schedules = new Map((data?.channels || []).map((r) => [r.slug, r.schedule || null]));
  const rowsOf = (list, slug) => (list || []).filter((r) => r.channel === slug);
  if (out.pages?.calendar) {
    const list = allChannels(data?.channels);
    const label = new Map(list.map((c) => [c.slug, c.label]));
    const video = (r) => ({
      id: r.id, title: r.title, status: r.status, date: r.day, dateLabel: dayLabel(r.day, today),
      timeLabel: r.time_pt ? `${timeLabel(r.time_pt)} PT` : '', link: r.link || null, channel: label.get(r.channel) || r.channel,
      differs: r.differs || [], planned: r.planned || null,
    });
    const tab = (c, rows) => {
      const videos = rows.map(video);
      const upcoming = videos.filter((v) => v.date >= today);
      return { ...c, count: upcoming.length, upcoming, earlier: videos.filter((v) => v.date < today).reverse() };
    };
    const when = (r) => `${r.day} ${r.time_pt || '99'}`; // YouTube's date can move a row
    const known = (data?.calendar || []).filter((r) => label.has(r.channel)).map((r) => withYoutube(r, today))
      .sort((a, b) => when(a).localeCompare(when(b)));
    out.pages.calendar = {
      title: 'Calendar',
      available: !!data,
      channels: [{ ...tab({ slug: 'all', label: 'All channels', group: 'All' }, known), all: true },
        ...list.map((c) => {
          const t = tab(c, rowsOf(known, c.slug));
          return { ...t, schedule: schedules.get(c.slug) || postingDays(t.upcoming) };
        })],
    };
  }
  if (out.pages?.content) {
    out.pages.content = {
      title: 'Content',
      available: !!data,
      channels: allChannels(data?.channels).map((c) => {
        const outliers = rowsOf(data?.outliers, c.slug).map((r) => ({ ...r, avg: r.avg_views })).sort(byMultiple).map((r) => ({
          id: r.id, title: r.title, source: r.source || null, link: r.link, thumb: r.thumb || null, views: r.views, avg: r.avg,
          multipleLabel: multipleLabel(r.views / r.avg), viewsLabel: `${compact(r.views)} views vs ${compact(r.avg)} avg`,
          ageLabel: ageLabel(r.published, today), selected: !!r.selected, selectUrl: `/dashboard/api/v1/outliers/${r.id}/select`,
        }));
        return { ...c, count: outliers.length, outliers };
      }),
    };
  }
}
