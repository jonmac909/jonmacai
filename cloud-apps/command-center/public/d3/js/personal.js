// The Personal page (Jacqueline's handover, section 11) and the expense lists with tags (Personal › Budget and the
// Money page's business part). Routes: #personal, #personal/meals, /workouts, /date, /trips, /trips/<n>, /home, /budget.
// Data: S.personal from GET /dashboard/api/personal (src/personal.js) and S.home (the schedule, src/home.js).
// Writes: PUT /personal/<meals|prices|trips|rules>, POST /personal/tags, POST /personal/photo, and the schedule's own
// PATCH /home/tasks/<id> for the workout and date-night rules.
import { esc } from './util.js';

const TZ = 'America/Vancouver';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NAMES = { meals: 'Meals', workouts: 'Workouts', date: 'Date night', budget: 'Budget', trips: 'Trips', home: 'Home' };
const BUDGET = { personal: [8000, 10000, '$8–10k'], business: [3000, 5000, '$3–5k'] };
const FOOD_MONTH = 1000;
const GROC_WEEK = 230;

// ---- time (Vancouver) ----
export function nowParts(ms = Date.now()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t) => f.find((x) => x.type === t)?.value || '0';
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, min: Number(g('hour')) * 60 + Number(g('minute')) };
}
export const dow = (ymd) => (new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
export const addD = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fmtT = (m) => { const h = Math.floor(m / 60); const mm = m % 60; return `${((h + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
const fmtD = (ymd) => (ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '');
const taskDays = (t) => (t.rep === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : t.rep === 'weekdays' ? [0, 1, 2, 3, 4] : t.rep === 'weekly' ? t.days : []);
function nextOcc(t, now) {
  for (let i = 0; i < 8; i++) {
    const d = addD(now.ymd, i);
    if (taskDays(t).includes(dow(d)) && (i > 0 || t.end > now.min)) return { ymd: d, i };
  }
  return null;
}
const whenText = (o, t) => (!o ? 'Not on the schedule' : o.i === 0 ? `Today ${fmtT(t.start)}` : o.i === 1 ? `Tomorrow ${fmtT(t.start)}` : `${DAYS[dow(o.ymd)]} ${fmtT(t.start)}`);
const daysText = (t) => { const d = taskDays(t); return d.length === 7 ? 'Every day' : d.length ? d.map((x) => DAYS[x]).join(', ') : ''; };
// The meal week: on Sunday it is the coming week, otherwise this week (its Monday).
export const mealWeek = (today) => (dow(today) === 6 ? addD(today, 1) : addD(today, -dow(today)));

// ---- money ----
const usd0 = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const bar = (pct, cls = '') => `<div class="psbar"><u class="${cls}" style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%"></u></div>`;

// ---- recipes and grocery lists (ported from the approved mockup) ----
export function splitR(t) {
  const L = String(t || '').split('\n');
  const iH = L.findIndex((l) => /^\s*ingredients\s*:?\s*$/i.test(l));
  let mH = L.findIndex((l) => /^\s*(method|directions|instructions|steps)\s*:?\s*$/i.test(l));
  const mS = mH < 0 ? L.findIndex((l) => /^\s*1[.)]\s/.test(l)) : mH + 1;
  if (mH < 0) mH = mS < 0 ? L.length : mS;
  return { head: iH > 0 ? L.slice(0, iH).join('\n').trim() : '', ing: L.slice(iH >= 0 ? iH + 1 : 0, mH).map((x) => x.trim()).filter(Boolean), meth: mS < 0 ? '' : L.slice(mS).join('\n').trim() };
}
const PANTRY = /^(salt|pepper|black pepper|olive oil|oil|garam masala|turmeric|cumin|fajita spice|spice|water)$/i;
const PREP = /\(.*?\)|\b(cut up|halved|sliced|diced|chopped|minced|to serve|for serving|thinly)\b/gi;
const sing = (w) => w.replace(/oes$/, 'o').replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
export function parseIng(lines) {
  const out = [];
  lines.forEach((l) => l.split(/,|\band\b/i).forEach((part) => {
    const p = part.replace(PREP, '').replace(/handful of|a few/ig, '').replace(/\s+/g, ' ').trim();
    if (!p) return;
    const m = p.match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lb|cups?|tbsp|tsp|heads?|pints?|bunch(?:es)?|jars?|cans?|packs?)?\s+(.+)$/i);
    let q = null; let u = ''; let name = p;
    if (m) { q = Number(m[1]); u = (m[2] || '').toLowerCase().replace(/s$/, ''); name = m[3]; }
    name = name.replace(/^fresh\s+/i, '');
    const key = sing(name.toLowerCase().replace(/\bcloves?\b/, '').trim());
    if (!key) return;
    out.push({ key, name: name.charAt(0).toUpperCase() + name.slice(1), q, u, pantry: PANTRY.test(key) });
  }));
  const seen = new Map();
  out.forEach((x) => { const y = seen.get(x.key); if (!y) seen.set(x.key, { ...x, qs: x.q != null ? [[x.q, x.u]] : [] }); else if (x.q != null) y.qs.push([x.q, x.u]); });
  return [...seen.values()];
}
export function qtyText(qs) {
  const by = {};
  qs.forEach(([q0, u0]) => { let q = q0; let u = u0; if (u === 'kg') { q *= 1000; u = 'g'; } by[u] = (by[u] || 0) + q; });
  return Object.entries(by).map(([u, q]) => (u === 'g' && q >= 1000 ? `${Number((q / 1000).toFixed(2))} kg` : `${Number(q.toFixed(2))}${u ? ` ${u}` : ''}`)).join(' + ');
}
// Prices checked 12-13 Nov 2026: Costco (ribeye, steelhead: Jacqueline's; chicken: Costco Business Centre), the rest from
// the Real Canadian Superstore site. n = pack of n, g = pack of g grams, each = priced per piece.
const PRICE = [[/ribeye/i, 100, { n: 4 }], [/steelhead/i, 35], [/chicken/i, 33.38, { g: 2000 }], [/passata/i, 5.99], [/potato/i, 5], [/garlic/i, 1.28], [/rosemary/i, 3], [/onion/i, 2], [/ginger/i, 1.15], [/cilantro/i, 1.25],
  [/broccoli/i, 4.25, { each: 1 }], [/lemon/i, 1.25, { each: 1 }], [/lime/i, 1, { each: 1 }], [/bell pepper/i, 2.64, { each: 1 }], [/romaine/i, 7], [/spinach/i, 5], [/tomato/i, 7], [/cucumber/i, 2, { each: 1 }],
  [/butter/i, 7.99], [/yogurt/i, 2.49], [/cream/i, 7.29], [/rice/i, 7.49], [/tortilla/i, 3.49], [/feta/i, 6], [/parmesan/i, 13.75], [/spaghetti/i, 1.99],
  [/trout/i, 23.9, { each: 1 }], [/steak/i, 16.29, { each: 1 }], [/asparagus/i, 11.69], [/shrimp/i, 8, { g: 400 }], [/cabbage/i, 4.64, { each: 1 }]];
const pEntry = (k) => PRICE.find((p) => p[0].test(k)) || [null, 0, {}];
export const priceOf = (k, P = {}) => (k in P ? P[k] : pEntry(k)[1]);
export function lineFor(k, qs, P = {}) {
  const o = pEntry(k)[2] || {}; const pr = priceOf(k, P);
  const n = qs.filter((q) => !q[1] || q[1] === 'head').reduce((a, q) => a + q[0], 0);
  const g = qs.reduce((a, [q, u]) => a + (u === 'g' ? q : u === 'kg' ? q * 1000 : u === 'lb' ? q * 454 : 0), 0);
  if (o.n && n) { const p = Math.ceil(n / o.n); return { q: `${p} pack${p > 1 ? 's' : ''} of ${o.n}`, p: pr * p }; }
  if (o.g && g) { const p = Math.ceil(g / o.g); return { q: `${p} × ${o.g >= 1000 ? `${o.g / 1000} kg` : `${o.g} g`} pack (need ${qtyText(qs)})`, p: pr * p }; }
  if (o.each && n) return { q: `${n} × $${pr % 1 ? pr.toFixed(2) : pr}`, p: pr * n };
  return { q: qtyText(qs), p: pr };
}
const AISLES = [['Meat & fish', /ribeye|steak|chicken|steelhead|trout|salmon|shrimp|beef|pork|fish|bacon/i], ['Dairy', /yogurt|cream|butter|feta|parmesan|cheese|milk|egg/i], ['Carbs', /rice|spaghetti|pasta|tortilla|bread|noodle|bun/i], ['Pantry', /passata|sauce|stock|honey|soy|can|jar|flour|sugar/i]];
const COSTCO = /ribeye|steelhead|chicken/i;
export const aisle = (k) => (COSTCO.test(k) ? 'Costco' : (AISLES.find((a) => a[1].test(k)) || ['Produce'])[0]);
const AORDER = ['Costco', 'Meat & fish', 'Produce', 'Dairy', 'Carbs', 'Pantry'];
const MON = [0, 1, 2, 3];
const THU = [4, 5, 6];
// One grocery list: the ticked ingredients of its meals, merged, in store order.
export function groc(meals, idxs, P = {}) {
  const items = new Map();
  idxs.forEach((i) => {
    const m = meals[i];
    if (!m?.on?.length) return;
    parseIng(splitR(m.r).ing).forEach((x) => {
      if (!m.on.includes(x.key)) return;
      const y = items.get(x.key);
      if (y) y.qs.push(...x.qs); else items.set(x.key, { name: x.name, qs: [...x.qs] });
    });
  });
  const rows = [...items.entries()].sort((a, b) => AORDER.indexOf(aisle(a[0])) - AORDER.indexOf(aisle(b[0])));
  return { rows, total: rows.reduce((a, [k, x]) => a + lineFor(k, x.qs, P).p, 0) };
}

// ---- saved data, with defaults ----
const blankMeal = () => ({ n: '', r: '', on: [], src: '', imgs: [] });
export const mealsOf = (P) => { const l = P?.store?.meals?.list; return Array.from({ length: 7 }, (_, i) => ({ ...blankMeal(), ...(Array.isArray(l) && l[i] ? l[i] : {}) })); };
const items3 = () => [{ k: 'Flight', cost: '', ok: false }, { k: 'Hotel', cost: '', ok: false }, { k: 'Car', cost: '', ok: false }];
// Portugal is the first trip; its stops are examples until Jon adds the real ones (the handover's open question).
export const tripsOf = (P) => (Array.isArray(P?.store?.trips) ? P.store.trips : [{ name: 'Portugal', bud: 5000, stops: [
  { place: 'Lisbon', from: '', to: '', ex: 1, items: items3() }, { place: 'Porto', from: '', to: '', ex: 1, items: items3() }] }]);
const rulesOf = (P) => ({ again: 'next', ...(P?.store?.rules || {}) });
// Plans: day trips, things to do and things booked, kept per day on the trip (plans[day] = [{ n, img, link, cost,
// ok, notes }]). Each one's cost counts toward the trip budget.
export const plansOf = (t) => Object.entries(t?.plans || {}).flatMap(([d, xs]) => (Array.isArray(xs) ? xs : []).map((x, k) => ({ ...x, d, k })))
  .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.k - b.k));
const inStop = (s, d) => { const a = s.from || s.to; const b = s.to || s.from; return !!(a && a <= d && d <= b); };
const tripCost = (t) => t.stops.reduce((a, s) => a + s.items.reduce((b, x) => b + (Number(x.cost) || 0), 0), 0) + plansOf(t).reduce((a, x) => a + (Number(x.cost) || 0), 0);
// The plan form onto trip n: adds one, or replaces plans[d][k] (moving it when its day changed). Returns what to fix, or ''.
export function savePlan(T, n, v, at = null) {
  const t = T[n]; if (!t) return 'That trip is gone. Reload the page.';
  const name = String(v.n || '').trim().slice(0, 120);
  const img = String(v.img || '').slice(0, 500);
  if (!name && !img) return 'Add what it is, or a photo';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.d || '')) return 'Pick the day';
  const plan = { n: name, img, link: webLink(v.link), cost: v.cost == null || v.cost === '' ? '' : Math.max(0, Number(v.cost) || 0), ok: v.ok != null && v.ok !== false, notes: String(v.notes || '').trim().slice(0, 2000) };
  t.plans = t.plans || {};
  if (at) {
    const list = t.plans[at.d];
    if (!list?.[at.k]) return 'That plan changed on another screen. Close and open it again.';
    if (at.d === v.d) { list[at.k] = plan; return ''; }
    list.splice(at.k, 1); if (!list.length) delete t.plans[at.d];
  }
  (t.plans[v.d] = t.plans[v.d] || []).push(plan);
  return '';
}
export function dropPlan(T, n, d, k) {
  const list = T[n]?.plans?.[d]; if (!list?.[k]) return false;
  list.splice(k, 1); if (!list.length) delete T[n].plans[d];
  return true;
}
const planTile = (x, cls = 'psct') => `<button type="button" class="${cls}${x.ok ? ' ok' : ''}" data-psplanedit="${x.d}.${x.k}" title="${esc(x.n || 'Plan')}${x.ok ? ' · booked' : ''}">${x.img ? `<img alt="" loading="lazy" src="${esc(x.img)}">` : `<span>${esc((x.n || '?').slice(0, 1).toUpperCase())}</span>`}</button>`;
const planRow = (x) => `<div class="psplan${x.ok ? ' ok' : ''}">${planTile(x, 'psplt')}<button type="button" class="psplb" data-psplanedit="${x.d}.${x.k}"><b>${esc(x.n || 'Untitled')}</b><span class="mut">${DAYS[dow(x.d)]} ${fmtD(x.d)}${x.cost !== '' && x.cost != null ? ` · ${usd0(Number(x.cost) || 0)}` : ''}</span></button>${x.link ? `<a class="pslnk" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">Link</a>` : ''}<label class="psplok"><input type="checkbox" data-psplanok="${x.d}.${x.k}"${x.ok ? ' checked' : ''}> ${x.ok ? 'Booked' : 'Idea'}</label></div>`;
const tripBooked = (t) => { let n = 0; let all = 0; t.stops.forEach((s) => s.items.forEach((x) => { all++; if (x.ok) n++; })); return [n, all]; };
const tripDates = (t) => { const ds = t.stops.flatMap((s) => [s.from, s.to]).filter(Boolean).sort(); return ds.length ? `${fmtD(ds[0])} – ${fmtD(ds[ds.length - 1])}` : 'Dates not set'; };
const budLine = (t) => (t.bud ? `${usd0(tripCost(t))} of ${usd0(t.bud)} budget` : `${usd0(tripCost(t))} · no budget`);
// A trip with no photo of its own shows its first stop (a known city beats the country article). A place's photo: Jon's own upload, else the first real photo in the place's Wikipedia article (no flags, maps or
// crests), looked up once per name while the page is open and dropped into the picture when it arrives.
const WIKI = {};
const NOT_PHOTO = /flag|map|coat|locat|logo|emblem|seal|arms|atlas|diagram|portrait/i;
function placePhoto(name, own) {
  if (own) return own;
  const k = String(name || '').trim();
  if (!k || typeof fetch !== 'function' || typeof document === 'undefined') return '';
  if (!(k in WIKI)) {
    WIKI[k] = '';
    fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(k.replace(/ /g, '_'))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        const it = (b?.items || []).find((i) => i.type === 'image' && /\.jpe?g$/i.test(i.title || '') && !NOT_PHOTO.test(i.title) && i.srcset?.length);
        const src = it ? it.srcset[it.srcset.length - 1].src || '' : '';
        if (!src) return;
        WIKI[k] = src.startsWith('//') ? `https:${src}` : src;
        document.querySelectorAll('img[data-psimg]').forEach((im) => { if (im.dataset.psimg === k && !im.getAttribute('src')) im.src = WIKI[k]; });
      })
      .catch(() => {});
  }
  return WIKI[k];
}
const photoHtml = (name, own, up) => { const src = placePhoto(name, own); return `<div class="psph"><span class="psphi">${esc(String(name || '?').trim().slice(0, 1).toUpperCase())}</span><img alt="" loading="lazy" data-psimg="${esc(String(name || '').trim())}"${src ? ` src="${esc(src)}"` : ''}>${up ? `<label class="psphup"><input type="file" accept="image/*" hidden ${up}>${own ? 'Change photo' : 'Add photo'}</label>` : ''}</div>`; };
const tripBar = (t) => (t.bud ? bar((tripCost(t) / t.bud) * 100, tripCost(t) > t.bud ? 'bad' : '') : '');
// A stop's order is its place in the saved list: Jon sets it (drag, or the arrows), and nothing re-sorts it by date.
export function moveStop(T, n, from, to) {
  const s = T[n]?.stops;
  if (!s || from === to || !(from >= 0 && to >= 0 && from < s.length && to < s.length)) return false;
  s.splice(to, 0, s.splice(from, 1)[0]);
  return true;
}
const webLink = (v) => { const l = String(v || '').trim().slice(0, 500); return !l ? '' : /^https?:\/\//i.test(l) ? l : `https://${l}`; };
// The stop form (place, dates, notes, link, and each booking's name, cost and booked tick) onto stop j of trip n.
// Returns what to fix, or '' when saved into T.
export const formStop = (s, v) => ({
  ...s, place: String(v.place || '').trim().slice(0, 80), from: v.from || '', to: v.to || '', notes: String(v.notes || '').trim().slice(0, 2000), link: webLink(v.link),
  items: (s.items || []).map((x, k) => { const c = v[`c${k}`]; return { ...x, k: String(v[`k${k}`] ?? '').trim().slice(0, 40) || x.k, cost: c == null || c === '' ? '' : Math.max(0, Number(c) || 0), ok: v[`o${k}`] != null }; }),
});
export function editStop(T, n, j, v) {
  const s = T[n]?.stops?.[j];
  if (!s) return 'That stop is gone. Reload the page.';
  if (!String(v.place || '').trim()) return 'Add the place';
  if (v.from && v.to && v.to < v.from) return 'Leave date is before arrive date';
  Object.assign(s, formStop(s, v), { ex: 0 });
  return '';
}
// The calendar: the trip's weeks (Monday first), each stop on every day from its arrive to its leave date.
function tripCal(t) {
  const ds = t.stops.flatMap((s) => [s.from, s.to]).filter(Boolean).sort();
  const chip = (s, j) => { const src = placePhoto(s.place, s.img); return `<button type="button" class="pscchip" data-psedstop="${j}" title="Edit ${esc(s.place)}"><img alt="" loading="lazy" data-psimg="${esc(String(s.place || '').trim())}"${src ? ` src="${esc(src)}"` : ''}>${esc(s.place)}</button>`; };
  const undated = t.stops.map((s, j) => (!s.from && !s.to ? chip(s, j) : '')).join('');
  const none = undated ? `<div class="psstend pscnone"><span class="mut">No dates yet</span><div class="pscchips">${undated}</div></div>` : '';
  if (!ds.length) return `<p class="mut psstend">Add dates to the stops to see them on the calendar.</p>${none}`;
  const first = ds[0]; const last = ds[ds.length - 1];
  const plans = t.plans || {};
  // One block per month (Jon, 2026-11-14), Monday first. A day in the trip shows where he is (a small photo of the
  // stop) and the thumbnails of what he wants to do that day, with + to add one.
  const months = [];
  for (let m = `${first.slice(0, 7)}-01`; m <= last; m = addD(m, 32).slice(0, 7) + '-01') months.push(m);
  return `<div class="pscals">${months.map((m) => {
    const days = [];
    for (let d = m; d.slice(0, 7) === m.slice(0, 7); d = addD(d, 1)) days.push(d);
    const pad = '<div class="pscday pad"></div>'.repeat(dow(m));
    const cells = days.map((d) => {
      const inTrip = d >= first && d <= last;
      const on = t.stops.map((s, j) => { const a = s.from || s.to; const b = s.to || s.from; return a && a <= d && d <= b ? chip(s, j) : ''; }).join('');
      const th = (plans[d] || []).map((x, k) => planTile({ ...x, d, k })).join('');
      const add = inTrip ? `<button type="button" class="psctadd" data-psaddplan="${d}" title="Add a plan" aria-label="Add a plan on ${fmtD(d)}">+</button>` : '';
      return `<div class="pscday${inTrip ? '' : ' out'}${on ? '' : ' empty'}" data-ymd="${d}"><small><span class="pscdw">${DAYS[dow(d)]} </span>${Number(d.slice(8))}</small><div class="pscchips">${on}</div>${th || add ? `<div class="pscthumbs">${th}${add}</div>` : ''}</div>`;
    }).join('');
    return `<div class="pscmon"><h3>${new Date(`${m}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</h3><div class="pscal"><div class="pscalh">${DAYS.map((x) => `<span>${x}</span>`).join('')}</div>${pad}${cells}</div></div>`;
  }).join('')}</div>${none}`;
}
const task = (H, id) => (H?.tasks || []).find((t) => t.id === id) || null;
const habitOn = (H, kind, ymd) => (H?.habits || []).some((h) => h.kind === kind && h.day === ymd);

// ---- the page ----
function crumbs(sub, extra) {
  if (!sub[0]) return '<h1>Personal</h1>';
  const back = extra ? `#personal/${sub[0]}` : '#personal';
  return `<h1 class="pscrumb"><a href="${back}" aria-label="Back">‹</a> <a href="#personal">Personal</a> <span>›</span> ${extra ? `<a href="#personal/${sub[0]}">${NAMES[sub[0]]}</a> <span>›</span> ${esc(extra)}` : NAMES[sub[0]]}</h1>`;
}
export function mnavHtml(p) {
  return `<nav class="psmnav" aria-label="Pages">${[['home', 'Goals'], ['personal', 'Personal'], ['money', 'Money']].map(([k, l]) => `<a href="#${k}"${k === p ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}

function spendPersonal(P) { const v = P?.money?.personal?.month; return typeof v === 'number' ? v : null; }
function monthPace(today) { const d = Number(today.slice(8, 10)); const [y, m] = today.split('-').map(Number); return { d, len: new Date(Date.UTC(y, m, 0)).getUTCDate() }; }
const monthName = (today) => new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' });

function overview(S, now) {
  const P = S.personal; const H = S.home;
  const card = (go, title, em, b, sd, foot, pct) => `<a class="pscard" href="#personal/${go}"><small>${title}</small><div class="psmain"><em>${em}</em><b>${b}</b><span>${sd}</span></div><div class="psfoot">${pct == null ? '<div class="psbar" style="visibility:hidden"></div>' : bar(pct)}<span>${foot}</span></div></a>`;
  const spent = spendPersonal(P); const pace = monthPace(now.ymd);
  const budget = spent == null
    ? card('budget', `Budget · ${monthName(now.ymd)}`, 'Personal', 'No feed', 'MoneyClaw has not sent this month', `Budget ${BUDGET.personal[2]}`, null)
    : card('budget', `Budget · ${monthName(now.ymd)}`, 'Personal', `${usd0(spent)} <i>of ${BUDGET.personal[2]}</i>`, 'Includes fixed bills', `Heading for ~${usd0((spent / pace.d) * pace.len)}`, (spent / BUDGET.personal[1]) * 100);
  const meals = mealsOf(P); const nM = meals.filter((m) => m.n).length; const next = meals.findIndex((m) => m.n);
  const wo = task(H, 'r-workout'); const woNext = wo && nextOcc(wo, now);
  const wk = addD(now.ymd, -dow(now.ymd));
  const woDays = wo ? taskDays(wo) : [];
  const woDone = woDays.filter((d) => habitOn(H, 'workout', addD(wk, d))).length;
  const trip = tripsOf(P)[0]; const [tb, ta] = trip ? tripBooked(trip) : [0, 0];
  const dt = task(H, 'r-date'); const dtNext = dt && nextOcc(dt, now);
  const homeTasks = (H?.tasks || []).filter((t) => t.cat === 'personal' && !t.kind && t.id !== 'r-lunch-wo');
  const homeNext = homeTasks.map((t) => ({ t, o: nextOcc(t, now) })).filter((x) => x.o).sort((a, b) => a.o.i - b.o.i || a.t.start - b.t.start)[0];
  const plan = task(H, 'r-meals');
  return `<div class="psgrid">
${budget}
${card('meals', 'Meals', next >= 0 ? 'Next up' : 'This week', next >= 0 ? esc(meals[next].n) : 'No meals yet', next >= 0 ? `Meal ${next + 1} · 2 portions` : 'Add 7 meals on Sunday', `${nM} of 7 planned`, (nM / 7) * 100)}
${wo ? card('workouts', 'Workouts', esc(whenText(woNext, wo)), 'Workout', esc(daysText(wo)), `${woDone} of ${woDays.length} this week`, woDays.length ? (woDone / woDays.length) * 100 : 0) : card('workouts', 'Workouts', 'Not on the schedule', 'No workout', '', '', null)}
${trip ? card('trips', 'Trips', `${esc(trip.name)} · ${esc(tripDates(trip))}`, ta ? `${tb} <i>of ${ta} booked</i>` : `${trip.stops.length} <i>stops</i>`, esc(trip.stops.map((s) => s.place).join(' → ') || 'Add stops'), esc(trip.bud ? `${usd0(tripCost(trip))} of ${usd0(trip.bud)}` : 'Budget not set'), ta ? (tb / ta) * 100 : 0) : card('trips', 'Trips', 'No trips', 'Add a trip', '', '', null)}
${dt ? card('date', 'Date night', esc(dtNext ? `${dtNext.i === 0 ? 'Tonight' : dtNext.i === 1 ? 'Tomorrow' : `${DAYS[dow(dtNext.ymd)]} ${fmtD(dtNext.ymd)}`} ${fmtT(dt.start)}–${fmtT(dt.end)}` : ''), esc(dt.title.split('·').pop().trim() || 'Date night'), dtNext && dtNext.i ? '' : 'Covers dinner', `Every ${DAYL[taskDays(dt)[0]] || ''}`, null) : card('date', 'Date night', '', 'Not on the schedule', '', '', null)}
${card('home', 'Home', 'Next', homeNext ? esc(homeNext.t.title) : 'Nothing set', homeNext ? esc(whenText(homeNext.o, homeNext.t)) : '', plan ? esc(`${plan.title} ${DAYS[taskDays(plan)[0]] || ''} ${fmtT(plan.start)}`) : '', null)}
</div>`;
}

function mealsPage(S, now, ui) {
  const P = S.personal; const meals = mealsOf(P); const prices = P?.store?.prices || {};
  const wk = mealWeek(now.ymd); const nM = meals.filter((m) => m.n).length;
  const mon = groc(meals, MON, prices); const thu = groc(meals, THU, prices);
  const left = meals.map((m, i) => (m.n ? '' : `Meal ${i + 1}`)).filter(Boolean);
  const list = (id, g) => {
    let last = '';
    const rows = g.rows.map(([k, x]) => {
      const L = lineFor(k, x.qs, prices); const sec = aisle(k); const h = sec !== last ? `<div class="psgsec">${sec}</div>` : ''; last = sec;
      const pr = priceOf(k, prices);
      return `${h}<div class="psgi"><span class="psgn">${esc(x.name)}${L.q ? `<small>${esc(L.q)}</small>` : ''}</span><label class="pspin">$<input type="number" min="0" step="0.5" data-psprice="${esc(k)}" value="${pr ? (pr % 1 ? pr.toFixed(2) : pr) : ''}" placeholder="–" aria-label="Price of ${esc(x.name)}"></label><button type="button" class="pslnk" data-psgrm="${esc(k)}" data-psgl="${id}">Remove</button></div>`;
    }).join('');
    return `${rows || '<p class="mut psempty">Nothing yet. Open a meal and add its ingredients.</p>'}<div class="psgi pstot"><span>Estimate</span><span>${money(Number(g.total.toFixed(2)))}</span><span></span></div>`;
  };
  return `<div class="pstrk">
<div class="hmw"><small>Food this month · ${monthName(now.ymd)}</small><b>No feed <i>of ${usd0(FOOD_MONTH)}</i></b>${bar(0)}<span>MoneyClaw does not send food spending yet</span></div>
<div class="hmw"><small>Groceries this week</small><b>${usd0(mon.total + thu.total)} <i>of ${usd0(GROC_WEEK)}</i></b>${bar(((mon.total + thu.total) / GROC_WEEK) * 100, mon.total + thu.total > GROC_WEEK ? 'bad' : '')}<span>Mon ${usd0(mon.total)} · Thu ${usd0(thu.total)}</span></div>
<div class="hmw"><small>Meals planned</small><b>${nM} <i>of 7</i></b>${bar((nM / 7) * 100)}<span>${left.length ? esc(`${left.join(', ')} still to add`) : 'All 7 planned'}</span></div>
</div>
<div class="psmeals">
<section class="card pscol pswide"><div class="pshd"><h2>Meals</h2><span class="mut">Week of ${fmtD(wk)} · 2 portions each</span><span class="mut psright">${nM} of 7 added</span></div>
<div class="psmlist">${meals.map((m, i) => `<button type="button" class="psmrow${m.n ? '' : ' empty'}" data-psmeal="${i}"><b>Meal ${i + 1}</b><span>${m.n ? esc(m.n) : 'Add recipe'}${m.n && m.src ? `<small>${esc(m.src)}</small>` : ''}</span><span class="${m.n ? 'psok' : 'mut'}">${m.n ? '✓' : '›'}</span></button>`).join('')}</div></section>
<section class="card pscol"><div class="pshd"><h2>Groceries · Monday</h2><span class="mut">${fmtD(wk)} · 8am · Meals 1–4 · tap a price to change it</span></div><div class="psglist">${list('mon', mon)}</div></section>
<section class="card pscol"><div class="pshd"><h2>Groceries · Thursday</h2><span class="mut">${fmtD(addD(wk, 3))} · 8am · Meals 5–7</span></div><div class="psglist">${list('thu', thu)}</div></section>
</div>
${ui.psMeal ? mealModal(ui.psMeal) : ''}`;
}

function mealModal(d) {
  const full = d.view !== 'split';
  let body;
  if (full) {
    body = `<textarea class="pstext psbig" id="psText" data-psin="r" placeholder="Paste the whole recipe here" aria-label="Full recipe">${esc(d.r)}</textarea>`;
  } else {
    const ing = parseIng(d.ing || []);
    const rows = ing.length ? ing.map((x, k) => {
      const q = qtyText(x.qs);
      const label = `<span class="pst">${esc(x.name)}${q ? ` <span class="mut">${esc(q)}</span>` : ''}${x.pantry ? ' <span class="mut">· pantry</span>' : ''}</span>`;
      return d.on.includes(x.key)
        ? `<div class="psir on">${label}<span class="psonl">✓ On list</span><button type="button" class="pslnk" data-psoff="${esc(x.key)}">Remove</button></div>`
        : `<label class="psir"><input type="checkbox" data-pssel="${esc(x.key)}"${d.sel.includes(x.key) ? ' checked' : ''}>${label}</label>`;
    }).join('') : '<p class="mut">No ingredients found. Use Edit recipe to add an "Ingredients" line.</p>';
    const left = ing.filter((x) => !d.on.includes(x.key) && !x.pantry).length;
    const act = left || d.sel.length
      ? `${left ? '<button type="button" class="btn sm primary" data-psaddall>Add all to groceries</button>' : ''}<button type="button" class="btn sm" data-psaddsel${d.sel.length ? '' : ' disabled'}>Add selected${d.sel.length ? ` (${d.sel.length})` : ''}</button>`
      : (ing.length ? '<span class="psonl">✓ All on the grocery list</span>' : '');
    body = `<div class="pssplit psbig"><div class="pscolb"><b>Ingredients</b><div class="psilist">${rows}</div><div class="psiact">${act}</div></div><div class="pscolb"><b>Method</b><textarea class="pstext" data-psin="meth" aria-label="Method" placeholder="Steps">${esc(d.meth || '')}</textarea></div></div>`;
  }
  return `<div class="hmhost" data-psback><form class="hmed psmodal" data-psform="meal">
<div class="hmedh"><input class="hmedt" data-psin="n" value="${esc(d.n)}" placeholder="Meal ${d.i + 1} name" aria-label="Meal name"><button type="button" class="btn sm" data-psx aria-label="Close">✕</button></div>
<div class="psrtop"><button type="button" class="btn sm${full ? ' primary' : ''}" data-psview>${full ? 'Create grocery list' : 'Edit recipe'}</button><label class="btn sm"><input type="file" accept="image/*" hidden data-psphoto>${d.busy ? 'Reading…' : 'Upload photo'}</label></div>
${d.note ? `<p class="mut">${esc(d.note)}</p>` : ''}${d.imgs?.length ? `<div class="psimgs">${d.imgs.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Recipe photo"></a>`).join('')}</div>` : ''}
${body}
${d.err ? `<p class="psbad">${esc(d.err)}</p>` : ''}
<div class="hmedf"><button type="button" class="btn" data-psx>Cancel</button><button class="btn primary">Save meal</button></div>
</form></div>`;
}

// ---- workouts, date night, home ----
const HOURS = Array.from({ length: 15 }, (_, i) => (i + 6) * 60);
const opt = (v, l, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`;
const sel = (name, opts, cur, aria) => `<select class="pssel" data-psrule="${name}" aria-label="${aria}">${opts.map(([v, l]) => opt(v, l, cur)).join('')}</select>`;

function workoutsPage(S, now, ui) {
  const H = S.home; const wo = task(H, 'r-workout');
  if (!wo) return '<section class="card"><p class="mut">The workout is not on the schedule.</p></section>';
  const wk = addD(now.ymd, -dow(now.ymd)); const R = rulesOf(S.personal);
  const rows = taskDays(wo).map((d) => {
    const day = addD(wk, d); const done = habitOn(H, 'workout', day);
    const st = done ? '<span class="psok">✓ Done</span>' : day < now.ymd ? '<span class="mut">Missed</span>' : day === now.ymd ? '<span class="mut">Today</span>' : '<span></span>';
    return `<div class="psorow"><span class="psot">${DAYS[d]} ${fmtD(day).split(' ')[1]}</span><span>${fmtT(wo.start)}</span>${st}</div>`;
  }).join('');
  const lunch = task(H, 'r-lunch-wo');
  const retry = wo.miss === 'retry' ? wo.retry : 'none';
  return `<div class="ps2">
<section class="card pscol"><div class="pshd"><h2>This week</h2><span class="mut">${esc(daysText(wo))} at ${fmtT(wo.start)}</span></div><div class="psolist">${rows || '<p class="mut">No workout days set.</p>'}</div></section>
<section class="card pscol"><div class="pshd"><h2>Rules</h2><span class="mut">Tap a choice to change it</span></div>
<ul class="psrules">
<li>Workouts are on <span class="psdays">${DAYS.map((l, d) => `<button type="button" class="psday${taskDays(wo).includes(d) ? ' on' : ''}" data-psday="${d}" aria-pressed="${taskDays(wo).includes(d)}">${l}</button>`).join('')}</span> at ${sel('woStart', HOURS.map((m) => [m, fmtT(m)]), wo.start, 'Workout time')}</li>
<li>If missed, retry at ${sel('woRetry', [['none', 'no retry'], ...HOURS.filter((m) => m > wo.start).map((m) => [m, fmtT(m)])], retry, 'Retry time')} the same day</li>
<li>If missed${retry === 'none' ? '' : ' again'}, ${retry === 'none' ? sel('woAgain', [['next', 'move it to the next day'], ['skip', 'skip it']], wo.miss === 'none' ? 'skip' : 'next', 'If missed') : 'move it to the next day'}, marked Late</li>
${lunch ? `<li>On workout days, lunch is at ${sel('woLunch', [[690, '11:30am'], [720, '12pm'], [750, '12:30pm'], [780, '1pm']], lunch.start, 'Lunch on workout days')}</li>` : ''}
<li>The week's count resets every Monday</li>
</ul>${ui.psErr ? `<p class="psbad pspad">${esc(ui.psErr)}</p>` : ''}</section>
</div>`;
}

function datePage(S, now, ui) {
  const H = S.home; const dt = task(H, 'r-date');
  if (!dt) return '<section class="card"><p class="mut">Date night is not on the schedule.</p></section>';
  const dinner = task(H, 'r-dinner'); const d0 = taskDays(dt)[0] ?? 3;
  const covers = dinner ? !taskDays(dinner).includes(d0) : false;
  const next = []; let o = nextOcc(dt, now);
  for (let i = 0; o && i < 3; i++) { next.push(o.ymd); o = { ymd: addD(o.ymd, 7), i: 9 }; }
  return `<div class="ps2">
<section class="card pscol"><div class="pshd"><h2>Date night</h2><span class="mut">${esc(`${DAYL[d0]}s ${fmtT(dt.start)}`)}</span></div><div class="psolist">${next.map((d) => `<div class="psorow"><span class="psot">${DAYS[dow(d)]} ${fmtD(d).split(' ')[1]}</span><span>${fmtT(dt.start)} – ${fmtT(dt.end)}${d === now.ymd ? ' · today' : ''}</span><span></span></div>`).join('')}</div></section>
<section class="card pscol"><div class="pshd"><h2>Rules</h2><span class="mut">Tap a choice to change it</span></div>
<ul class="psrules">
<li>Every ${sel('dtDay', DAYL.map((l, i) => [i, l]), d0, 'Day')} at ${sel('dtStart', HOURS.map((m) => [m, fmtT(m)]), dt.start, 'Time')}</li>
<li>If missed, ${sel('dtMiss', [['makeup', 'pick a make-up day that week'], ['next', 'move it to the next day'], ['none', 'skip that week']], dt.miss, 'If missed')}</li>
<li>The usual day and time stay the same</li>
${dinner ? `<li>Covers dinner that day: ${sel('dtDinner', [['yes', 'Yes'], ['no', 'No']], covers ? 'yes' : 'no', 'Covers dinner')}</li>` : ''}
</ul>${ui.psErr ? `<p class="psbad pspad">${esc(ui.psErr)}</p>` : ''}</section>
</div>`;
}

function homePage(S) {
  const ts = (S.home?.tasks || []).filter((t) => t.cat === 'personal' && !t.kind && t.id !== 'r-lunch-wo').sort((a, b) => a.start - b.start);
  const wo = task(S.home, 'r-lunch-wo');
  const note = (t) => (t.id === 'r-lunch' && wo ? `${fmtT(wo.start)} on workout days` : t.id === 'r-dinner' && taskDays(t).length < 7 ? 'not on date night' : '');
  const daily = ts.filter((t) => t.id === 'r-lunch' || t.id === 'r-dinner' || taskDays(t).length === 7);
  const weekly = ts.filter((t) => !daily.includes(t));
  const row = (t, lbl) => `<div class="psorow"><span class="psot">${lbl}</span><span>${esc(t.title)}</span><span class="mut">${esc(note(t))}</span></div>`;
  return `<div class="ps2">
<section class="card pscol"><div class="pshd"><h2>Every day</h2></div><div class="psolist">${daily.map((t) => row(t, fmtT(t.start))).join('') || '<p class="mut">Nothing set.</p>'}</div></section>
<section class="card pscol"><div class="pshd"><h2>Every week</h2></div><div class="psolist">${weekly.map((t) => row(t, `${taskDays(t).map((d) => DAYS[d]).join(', ')} ${fmtT(t.start)}`)).join('') || '<p class="mut">Nothing set.</p>'}</div></section>
</div><p class="mut">These come from the schedule on Goals. Change a time there.</p>`;
}

// ---- trips ----
function cityPage(t, n, j, ui) {
  const s = t.stops[j];
  const ps = plansOf(t).filter((x) => inStop(s, x.d));
  return `<section class="card pscity"><div class="pscityh">${photoHtml(s.place, s.img, `data-psstphoto="${j}"`)}<div class="pscityb"><div class="psthrow"><h2>${esc(s.place)}</h2><span class="mut">${s.from ? fmtD(s.from) : '?'} – ${s.to ? fmtD(s.to) : '?'}</span><button type="button" class="pslnk" data-psedstop="${j}">Edit</button></div>
${s.notes || s.link ? `<div class="psnote">${s.notes ? `<p>${esc(s.notes)}</p>` : ''}${s.link ? `<a href="${esc(webLink(s.link))}" target="_blank" rel="noopener noreferrer">${esc(s.link.replace(/^https?:\/\//i, '').slice(0, 60))}</a>` : ''}</div>` : ''}
<div class="psbk3">${s.items.map((x, k) => `<div class="psbk${x.ok ? ' on' : ''}"><label><input type="checkbox" data-psbook="${j}.${k}"${x.ok ? ' checked' : ''}> ${esc(x.k)}${x.ok ? ' <i>booked</i>' : ''}</label><span class="pscost">$<input type="number" min="0" step="10" data-pscost="${j}.${k}" value="${esc(x.cost)}" placeholder="cost" aria-label="${esc(x.k)} cost"></span></div>`).join('')}</div></div></div>
<div class="psplans pscityp"><div class="psplh"><b>Plans</b><span class="mut">${ps.length ? `${ps.length} · ${ps.filter((x) => x.ok).length} booked` : 'Day trips, things to do and anything booked'}</span><button type="button" class="btn sm primary" data-psaddplan="${esc(s.from || s.to || '')}">+ Add plan</button></div>${ps.map(planRow).join('')}</div>
<div class="psstend psrowend"><a class="btn" href="#personal/trips/${n}">‹ ${esc(t.name)}</a></div></section>${ui.psErr ? `<p class="psbad">${esc(ui.psErr)}</p>` : ''}`;
}
function tripsPage(S, sub, ui) {
  const T = tripsOf(S.personal); const n = sub[1] != null ? Number(sub[1]) : null; const t = n != null ? T[n] : null;
  const j = sub[2] != null ? Number(sub[2]) : null;
  if (t && j != null && t.stops[j]) return cityPage(t, n, j, ui) + (ui.psPop ? popHtml(ui.psPop, T) : '');
  let html;
  if (!t) {
    html = `<div class="pstrhead"><span></span><button type="button" class="btn primary" data-pstrip="new">+ Add trip</button></div>
<div class="psgrid pstgrid">${T.map((x, i) => { const [b, a] = tripBooked(x); return `<a class="pscard pstcard" href="#personal/trips/${i}">${photoHtml(x.stops[0]?.place || x.name, x.img || x.stops[0]?.img)}<div class="pstcb"><b>${esc(x.name)}</b><em>${esc(tripDates(x))} · ${x.stops.length} stop${x.stops.length === 1 ? '' : 's'}</em><div class="psfoot">${tripBar(x)}<span>${a ? `${b} of ${a} booked` : 'No stops yet'} · ${esc(budLine(x))}</span></div></div></a>`; }).join('') || '<p class="mut">No trips yet.</p>'}</div>`;
  } else {
    const [b, a] = tripBooked(t); const cal = ui.psTView === 'cal'; const L = t.stops.length;
    const views = `<div class="psfilter" role="group" aria-label="View">${[['list', 'List'], ['cal', 'Calendar']].map(([k, l]) => `<button type="button" data-pstview="${k}" aria-pressed="${(k === 'cal') === cal}">${l}</button>`).join('')}</div>`;
    html = `<section class="card pstrip"><div class="psthead"><div class="psthrow"><h2>${esc(t.name)}</h2><span class="mut">${esc(tripDates(t))}</span><label class="pslnk"><input type="file" accept="image/*" hidden data-pstphoto>${t.img ? 'Change photo' : 'Trip photo'}</label><button type="button" class="pslnk" data-pstrip="edit">Edit</button></div>${tripBar(t)}<div class="pstvrow"><span class="mut">${esc(budLine(t))} · ${a ? `${b} of ${a} booked` : 'nothing to book yet'}</span>${L ? views : ''}</div></div>
${cal && L ? tripCal(t) : L ? `<div class="psstops">${t.stops.map((s, j) => `<div class="psstop" data-psstop="${j}"><a class="psphl" href="#personal/trips/${n}/${j}" aria-label="Open ${esc(s.place)}">${photoHtml(s.place, s.img)}</a><div class="psstb"><div class="psst2h"><span class="psgrip" draggable="true" data-psgrip="${j}" title="Drag to move">⠿</span><b>${esc(s.place)}</b>${s.ex ? '<span class="psex">example</span>' : ''}<span class="mut">${s.from ? fmtD(s.from) : '?'} – ${s.to ? fmtD(s.to) : '?'}</span><span class="psstc"><button type="button" class="psmv" data-psmove="${j}.-1" aria-label="Move ${esc(s.place)} up"${j ? '' : ' disabled'}>↑</button><button type="button" class="psmv" data-psmove="${j}.1" aria-label="Move ${esc(s.place)} down"${j < L - 1 ? '' : ' disabled'}>↓</button><button type="button" class="pslnk" data-psedstop="${j}">Edit</button><button type="button" class="pslnk" data-psdelstop="${j}">Remove</button></span></div>
${s.notes || s.link ? `<div class="psnote">${s.notes ? `<p>${esc(s.notes)}</p>` : ''}${s.link ? `<a href="${esc(webLink(s.link))}" target="_blank" rel="noopener noreferrer">${esc(s.link.replace(/^https?:\/\//i, '').slice(0, 60))}</a>` : ''}</div>` : ''}
<div class="psbk3">${s.items.map((x, k) => `<div class="psbk${x.ok ? ' on' : ''}"><label><input type="checkbox" data-psbook="${j}.${k}"${x.ok ? ' checked' : ''}> ${esc(x.k)}${x.ok ? ' <i>booked</i>' : ''}</label><span class="pscost">$<input type="number" min="0" step="10" data-pscost="${j}.${k}" value="${esc(x.cost)}" placeholder="cost" aria-label="${esc(x.k)} cost"></span></div>`).join('')}</div>
${(() => { const ps = plansOf(t).filter((x) => inStop(s, x.d)); const ok = ps.filter((x) => x.ok).length; return `<a class="pscityl" href="#personal/trips/${n}/${j}"><span>${ps.length ? `${ps.length} plan${ps.length === 1 ? '' : 's'}${ok ? ` · ${ok} booked` : ''}` : 'No plans yet'}</span><b>Open ${esc(s.place)} ›</b></a>`; })()}</div></div>`).join('')}</div>`
  : '<p class="mut psstend">No stops yet. Add the first place you\'re going.</p>'}
<div class="psstend psrowend"><button type="button" class="btn" data-psaddstop="${n}">+ Add stop</button><a class="btn primary" href="#personal/trips">Done</a></div></section>`;
  }
  return html + (ui.psPop ? popHtml(ui.psPop, T) : '');
}
function planPop(p, t) {
  const x = p.draft;
  return `<div class="hmhost" data-psback><form class="hmed pspop" data-psform="plan"><div class="hmedh"><b class="hmedt">${p.at ? 'Edit plan' : `Add a plan to ${esc(t?.name || 'the trip')}`}</b><button type="button" class="btn sm" data-psx aria-label="Close">✕</button></div>
<div class="pstfb"><div class="psplimg">${x.img ? `<img alt="" src="${esc(x.img)}">` : '<span>No photo</span>'}<label class="btn sm"><input type="file" accept="image/*" hidden data-psplanimg>${p.busy ? 'Uploading…' : x.img ? 'Change photo' : 'Add photo'}</label>${x.img ? '<button type="button" class="pslnk" data-psplanimgx>Remove photo</button>' : ''}</div>
<label>What<input name="n" value="${esc(x.n || '')}" placeholder="Sintra day trip, Belém pastéis, fado night"></label>
<div class="pstf2"><label>Day<input type="date" name="d" value="${esc(x.d || '')}"></label><label>Cost $<input type="number" min="0" step="5" name="cost" value="${esc(x.cost ?? '')}" placeholder="0"></label></div>
<label>Link<input name="link" inputmode="url" value="${esc(x.link || '')}" placeholder="getyourguide.com/..."></label>
<label>Notes<textarea name="notes" rows="2" placeholder="Times, tickets, who's coming">${esc(x.notes || '')}</textarea></label>
<label class="psedok"><input type="checkbox" name="ok"${x.ok ? ' checked' : ''}> Booked</label></div>
<div class="hmedf"><span class="psbad">${esc(p.err || '')}</span>${p.at ? '<button type="button" class="btn" data-psplanrm>Remove</button>' : ''}<button type="button" class="btn" data-psx style="margin-left:auto">Cancel</button><button class="btn primary">${p.at ? 'Save' : 'Add plan'}</button></div></form></div>`;
}
function popHtml(p, T) {
  const t = T[p.i];
  if (p.kind === 'plan') return planPop(p, t);
  const s = p.kind === 'stop' ? p.draft || (p.j != null ? t?.stops?.[p.j] : null) || { place: '', from: '', to: '', notes: '', link: '', items: items3() } : null;
  const ed = p.kind === 'stop' && p.j != null;
  const body = s
    ? `<label>Where<input name="place" value="${esc(s.place)}" placeholder="Lisbon"></label><div class="pstf2"><label>Arrive<input type="date" name="from" value="${esc(s.from)}"></label><label>Leave<input type="date" name="to" value="${esc(s.to)}"></label></div>
<label>Notes<textarea name="notes" rows="3" placeholder="Address, check-in time, who's coming">${esc(s.notes || '')}</textarea></label><label>Link<input name="link" inputmode="url" value="${esc(s.link || '')}" placeholder="booking.com/..."></label>
<div class="psedbk">${(s.items || []).map((x, k) => `<div class="psedr"><input name="k${k}" value="${esc(x.k)}" aria-label="Booking ${k + 1}"><span class="pscost">$<input type="number" min="0" step="10" name="c${k}" value="${esc(x.cost)}" placeholder="cost" aria-label="${esc(x.k)} cost"></span><label class="psedok"><input type="checkbox" name="o${k}"${x.ok ? ' checked' : ''}> Booked</label></div>`).join('')}</div>`
    : `<label>Where<input name="name" value="${p.kind === 'edit' && t ? esc(t.name) : ''}" placeholder="Portugal"></label><label>Budget $<input type="number" min="0" step="100" name="bud" value="${p.kind === 'edit' && t?.bud ? t.bud : ''}" placeholder="5000"></label>`;
  const title = ed ? `Edit ${s.place || 'stop'}` : p.kind === 'stop' ? `Add a stop to ${t?.name || 'the trip'}` : p.kind === 'edit' ? 'Edit trip' : 'New trip';
  return `<div class="hmhost" data-psback><form class="hmed pspop" data-psform="pop"><div class="hmedh"><b class="hmedt">${esc(title)}</b><button type="button" class="btn sm" data-psx aria-label="Close">✕</button></div>
<div class="pstfb">${body}</div><div class="hmedf"><span class="psbad">${esc(p.err || '')}</span><button type="button" class="btn" data-psx style="margin-left:auto">Cancel</button><button class="btn primary">${ed ? 'Save' : p.kind === 'stop' ? 'Add stop' : p.kind === 'edit' ? 'Save' : 'Add trip'}</button></div></form></div>`;
}

// ---- expenses with tags (Personal › Budget and the Money page) ----
export const TAGN = { ok: 'Approved', fixed: 'Fixed', once: 'One-off', sus: 'Odd charge', new: 'New', subs: 'Add to subs', cancel: 'Cancel', refund: 'Refund' };
const FILTERS = [['all', 'All'], ['sus', 'Odd charges'], ['new', 'New'], ['subs', 'Add to subs'], ['cancel', 'Cancel'], ['refund', 'Refund']];
const ACTION = ['sus', 'new', 'subs', 'cancel', 'refund'];
const tagOf = (P, id) => P?.tags?.[id] || 'ok';
export function flagLine(P, charges) {
  const c = {};
  charges.forEach((x) => { const t = tagOf(P, x.id); if (ACTION.includes(t)) c[t] = (c[t] || 0) + 1; });
  return ACTION.filter((k) => c[k]).map((k) => `${c[k]} ${TAGN[k].toLowerCase()}`).join(' · ') || 'Nothing to act on';
}
function budgetCard(kind, total, P, charges, today) {
  const [lo, hi, label] = BUDGET[kind];
  const pace = monthPace(today);
  return `<div class="hmw psbud"><small>${kind === 'personal' ? 'Personal' : 'Business'} budget · ${monthName(today)}</small>${total == null ? `<b>No feed <i>of ${label}</i></b>${bar(0)}<span>MoneyClaw has not sent this month</span>`
    : `<b>${usd0(total)} <i>of ${label}</i></b>${bar((total / hi) * 100, total > hi ? 'bad' : total > lo ? 'warn' : '')}<span>${monthName(today).slice(0, 3)} 1–${pace.d} · heading for ~${usd0((total / pace.d) * pace.len)}</span>`}<span class="psflag">${esc(flagLine(P, charges))}</span></div>`;
}
export function expensesCard(kind, P, ui, today) {
  const M = P?.money?.[kind] || {};
  const charges = M.charges || [];
  const F = ui.exF?.[kind] || 'all';
  const cnt = {}; charges.forEach((x) => { const t = tagOf(P, x.id); cnt[t] = (cnt[t] || 0) + 1; });
  const filt = `<div class="psfilter" role="group" aria-label="Filter">${FILTERS.map(([k, l]) => `<button type="button" data-psfilter="${kind}.${k}" aria-pressed="${k === F}">${l}${k === 'all' ? '' : ` <i>${cnt[k] || 0}</i>`}</button>`).join('')}</div>`;
  const cats = new Map();
  (M.categories || []).forEach((c) => cats.set(c.name, { name: c.name, count: c.count, total: c.total, items: [] }));
  charges.forEach((x) => { if (!cats.has(x.cat)) cats.set(x.cat, { name: x.cat, count: null, total: null, items: [] }); cats.get(x.cat).items.push(x); });
  const groups = [...cats.values()].map((g) => ({ ...g, total: g.total ?? g.items.reduce((a, x) => a + x.amount, 0) })).sort((a, b) => b.total - a.total);
  const html = groups.map((g) => {
    const items = g.items.filter((x) => F === 'all' || tagOf(P, x.id) === F);
    if (F !== 'all' && !items.length) return '';
    const key = `${kind}.${g.name}`; const open = F !== 'all' || !ui.exShut?.[key];
    const count = g.count != null ? `${g.count} this month` : `${g.items.length} listed`;
    return `<div class="psexg"><button type="button" class="psexh" data-psexh="${esc(key)}" aria-expanded="${open}"><span>${open ? '▾' : '▸'} ${esc(g.name)}<small>${count}</small></span><span>${money(Number(g.total.toFixed(2)))}</span></button>${open ? (items.length ? items.map((x) => `<div class="psexr"><span class="mut">${esc(fmtD(x.date))}</span><span>${esc(x.what)}${x.pending ? ' <small class="mut">pending</small>' : ''}</span><span class="psamt">${money(x.amount)}</span><select class="pstag st-${tagOf(P, x.id)}" data-pstag="${esc(x.id)}" aria-label="Tag">${Object.entries(TAGN).map(([k, l]) => opt(k, l, tagOf(P, x.id))).join('')}</select></div>`).join('') : '<p class="mut psexnone">No recent charges listed in this category.</p>') : ''}</div>`;
  }).join('');
  const none = kind === 'personal' && !charges.length
    ? '<p class="mut psexnone">MoneyClaw sends this month\'s personal total only, not the charges behind it, so there is nothing to tag yet.</p>'
    : '<p class="mut psexnone">Nothing with this tag.</p>';
  return `${budgetCard(kind, M.month ?? null, P, charges, today)}
<section class="card pscol"><div class="pshd"><h2>${kind === 'personal' ? 'Personal' : 'Business'} expenses</h2><span class="mut">${kind === 'business' ? `the ${charges.length} latest charges, by category` : 'this month'}</span>${filt}</div><div class="psexlist">${html || none}</div></section>`;
}
export function moneyBizHtml(P, ui, today) {
  if (!P) return '';
  return `<div class="psexwrap">${expensesCard('business', P, ui, today)}</div>`;
}

export function renderPersonal(S, sub, ui, ms = Date.now()) {
  const now = nowParts(ms);
  if (S.home?.today) now.ymd = S.home.today;
  const k = NAMES[sub[0]] ? sub[0] : '';
  const T = tripsOf(S.personal);
  const extra = k === 'trips' && sub[1] != null && T[Number(sub[1])] ? T[Number(sub[1])].name : '';
  const city = extra && sub[2] != null ? T[Number(sub[1])].stops[Number(sub[2])] : null;
  const head = `${mnavHtml('personal')}<header class="hd pshead">${city ? `<h1 class="pscrumb"><a href="#personal/trips/${Number(sub[1])}" aria-label="Back">‹</a> <a href="#personal">Personal</a> <span>›</span> <a href="#personal/trips">Trips</a> <span>›</span> <a href="#personal/trips/${Number(sub[1])}">${esc(extra)}</a> <span>›</span> ${esc(city.place)}</h1>` : crumbs(k ? [k] : [], extra)}</header>`;
  if (!S.personal) return `${head}<section class="card"><p class="mut">${S.personalErr ? esc(S.personalErr) : 'Loading'}</p></section>`;
  const body = k === 'meals' ? mealsPage(S, now, ui) : k === 'workouts' ? workoutsPage(S, now, ui) : k === 'date' ? datePage(S, now, ui)
    : k === 'trips' ? tripsPage(S, sub, ui) : k === 'home' ? homePage(S) : k === 'budget' ? `<div class="psexwrap">${expensesCard('personal', S.personal, ui, now.ymd)}</div>` : overview(S, now);
  return `${head}${body}`;
}

// ---- events ----
// Saves one stored key (optimistic: the page shows the change at once; a failed save says so and reloads).
// Saves go out one at a time, so two fast changes (say two taps on a stop's arrow) reach the server in order.
let saving = Promise.resolve();
function save(S, key, value, send, render, reload) {
  S.personal.store = { ...S.personal.store, [key]: value };
  render();
  const run = saving.then(() => send('PUT', `/personal/${key}`, value)).then(async (r) => { if (!r.ok) { S.ui.psErr = `Could not save (${r.error}).`; await reload(); } });
  saving = run.catch(() => {});
  return run;
}
const draftOf = (m, i) => ({ i, n: m.n, r: m.r, on: [...(m.on || [])], src: m.src, imgs: [...(m.imgs || [])], view: m.r.trim() ? 'split' : 'full', sel: [], meth: '', ing: [], note: '', err: '' });
// Splits the draft's recipe into its parts for the formatted view (and names the meal from its first line).
function toSplit(d) {
  const p = splitR(d.r);
  if (!p.head && p.ing.length && !/\d/.test(p.ing[0]) && p.ing[0].length < 60) p.head = p.ing.shift();
  if (!d.n.trim() && p.head) d.n = p.head.split('\n')[0].replace(/\s*\(.*\)\s*$/, '').slice(0, 80);
  Object.assign(d, { view: 'split', head: p.head, ing: p.ing, meth: p.meth, sel: [] });
}
const compose = (d) => (d.ing.length || d.meth.trim() || d.head ? `${d.head ? `${d.head}\n\n` : ''}Ingredients\n${d.ing.join('\n')}\n\nMethod\n${d.meth.trim()}` : '');
async function saveMeal(S, send, render, reload, close) {
  const d = S.ui.psMeal;
  const meals = mealsOf(S.personal);
  const keep = new Set(parseIng(splitR(d.r).ing).map((x) => x.key));
  meals[d.i] = { n: d.n.trim(), r: d.r.trim(), on: d.on.filter((k) => keep.has(k)), src: d.src || (d.r.trim() ? (d.imgs.length ? 'photo' : 'typed') : ''), imgs: d.imgs };
  if (close) S.ui.psMeal = null;
  await save(S, 'meals', { list: meals }, send, render, reload);
}

export function personalPopOpen(ui) { return !!(ui.psMeal || ui.psPop || ui.psDrag); }

export function personalKey(e, ui, render) {
  if (e.key === 'Escape' && (ui.psMeal || ui.psPop)) { ui.psMeal = null; ui.psPop = null; render(); return true; }
  return false;
}

export function personalInput(e, ui) {
  const f = e.target.dataset?.psin;
  if (!f || !ui.psMeal) return false;
  const d = ui.psMeal;
  if (f === 'meth') { d.meth = e.target.value; d.r = compose(d); } else d[f] = e.target.value;
  return true;
}

export function personalPaste(e, ui, render) {
  if (e.target.id !== 'psText' || !ui.psMeal) return;
  setTimeout(() => { const d = ui.psMeal; if (!d) return; d.r = e.target.value; if (d.r.trim()) { toSplit(d); render(); } }, 0);
}

export function personalClick(e, S, render, send, reload, sendHome) {
  const ui = S.ui; const t = e.target;
  if (t.closest('[data-psx]') || (t.matches?.('[data-psback]'))) { ui.psMeal = null; ui.psPop = null; render(); return true; }
  const m = t.closest('[data-psmeal]');
  if (m) { const i = Number(m.dataset.psmeal); const d = draftOf(mealsOf(S.personal)[i], i); if (d.view === 'split') toSplit(d); ui.psMeal = d; render(); return true; }
  const d = ui.psMeal;
  if (d && t.closest('[data-psview]')) { if (d.view === 'split') d.view = 'full'; else if (d.r.trim()) toSplit(d); render(); return true; }
  if (d && t.closest('[data-psoff]')) { const k = t.closest('[data-psoff]').dataset.psoff; d.on = d.on.filter((x) => x !== k); saveMeal(S, send, render, reload, false); return true; }
  if (d && t.closest('[data-psaddall]')) { parseIng(d.ing).forEach((x) => { if (!x.pantry && !d.on.includes(x.key)) d.on.push(x.key); }); d.sel = []; saveMeal(S, send, render, reload, false); return true; }
  if (d && t.closest('[data-psaddsel]')) { d.sel.forEach((k) => { if (!d.on.includes(k)) d.on.push(k); }); d.sel = []; saveMeal(S, send, render, reload, false); return true; }
  const grm = t.closest('[data-psgrm]');
  if (grm) {
    const meals = mealsOf(S.personal); (grm.dataset.psgl === 'mon' ? MON : THU).forEach((i) => { meals[i].on = meals[i].on.filter((k) => k !== grm.dataset.psgrm); });
    save(S, 'meals', { list: meals }, send, render, reload); return true;
  }
  const fl = t.closest('[data-psfilter]');
  if (fl) { const [kind, f] = fl.dataset.psfilter.split('.'); ui.exF = { ...(ui.exF || {}), [kind]: f }; render(); return true; }
  const exh = t.closest('[data-psexh]');
  if (exh) { const k = exh.dataset.psexh; ui.exShut = { ...(ui.exShut || {}), [k]: !ui.exShut?.[k] }; render(); return true; }
  const day = t.closest('[data-psday]');
  if (day) { workoutDays(S, Number(day.dataset.psday), sendHome); return true; }
  const tr = t.closest('[data-pstrip]');
  if (tr) { ui.psPop = { kind: tr.dataset.pstrip, i: Number((location.hash.split('/')[2]) ?? 0) }; render(); main(t)?.querySelector('.pspop input')?.focus(); return true; }
  const as = t.closest('[data-psaddstop]');
  if (as) { ui.psPop = { kind: 'stop', i: Number(as.dataset.psaddstop) }; render(); main(t)?.querySelector('.pspop input')?.focus(); return true; }
  const ap = t.closest('[data-psaddplan]');
  if (ap) { ui.psPop = { kind: 'plan', i: tripN(), draft: { n: '', d: ap.dataset.psaddplan || '', img: '', link: '', cost: '', ok: false, notes: '' } }; render(); main(t)?.querySelector('.pspop input[name="n"]')?.focus(); return true; }
  const pe = t.closest('[data-psplanedit]');
  if (pe) {
    const [d, k] = pe.dataset.psplanedit.split('.'); const x = tripsOf(S.personal)[tripN()]?.plans?.[d]?.[Number(k)];
    if (x) { ui.psPop = { kind: 'plan', i: tripN(), at: { d, k: Number(k) }, draft: { ...x, d } }; render(); }
    return true;
  }
  if (t.closest('[data-psplanrm]') && ui.psPop?.kind === 'plan' && ui.psPop.at) {
    const T = structuredClone(tripsOf(S.personal)); const { d, k } = ui.psPop.at;
    if (dropPlan(T, ui.psPop.i, d, k)) { ui.psPop = null; save(S, 'trips', T, send, render, reload); } else { ui.psPop.err = 'That plan is already gone.'; render(); }
    return true;
  }
  if (t.closest('[data-psplanimgx]') && ui.psPop?.kind === 'plan') { keepPlanForm(t, ui.psPop); ui.psPop.draft.img = ''; render(); return true; }
  const ds = t.closest('[data-psdelstop]');
  if (ds) { const T = structuredClone(tripsOf(S.personal)); const n = Number(location.hash.split('/')[2]); T[n].stops.splice(Number(ds.dataset.psdelstop), 1); save(S, 'trips', T, send, render, reload); return true; }
  const es = t.closest('[data-psedstop]');
  if (es) { const j = Number(es.dataset.psedstop); ui.psPop = { kind: 'stop', i: tripN(), j, was: tripsOf(S.personal)[tripN()]?.stops?.[j]?.place }; render(); main(t)?.querySelector('.pspop input')?.focus(); return true; }
  const mv = t.closest('[data-psmove]');
  if (mv) { const [j, d] = mv.dataset.psmove.split('.').map(Number); reorder(S, j, j + d, send, render, reload); return true; }
  const tv = t.closest('[data-pstview]');
  if (tv) { ui.psTView = tv.dataset.pstview; render(); return true; }
  return false;
}
const main = (el) => el.closest?.('#main') || document.getElementById('main');
// Keep what Jon has typed in the plan form before the pop-up is drawn again (after a photo upload, say).
function keepPlanForm(el, p) {
  const form = el.closest?.('form'); if (!form) return;
  const v = Object.fromEntries(new FormData(form).entries());
  p.draft = { ...p.draft, n: v.n ?? p.draft.n, d: v.d ?? p.draft.d, cost: v.cost ?? p.draft.cost, link: v.link ?? p.draft.link, notes: v.notes ?? p.draft.notes, ok: v.ok != null };
}
const tripN = () => Number(location.hash.split('/')[2]);
function reorder(S, from, to, send, render, reload) {
  const T = structuredClone(tripsOf(S.personal));
  if (moveStop(T, tripN(), from, to)) save(S, 'trips', T, send, render, reload);
}
// Drag a stop by its handle onto another stop to put it there (the arrows do the same on a phone).
export function personalDrag(root, S, on, send, render, reload) {
  let from = null;
  const clear = () => root.querySelectorAll('.psstop.drag, .psstop.over, .psstop.under').forEach((x) => x.classList.remove('drag', 'over', 'under'));
  root.addEventListener('dragstart', (e) => {
    const g = on() && e.target.closest?.('[data-psgrip]'); if (!g) return;
    from = Number(g.dataset.psgrip); S.ui.psDrag = true;
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from));
    const card = g.closest('.psstop'); if (card) { card.classList.add('drag'); e.dataTransfer.setDragImage?.(card, 16, 16); }
  });
  root.addEventListener('dragover', (e) => {
    const c = from != null && e.target.closest?.('[data-psstop]'); if (!c) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const cls = Number(c.dataset.psstop) > from ? 'under' : 'over'; // the line shows where the stop will land
    root.querySelectorAll('.psstop.over, .psstop.under').forEach((x) => { if (x !== c) x.classList.remove('over', 'under'); }); c.classList.remove('over', 'under'); if (Number(c.dataset.psstop) !== from) c.classList.add(cls);
  });
  root.addEventListener('drop', (e) => {
    const c = from != null && e.target.closest?.('[data-psstop]'); if (!c) return;
    e.preventDefault(); const f = from; from = null; S.ui.psDrag = false; clear();
    reorder(S, f, Number(c.dataset.psstop), send, render, reload);
  });
  root.addEventListener('dragend', () => { from = null; S.ui.psDrag = false; clear(); });
}

// The workout and date-night rules change the schedule's own tasks (PATCH /home/tasks/<id>).
async function patch(S, id, body, sendHome) {
  const r = await sendHome('PATCH', `/home/tasks/${id}`, body);
  if (!r.ok) S.ui.psErr = `Could not change the schedule (${r.error}).`;
  return r.ok;
}
async function workoutDays(S, d, sendHome) {
  const wo = task(S.home, 'r-workout'); if (!wo) return;
  const days = taskDays(wo).includes(d) ? taskDays(wo).filter((x) => x !== d) : [...taskDays(wo), d].sort();
  if (!days.length) { S.ui.psErr = 'Keep at least one workout day.'; S.rerender(); return; }
  S.ui.psErr = '';
  const ok = await patch(S, 'r-workout', { days }, sendHome);
  if (ok && task(S.home, 'r-lunch-wo')) await patch(S, 'r-lunch-wo', { days }, sendHome);
  if (ok && task(S.home, 'r-lunch')) await patch(S, 'r-lunch', { days: [0, 1, 2, 3, 4, 5, 6].filter((x) => !days.includes(x)) }, sendHome);
  await S.reloadAll();
}

export async function personalChange(e, S, render, send, reload, sendHome) {
  const t = e.target; const ui = S.ui;
  if (t.matches('[data-pssel]') && ui.psMeal) { const k = t.dataset.pssel; ui.psMeal.sel = t.checked ? [...ui.psMeal.sel, k] : ui.psMeal.sel.filter((x) => x !== k); render(); return; }
  if (t.matches('[data-psphoto]') && ui.psMeal) {
    const file = t.files?.[0]; if (!file) return;
    const d = ui.psMeal; d.busy = true; d.note = ''; render();
    try {
      const res = await fetch('/dashboard/api/personal/photo', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'image/jpeg', 'X-CC': '1' }, body: file });
      const b = await res.json().catch(() => null);
      if (!res.ok || !b?.ok) d.note = `Could not upload the photo (${b?.error || res.status}).`;
      else {
        if (b.url) d.imgs.push(b.url);
        d.note = b.note || '';
        if (b.text && !d.r.trim()) { d.r = b.text; d.src = 'photo'; toSplit(d); }
      }
    } catch (err) { d.note = `Could not upload the photo (${err.message}).`; }
    d.busy = false; if (ui.psMeal === d) render();
    return;
  }
  if (t.matches('[data-psplanimg]') && ui.psPop?.kind === 'plan') {
    const file = t.files?.[0]; if (!file) return;
    const p = ui.psPop; keepPlanForm(t, p); p.busy = true; p.err = ''; render();
    try {
      const res = await fetch('/dashboard/api/personal/photo?read=0', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'image/jpeg', 'X-CC': '1' }, body: file });
      const b = await res.json().catch(() => null);
      if (!res.ok || !b?.ok || !b.url) p.err = `Could not upload the photo (${b?.error || res.status}).`; else p.draft.img = b.url;
    } catch (err) { p.err = `Could not upload the photo (${err.message}).`; }
    p.busy = false; if (ui.psPop === p) render();
    return;
  }
  if (t.matches('[data-psplanok]')) {
    const [d, k] = t.dataset.psplanok.split('.'); const T = structuredClone(tripsOf(S.personal)); const x = T[tripN()]?.plans?.[d]?.[Number(k)];
    if (x) { x.ok = t.checked; save(S, 'trips', T, send, render, reload); }
    return;
  }
  if (t.matches('[data-psstphoto], [data-pstphoto]')) {
    const file = t.files?.[0]; if (!file) return;
    const n = tripN(); const j = t.matches('[data-psstphoto]') ? Number(t.dataset.psstphoto) : null;
    try {
      const res = await fetch('/dashboard/api/personal/photo?read=0', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'image/jpeg', 'X-CC': '1' }, body: file });
      const b = await res.json().catch(() => null);
      if (!res.ok || !b?.ok || !b.url) { ui.psErr = `Could not upload the photo (${b?.error || res.status}).`; render(); return; }
      const T = structuredClone(tripsOf(S.personal));
      if (j == null) T[n].img = b.url; else T[n].stops[j].img = b.url;
      save(S, 'trips', T, send, render, reload);
    } catch (err) { ui.psErr = `Could not upload the photo (${err.message}).`; render(); }
    return;
  }
  if (t.matches('[data-psprice]')) {
    const prices = { ...(S.personal.store.prices || {}) }; const k = t.dataset.psprice;
    if (t.value === '') delete prices[k]; else prices[k] = Math.max(0, Number(t.value) || 0);
    save(S, 'prices', prices, send, render, reload); return;
  }
  if (t.matches('[data-pstag]')) {
    const id = t.dataset.pstag; S.personal.tags = { ...S.personal.tags, [id]: t.value }; render();
    const r = await send('POST', '/personal/tags', { id, tag: t.value });
    if (!r.ok) { ui.psErr = `Could not save the tag (${r.error}).`; await reload(); }
    return;
  }
  const bk = t.dataset.psbook ?? t.dataset.pscost;
  if (bk != null) {
    const T = structuredClone(tripsOf(S.personal)); const n = Number(location.hash.split('/')[2]); const [j, k] = bk.split('.').map(Number);
    const it = T[n]?.stops[j]?.items[k]; if (!it) return;
    if (t.dataset.psbook != null) it.ok = t.checked; else it.cost = t.value === '' ? '' : Math.max(0, Number(t.value) || 0);
    T[n].stops[j].ex = 0;
    save(S, 'trips', T, send, render, reload); return;
  }
  const rule = t.dataset.psrule;
  if (rule) {
    ui.psErr = '';
    const v = t.value; const wo = task(S.home, 'r-workout'); const dt = task(S.home, 'r-date');
    if (rule === 'woStart' && wo) { const s = Number(v); const keepRetry = wo.miss === 'retry' && wo.retry > s; await patch(S, 'r-workout', { start: s, end: s + 60, ...(keepRetry ? {} : { miss: wo.miss === 'retry' ? 'next' : wo.miss, retry: null }) }, sendHome); }
    if (rule === 'woRetry' && wo) await patch(S, 'r-workout', v === 'none' ? { miss: 'next', retry: null } : { miss: 'retry', retry: Number(v) }, sendHome);
    if (rule === 'woAgain' && wo) await patch(S, 'r-workout', { miss: v === 'skip' ? 'none' : 'next', retry: null }, sendHome);
    if (rule === 'woLunch') { const s = Number(v); await patch(S, 'r-lunch-wo', { start: s, end: s + 45 }, sendHome); }
    if (rule === 'dtDay' && dt) {
      const d = Number(v); await patch(S, 'r-date', { days: [d] }, sendHome);
      const dinner = task(S.home, 'r-dinner');
      if (dinner && taskDays(dinner).length < 7) await patch(S, 'r-dinner', { days: [0, 1, 2, 3, 4, 5, 6].filter((x) => x !== d) }, sendHome);
    }
    if (rule === 'dtStart' && dt) { const s = Number(v); await patch(S, 'r-date', { start: s, end: Math.min(1440, s + (dt.end - dt.start)) }, sendHome); }
    if (rule === 'dtMiss' && dt) await patch(S, 'r-date', { miss: v, retry: null }, sendHome);
    if (rule === 'dtDinner' && dt) { const d0 = taskDays(dt)[0]; await patch(S, 'r-dinner', { days: [0, 1, 2, 3, 4, 5, 6].filter((x) => v === 'no' || x !== d0) }, sendHome); }
    await S.reloadAll();
  }
}

export async function personalSubmit(e, S, render, send, reload) {
  const form = e.target.closest?.('[data-psform]'); if (!form) return false;
  e.preventDefault();
  const ui = S.ui;
  if (form.dataset.psform === 'meal' && ui.psMeal) {
    if (!ui.psMeal.n.trim() && ui.psMeal.r.trim()) { ui.psMeal.err = 'Give the meal a name'; render(); return true; }
    await saveMeal(S, send, render, reload, true);
    return true;
  }
  if (form.dataset.psform === 'plan' && ui.psPop?.kind === 'plan') {
    const p = ui.psPop; keepPlanForm(form, p);
    const T = structuredClone(tripsOf(S.personal));
    const err = savePlan(T, p.i, { ...p.draft, ok: p.draft.ok ? 'on' : null }, p.at || null);
    if (err) { p.err = err; render(); return true; }
    ui.psPop = null;
    await save(S, 'trips', T, send, render, reload);
    return true;
  }
  if (form.dataset.psform === 'pop' && ui.psPop) {
    const v = Object.fromEntries(new FormData(form).entries());
    const T = structuredClone(tripsOf(S.personal)); const p = ui.psPop;
    if (p.kind === 'stop') {
      const t = T[p.i]; if (!t) return true;
      const add = p.j == null;
      if (add) t.stops.push({ place: '', from: '', to: '', items: items3() });
      const j = add ? t.stops.length - 1 : p.j;
      if (!add && t.stops[j]?.place !== p.was) { p.err = 'This stop changed on another screen. Close and open it again.'; render(); return true; }
      const base = t.stops[j];
      const err = editStop(T, p.i, j, v);
      if (err) { p.err = err; if (base) p.draft = formStop(base, v); render(); return true; }
      // A new stop goes before the first stop that starts later; the stops already there keep Jon's order.
      if (add && t.stops[j].from) { const at = t.stops.findIndex((x, k) => k < j && x.from && x.from > t.stops[j].from); if (at >= 0) moveStop(T, p.i, j, at); }
      ui.psPop = null;
      if (!location.hash.startsWith(`#personal/trips/${p.i}`)) location.hash = `#personal/trips/${p.i}`;
    } else {
      const name = String(v.name || '').trim();
      if (!name) { p.err = 'Add where the trip is'; render(); return true; }
      if (p.kind === 'edit' && T[p.i]) Object.assign(T[p.i], { name: name.slice(0, 80), bud: Math.max(0, Number(v.bud) || 0) });
      else { T.push({ name: name.slice(0, 80), bud: Math.max(0, Number(v.bud) || 0), stops: [] }); location.hash = `#personal/trips/${T.length - 1}`; }
      ui.psPop = null;
    }
    await save(S, 'trips', T, send, render, reload);
    return true;
  }
  return false;
}
