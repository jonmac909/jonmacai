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
    ['naomi-takeda-japan', 'Naomi Takeda Japan'], ['walter-brandt-dogs', 'Walter Brandt Dogs']]],
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
      db.prepare('SELECT * FROM yt_calendar WHERE day >= ? ORDER BY day, created_at LIMIT 3000').bind(ymd(nowMs - 60 * 86400000)).all(),
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

const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const multipleLabel = (m) => `${m >= 10 ? Math.round(m) : m.toFixed(1)}× avg`;

export function buildChannelPages(out, data, nowMs = Date.now()) {
  const today = ymd(nowMs);
  const schedules = new Map((data?.channels || []).map((r) => [r.slug, r.schedule || null]));
  const rowsOf = (list, slug) => (list || []).filter((r) => r.channel === slug);
  if (out.pages?.calendar) {
    out.pages.calendar = {
      title: 'Calendar',
      available: !!data,
      channels: CHANNELS.map((c) => {
        const videos = rowsOf(data?.calendar, c.slug).map((r) => ({
          id: r.id, title: r.title, status: r.status, date: r.day, dateLabel: dayLabel(r.day, today), link: r.link || null,
        }));
        const upcoming = videos.filter((v) => v.date >= today);
        return { ...c, schedule: schedules.get(c.slug) || null, count: upcoming.length, upcoming, earlier: videos.filter((v) => v.date < today).reverse() };
      }),
    };
  }
  if (out.pages?.content) {
    out.pages.content = {
      title: 'Content',
      available: !!data,
      channels: CHANNELS.map((c) => {
        const outliers = rowsOf(data?.outliers, c.slug).map((r) => ({ ...r, avg: r.avg_views })).sort(byMultiple).map((r) => ({
          id: r.id, title: r.title, link: r.link, thumb: r.thumb || null, views: r.views, avg: r.avg,
          multipleLabel: multipleLabel(r.views / r.avg), viewsLabel: `${compact(r.views)} views vs ${compact(r.avg)} avg`,
          ageLabel: ageLabel(r.published, today), selected: !!r.selected, selectUrl: `/dashboard/api/v1/outliers/${r.id}/select`,
        }));
        return { ...c, count: outliers.length, outliers };
      }),
    };
  }
}
