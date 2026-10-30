// Calendar and Content pages (2026-10-30): one tab per YouTube channel Jon owns. The channel bots
// post each channel's schedule, calendar videos and outliers through /v1 (src/bots.js).
import { ymd } from './life.js';

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

// Outliers rank by views over their channel's average.
export const MULTIPLE_SQL = 'CAST(views AS REAL) / avg_views DESC, views DESC';
export const byMultiple = (a, b) => b.views / b.avg - a.views / a.avg || b.views - a.views;

// The rows both pages need: last 60 days of calendar and every outlier. Null when the tables can't
// be read (migration 0014 not applied), so the pages say so instead of failing.
export async function channelData(db, nowMs) {
  if (!db) return null;
  try {
    const [channels, calendar, outliers] = await Promise.all([
      db.prepare('SELECT * FROM yt_channels').all(),
      db.prepare("SELECT * FROM yt_calendar WHERE day >= ? ORDER BY day, IFNULL(time_pt, '99'), created_at LIMIT 3000").bind(ymd(nowMs - 60 * 86400000)).all(),
      db.prepare(`SELECT * FROM yt_outliers ORDER BY ${MULTIPLE_SQL} LIMIT 3000`).all(),
    ]);
    return { channels: channels.results || [], calendar: calendar.results || [], outliers: outliers.results || [] };
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

// With no schedule set, the weekdays its coming videos post on: "Tue, Fri".
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function postingDays(upcoming) {
  const days = new Set(upcoming.map((v) => new Date(`${v.date}T12:00:00Z`).getUTCDay()));
  return days.size ? [1, 2, 3, 4, 5, 6, 0].filter((d) => days.has(d)).map((d) => WEEKDAYS[d]).join(', ') : null;
}

const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const multipleLabel = (m) => `${m >= 10 ? Math.round(m) : m.toFixed(1)}× avg`;

export function buildChannelPages(out, data, nowMs = Date.now()) {
  const today = ymd(nowMs);
  const schedules = new Map((data?.channels || []).map((r) => [r.slug, r.schedule || null]));
  const rowsOf = (list, slug) => (list || []).filter((r) => r.channel === slug);
  if (out.pages?.calendar) {
    const label = new Map(CHANNELS.map((c) => [c.slug, c.label]));
    const video = (r) => ({
      id: r.id, title: r.title, status: r.status, date: r.day, dateLabel: dayLabel(r.day, today),
      timeLabel: r.time_pt ? `${timeLabel(r.time_pt)} PT` : '', link: r.link || null, channel: label.get(r.channel) || r.channel,
    });
    const tab = (c, rows) => {
      const videos = rows.map(video);
      const upcoming = videos.filter((v) => v.date >= today);
      return { ...c, count: upcoming.length, upcoming, earlier: videos.filter((v) => v.date < today).reverse() };
    };
    const known = (data?.calendar || []).filter((r) => label.has(r.channel));
    out.pages.calendar = {
      title: 'Calendar',
      available: !!data,
      channels: [{ ...tab({ slug: 'all', label: 'All channels', group: 'All' }, known), all: true },
        ...CHANNELS.map((c) => {
          const t = tab(c, rowsOf(known, c.slug));
          return { ...t, schedule: schedules.get(c.slug) || postingDays(t.upcoming) };
        })],
    };
  }
  if (out.pages?.content) {
    out.pages.content = {
      title: 'Content',
      available: !!data,
      channels: CHANNELS.map((c) => {
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
