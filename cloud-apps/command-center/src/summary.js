// Daily Summary (docs/dashboard-2.md): the block at the top of the Dashboard 2 Today page. View only: every
// number comes from a feed this Worker already holds (or Open-Meteo for the weather); a section with nothing to
// show says why in one line and names its owner, never a made-up value. No collector, no schedule.
import { sourceOf } from './today.js';
import { vanYmd } from './periods.js';

const DAY = 86400000;
const TZ = 'America/Vancouver';
const OPEN_CARD = ['todo', 'doing', 'waiting_on_jon', 'qc', 'review'];

const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const short = (ymd) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`));
const money = (n, cents = false) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
const parse = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
};

// ---- weather (Open-Meteo, no key), fetched by the Worker and kept 10 minutes ----
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=49.86&longitude=-119.58&current=temperature_2m,weather_code'
  + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FVancouver&forecast_days=1';
const WMO = [
  [[0], 'clear'], [[1], 'mostly clear'], [[2], 'partly cloudy'], [[3], 'overcast'], [[45, 48], 'fog'],
  [[51, 53, 55], 'drizzle'], [[56, 57], 'freezing drizzle'], [[61], 'light rain'], [[63], 'rain'], [[65], 'heavy rain'],
  [[66, 67], 'freezing rain'], [[71], 'light snow'], [[73], 'snow'], [[75, 77], 'heavy snow'], [[80], 'light showers'],
  [[81], 'showers'], [[82], 'heavy showers'], [[85, 86], 'snow showers'], [[95], 'thunderstorm'], [[96, 99], 'thunderstorm with hail'],
];
export const wmoText = (code) => WMO.find(([codes]) => codes.includes(Number(code)))?.[1] ?? null;

let cached = null; // { at, ttl, value } per Worker instance
export async function fetchWeather(nowMs, fetchFn = globalThis.fetch) {
  if (cached && nowMs - cached.at < cached.ttl && nowMs >= cached.at) return cached.value;
  let value = null;
  try {
    const res = await fetchFn(WEATHER_URL, { signal: AbortSignal.timeout(3000) });
    const j = res.ok ? await res.json() : null;
    const code = j?.current?.weather_code;
    if (Number.isFinite(j?.current?.temperature_2m) && wmoText(code)) {
      value = { at: new Date(nowMs).toISOString(), temp: j.current.temperature_2m, code, hi: j.daily?.temperature_2m_max?.[0], lo: j.daily?.temperature_2m_min?.[0], rain: j.daily?.precipitation_probability_max?.[0] };
    }
  } catch (err) { console.error('weather', err.message); }
  cached = { at: nowMs, ttl: value ? 10 * 60000 : 5 * 60000, value };
  return value;
}

// ---- RBC expenses: rolling totals and strange purchases (pure) ----
// Charges are { date, amount, description, pending, currency? } as MoneyClaw lists them. Refunds are negative.
const merchantOf = (c) => String(c.description || c.merchant || c.name || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 3).join(' ');
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const COMMON_CURRENCY = ['CAD', 'USD'];
const currencyOf = (c) => String(c.currency || c.nativeCurrency || '').toUpperCase();
const NEW_MERCHANT_HISTORY_DAYS = 14;

// Net spend (pending included, refunds netted) for the last 1, 7 and 30 days, counted back from `today` (a Kelowna day).
// `coverFrom` is the first day the charge lists vouch for; a window that starts before it is partial.
export function windowTotals(charges, today, coverFrom) {
  const sum = (from, to) => Math.round(charges.filter((c) => isDay(c.date) && c.date >= from && c.date <= to).reduce((n, c) => n + (Number(c.amount) || 0), 0) * 100) / 100;
  const yesterday = addDays(today, -1);
  const win = (days) => { const from = addDays(today, -(days - 1)); return { from, total: sum(from, today), partial: !coverFrom || coverFrom > from }; };
  return { yesterday: { from: yesterday, total: sum(yesterday, yesterday), partial: !coverFrom || coverFrom > yesterday }, week: win(7), month: win(30) };
}

// Charges in the last `days` days that look wrong, judged against all the charges given.
//   duplicate: same merchant and amount twice on one day; high: more than 3x the merchant's median (3+ earlier charges);
//   newMerchant: first sight of a merchant and over $100 (only with 14+ days of history before it);
//   currency: a charge in a currency other than CAD or USD (only when the feed carries one per charge).
export function strangePurchases(charges, { today, coverFrom, days = 7 }) {
  const list = charges.filter((c) => isDay(c.date) && Number(c.amount) > 0 && merchantOf(c));
  const since = addDays(today, -(days - 1));
  const recent = list.filter((c) => c.date >= since && c.date <= today);
  const items = [];
  const flag = (rule, c, detail) => items.push({ rule, date: c.date, merchant: String(c.description || c.merchant || c.name).trim(), amount: Number(c.amount), detail });
  const seen = new Set();
  for (const c of recent) {
    const m = merchantOf(c);
    const same = list.filter((x) => x.date === c.date && merchantOf(x) === m && Math.round(x.amount * 100) === Math.round(c.amount * 100));
    const dup = `${c.date}|${m}|${c.amount}`;
    if (same.length > 1 && !seen.has(dup)) { seen.add(dup); flag('duplicate', c, `${same.length} charges of ${money(c.amount, true)} the same day`); }
    const before = list.filter((x) => merchantOf(x) === m && x.date < c.date);
    if (before.length >= 3 && c.amount > 3 * median(before.map((x) => x.amount))) flag('high', c, `over 3x its usual ${money(median(before.map((x) => x.amount)), true)}`);
    const first = !before.length && !list.some((x) => x !== c && merchantOf(x) === m && x.date === c.date && x.amount > c.amount);
    const deep = coverFrom && addDays(c.date, -NEW_MERCHANT_HISTORY_DAYS) >= coverFrom;
    if (first && deep && c.amount > 100) flag('newMerchant', c, 'first charge from this merchant');
  }
  const currencyInFeed = list.some((c) => currencyOf(c));
  if (currencyInFeed) for (const c of recent) if (currencyOf(c) && !COMMON_CURRENCY.includes(currencyOf(c))) flag('currency', c, `charged in ${currencyOf(c)}`);
  return { items, currencyInFeed };
}

const feedSource = (label, at, nowMs, days) => {
  const s = sourceOf(label, at, nowMs);
  return { ...s, stale: !(nowMs - Date.parse(at) <= days * DAY) };
};

// ---- the sections ----
const row = (label, value, sub = '', cls = '') => ({ label, value, ...(sub ? { sub } : {}), ...(cls ? { cls } : {}) });
const section = (key, title, owner, sources, rest) => ({ key, title, owner, sources: sources.filter(Boolean), line: '', rows: [], notes: [], ...rest });
const none = (key, title, owner, sources, line) => section(key, title, owner, sources, { line });

function weatherSection(w, nowMs) {
  if (!w) return none('weather', 'Weather · West Kelowna', 'Mila', [], 'Weather unavailable (Open-Meteo), owner Mila');
  const rows = [row('Now', `${Math.round(w.temp)}°C, ${wmoText(w.code)}`)];
  if (Number.isFinite(w.hi) && Number.isFinite(w.lo)) rows.push(row('Today', `High ${Math.round(w.hi)}°, low ${Math.round(w.lo)}°${Number.isFinite(w.rain) ? `, ${Math.round(w.rain)}% chance of rain` : ''}`));
  return section('weather', 'Weather · West Kelowna', 'Mila', [{ ...sourceOf('Open-Meteo', w.at, nowMs), stale: false }], { rows });
}

function calendarSection(feed, today, nowMs) {
  const title = 'Calendar · today';
  if (!feed) return none('calendar', title, 'Ana', [], 'Calendar feed not connected. Owner: Ana.');
  const src = sourceOf("Ana's calendar post", feed.createdAt, nowMs);
  const pushed = Date.parse(feed.createdAt);
  if (Number.isFinite(pushed)) { // "updated 9:15 AM (12 min ago)": the clock time of the push, Kelowna time
    const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', hour: 'numeric', minute: '2-digit' }).format(new Date(pushed));
    src.ageLabel = src.ageLabel.replace(/^updated /, `updated ${clock} (`) + ')';
  }
  if (feed.data?.date !== today) return none('calendar', title, 'Ana', [src], `Calendar feed is from ${isDay(feed.data?.date) ? short(feed.data.date) : 'an unknown day'}, not today. Owner: Ana.`);
  const events = feed.data.events || [];
  if (!events.length) return none('calendar', title, 'Ana', [src], 'No events today.');
  return section('calendar', title, 'Ana', [src], { rows: events.map((e) => row(e.start === 'All day' ? 'All day' : `${e.start}-${e.end}`, e.title, e.calendar || '')) });
}

function marketsSection(row0, nowMs) {
  const title = 'Markets';
  const core = row0 ? parse(row0.data).markets?.core : null;
  if (!Array.isArray(core)) return none('markets', title, 'Mila', [], 'Market feed not connected (MoneyClaw). Owner: Mila.');
  const src = sourceOf('MoneyClaw markets', row0.collected_at, nowMs);
  const rows = ['VOO', 'QQQ'].map((sym) => {
    const m = core.find((x) => x?.symbol === sym);
    if (!m || !Number.isFinite(Number(m.price))) return row(sym, '', 'Not in the MoneyClaw feed. Owner: Mila.', 'muted');
    const ath = Number(m.allTimeHigh);
    const off = Number.isFinite(Number(m.pctOffHigh)) ? Number(m.pctOffHigh) : Number.isFinite(ath) && ath > 0 ? Math.round((1 - m.price / ath) * 1000) / 10 : null;
    const day = Number.isFinite(Number(m.todayPct)) ? ` · today ${m.todayPct > 0 ? '+' : ''}${m.todayPct}%` : '';
    return row(sym, money(Number(m.price), true), off == null ? `all-time high not in feed${day}` : `${off === 0 ? 'at its all-time high' : `${off}% below all-time high`}${day}`);
  });
  return section('markets', title, 'Mila', [src], { rows });
}

function expensesSection(row0, questions, keyOf, today, nowMs) { // questions is null when the open questions or their keys could not be read
  const title = 'RBC expenses';
  const ex = row0 ? parse(row0.data).expenses : null;
  if (!ex || !(ex.personal || ex.business)) return none('expenses', title, 'Mila', [], 'Expenses feed not connected (MoneyClaw). Owner: Mila.');
  const asOf = parse(row0.data).asOf;
  const src = feedSource('MoneyClaw expenses', row0.collected_at, nowMs, 2);
  if (isDay(asOf) && asOf < addDays(today, -2)) src.stale = true;
  const currency = /^[A-Z]{3}$/.test(String(parse(row0.data).currency || ex.currency || '').toUpperCase()) ? String(parse(row0.data).currency || ex.currency).toUpperCase() : 'CAD';
  const rows = [];
  const strange = [];
  const notes = [];
  let anyList = false;
  let coverFrom = null;
  const groups = [['business', 'Business'], ['personal', 'Personal']].filter(([k]) => ex[k]);
  const lists = Object.fromEntries(groups.map(([k]) => {
    const lm = ex[k].lastMonth;
    const cur = ex[k].month;
    const charges = [...(Array.isArray(lm?.charges) ? lm.charges : []), ...(Array.isArray(cur?.charges) ? cur.charges : [])].filter((c) => c && typeof c === 'object');
    const from = Array.isArray(lm?.charges) && isDay(lm.startDate) ? lm.startDate : Array.isArray(cur?.charges) && isDay(cur.startDate) ? cur.startDate : null;
    return [k, { charges, from }];
  }));
  for (const [k, label] of groups) {
    const { charges, from } = lists[k];
    const listed = charges.length > 0 || Array.isArray(ex[k].month?.charges);
    anyList ||= listed;
    coverFrom = from && (!coverFrom || from < coverFrom) ? from : coverFrom;
    const y = Number.isFinite(Number(ex[k].yesterday?.total)) ? Number(ex[k].yesterday.total) : null;
    if (!listed) { rows.push(row(label, y == null ? '' : `Yesterday ${money(y)}`, 'Charge list not in feed, so no 7 or 30 day total. Owner: Mila.', 'muted')); continue; }
    const t = windowTotals(charges, today, from);
    if (y != null && Math.abs(y - t.yesterday.total) > 0.01) notes.push(`${label}: yesterday is MoneyClaw's total (${money(y, true)}); its charge list adds to ${money(t.yesterday.total, true)}, so the 7 and 30 day totals may differ slightly.`);
    rows.push(row(label, `Yesterday ${money(y ?? t.yesterday.total)} · 7 days ${money(t.week.total)} · 30 days ${money(t.month.total)}`,
      !t.month.partial ? '' : from ? `30 days counts only from ${short(from)}, where the charge list starts` : '30 days may be partial: the charge list does not say where it starts'));
    const s = strangePurchases(charges, { today, coverFrom: from });
    for (const it of s.items) strange.push({ ...it, group: label });
  }
  if (anyList) {
    const noCurrency = !groups.some(([k]) => lists[k].charges.some((c) => currencyOf(c)));
    if (noCurrency) notes.push('Foreign currency check: currency not in feed.');
    if (!coverFrom || addDays(coverFrom, NEW_MERCHANT_HISTORY_DAYS) > addDays(today, -6)) notes.push(`New-merchant check needs ${NEW_MERCHANT_HISTORY_DAYS} days of earlier charges${coverFrom ? `, so it only covers charges from ${short(addDays(coverFrom, NEW_MERCHANT_HISTORY_DAYS))}` : ' and the list start is unknown'}.`);
  }
  // Charge watch: MoneyClaw's own flags (new subscription, price rise, big one-off, charged after cancel) are open questions keyed cw:.
  const watch = questions ? questions.filter((q) => /^cw:/.test(keyOf.get(q.id) || '')) : null;
  const flagged = [...strange.slice(0, 8).map((s) => row(`${s.group} · ${short(s.date)}`, `${s.merchant} ${money(s.amount, true)}`, s.detail, 'crit')),
    ...(watch || []).slice(0, 5).map((q) => row('Charge watch', String(q.question).slice(0, 120), 'Open question for you', 'crit'))];
  if (strange.length > 8) notes.push(`+${strange.length - 8} more strange purchases.`);
  if (watch && watch.length > 5) notes.push(`${watch.length - 5} more charge-watch flags are on the Questions page.`);
  if (!watch) notes.push('Charge-watch flags unavailable (bot questions unreadable). Owner: Mila.');
  if (anyList && watch && !flagged.length) notes.push('No strange purchases in the last 7 days.');
  return section('expenses', title, 'Mila', [src], { rows: [...rows, ...flagged], notes, currency, strange });
}

// ---- Sponsors ----
function sponsorsSection(C, X) {
  const title = 'Sponsors';
  const missing = (label, why = 'No source, owner Florence') => row(label, '', why, 'muted');
  const rows = [];
  const card = C.cards.find((c) => c.key === 'sponsors');
  const sources = [];
  if (card?.usd != null) {
    rows.push(row('Income this month', `${money(card.usd)} · ${C.cash?.month?.payments || 0} deposits`, 'All deposits to the RBC USD account'));
    sources.push(card.source);
  } else rows.push(missing('Income this month', `${card?.why || 'The sponsor cash ledger has not reported'}. No source, owner Florence`));
  const cash = C.cash;
  const collSrc = sourceOf('Sponsor collections', C.by.sponsors?.collected_at, C.nowMs);
  if (cash?.unpaidAvailable) {
    sources.push(collSrc);
    const top = cash.unpaid.slice(0, 4).map((u) => `${u.sponsor} ${money(u.owed)}`).join(', ');
    rows.push(cash.unpaid.length ? row('Owes you', `${money(cash.owed)} from ${cash.unpaid.length} sponsor${cash.unpaid.length === 1 ? '' : 's'}`, `${top}${cash.unpaid.length > 4 ? ` and ${cash.unpaid.length - 4} more` : ''}`) : row('Owes you', 'Nothing owed'));
    const dated = cash.unpaid.filter((u) => isDay(u.due));
    const soon = dated.filter((u) => u.due <= addDays(C.today, 7));
    rows.push(!dated.length ? row('Collections due', '', 'The collections feed has no due dates. Owner: Florence', 'muted')
      : soon.length ? row('Collections due', soon.map((u) => `${u.sponsor} ${money(u.owed)} ${u.due < C.today ? 'overdue since' : 'by'} ${short(u.due)}`).join(', '), '', soon.some((u) => u.due < C.today) ? 'crit' : '')
        : row('Collections due', 'None due in the next 7 days'));
  } else {
    rows.push(missing('Owes you', 'The sponsor collections feed has not reported. No source, owner Florence'));
    rows.push(missing('Collections due', 'The sponsor collections feed has not reported. No source, owner Florence'));
  }
  const real = !!parse(C.by.sponsors?.data).collections;
  const neg = real ? X.sponsors?.board?.columns?.find((c) => c.boardStage === 'negotiating')?.cards : null;
  rows.push(neg ? (neg.length ? row('Negotiating, to close', `${neg.length} deal${neg.length === 1 ? '' : 's'}`, neg.slice(0, 5).map((k) => `${k.name}${k.amt > 0 ? ` ${k.amtLabel}` : ''}`).join(', ')) : row('Negotiating, to close', 'None open'))
    : missing('Negotiating, to close', 'The sponsor deal board has not reported. No source, owner Florence'));
  if (real) sources.push(sourceOf('Sponsor deal board', C.by.sponsors.collected_at, C.nowMs));
  const open = X.videoCards ? X.videoCards.filter((c) => c.status !== 'done') : null;
  rows.push(open ? (open.length ? row('Videos still to make', `${open.length} sponsor video${open.length === 1 ? '' : 's'}`, open.slice(0, 5).map((c) => `${c.title.split(':')[0].trim()}${c.due ? ` (due ${short(c.due)})` : ''}`).join(', ')) : row('Videos still to make', 'None open'))
    : missing('Videos still to make', 'The dashboard cards could not be read. No source, owner Florence'));
  if (open) sources.push(C.src.cards);
  return section('sponsors', title, 'Florence', sources, { rows });
}

// ---- channels: videos on the calendar this week plus open cards ----
function channelSection(C, g) {
  const calOk = !!C.data.calendar;
  const tasks = C.t.tasks;
  const norm = (s) => String(s || '').toLowerCase().replace(/[’‘`]/g, "'");
  const week = (slug) => (C.data.calendar || []).filter((r) => r.channel === slug && r.day >= C.ws && r.day <= C.we);
  const sources = [C.src.calendar, { label: 'Dashboard cards', at: null, ageLabel: tasks ? 'live' : 'could not be read', stale: !tasks }];
  const open = tasks ? tasks.filter((t) => t.project === g.project && OPEN_CARD.includes(t.status)) : null;
  let used = 0;
  const rows = g.chans.map((c) => {
    const cards = open && (g.group ? open.filter((t) => norm(t.title).includes(norm(c.label))) : open);
    used += cards ? cards.length : 0;
    const w = c.noCalendar || !calOk ? null : week(c.slug);
    const cal = w ? (w.length ? `${w.filter((r) => r.status === 'scheduled' || r.status === 'published').length} of ${w.length} scheduled or live` : 'Nothing planned this week')
      : c.noCalendar ? 'No calendar yet' : 'Calendar unavailable';
    const cardText = cards ? `${cards.length} open card${cards.length === 1 ? '' : 's'}` : 'cards unavailable';
    return row(c.label, cal, cardText, !w || !w.some((r) => ['scheduled', 'published'].includes(r.status)) ? 'risk' : '');
  });
  const notes = [];
  if (!calOk) notes.push(`Channel calendars unavailable. Owner: ${g.owner}.`);
  if (!tasks) notes.push(`Open cards unavailable (dashboard cards unreadable). Owner: ${g.owner}.`);
  else if (g.group && open.length > used) notes.push(`${open.length - used} more open card${open.length - used === 1 ? '' : 's'} not tied to one channel.`);
  return section(g.key, g.title, g.owner, sources, { rows, notes });
}

// One bad source must not take the others down (or /d2): a section that throws becomes its "unavailable" line.
function safe(key, title, owner, build) {
  try { return build(); } catch (err) {
    console.error('summary', key, err);
    return none(key, title, owner, [], `${title} unavailable (could not read its data). Owner: ${owner}.`);
  }
}

// `C` is buildD2's context; `X` carries what d2.js already built: { weather, goals: [{ key, title, owner, project, group, chans }], videoCards, sponsors }.
export function buildSummary(C, X) {
  const mc = C.by.moneyclaw;
  const asks = C.data.keys && C.t.questions ? C.t.questions : null; // a charge-watch flag is a question matched by its key
  return {
    asOf: new Date(C.nowMs).toISOString(), tz: TZ, today: vanYmd(C.nowMs),
    sections: [
      safe('weather', 'Weather', 'Mila', () => weatherSection(X.weather, C.nowMs)),
      safe('calendar', 'Calendar', 'Ana', () => calendarSection(C.t.feeds?.calendar_today, C.today, C.nowMs)),
      safe('markets', 'Markets', 'Mila', () => marketsSection(mc, C.nowMs)),
      safe('expenses', 'RBC expenses', 'Mila', () => expensesSection(mc, asks, C.keyOf, C.today, C.nowMs)),
      safe('sponsors', 'Sponsors', 'Florence', () => sponsorsSection(C, X)),
      ...X.goals.map((g) => safe(g.key, g.title, g.owner, () => channelSection(C, g))),
    ],
  };
}
