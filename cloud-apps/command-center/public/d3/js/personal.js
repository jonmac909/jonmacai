// The Personal page (Jacqueline's handover, section 11) and the expense lists with tags (Personal › Budget and the
// Money page's business part). Routes: #personal, #personal/meals, /workouts, /date, /trips, /trips/<n>, /home, /budget.
// Data: S.personal from GET /dashboard/api/personal (src/personal.js) and S.home (the schedule, src/home.js).
// Writes: PUT /personal/<meals|prices|trips|rules>, POST /personal/tags, POST /personal/photo, and the schedule's own
// PATCH /home/tasks/<id> for the workout and date-night rules.
import { esc } from './util.js';

const TZ = 'America/Vancouver';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// Overview cards: an emoji each so they don't blend together (Jon, 2026-11-15).
const OV_ICON = { budget: '💰', meals: '🍽️', workouts: '🏋️', trips: '✈️', date: '🍷', home: '🏠' };
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
  // A "Prep" section (chopping, seasoning: done ahead by whoever preps) sits between the ingredients and the method.
  const pH = L.findIndex((l, i) => i > iH && i < mH && /^\s*prep(aration)?\s*:?\s*$/i.test(l));
  const meth = mS < 0 ? '' : L.slice(mS).join('\n').trim();
  const split = pH >= 0 ? { prep: L.slice(pH + 1, mH).join('\n').trim(), meth } : prepSplit(meth);
  return { head: iH > 0 ? L.slice(0, iH).join('\n').trim() : '', ing: L.slice(iH >= 0 ? iH + 1 : 0, pH >= 0 ? pH : mH).map((x) => x.trim()).filter(Boolean), ...split };
}
// With no Prep section yet, the steps that are only getting things ready (chop, season, mix, no heat) become the prep.
const PREP_STEP = /^\W*(\d+[.)]\s*)?((finely|roughly|thinly|coarsely)\s+)?(pat|season|chop|dice|mince|slice|peel|trim|wash|rinse|zest|juice|grate|measure|mix|whisk|combine|marinate|crush|cut|prep|prepare|soak|drain|pick|halve|score|toss|pound|butterfly|debone|devein|shell|core|seed)\b/i;
const HEAT = /\b(heat|preheat|pan|skillet|wok|oven|sear|fry|saut|bake|roast|simmer|boil|grill|broil|cook|melt|toast|stove|burner|air fryer)/i;
export function prepSplit(meth) {
  const steps = String(meth || '').split(/\n\s*\n|\n(?=\W*\d+[.)]\s)/).map((x) => x.trim()).filter(Boolean);
  const isPrep = (x) => PREP_STEP.test(x) && !HEAT.test(x);
  return { prep: steps.filter(isPrep).join('\n\n'), meth: steps.filter((x) => !isPrep(x)).join('\n\n') };
}
const PANTRY = /^(salt|pepper|black pepper|olive oil|oil|garam masala|turmeric|cumin|fajita spice|spice|water)$/i;
const PREP = /\(.*?\)|\b(cut up|halved|sliced|diced|chopped|minced|to serve|for serving|thinly|finely|roughly|coarsely|freshly ground|freshly|skin[- ]on|skinless|boneless|drained|rinsed|crushed|peeled|softened|melted|divided|optional|to taste|(?:at )?room temperature|cubed|grated|zested|juiced|trimmed|patted dry|beaten|plus more|cold|warm)\b/gi;
const BULLET = /^\s*(?:[*\u2022\u2013-]|\d+[.)])\s+/;
const sing = (w) => w.replace(/oes$/, 'o').replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
// A recipe made of parts ("Branzino", "Rice", "Lemon-caper beurre blanc"): its ingredient lines grouped under each part.
export function ingParts(lines) {
  const bulleted = lines.filter((l) => BULLET.test(l)).length >= 2;
  if (!bulleted) return [{ t: '', lines }];
  const parts = [];
  lines.forEach((l) => { if (!BULLET.test(l)) parts.push({ t: l.replace(/:\s*$/, '').replace(/^for the\s+/i, '').trim(), lines: [] }); else (parts[parts.length - 1] || parts[parts.push({ t: '', lines: [] }) - 1]).lines.push(l); });
  return parts.filter((x) => x.lines.length).map((x) => ({ ...x, t: x.t ? x.t.charAt(0).toUpperCase() + x.t.slice(1) : '' }));
}
export function parseIng(lines) {
  const out = [];
  // A recipe with bullet points: the lines without one are section headings ("Branzino", "Lemon-caper beurre blanc").
  const bulleted = lines.filter((l) => BULLET.test(l)).length >= 2;
  lines.filter((l) => !bulleted || BULLET.test(l)).map((l) => l.replace(BULLET, '')).forEach((l) => l.split(/,|\band\b/i).forEach((part) => {
    const p = part.replace(PREP, '').replace(/handful of|a few/ig, '').replace(/\s+/g, ' ').trim();
    if (!p) return;
    const m = p.replace(/^(\d+)\/(\d+)/, (_, x, y) => String(Number(x) / Number(y))).replace(/^[½⅓¼¾⅔]/, (c) => ({ '½': '0.5', '⅓': '0.33', '¼': '0.25', '¾': '0.75', '⅔': '0.67' })[c]).match(/^(\d*\.?\d+)\s*(kg|g|ml|l|lb|cups?|tbsp|tsp|heads?|pints?|bunch(?:es)?|jars?|cans?|packs?)?\s+(.+)$/i);
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
// Each meal is on a day of the meal week (0 Mon .. 6 Sun). Meal i starts on day i; drag it to another day and the two swap.
// A meal's day this week (0 Mon .. 6 Sun), or null while it is still in the Meals list. One meal a day.
export const mealDays = (meals) => { const seen = new Set(); return meals.map((m) => { const d = Number.isInteger(m?.dw) && m.dw >= 0 && m.dw < 7 && !seen.has(m.dw) ? m.dw : null; if (d != null) seen.add(d); return d; }); };
// Drag meal `from` onto a day (null: back to the list). A meal already on that day takes the dragged one's old place.
export function moveMeal(meals, from, day) {
  const d = mealDays(meals); if (!(from >= 0 && from < meals.length) || (day != null && !(day >= 0 && day < 7)) || d[from] === day) return false;
  if (day != null) { const k = d.indexOf(day); if (k >= 0) meals[k].dw = d[from]; }
  meals[from].dw = day;
  return true;
}
// Monday's shop buys for Mon to Thu, Thursday's for Fri to Sun.
const shopOf = (meals, mon) => mealDays(meals).map((d, i) => [d ?? (i < 4 ? 0 : 4), i]).filter(([d]) => (mon ? d < 4 : d >= 4)).map(([, i]) => i);
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
const items3 = () => [{ k: 'Flight', cost: '', ok: false }, { k: 'Accommodation', cost: '', ok: false }, { k: 'Car', cost: '', ok: false }];
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
export const CATS = ['Food', 'Sights', 'Beach', 'Nightlife', 'Shopping', 'Day trip', 'Other'];
// Every day of a stop, arrive to leave (60 at most).
export const stopDays = (s) => { const a = s.from || s.to; const b = s.to || s.from; const out = []; if (!a) return out; for (let d = a; d <= b && out.length < 60; d = addD(d, 1)) out.push(d); return out; };
// The plan form onto trip n. A day puts it in plans[day]; no day (on a city page) puts it on that city's Want to do
// list (stops[j].want). `at` is where it was: { d, k } for a plan, { j, w } for a want-to-do item. Returns what to
// fix, or '' when saved into T.
export function savePlan(T, n, v, at = null, j = null) {
  const t = T[n]; if (!t) return 'That trip is gone. Reload the page.';
  const name = caps(String(v.n || '').trim().slice(0, 120));
  const img = String(v.img || '').slice(0, 500);
  if (!name && !img) return 'Add what it is, or a photo';
  const d = v.d || '';
  if (d ? !/^\d{4}-\d{2}-\d{2}$/.test(d) : (j == null || !t.stops[j])) return 'Pick the day';
  const plan = { n: name, img, cat: CATS.includes(v.cat) ? v.cat : '', link: webLink(v.link), cost: v.cost == null || v.cost === '' ? '' : Math.max(0, Number(v.cost) || 0), ok: v.ok != null && v.ok !== false, notes: String(v.notes || '').trim().slice(0, 2000) };
  if (at) {
    const list = at.w != null ? t.stops[at.j]?.want : t.plans?.[at.d];
    const k = at.w != null ? at.w : at.k;
    const old = list?.[k];
    if (!old) return 'That plan changed on another screen. Close and open it again.';
    if (old.n === name && Number.isFinite(old.lat)) Object.assign(plan, { lat: old.lat, lon: old.lon }); // keep where it is on the map
    if (old.n === name && old.nomap) plan.nomap = 1;
    if (at.w != null ? !d && at.j === j : at.d === d) { list[k] = plan; return ''; }
    list.splice(k, 1);
    if (at.w == null && !list.length) delete t.plans[at.d];
  }
  if (d) { t.plans = t.plans || {}; (t.plans[d] = t.plans[d] || []).push(plan); } else { const st = t.stops[j]; st.want = st.want || []; st.want.push(plan); }
  return '';
}
export function dropPlan(T, n, d, k) {
  const list = T[n]?.plans?.[d]; if (!list?.[k]) return false;
  list.splice(k, 1); if (!list.length) delete T[n].plans[d];
  return true;
}
export function dropWant(T, n, j, w) {
  const list = T[n]?.stops?.[j]?.want; if (!list?.[w]) return false;
  list.splice(w, 1);
  return true;
}
// Build my days: places near each other share a day. Day trips get a day of their own; the rest are joined two
// groups at a time, nearest first, until there is one group per free day. `items` are [{ w, lat, lon, cat }];
// returns [{ d, ws }] (the want-to-do indexes for each day) and the ones left over.
// A typed name and the Wikipedia page found for it: the page's spelling when it is the same place spelt better
// ("obido" -> "Óbidos", "sintra" -> "Sintra"). '' when it is a different place.
const plain = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const edits = (a, b) => { let r = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { const q = [i]; for (let k = 1; k <= b.length; k++) q[k] = Math.min(r[k] + 1, q[k - 1] + 1, r[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1)); r = q; } return r[b.length]; };
export function fixName(typed, title) {
  const t = String(title || '').replace(/\s*\(.*?\)\s*$/, '').replace(/,.*$/, '').trim(); const a = plain(typed); const b = plain(t);
  if (!a || !b || t === String(typed || '').trim()) return '';
  if (a === b || edits(a, b) <= Math.max(1, Math.floor(a.length / 4))) return t;
  if (b.startsWith(`${a} `) && a.length >= 4 && b.split(' ').length - a.split(' ').length <= 2) return t;
  return '';
}
// A category from the name and what Wikipedia says it is; somewhere a town or more away is a day trip.
export function guessCat(text, far) {
  const x = String(text || '').toLowerCase();
  if (/\b(restaurant|caf[eé]|bakery|pastelaria|patisserie|tasca|tavern|food market|food hall|market|mercado|winery|wine bar|port cellar|cellars?)\b/.test(x)) return 'Food';
  if (/\b(beach|praia|playa|cove)\b/.test(x)) return 'Beach';
  if (/\b(nightclub|night club|bar|pub|club)\b/.test(x)) return 'Nightlife';
  if (/\b(shopping|mall|department store|boutique|outlet)\b/.test(x)) return 'Shopping';
  if (far) return 'Day trip';
  return 'Sights';
}
const km = (a, b) => { const r = Math.PI / 180; const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r); const y = (b.lat - a.lat) * r; return 6371 * Math.hypot(x, y); };
export const FAR_KM = 25;
export function groupNear(items, days, center = null) {
  const placed = items.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  const far = (x) => x.cat === 'Day trip' || (center && Number.isFinite(center.lat) && km(center, x) > FAR_KM);
  const trips = placed.filter(far);
  let groups = placed.filter((x) => !far(x)).map((x) => ({ ws: [x.w], lat: x.lat, lon: x.lon }));
  const room = Math.max(0, days.length - trips.length);
  while (groups.length > room && groups.length > 1) {
    let best = null;
    for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) { const dk = km(groups[a], groups[b]); if (!best || dk < best[0]) best = [dk, a, b]; }
    const [, a, b] = best; const A = groups[a]; const B = groups[b]; const na = A.ws.length; const nb = B.ws.length;
    groups[a] = { ws: [...A.ws, ...B.ws], lat: (A.lat * na + B.lat * nb) / (na + nb), lon: (A.lon * na + B.lon * nb) / (na + nb) };
    groups.splice(b, 1);
  }
  if (!room) groups = [];
  const all = [...trips.map((x) => ({ ws: [x.w] })), ...groups.sort((x, y) => y.ws.length - x.ws.length)].slice(0, days.length);
  const used = new Set(all.flatMap((g) => g.ws));
  return { days: all.map((g, k) => ({ d: days[k], ws: g.ws })).sort((x, y) => (x.d < y.d ? -1 : 1)), left: items.map((x) => x.w).filter((w) => !used.has(w)) };
}
// "benagil cave" reads "Benagil Cave"; small joining words stay small, and anything already capitalised is left alone.
const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'of', 'the', 'and', 'a', 'in', 'on', 'at', 'la', 'le', 'el', 'di', 'del', 'van', 'von']);
export const caps = (n) => (/[A-Z]/.test(n) ? n : n.replace(/\S+/g, (w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1))));
const planTile = (x, cls = 'psct') => `<button type="button" class="${cls}${x.ok ? ' ok' : ''}" draggable="true" data-psdragp="${x.w != null ? `w.${x.j}.${x.w}` : `d.${x.d}.${x.k}`}" ${x.w != null ? `data-pswantedit="${x.j}.${x.w}"` : `data-psplanedit="${x.d}.${x.k}"`} title="${esc(x.n || 'Plan')}${x.ok ? ' · booked' : ''}">${x.img ? `<img alt="" loading="lazy" src="${esc(x.img)}">` : `<span>${esc((x.n || '?').slice(0, 1).toUpperCase())}</span>`}</button>`;
// A plan as a rounded square with its name under it (the city page's days and its Want to do list).
const bigTile = (x) => `<div class="psbt">${planTile(x, 'psbti')}${x.w != null ? `<button type="button" class="psbtx" data-pswantrm="${x.j}.${x.w}" aria-label="Remove ${esc(x.n || 'it')}" title="Remove">✕</button>` : ''}<span>${esc(caps(x.n || 'Untitled'))}</span></div>`;
const planRow = (x) => `<div class="psplan${x.ok ? ' ok' : ''}">${planTile(x, 'psplt')}<button type="button" class="psplb" data-psplanedit="${x.d}.${x.k}"><b>${esc(x.n || 'Untitled')}</b><span class="mut">${DAYS[dow(x.d)]} ${fmtD(x.d)}${x.cost !== '' && x.cost != null ? ` · ${usd0(Number(x.cost) || 0)}` : ''}</span></button>${x.link ? `<a class="pslnk" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">Link</a>` : ''}<label class="psplok"><input type="checkbox" data-psplanok="${x.d}.${x.k}"${x.ok ? ' checked' : ''}> ${x.ok ? 'Booked' : 'Idea'}</label></div>`;
const tripBooked = (t) => { let n = 0; let all = 0; t.stops.forEach((s) => s.items.forEach((x) => { all++; if (x.ok) n++; })); return [n, all]; };
export const nDays = (a, b) => { if (!a || !b) return 0; const n = Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1; return n > 0 ? n : 0; };
const daysTxt = (n) => (n ? ` · ${n} day${n === 1 ? '' : 's'}` : '');
const tripDates = (t) => { const ds = t.stops.flatMap((s) => [s.from, s.to]).filter(Boolean).sort(); return ds.length ? `${fmtD(ds[0])} – ${fmtD(ds[ds.length - 1])}${daysTxt(nDays(ds[0], ds[ds.length - 1]))}` : 'Dates not set'; };
const budLine = (t) => (t.bud ? `${usd0(tripCost(t))} of ${usd0(t.bud)} budget` : `${usd0(tripCost(t))} · no budget`);
// A trip with no photo of its own shows its first stop (a known city beats the country article). A place's photo: Jon's own upload, else the first real photo in the place's Wikipedia article (no flags, maps or
// crests), looked up once per name while the page is open and dropped into the picture when it arrives.
const WIKI = {};
// Not scenic: flags, maps, crests, logos, portraits, and pictures taken from space.
const NOT_PHOTO = /panoram|_pano|pano_|bus_|routemaster|train|tram_|locomotiv|aircraft|airport|station|metro|underground|taxi|flag|map|coat|locat|logo|emblem|seal|arms|atlas|diagram|portrait|satellite|landsat|sentinel|nasa|iss0|from_space|topograph|relief|terra|modis|casino|hotel|resort|airport|stadium|interior|station|hospital|building|street|sign/i;
// Scenic first: a view, a beach, the water, the old town (Jon, 2026-11-14: "a casino??").
const SCENIC = /panoram|view|beach|praia|playa|bay|baia|coast|harbou?r|marina|port_|skyline|sunset|dune|old.?town|river|cliff|lagoon|island|landscape/i;
// "Estoril/Cascais" or "Foz do Douro, Porto" looks up its first place.
export const placeKey = (name) => String(name || '').split(/[/,(&+]|\band\b/)[0].trim();
// A place's photo: Wikivoyage's lead photo first (picked for travellers: the marina, the old town, the skyline),
// then the first real photo on its Wikipedia page.
export const PIC_V = 4;
// A country or region shows its capital ("UK" shows London), from Wikidata's capital field.
async function capitalOf(k) {
  try {
    const w = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*';
    const e = Object.values((await (await fetch(`${w}&sites=enwiki&normalize=1&props=claims&titles=${encodeURIComponent(k)}`)).json())?.entities || {})[0];
    const id = e?.claims?.P36?.find((c) => c.rank === 'preferred')?.mainsnak?.datavalue?.value?.id || e?.claims?.P36?.[0]?.mainsnak?.datavalue?.value?.id;
    if (!id) return '';
    const c = (await (await fetch(`${w}&ids=${id}&props=sitelinks&sitefilter=enwiki`)).json())?.entities?.[id];
    return c?.sitelinks?.enwiki?.title || '';
  } catch { return ''; }
}
export async function placePic(name) {
  let k = placeKey(name); if (!k) return '';
  k = (await capitalOf(k)) || k;
  try {
    const r = await fetch(`https://en.wikivoyage.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=1600&titles=${encodeURIComponent(k)}`);
    const pg = r.ok ? Object.values((await r.json())?.query?.pages || {})[0] : null; const src = pg?.thumbnail?.source || '';
    if (/\.jpe?g/i.test(src) && !NOT_PHOTO.test(decodeURIComponent(src.split('/').pop()))) return src;
  } catch { /* try Wikipedia */ }
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(k.replace(/ /g, '_'))}`);
    const b = r.ok ? await r.json() : null;
    const ok = (b?.items || []).filter((i) => i.type === 'image' && /\.jpe?g$/i.test(i.title || '') && !NOT_PHOTO.test(i.title) && i.srcset?.length);
    const it = ok.find((i) => SCENIC.test(i.title)) || ok[0];
    const src = it ? it.srcset[it.srcset.length - 1].src || '' : '';
    return src.startsWith('//') ? `https:${src}` : src;
  } catch { return ''; }
}
function placePhoto(name, own) {
  if (own) return own;
  const k = placeKey(name);
  if (!k || typeof fetch !== 'function' || typeof document === 'undefined') return '';
  if (!(k in WIKI)) {
    WIKI[k] = '';
    placePic(k).then((src) => {
      if (!src) return;
      WIKI[k] = src;
      document.querySelectorAll('img[data-psimg]').forEach((im) => { if (placeKey(im.dataset.psimg) === k && !im.getAttribute('src')) im.src = src; });
    });
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
  const card = (go, title, em, b, sd, foot, pct) => `<a class="pscard ov ov-${go}" href="#personal/${go}"><small><span class="psico" aria-hidden="true">${OV_ICON[go] || ''}</span>${title}</small><div class="psmain"><em>${em}</em><b>${b}</b><span>${sd}</span></div><div class="psfoot">${pct == null ? '<div class="psbar" style="visibility:hidden"></div>' : bar(pct)}<span>${foot}</span></div></a>`;
  const spent = spendPersonal(P); const pace = monthPace(now.ymd);
  const budget = spent == null
    ? card('budget', `Budget · ${monthName(now.ymd)}`, 'Personal', 'No feed', 'MoneyClaw has not sent this month', `Budget ${BUDGET.personal[2]}`, null)
    : card('budget', `Budget · ${monthName(now.ymd)}`, 'Personal', `${usd0(spent)} <i>of ${BUDGET.personal[2]}</i>`, 'Includes fixed bills', `Heading for ~${usd0((spent / pace.d) * pace.len)}`, (spent / BUDGET.personal[1]) * 100);
  const meals = mealsOf(P); const nM = meals.filter((m) => m.n).length; const next = meals.findIndex((m) => m.n);
  const wo = task(H, 'r-workout'); const woNext = wo && nextOcc(wo, now);
  const wk = addD(now.ymd, -dow(now.ymd));
  const woDays = wo ? taskDays(wo) : [];
  const woDone = woDays.filter((d) => habitOn(H, 'workout', addD(wk, d))).length;
  // The trip coming up next (or the one he's on), counting down to it (Jon, 2026-11-15).
  const span = (t) => { const ds = t.stops.flatMap((x) => [x.from, x.to]).filter(Boolean).sort(); return ds.length ? [ds[0], ds[ds.length - 1]] : null; };
  const trip = tripsOf(P).filter((t) => { const d = span(t); return d && d[1] >= now.ymd; }).sort((a, b) => span(a)[0].localeCompare(span(b)[0]))[0] || tripsOf(P)[0];
  const tsp = trip && span(trip); const toGo = tsp ? nDays(now.ymd, tsp[0]) - 1 : null; const onDay = tsp && toGo <= 0 ? nDays(tsp[0], now.ymd) : 0;
  // flights and places to stay are what has to be booked; a car is optional, and coming home is just the journey
  const must = trip ? trip.stops.flatMap((x, j) => x.items.filter((it) => bkKind(it.k) === 'go' || (bkKind(it.k) === 'hotel' && !isHomeLeg(trip, j)))) : [];
  const tb = must.filter((x) => x.ok).length; const ta = must.length;
  const dt = task(H, 'r-date'); const dtNext = dt && nextOcc(dt, now);
  const homeTasks = (H?.tasks || []).filter((t) => t.cat === 'personal' && !t.kind && t.id !== 'r-lunch-wo');
  const homeNext = homeTasks.map((t) => ({ t, o: nextOcc(t, now) })).filter((x) => x.o).sort((a, b) => a.o.i - b.o.i || a.t.start - b.t.start)[0];
  const plan = task(H, 'r-meals');
  return `<div class="psgrid">
${budget}
${card('meals', 'Meals', next >= 0 ? 'Next up' : 'This week', next >= 0 ? esc(meals[next].n) : 'No meals yet', next >= 0 ? `${mealDays(meals)[next] != null ? DAYS[mealDays(meals)[next]] : `Meal ${next + 1}`} · 2 portions` : 'Add 7 meals on Sunday', `${nM} of 7 planned`, (nM / 7) * 100)}
${wo ? card('workouts', 'Workouts', esc(whenText(woNext, wo)), 'Workout', esc(daysText(wo)), `${woDone} of ${woDays.length} this week`, woDays.length ? (woDone / woDays.length) * 100 : 0) : card('workouts', 'Workouts', 'Not on the schedule', 'No workout', '', '', null)}
${trip ? card('trips', 'Trips', esc(trip.name), toGo > 0 ? `${toGo} <i>day${toGo === 1 ? '' : 's'} to go</i>` : onDay ? `Day ${onDay} <i>of ${nDays(tsp[0], tsp[1])}</i>` : `${trip.stops.length} <i>stops</i>`, esc(`${tripDates(trip)} · ${trip.stops.length} stop${trip.stops.length === 1 ? '' : 's'}`), esc(`${ta ? (tb ? `${tb} of ${ta} flights and stays booked` : `${ta} flights and stays to book`) : 'Add the stops'}${trip.bud ? ` · ${usd0(trip.bud)} budget` : ''}`), ta ? (tb / ta) * 100 : 0) : card('trips', 'Trips', 'No trips', 'Add a trip', '', '', null)}
${dt ? card('date', 'Date night', esc(dtNext ? `${dtNext.i === 0 ? 'Tonight' : dtNext.i === 1 ? 'Tomorrow' : `${DAYS[dow(dtNext.ymd)]} ${fmtD(dtNext.ymd)}`} ${fmtT(dt.start)}–${fmtT(dt.end)}` : ''), 'Book something', esc(dtNext && !dtNext.i ? 'Covers dinner' : 'Pick a spot and book it'), `Every ${DAYL[taskDays(dt)[0]] || ''}`, null) : card('date', 'Date night', '', 'Not on the schedule', '', '', null)}
${card('home', 'Home', 'Next', homeNext ? esc(homeNext.t.title) : 'Nothing set', homeNext ? esc(whenText(homeNext.o, homeNext.t)) : '', plan ? esc(`${plan.title} ${DAYS[taskDays(plan)[0]] || ''} ${fmtT(plan.start)}`) : '', null)}
</div>`;
}

function mealsPage(S, now, ui) {
  const P = S.personal; const meals = mealsOf(P); const prices = P?.store?.prices || {};
  const wk = mealWeek(now.ymd); const nM = meals.filter((m) => m.n).length;
  const mon = groc(meals, shopOf(meals, true), prices); const thu = groc(meals, shopOf(meals, false), prices);
  const days = mealDays(meals); const free = meals.findIndex((m, i) => !m.n && days[i] == null); const left = meals.map((m, i) => (m.n ? '' : `Meal ${i + 1}`)).filter(Boolean);
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
<section class="card pscol pswide"><div class="pshd"><h2>Meals</h2><span class="mut">2 portions each</span><span class="mut psright">${nM} of 7 added</span></div>
<div class="psmlist" data-psmday="">${meals.map((m, i) => (days[i] != null ? '' : `<button type="button" class="psmrow${m.n ? '' : ' empty'}" data-psmeal="${i}"${m.n ? ` draggable="true" data-psmdrag="${i}"` : ''}><b>Meal ${i + 1}</b><span>${m.n ? esc(m.n) : 'Add recipe'}${m.n && m.src ? `<small>${esc(m.src)}</small>` : ''}</span><span class="${m.n ? 'psok' : 'mut'}">${m.n ? '✓' : '›'}</span></button>`)).join('')}</div></section>
<section class="card pscol pswide"><div class="pshd"><h2>This week</h2><span class="mut">Week of ${fmtD(wk)}</span></div>
<div class="pscal pscitycal psmcal">${[0, 1, 2, 3, 4, 5, 6].map((d) => { const i = days.indexOf(d); const m = i >= 0 ? meals[i] : null; return `<div class="pscday" data-psmday="${d}"><small>${Number(addD(wk, d).slice(8))} ${DAYS[d]}</small>${m ? `<div class="pscnames"><button type="button" class="psmchip" data-psmeal="${i}" draggable="true" data-psmdrag="${i}">${esc(m.n || `Meal ${i + 1}`)}</button></div>` : free >= 0 ? `<div class="pscthumbs"><button type="button" class="psctadd" data-psmadd="${d}" aria-label="Add a meal on ${DAYS[d]}">+</button></div>` : ''}</div>`; }).join('')}</div></section>
<section class="card pscol"><div class="pshd"><h2>Groceries · Monday</h2><span class="mut">${fmtD(wk)} · 8am · Mon to Thu meals · tap a price to change it</span></div><div class="psglist">${list('mon', mon)}</div></section>
<section class="card pscol"><div class="pshd"><h2>Groceries · Thursday</h2><span class="mut">${fmtD(addD(wk, 3))} · 8am · Fri to Sun meals</span></div><div class="psglist">${list('thu', thu)}</div></section>
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
    const row = (x) => {
      const q = qtyText(x.qs);
      const label = `<span class="pst">${esc(x.name)}${q ? ` <span class="mut">${esc(q)}</span>` : ''}${x.pantry ? ' <span class="mut">· pantry</span>' : ''}</span>`;
      return d.on.includes(x.key)
        ? `<div class="psir on">${label}<span class="psonl">✓ On list</span><button type="button" class="pslnk" data-psoff="${esc(x.key)}">Remove</button></div>`
        : `<label class="psir"><input type="checkbox" data-pssel="${esc(x.key)}"${d.sel.includes(x.key) ? ' checked' : ''}>${label}</label>`;
    };
    const parts = ingParts(d.ing || []);
    const rows = ing.length ? parts.map((pt) => `${pt.t ? `<div class="psipart">${esc(pt.t)}</div>` : ''}${parseIng(pt.lines).map(row).join('')}`).join('') : '<p class="mut">No ingredients found. Use Edit recipe to add an "Ingredients" line.</p>';
    const left = ing.filter((x) => !d.on.includes(x.key) && !x.pantry).length;
    const act = left || d.sel.length
      ? `${left ? '<button type="button" class="btn sm primary" data-psaddall>Add all to groceries</button>' : ''}<button type="button" class="btn sm" data-psaddsel${d.sel.length ? '' : ' disabled'}>Add selected${d.sel.length ? ` (${d.sel.length})` : ''}</button>`
      : (ing.length ? '<span class="psonl">✓ All on the grocery list</span>' : '');
    body = `<div class="pssplit psbig"><div class="pscolb"><b>Ingredients</b><div class="psilist">${rows}</div><div class="psiact">${act}</div></div><div class="pscolb psmeth"><b>Prep</b><small class="mut">Chopping, seasoning, getting it ready</small><textarea class="pstext psprep" data-psin="prep" aria-label="Prep" placeholder="Prep steps">${esc(d.prep || '')}</textarea><b>Cooking</b><textarea class="pstext" data-psin="meth" aria-label="Cooking" placeholder="Cooking steps">${esc(d.meth || '')}</textarea></div></div>`;
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
// ---- booking details (Jon, 2026-11-14): how he gets there (a dropdown), the hotel, the car, and the paperwork ----
export const MODES = ['Flight', 'Train', 'Bus', 'Ferry', 'Drive'];
const bkKind = (k) => (MODES.includes(k) ? 'go' : k === 'Hotel' || k === 'Accommodation' ? 'hotel' : k === 'Car' ? 'car' : 'other');
// Older trips call it Hotel; Jon says accommodation (2026-11-14).
const bkName = (k) => (k === 'Hotel' ? 'Accommodation' : k);
// Each way of getting there asks for its own things (Jon, 2026-11-14: "i need airports").
const ride = (a, b) => [['from', `From ${a}`, b[0]], ['to', `To ${a}`, b[1]], ['dep', 'Departs', '', 1], ['arr', 'Arrives', '', 1]];
// [name, label, placeholder, date-and-time]; SHOW says how many show at once, the rest are under More details.
export const BKF = {
  Flight: [['from', 'From airport', 'LIS Lisbon'], ['to', 'To airport', 'LPA Gran Canaria'], ['dep', 'Departs', '', 1], ['arr', 'Lands', '', 1], ['co', 'Airline', 'TAP, Ryanair'], ['no', 'Flight number', 'TP 1350'],
    ['term', 'Terminal', 'T1'], ['seat', 'Seat', '14C'], ['bags', 'Bags', '1 checked, 1 carry-on'], ['code', 'Booking code', 'ABC123']],
  Train: [...ride('station', ['Lisboa Santa Apolónia', 'Porto Campanhã']), ['co', 'Company', 'CP'], ['no', 'Train number', 'AP 121'], ['seat', 'Coach and seat', 'Coach 4, seat 32'], ['code', 'Booking code', '']],
  Bus: [...ride('stop', ['Sete Rios', 'Porto Campo 24 de Agosto']), ['co', 'Company', 'FlixBus, Rede Expressos'], ['no', 'Route', ''], ['seat', 'Seat', ''], ['code', 'Booking code', '']],
  Ferry: [...ride('port', ['Huelva', 'Las Palmas']), ['co', 'Company', 'Naviera Armas'], ['no', 'Sailing', ''], ['seat', 'Cabin or seat', ''], ['veh', 'Car on board', 'Yes, plate AB-12-CD'], ['code', 'Booking code', '']],
  Drive: [['from', 'From', 'Lisbon'], ['to', 'To', 'Porto'], ['dep', 'Leave', '', 1], ['dur', 'How long', '3h'], ['tolls', 'Tolls and parking', 'Via Verde']],
  hotel: [['name', 'Where', 'Memmo Alfama, an Airbnb'], ['addr', 'Address', 'Travessa das Merceeiras 27, Lisbon'], ['cin', 'Check-in', '', 1], ['cout', 'Check-out', '', 1], ['code', 'Booking code', ''], ['phone', 'Phone', '']],
  car: [['co', 'Company', 'Sixt'], ['addr', 'Pick-up address', 'Lisbon airport'], ['dep', 'Pick-up', '', 1], ['arr', 'Return', '', 1], ['ret', 'Return address', ''], ['code', 'Booking code', '']],
  other: [['what', 'What', ''], ['addr', 'Address', ''], ['when', 'When', '', 1], ['code', 'Booking code', '']],
};
const fieldsOf = (k) => BKF[k] || BKF[bkKind(k)];
const SHOW = { Flight: 6, Train: 6 };
const tm = (v) => { const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(v || ''); return m ? `${fmtD(m[1])}${m[2] ? ` ${m[2]}` : ''}` : ''; };
export function bkSum(x) {
  const d = x.det || {};
  const kind = bkKind(x.k);
  if (kind === 'go') return [d.no || d.co, d.from && d.to ? `${d.from} → ${d.to}` : d.from || d.to, tm(d.dep)].filter(Boolean).join(' · ');
  if (kind === 'hotel') return [d.name, d.addr].filter(Boolean).join(' · ');
  if (kind === 'car') return [d.co, tm(d.dep)].filter(Boolean).join(' · ');
  return [d.what, tm(d.when)].filter(Boolean).join(' · ');
}
const mapsLink = (a) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
let attBusy = ''; // the box whose files are uploading ("j.k")
const docLink = (d) => `<a class="psbkfile" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(d.n)}"><b>${/\.pdf$/i.test(d.url) ? 'PDF' : 'IMG'}</b>${esc(d.n)}</a>`;
// Home, where the first leg starts; each later leg starts at the stop before (Jon, 2026-11-14).
export const HOME = 'Kelowna';
export const legOf = (t, j) => ({ from: j > 0 ? placeKey(t.stops[j - 1]?.place) : HOME, to: placeKey(t.stops[j]?.place) });
const UP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>';
// What a box says: the leg (or the place) on top, the details under it; empty boxes still read well.
export function bkFace(x, leg) {
  const d = x.det || {}; const kind = bkKind(x.k);
  // every box has two lines, so the three sit level
  if (kind === 'go') return { top: `${d.from || leg.from || '?'} → ${d.to || leg.to || '?'}`, sub: [d.no || d.co, tm(d.dep)].filter(Boolean).join(' · '), none: x.k === 'Drive' ? 'Add when you leave' : 'Add times and details' };
  if (kind === 'hotel') return { top: d.name || leg.to || 'Accommodation', sub: d.addr || '', none: d.name ? 'Add the address' : 'Where are you staying?' };
  if (kind === 'car') return { top: d.co || 'Rental car', sub: tm(d.dep) ? `Pick-up ${tm(d.dep)}` : '', none: 'Add the rental' };
  return { top: d.what || bkName(x.k), sub: tm(d.when), none: 'Add details' };
}
function bkBox(x, j, k, leg) {
  const f = bkFace(x, leg); const docs = x.docs || []; const busy = attBusy === `${j}.${k}`;
  return `<div class="psbk${x.ok ? ' on' : ''}"><div class="psbkh"><label class="psbkck"><input type="checkbox" data-psbook="${j}.${k}"${x.ok ? ' checked' : ''} aria-label="${esc(bkName(x.k))} booked">${bkKind(x.k) === 'go' ? '' : ` ${esc(bkName(x.k))}`}</label>${bkKind(x.k) === 'go' ? `<select class="psbkmode" data-psbkk="${j}.${k}" aria-label="How you're getting there">${MODES.map((m) => `<option${m === x.k ? ' selected' : ''}>${m}</option>`).join('')}</select>` : ''}${x.ok ? '<i class="psbkok">booked</i>' : ''}<label class="psbkup${busy ? ' busy' : ''}" title="Upload ${bkKind(x.k) === 'go' ? 'ticket' : 'booking'}" aria-label="Upload ${bkKind(x.k) === 'go' ? 'ticket' : 'booking'}"><input type="file" accept="image/*,application/pdf" multiple hidden data-psbkatt="${j}.${k}">${busy ? '…' : UP}</label></div>
<button type="button" class="psbkd" data-psbkdet="${j}.${k}"><b>${esc(f.top)}</b><small${f.sub ? '' : ' class="none"'}>${esc(f.sub || f.none)}</small></button>
<span class="pscost">$<input type="number" min="0" step="10" data-pscost="${j}.${k}" value="${esc(x.cost)}" placeholder="cost" aria-label="${esc(bkName(x.k))} cost"></span>${docs.length ? `<div class="psbkfiles">${docs.map(docLink).join('')}</div>` : ''}</div>`;
}
// The last stop back in Kelowna is the trip home: just the journey, no accommodation, car or plans (Jon, 2026-11-14).
export const isHomeLeg = (t, j) => j > 0 && j === t.stops.length - 1 && placeKey(t.stops[j]?.place).toLowerCase() === HOME.toLowerCase();
const bkRow = (s, j, t) => { const home = isHomeLeg(t, j); return `<div class="psbk3">${s.items.map((x, k) => (home && bkKind(x.k) !== 'go' ? '' : bkBox(x, j, k, legOf(t, j)))).join('')}</div>`; };
// The details form onto booking k of stop j. Returns what to fix, or '' when saved into T.
export function saveBk(T, n, j, k, was, v) {
  const it = T[n]?.stops?.[j]?.items?.[k];
  if (!it || it.k !== was) return 'That booking changed on another screen. Close and open it again.';
  const kk = MODES.includes(v.k) && MODES.includes(it.k) ? v.k : it.k;
  const det = {};
  for (const [f] of [...fieldsOf(kk), ['notes']]) { const x = String(v.det?.[f] ?? '').trim().slice(0, f === 'notes' ? 2000 : 200); if (x) det[f] = x; }
  const old = it.det || {};
  if (det.addr && det.addr === old.addr && Number.isFinite(old.lat)) Object.assign(det, { lat: old.lat, lon: old.lon }); // keep where it is on the map
  it.k = kk; it.det = det;
  it.docs = (v.docs || []).filter((d) => d?.url).map((d) => ({ n: String(d.n || 'File').slice(0, 120), url: String(d.url).slice(0, 500) })).slice(0, 20);
  it.cost = v.cost == null || v.cost === '' ? '' : Math.max(0, Number(v.cost) || 0);
  it.ok = !!v.ok;
  return '';
}
function bkPop(p, t) {
  const st = t?.stops?.[p.j]; const x = p.draft; const go = MODES.includes(x.k);
  const f = fieldsOf(x.k); const sh = SHOW[x.k] || 4; const more = p.more || f.slice(sh).some(([nm]) => x.det[nm]) || x.det.notes;
  const inp = ([nm, l, ph, dt]) => `<label>${l}<input name="${nm}"${dt ? ' type="datetime-local"' : ''} value="${esc(x.det[nm] || '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}></label>`;
  const addr = x.det.addr;
  return `<div class="hmhost" data-psback><form class="hmed pspop psbkpop" data-psform="bk"><div class="hmedh"><b class="hmedt">${go ? 'Getting to' : esc(bkName(x.k))}${go ? ' ' : ' in '}${esc(st?.place || '')}</b><button type="button" class="btn sm" data-psx aria-label="Close">✕</button></div>
<div class="pstfb">${go ? `<div class="psmodes" role="group" aria-label="How">${MODES.map((m) => `<button type="button" data-psbkmode="${m}" aria-pressed="${m === x.k}">${m}</button>`).join('')}</div>` : ''}
<div class="psbkf">${f.slice(0, sh).map(inp).join('')}</div>
<div class="psdocs"><small>Paperwork</small>${x.docs.map((d, i) => `<div class="psdoc"><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.n)}</a><button type="button" class="pslnk" data-psbkdocx="${i}">Remove</button></div>`).join('') || '<span class="mut">Tickets, confirmations, insurance (photo or PDF)</span>'}<label class="btn sm"><input type="file" accept="image/*,application/pdf" hidden data-psbkdoc>${p.busy ? 'Uploading…' : '+ Attach'}</label></div>${addr ? `<a class="pslnk" href="${esc(mapsLink(addr))}" target="_blank" rel="noopener noreferrer">Open the address in Maps ›</a>` : ''}
${more ? `<div class="psbkf">${f.slice(sh).map(inp).join('')}</div>
<label>Notes<textarea name="notes" rows="2" placeholder="Terminal, baggage, door code, who to call">${esc(x.det.notes || '')}</textarea></label>` : '<button type="button" class="pslnk psmore" data-psmore>+ More details</button>'}
<div class="pstf2"><label>Cost $<input type="number" min="0" step="10" name="cost" value="${esc(x.cost ?? '')}" placeholder="0"></label><label class="psedok"><input type="checkbox" name="ok"${x.ok ? ' checked' : ''}> Booked</label></div></div>
<div class="hmedf"><span class="psbad">${esc(p.err || '')}</span><button type="button" class="btn" data-psx style="margin-left:auto">Cancel</button><button class="btn primary">Save</button></div></form></div>`;
}
// Keep what Jon has typed in the booking form before the pop-up is drawn again.
function keepBk(el, p) {
  const form = el.closest?.('form'); if (!form) return;
  const v = Object.fromEntries(new FormData(form).entries());
  for (const [f] of [...fieldsOf(p.draft.k), ['notes']]) if (v[f] != null) p.draft.det[f] = v[f];
  if (v.cost != null) p.draft.cost = v.cost;
  p.draft.ok = v.ok != null;
}

// ---- the map (Jon, 2026-11-14): OpenStreetMap through Leaflet, loaded only when Map is picked ----
export function mapPts(t, j = null) {
  const pts = []; const ok = (o) => o && Number.isFinite(o.lat) && Number.isFinite(o.lon);
  const hotel = (s) => { const h = (s.items || []).find((x) => bkKind(x.k) === 'hotel'); if (ok(h?.det)) pts.push({ lat: h.det.lat, lon: h.det.lon, n: h.det.name || 'Accommodation', sub: h.det.addr, kind: 'hotel' }); };
  if (j == null) {
    t.stops.forEach((s, k) => { if (ok(s)) pts.push({ lat: s.lat, lon: s.lon, n: s.place, sub: `${s.from ? fmtD(s.from) : '?'} – ${s.to ? fmtD(s.to) : '?'}`, kind: 'stop', img: s.img, k }); hotel(s); });
    return pts;
  }
  const s = t.stops[j];
  if (ok(s)) pts.push({ lat: s.lat, lon: s.lon, n: s.place, sub: 'Where you\'re staying', kind: 'stop', img: s.img });
  const near = (x) => !ok(s) || km(s, x) < 60; // a far day trip stays in the list but doesn't stretch the city's map
  plansOf(t).filter((x) => inStop(s, x.d)).forEach((x) => { if (ok(x) && near(x)) pts.push({ lat: x.lat, lon: x.lon, n: x.n, sub: `${DAYS[dow(x.d)]} ${fmtD(x.d)}${x.ok ? ' · booked' : ''}`, kind: x.ok ? 'ok' : 'plan', img: x.img }); });
  (s.want || []).forEach((x) => { if (ok(x) && near(x)) pts.push({ lat: x.lat, lon: x.lon, n: x.n, sub: `Want to do${x.cat ? ` · ${x.cat}` : ''}`, kind: 'want', img: x.img }); });
  hotel(s);
  return pts;
}
const mapBox = (n, j, ui) => `<div class="psmapw">${ui.psMapNote ? `<p class="mut">${esc(ui.psMapNote)}</p>` : ''}<div class="psmap" data-psmap="${n}${j != null ? `.${j}` : ''}"><p class="mut">Loading the map…</p></div><p class="psmapk"><span class="psk plan"></span>Plan <span class="psk ok"></span>Booked <span class="psk want"></span>Want to do <span class="psk hotel"></span>Accommodation</p></div>`;
let leafletP = null;
function leaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  leafletP = leafletP || new Promise((res, rej) => {
    const c = document.createElement('link'); c.rel = 'stylesheet'; c.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.append(c);
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    sc.onload = () => res(window.L); sc.onerror = () => { leafletP = null; rej(new Error('no map')); }; document.head.append(sc);
  });
  return leafletP;
}
let finding = false;
// Find on OpenStreetMap whatever has no spot yet (stops, the hotel's address, plans and want-to-do places), one a
// second, and save the spots so it happens once. A place it can't find is marked and not asked again.
async function findSpots(S, n, j, send, render, reload) {
  if (finding) return;
  const T = structuredClone(tripsOf(S.personal)); const t = T[n]; if (!t) return;
  const before = JSON.stringify(tripsOf(S.personal));
  const todo = []; const need = (o, how) => { if (o && how.q && !Number.isFinite(o.lat) && !o.nomap) todo.push([o, how]); };
  const where = (...a) => a.filter(Boolean).join(', ');
  let pics = false;
  for (const s of (j == null ? t.stops : [t.stops[j]])) {
    // no photo yet, or one picked the old way (Jon's own uploads aren't on Wikimedia, so they're kept)
    const stale = s?.img && s.imgv !== PIC_V && /wikimedia\.org|wikipedia\.org/.test(s.img);
    if (s && s.place && (!s.img || stale)) { const src = WIKI[placeKey(s.place)] || await placePic(s.place); if (src) { s.img = src; s.imgv = PIC_V; pics = true; } else if (stale) { s.imgv = PIC_V; pics = true; } }
  }
  (j == null ? t.stops : [t.stops[j]]).forEach((s) => {
    if (!s) return;
    need(s, { q: where(placeKey(s.place), t.name) });
    const h = (s.items || []).find((x) => bkKind(x.k) === 'hotel'); if (h?.det?.addr) need(h.det, { q: h.det.addr, near: s });
    if (j == null) return;
    const thing = (x) => need(x, { q: where(x.n, s.place, t.name), wq: `${x.n} ${t.name}`, near: s, photo: true });
    Object.entries(t.plans || {}).forEach(([d, xs]) => { if (inStop(s, d)) xs.forEach((x) => x.n && thing(x)); });
    (s.want || []).forEach((x) => x.n && thing(x));
  });
  const fix = [];
  if (j != null && t.stops[j]) { const s = t.stops[j]; (s.want || []).forEach((x) => x.n && !x.wv && fix.push([x, s])); Object.entries(t.plans || {}).forEach(([d, xs]) => { if (inStop(s, d)) xs.forEach((x) => x.n && !x.wv && fix.push([x, s])); }); }
  if (fix.length && !finding) {
    finding = true;
    try { for (const [x, s] of fix) { await wikiFix(x, s, t.name); pics = true; } } finally { finding = false; }
    todo.splice(0, todo.length, ...todo.filter(([o]) => !Number.isFinite(o.lat) && !o.nomap));
  }
  if (!todo.length) {
    if (pics && JSON.stringify(tripsOf(S.personal)) === before) await save(S, 'trips', T, send, render, reload);
    return;
  }
  finding = true;
  try {
    for (const [c, [o, how]] of todo.entries()) {
      S.ui.psMapNote = `Finding places on the map… ${c + 1} of ${todo.length}`;
      const el = document.querySelector('.psmapw > p.mut'); if (el) el.textContent = S.ui.psMapNote;
      await lookUp(o, how);
    }
  } finally { finding = false; S.ui.psMapNote = ''; }
  if (JSON.stringify(tripsOf(S.personal)) !== before) { render(); return; } // changed meanwhile: try again on the next draw
  await save(S, 'trips', T, send, render, reload);
}
export async function personalAfter(root, S, send, render, reload) {
  const qi = S.ui?.psQuick && Date.now() - S.ui.psQuick < 4000 && root?.querySelector?.('.psquick input');
  if (qi && document.activeElement !== qi) qi.focus();
  const cityEl = root?.querySelector?.('[data-pscityat]');
  if (cityEl) { const [cn, cj] = cityEl.dataset.pscityat.split('.').map(Number); findSpots(S, cn, cj, send, render, reload); }
  const tripEl = root?.querySelector?.('[data-pstripat]');
  if (tripEl && !root.querySelector('[data-psmap]')) findSpots(S, Number(tripEl.dataset.pstripat), null, send, render, reload);
  const el = root?.querySelector?.('[data-psmap]'); if (!el) return;
  const [n, j0] = el.dataset.psmap.split('.'); const j = j0 == null ? null : Number(j0);
  const t = tripsOf(S.personal)[Number(n)]; if (!t) return;
  findSpots(S, Number(n), j, send, render, reload);
  let L; try { L = await leaflet(); } catch { el.innerHTML = '<p class="mut">The map could not load. Try again in a minute.</p>'; return; }
  if (!el.isConnected) return;
  const pts = mapPts(t, j); const s = j != null ? t.stops[j] : null;
  el.innerHTML = '';
  const m = L.map(el, { scrollWheelZoom: false, maxZoom: 18 });
  // Satellite with place names, Jon's pick (2026-11-14); Esri's tiles need no key. Roads and street names show from
  // zoom 12, when you're looking at a city.
  const esri = (name) => `https://server.arcgisonline.com/ArcGIS/rest/services/${name}/MapServer/tile/{z}/{y}/{x}`;
  L.tileLayer(esri('World_Imagery'), { maxZoom: 18, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics' }).addTo(m);
  L.tileLayer(esri('Reference/World_Transportation'), { minZoom: 12, maxZoom: 18, opacity: 0.8, pane: 'shadowPane' }).addTo(m);
  L.tileLayer(esri('Reference/World_Boundaries_and_Places'), { maxZoom: 18, pane: 'shadowPane' }).addTo(m);
  // Stops carry their number; a place visited twice (Lisbon at the start and the end) is one pin with both numbers.
  const at = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`; const nums = {};
  pts.forEach((p) => { if (p.kind === 'stop' && p.k != null) (nums[at(p)] = nums[at(p)] || []).push(p.k + 1); });
  const drawn = new Set();
  pts.forEach((p) => {
    const no = p.kind === 'stop' && p.k != null ? nums[at(p)] : null;
    if (no) { if (drawn.has(at(p))) return; drawn.add(at(p)); }
    const icon = L.divIcon({ className: `psmpin ${p.kind}`, html: (p.img ? `<img alt="" src="${esc(p.img)}">` : `<span>${esc((p.n || '?').trim().charAt(0).toUpperCase())}</span>`) + (no ? `<i class="psmno">${no.join(' · ')}</i>` : ''), iconSize: [40, 40], iconAnchor: [20, 20] });
    L.marker([p.lat, p.lon], { icon, title: p.n }).addTo(m).bindPopup(`<b>${esc(p.n || 'Untitled')}</b>${p.sub ? `<br>${esc(p.sub)}` : ''}${p.kind === 'stop' && p.k != null ? `<br><a href="#personal/trips/${n}/${p.k}">Open ${esc(p.n)} ›</a>` : ''}`);
  });
  const route = pts.filter((p) => p.kind === 'stop').map((p) => [p.lat, p.lon]);
  if (route.length > 1) L.polyline(route, { color: '#2563eb', weight: 3, dashArray: '6 8' }).addTo(m);
  if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.2), { maxZoom: 14 });
  else if (pts.length) m.setView([pts[0].lat, pts[0].lon], 13);
  else if (s && Number.isFinite(s.lat)) m.setView([s.lat, s.lon], 12);
  else m.setView([30, 0], 2);
}
// The city's days as a calendar (Monday first, its own weeks only), each day with its plans and a + (Jon, 2026-11-14).
function cityCal(days, ps, j) {
  const first = days[0]; const last = days[days.length - 1];
  const cells = [];
  for (let d = addD(first, -dow(first)), i = 0; (d <= last || dow(d) !== 0) && i < 70; d = addD(d, 1), i++) cells.push(d);
  return `<div class="pscal pscitycal"><div class="pscalh">${DAYS.map((x) => `<span>${x}</span>`).join('')}</div>${cells.map((d) => {
    if (d < first || d > last) return `<div class="pscday out empty"><small>${Number(d.slice(8))}</small></div>`;
    const here = ps.filter((x) => x.d === d);
    return `<div class="pscday" data-ymd="${d}" data-psdropday="${d}"><small><span class="pscdw">${DAYS[dow(d)]} </span>${fmtD(d)}</small><div class="pscthumbs">${here.map((x) => planTile(x)).join('')}<button type="button" class="psctadd" data-psaddplan="${d}" data-psj="${j}" aria-label="Add a plan on ${fmtD(d)}">+</button></div>${here.length ? `<div class="pscnames">${here.map((x) => `<span>${esc(x.n || 'Untitled')}</span>`).join('')}</div>` : ''}</div>`;
  }).join('')}</div>`;
}
function cityPage(t, n, j, ui) {
  const s = t.stops[j];
  const days = stopDays(s);
  const ps = plansOf(t).filter((x) => inStop(s, x.d));
  const want = (s.want || []).map((x, w) => ({ ...x, j, w }));
  const cats = CATS.filter((c) => want.some((x) => (x.cat || 'Other') === c));
  const cv = ui.psCView === 'map' ? 'map' : 'cal'; // the days are a calendar (Jon, 2026-11-14), or the map
  return `<section class="card pscity" data-pscityat="${n}.${j}"><div class="pscityh">${photoHtml(s.place, s.img, `data-psstphoto="${j}"`)}<div class="pscityb"><div class="psthrow"><h2>${esc(s.place)}</h2><span class="mut">${s.from ? fmtD(s.from) : '?'} – ${s.to ? fmtD(s.to) : '?'}${daysTxt(nDays(s.from, s.to))}</span><button type="button" class="pslnk" data-psedstop="${j}">Edit</button></div>
${s.notes || s.link ? `<div class="psnote">${s.notes ? `<p>${esc(s.notes)}</p>` : ''}${s.link ? `<a href="${esc(webLink(s.link))}" target="_blank" rel="noopener noreferrer">${esc(s.link.replace(/^https?:\/\//i, '').slice(0, 60))}</a>` : ''}</div>` : ''}
${bkRow(s, j, t)}</div></div>
<div class="pscsec pswantsec" data-psdropday=""><div class="psplh"><b>Want to do</b><span class="mut">${want.length ? `${want.length} not on a day yet` : 'Places and things with no day yet'}</span>${want.length && days.length ? `<button type="button" class="btn sm" data-psbuild="${j}">Build my days</button>` : ''}<button type="button" class="btn sm" data-psaddplan="" data-psj="${j}" data-pswant="1">+ Add</button></div>
<form class="psquick" data-psform="quick" data-psj="${j}"><input name="n" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="Type a place or thing and press Enter" aria-label="Add to Want to do"></form>
${cats.length ? `<div class="pswcats">${cats.map((c) => `<div class="pswcat"><small>${esc(c)}</small><div class="pscdtiles">${want.filter((x) => (x.cat || 'Other') === c).map(bigTile).join('')}</div></div>`).join('')}</div>` : ''}</div>
<div class="pscsec"><div class="psplh"><b>Days</b><span class="mut">${days.length ? `${days.length} day${days.length === 1 ? '' : 's'} · ${ps.length} plan${ps.length === 1 ? '' : 's'}, ${ps.filter((x) => x.ok).length} booked` : 'Add the arrive and leave dates to see the days'}</span><div class="psfilter" role="group" aria-label="View">${[['cal', 'Calendar'], ['map', 'Map']].map(([k, l]) => `<button type="button" data-pscview="${k}" aria-pressed="${k === cv}">${l}</button>`).join('')}</div><button type="button" class="btn sm primary" data-psaddplan="" data-psj="${j}">+ Add plan</button></div>
${cv === 'map' ? mapBox(n, j, ui) : !days.length ? '' : cityCal(days, ps, j)}</div>
<div class="psstend psrowend"><a class="btn" href="#personal/trips/${n}">‹ ${esc(t.name)}</a></div></section>${ui.psErr ? `<p class="psbad">${esc(ui.psErr)}</p>` : ''}`;
}
// ---- trips by year (Jon, 2026-11-14): each year has Snowbird (about 3 winter months) and Fall escape (August to the
// end of October: the UK with his mum, and short trips around Europe to try places for a long stay). A trip is dragged
// between years and seasons unless it's locked. ----
export const SEAS = [['snow', 'Snowbird', 'Winter, about 3 months away'], ['fall', 'Fall escape', 'Aug – Oct · UK with Mum, short trips around Europe']];
// Where a trip sits: its saved year and season, or (never placed) from its first date; no date and no season = not
// placed yet, under Snowbird.
export function tripSlot(t) {
  if (t.sea) return { yr: Number(t.yr) || null, sea: t.sea === 'fall' ? 'fall' : 'snow' };
  const d = (t.stops || []).map((s) => s.from || s.to).filter(Boolean).sort()[0];
  if (!d) return { yr: null, sea: 'snow' };
  const y = Number(d.slice(0, 4)); const m = Number(d.slice(5, 7));
  return m >= 7 && m <= 10 ? { yr: y, sea: 'fall' } : { yr: m >= 11 ? y + 1 : y, sea: 'snow' };
}
export function placeTrip(T, i, yr, sea) {
  const t = T[i]; if (!t || t.lock) return false;
  const k = sea || tripSlot(t).sea; // dropped on a year: keeps its season
  t.yr = yr || null; t.sea = k === 'fall' ? 'fall' : 'snow';
  return true;
}
const lockBtn = (x, i) => `<button type="button" class="pstlock${x.lock ? ' on' : ''}" data-pslock="${i}" aria-pressed="${!!x.lock}" title="${x.lock ? 'Locked: click to let it move' : 'Lock it where it is'}">${x.lock ? '🔒 Locked' : '🔓'}</button>`;
// A trip's card: the photo, its name and dates, a season pill (tap to switch) and the lock. Short trips are smaller.
const seaPill = (x, i) => { const k = tripSlot(x).sea; return `<button type="button" class="pstpill ${k}" data-psseason="${i}" title="${x.lock ? 'Locked' : 'Tap to move it'}"${x.lock ? ' disabled' : ''}>${k === 'fall' ? 'Fall escape' : 'Snowbird'}</button>`; };
// A trip's photo shows the new place: "UK & Malta" shows Malta, since a Fall escape starts in the UK every year.
export function tripPic(x) {
  const parts = String(x.name || '').split(/[/,&+]|and/).map((y) => y.trim()).filter(Boolean);
  const st = x.stops || []; const s = st.length > 1 && /^(uk|united kingdom|england|london)$/i.test(placeKey(st[0].place)) ? st[1] : st[0];
  if (parts.length > 1 && !st.length) return { name: parts[parts.length - 1], img: x.img };
  return { name: s?.place || x.name, img: x.img || s?.img };
}
function tripCard(x, i) {
  const pic = tripPic(x);
  return `<a class="pscard pstcard${x.lock ? ' locked' : ''}${x.mini ? ' mini' : ''}" href="#personal/trips/${i}" draggable="${!x.lock}" data-pstcard="${i}">${photoHtml(pic.name, pic.img)}${seaPill(x, i)}${lockBtn(x, i)}<div class="pstcb"><b>${esc(x.name)}</b><em>${esc(tripDates(x))}</em></div></a>`;
}
// Trips by year (Jon, 2026-11-14): the year, then its trips in one row, Snowbird first. Drag a card to another year;
// its pill says the season.
// The years shown: from the one being planned (next year from October on) to one past the latest trip.
export function tripYearRange(T, now = new Date()) {
  const base = now.getFullYear() + (now.getMonth() >= 9 ? 1 : 0);
  const used = T.map(tripSlot).map((x) => x.yr).filter(Boolean);
  return [Math.min(base, ...used), Math.max(base, ...used) + 1];
}
function tripYears(T, now = new Date()) {
  const slots = T.map(tripSlot);
  const [lo, hi] = tripYearRange(T, now); // always a free year to drag into
  const order = (i) => (slots[i].sea === 'fall' ? 1 : 0) * 2 + (T[i].mini ? 1 : 0);
  const row = (yr) => {
    const here = T.map((x, i) => i).filter((i) => slots[i].yr === yr).sort((a, b) => order(a) - order(b));
    // Big cards for the long trips; mini trips are small thumbnails under them, only when there are some.
    const big = here.filter((i) => !T[i].mini); const mini = here.filter((i) => T[i].mini);
    const add = (m, l) => `<button type="button" class="pslnk" data-pstripnew="${yr || ''}.${m ? 'fall' : 'snow'}.${m}">+ ${l}</button>`;
    return `<section class="pstyear" data-psdrop="${yr || ''}."><div class="pstyh"><h2>${yr || 'Not placed yet'}</h2>${add(0, 'Trip')}${add(1, 'Mini trip')}</div>${big.length ? `<div class="pstrow">${big.map((i) => tripCard(T[i], i)).join('')}</div>` : mini.length ? '' : `<button type="button" class="pstadd" data-pstripnew="${yr || ''}.snow.0"><span>+</span>Trip</button>`}${mini.length ? `<div class="pstminis">${mini.map((i) => tripCard(T[i], i)).join('')}</div>` : ''}</section>`;
  };
  const years = []; for (let y = lo; y <= hi; y++) years.push(y);
  return years.map(row).join('') + row(null);
}
function tripsPage(S, sub, ui) {
  const T = tripsOf(S.personal); const n = sub[1] != null ? Number(sub[1]) : null; const t = n != null ? T[n] : null;
  const j = sub[2] != null ? Number(sub[2]) : null;
  if (t && j != null && t.stops[j]) return cityPage(t, n, j, ui) + (ui.psPop ? popHtml(ui.psPop, T) : '');
  let html;
  if (!t) {
    html = `<div class="pstrhead"><span class="mut">Drag a trip to another year, or tap its pill to move it. Locked trips stay put.</span><button type="button" class="btn primary" data-pstrip="new">+ Add trip</button></div>${tripYears(T)}`;
  } else {
    const [b, a] = tripBooked(t); const tv = ui.psTView || 'list'; const L = t.stops.length;
    const views = `<div class="psfilter" role="group" aria-label="View">${[['list', 'List'], ['cal', 'Calendar'], ['map', 'Map']].map(([k, l]) => `<button type="button" data-pstview="${k}" aria-pressed="${k === tv}">${l}</button>`).join('')}</div>`;
    html = `<section class="card pstrip" data-pstripat="${n}"><div class="psthead"><div class="psthrow"><h2>${esc(t.name)}</h2><span class="mut">${esc(tripDates(t))}</span><label class="pslnk"><input type="file" accept="image/*" hidden data-pstphoto>${t.img ? 'Change photo' : 'Trip photo'}</label><button type="button" class="pslnk" data-pstrip="edit">Edit</button></div>${tripBar(t)}<div class="pstvrow"><span class="mut">${esc(budLine(t))} · ${a ? `${b} of ${a} booked` : 'nothing to book yet'}</span>${L ? views : ''}</div>${L ? `<nav class="psstopnav" aria-label="Stops">${t.stops.map((s, j) => `<a href="#personal/trips/${n}/${j}"><span class="psnavph">${(() => { const src = placePhoto(s.place, s.img); return src ? `<img alt="" src="${esc(src)}">` : esc(String(s.place || '?').trim().charAt(0).toUpperCase()); })()}</span><b>${j + 1}</b>${esc(s.place || 'Stop')}</a>`).join('')}</nav>` : ''}</div>
${tv === 'cal' && L ? tripCal(t) : tv === 'map' && L ? mapBox(n, null, ui) : L ? `<div class="psstops">${t.stops.map((s, j) => `<div class="psstop${isHomeLeg(t, j) ? ' home' : ''}" data-psstop="${j}"><a class="psphl" href="#personal/trips/${n}/${j}" aria-label="Open ${esc(s.place)}">${photoHtml(s.place, s.img)}</a><div class="psstb"><div class="psst2h"><span class="psgrip" draggable="true" data-psgrip="${j}" title="Drag to move">⠿</span><span class="psstno">${j + 1}</span>${isHomeLeg(t, j) ? `<b>Back home</b><span class="mut">${esc(s.place)}${s.from ? ` · ${fmtD(s.from)}` : ''}</span>` : `<b>${esc(s.place)}</b>${s.ex ? '<span class="psex">example</span>' : ''}<span class="mut">${s.from ? fmtD(s.from) : '?'} – ${s.to ? fmtD(s.to) : '?'}${daysTxt(nDays(s.from, s.to))}</span>`}<span class="psstc"><button type="button" class="psmv" data-psmove="${j}.-1" aria-label="Move ${esc(s.place)} up"${j ? '' : ' disabled'}>↑</button><button type="button" class="psmv" data-psmove="${j}.1" aria-label="Move ${esc(s.place)} down"${j < L - 1 ? '' : ' disabled'}>↓</button><button type="button" class="pslnk" data-psedstop="${j}">Edit</button><button type="button" class="pslnk" data-psdelstop="${j}">Remove</button></span></div>
${s.notes || s.link ? `<div class="psnote">${s.notes ? `<p>${esc(s.notes)}</p>` : ''}${s.link ? `<a href="${esc(webLink(s.link))}" target="_blank" rel="noopener noreferrer">${esc(s.link.replace(/^https?:\/\//i, '').slice(0, 60))}</a>` : ''}</div>` : ''}
${bkRow(s, j, t)}
${isHomeLeg(t, j) ? '' : (() => { const ps = plansOf(t).filter((x) => inStop(s, x.d)); const ok = ps.filter((x) => x.ok).length; const want = s.want || []; const all = [...ps, ...want]; const pics = all.slice(0, 6);
  const txt = [ps.length ? `${ps.length} plan${ps.length === 1 ? '' : 's'}${ok ? ` · ${ok} booked` : ''}` : '', want.length ? `${want.length} to do` : ''].filter(Boolean).join(' · ') || 'No plans yet';
  return `<a class="pscityl" href="#personal/trips/${n}/${j}">${pics.length ? `<span class="pscthumbs">${pics.map((x) => `<i title="${esc(x.n || '')}">${x.img ? `<img alt="" loading="lazy" src="${esc(x.img)}">` : esc((x.n || '?').slice(0, 1).toUpperCase())}</i>`).join('')}${all.length > 6 ? `<i class="more">+${all.length - 6}</i>` : ''}</span>` : ''}<span>${txt}</span><b>Open ${esc(s.place)} ›</b></a>`; })()}</div></div>`).join('')}</div>`
  : '<p class="mut psstend">No stops yet. Add the first place you\'re going.</p>'}
<div class="psstend psrowend"><button type="button" class="btn" data-psaddstop="${n}">+ Add stop</button><a class="btn primary" href="#personal/trips">Done</a></div></section>`;
  }
  return html + (ui.psPop ? popHtml(ui.psPop, T) : '');
}
function planPop(p, t) {
  if (p.kind === 'build') return buildPop(p, t);
  const x = p.draft;
  const st = p.j != null ? t?.stops?.[p.j] : null;
  const ps = plansOf(t);
  const dayField = st && stopDays(st).length
    ? `<label>Day<select name="d"><option value=""${x.d ? '' : ' selected'}>Want to do (no day yet)</option>${stopDays(st).map((d) => { const c = ps.filter((y) => y.d === d).length; return `<option value="${d}"${x.d === d ? ' selected' : ''}>${DAYS[dow(d)]} ${fmtD(d)}${c ? ` · ${c} plan${c === 1 ? '' : 's'}` : ''}</option>`; }).join('')}</select></label>`
    : `<label>Day<input type="date" name="d" value="${esc(x.d || '')}"></label>`;
  const cityField = (t?.stops || []).length > 1 && p.j != null
    ? `<label>Staying in<select data-psplanj aria-label="Staying in">${t.stops.map((s, j) => `<option value="${j}"${j === p.j ? ' selected' : ''}>${esc(s.place || `Stop ${j + 1}`)}</option>`).join('')}</select></label>` : '';
  return `<div class="hmhost" data-psback><form class="hmed pspop" data-psform="plan"><div class="hmedh"><b class="hmedt">${p.at ? 'Edit plan' : `Add a plan${st ? ` in ${esc(st.place)}` : ` to ${esc(t?.name || 'the trip')}`}`}</b><button type="button" class="btn sm" data-psx aria-label="Close">✕</button></div>
<div class="pstfb">${p.at || p.more ? `<div class="psplimg">${x.img ? `<img alt="" src="${esc(x.img)}">` : '<span>No photo</span>'}<label class="btn sm"><input type="file" accept="image/*" hidden data-psplanimg>${p.busy ? 'Uploading…' : x.img ? 'Change photo' : 'Add photo'}</label>${x.img ? '<button type="button" class="pslnk" data-psplanimgx>Remove photo</button>' : ''}</div>
` : ''}<div class="pstf2"><label>What<input name="n" autocomplete="off" autocapitalize="words" value="${esc(x.n || '')}" placeholder="Sintra, pastéis, fado night"></label><label>Category<select name="cat"><option value="">Pick one</option>${CATS.map((c) => `<option${x.cat === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label></div>
${cityField}
${dayField}
${p.at || p.more ? `<div class="pstf2"><label>Cost $<input type="number" min="0" step="5" name="cost" value="${esc(x.cost ?? '')}" placeholder="0"></label>
<label>Link<input name="link" inputmode="url" value="${esc(x.link || '')}" placeholder="getyourguide.com/..."></label></div>
<label>Notes<textarea name="notes" rows="2" placeholder="Times, tickets, who's coming">${esc(x.notes || '')}</textarea></label>
<label class="psedok"><input type="checkbox" name="ok"${x.ok ? ' checked' : ''}> Booked</label>` : '<button type="button" class="pslnk psmore" data-psmore>+ More details (photo, cost, link, notes)</button>'}</div>
<div class="hmedf"><span class="psbad">${esc(p.err || '')}</span>${p.at ? '<button type="button" class="btn" data-psplanrm>Remove</button>' : ''}<button type="button" class="btn" data-psx style="margin-left:auto">Cancel</button><button class="btn primary">${p.at ? 'Save' : 'Add plan'}</button></div></form></div>`;
}
// Build my days: what the map found, one day per area; each place can be moved before it is saved.
function buildPop(p, t) {
  const st = t?.stops?.[p.j]; const want = st?.want || [];
  const opts = (w) => `<select data-psbuildmv="${w}" aria-label="Day for ${esc(want[w]?.n || 'place')}">${stopDays(st).map((d) => `<option value="${d}"${p.groups.some((g) => g.d === d && g.ws.includes(w)) ? ' selected' : ''}>${DAYS[dow(d)]} ${fmtD(d)}</option>`).join('')}<option value=""${p.left.includes(w) ? ' selected' : ''}>Want to do</option></select>`;
  const row = (w) => `<div class="psbrow">${planTile({ ...want[w], j: p.j, w }, 'psplt')}<span>${esc(want[w]?.n || 'Untitled')}${want[w]?.cat ? ` <small class="mut">${esc(want[w].cat)}</small>` : ''}</span>${opts(w)}</div>`;
  const body = p.busy ? `<p class="mut">${esc(p.busy)}</p>`
    : `${p.groups.filter((g) => g.ws.length).map((g) => `<div class="psbday"><b>${DAYS[dow(g.d)]} ${fmtD(g.d)}</b>${g.ws.map(row).join('')}</div>`).join('') || '<p class="mut">No days to fill.</p>'}${p.left.length ? `<div class="psbday"><b>Stays on Want to do</b>${p.left.map(row).join('')}</div>` : ''}${p.note ? `<p class="mut">${esc(p.note)}</p>` : ''}`;
  return `<div class="hmhost" data-psback><div class="hmed pspop psbuild"><div class="hmedh"><b class="hmedt">Build my days in ${esc(st?.place || '')}</b><button type="button" class="btn sm" data-psx aria-label="Close">✕</button></div>
<div class="pstfb">${body}</div><div class="hmedf"><span class="psbad">${esc(p.err || '')}</span><button type="button" class="btn" data-psx style="margin-left:auto">Cancel</button><button type="button" class="btn primary" data-psbuildok${p.busy ? ' disabled' : ''}>Put them on the days</button></div></div></div>`;
}
function popHtml(p, T) {
  const t = T[p.i];
  if (p.kind === 'place') {
    const [lo, hi] = tripYearRange(T); const yrs = []; for (let y = lo; y <= hi; y++) yrs.push(y);
    const pill = (k, v, l, on) => `<button type="button" class="psmvpill${on ? ' on' : ''}" data-psplace="${k}:${v}" aria-pressed="${on}">${l}</button>`;
    return `<div class="hmhost" data-psback><div class="hmed pspop psmovepop"><div class="hmedh"><b class="hmedt">Move ${esc(t?.name || 'trip')}</b><button type="button" class="btn sm" data-psx aria-label="Close">✕</button></div>
<div class="pstfb"><small class="mut">Year</small><div class="psmvrow">${yrs.map((y) => pill('yr', y, y, p.draft.yr === y)).join('')}${pill('yr', '', 'Not placed', !p.draft.yr)}</div>
<small class="mut">Season</small><div class="psmvrow">${SEAS.map(([k, l]) => pill('sea', k, l, p.draft.sea === k)).join('')}</div></div>
<div class="hmedf"><button type="button" class="btn primary" data-psx style="margin-left:auto">Done</button></div></div></div>`;
  }
  if (p.kind === 'plan' || p.kind === 'build') return planPop(p, t);
  if (p.kind === 'bk') return bkPop(p, t);
  const s = p.kind === 'stop' ? p.draft || (p.j != null ? t?.stops?.[p.j] : null) || { place: '', from: '', to: '', notes: '', link: '', items: items3() } : null;
  const ed = p.kind === 'stop' && p.j != null;
  const body = s
    ? `<label>Where<input name="place" value="${esc(s.place)}" placeholder="Lisbon"></label><div class="pstf2"><label>Arrive<input type="date" name="from" value="${esc(s.from)}"></label><label>Leave<input type="date" name="to" value="${esc(s.to)}"></label></div>
<label>Notes<textarea name="notes" rows="3" placeholder="Address, check-in time, who's coming">${esc(s.notes || '')}</textarea></label><label>Link<input name="link" inputmode="url" value="${esc(s.link || '')}" placeholder="booking.com/..."></label>
<div class="psedbk">${(s.items || []).map((x, k) => `<div class="psedr"><select name="k${k}" aria-label="Booking ${k + 1}">${[...new Set([...MODES, 'Accommodation', 'Car', bkName(x.k)])].map((o) => `<option${bkName(x.k) === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select><span class="pscost">$<input type="number" min="0" step="10" name="c${k}" value="${esc(x.cost)}" placeholder="cost" aria-label="${esc(x.k)} cost"></span><label class="psedok"><input type="checkbox" name="o${k}"${x.ok ? ' checked' : ''}> Booked</label></div>`).join('')}</div>`
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
const draftOf = (m, i) => ({ i, n: m.n, r: m.r, on: [...(m.on || [])], src: m.src, imgs: [...(m.imgs || [])], view: m.r.trim() ? 'split' : 'full', sel: [], meth: '', prep: '', ing: [], note: '', err: '' });
// Splits the draft's recipe into its parts for the formatted view (and names the meal from its first line).
function toSplit(d) {
  const p = splitR(d.r);
  if (!p.head && p.ing.length && !BULLET.test(p.ing[1] || '') && !/\d/.test(p.ing[0]) && p.ing[0].length < 60) p.head = p.ing.shift();
  if (!d.n.trim() && p.head) d.n = p.head.split('\n')[0].replace(/\s*\(.*\)\s*$/, '').slice(0, 80);
  Object.assign(d, { view: 'split', head: p.head, ing: p.ing, prep: p.prep, meth: p.meth, sel: [] });
}
const compose = (d) => (d.ing.length || d.meth.trim() || (d.prep || '').trim() || d.head ? `${d.head ? `${d.head}\n\n` : ''}Ingredients\n${d.ing.join('\n')}\n\n${(d.prep || '').trim() ? `Prep\n${d.prep.trim()}\n\n` : ''}Method\n${d.meth.trim()}` : '');
async function saveMeal(S, send, render, reload, close) {
  const d = S.ui.psMeal;
  const meals = mealsOf(S.personal);
  const keep = new Set(parseIng(splitR(d.r).ing).map((x) => x.key));
  meals[d.i] = { ...meals[d.i], ...(d.dw != null && d.n.trim() && !mealDays(meals).includes(d.dw) ? { dw: d.dw } : {}), n: d.n.trim(), r: d.r.trim(), on: d.on.filter((k) => keep.has(k)), src: d.src || (d.r.trim() ? (d.imgs.length ? 'photo' : 'typed') : ''), imgs: d.imgs };
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
  if (f === 'meth' || f === 'prep') { d[f] = e.target.value; d.r = compose(d); } else d[f] = e.target.value;
  return true;
}

export function personalPaste(e, ui, render) {
  if (e.target.id !== 'psText' || !ui.psMeal) return;
  setTimeout(() => { const d = ui.psMeal; if (!d) return; d.r = e.target.value; if (d.r.trim()) { toSplit(d); render(); } }, 0);
}

export function personalClick(e, S, render, send, reload, sendHome) {
  const ui = S.ui; const t = e.target;
  if (t.closest('[data-psx]') || (t.matches?.('[data-psback]'))) { ui.psMeal = null; ui.psPop = null; render(); return true; }
  const ma = t.closest('[data-psmadd]');
  if (ma) { const ms = mealsOf(S.personal); const dd = mealDays(ms); const i = ms.findIndex((x, k) => !x.n && dd[k] == null); if (i < 0) return true; const d = draftOf(ms[i], i); d.dw = Number(ma.dataset.psmadd); ui.psMeal = d; render(); return true; }
  const m = t.closest('[data-psmeal]');
  if (m) { const i = Number(m.dataset.psmeal); const d = draftOf(mealsOf(S.personal)[i], i); if (d.view === 'split') toSplit(d); ui.psMeal = d; render(); return true; }
  const d = ui.psMeal;
  if (d && t.closest('[data-psview]')) { if (d.view === 'split') d.view = 'full'; else if (d.r.trim()) toSplit(d); render(); return true; }
  if (d && t.closest('[data-psoff]')) { const k = t.closest('[data-psoff]').dataset.psoff; d.on = d.on.filter((x) => x !== k); saveMeal(S, send, render, reload, false); return true; }
  if (d && t.closest('[data-psaddall]')) { parseIng(d.ing).forEach((x) => { if (!x.pantry && !d.on.includes(x.key)) d.on.push(x.key); }); d.sel = []; saveMeal(S, send, render, reload, false); return true; }
  if (d && t.closest('[data-psaddsel]')) { d.sel.forEach((k) => { if (!d.on.includes(k)) d.on.push(k); }); d.sel = []; saveMeal(S, send, render, reload, false); return true; }
  const grm = t.closest('[data-psgrm]');
  if (grm) {
    const meals = mealsOf(S.personal); shopOf(meals, grm.dataset.psgl === 'mon').forEach((i) => { meals[i].on = meals[i].on.filter((k) => k !== grm.dataset.psgrm); });
    save(S, 'meals', { list: meals }, send, render, reload); return true;
  }
  const fl = t.closest('[data-psfilter]');
  if (fl) { const [kind, f] = fl.dataset.psfilter.split('.'); ui.exF = { ...(ui.exF || {}), [kind]: f }; render(); return true; }
  const exh = t.closest('[data-psexh]');
  if (exh) { const k = exh.dataset.psexh; ui.exShut = { ...(ui.exShut || {}), [k]: !ui.exShut?.[k] }; render(); return true; }
  const day = t.closest('[data-psday]');
  if (day) { workoutDays(S, Number(day.dataset.psday), sendHome); return true; }
  const lk = t.closest('[data-pslock]');
  if (lk) {
    e.preventDefault(); e.stopPropagation();
    const T = structuredClone(tripsOf(S.personal)); const x = T[Number(lk.dataset.pslock)]; if (!x) return true;
    x.lock = !x.lock; if (x.lock && !x.sea) Object.assign(x, tripSlot(x)); // locking pins it where it shows now
    save(S, 'trips', T, send, render, reload); return true;
  }
  const sp = t.closest('[data-psseason]');
  if (sp) {
    e.preventDefault(); e.stopPropagation();
    const i = Number(sp.dataset.psseason); const x = tripsOf(S.personal)[i]; if (!x || x.lock) return true;
    ui.psPop = { kind: 'place', i, draft: tripSlot(x) }; render(); return true;
  }
  const pl = t.closest('[data-psplace]');
  if (pl && ui.psPop?.kind === 'place') {
    const [k, v] = pl.dataset.psplace.split(':'); const p = ui.psPop;
    if (k === 'yr') p.draft.yr = Number(v) || null; else p.draft.sea = v;
    const T = structuredClone(tripsOf(S.personal));
    if (placeTrip(T, p.i, p.draft.yr, p.draft.sea)) save(S, 'trips', T, send, render, reload); else render();
    return true;
  }
  const tn = t.closest('[data-pstripnew]');
  if (tn) { const [yr, sea, mini] = tn.dataset.pstripnew.split('.'); ui.psPop = { kind: 'new', i: 0, slot: { yr: Number(yr) || null, sea, mini: mini === '1' ? 1 : 0 } }; render(); main(t)?.querySelector('.pspop input')?.focus(); return true; }
  const tr = t.closest('[data-pstrip]');
  if (tr) { ui.psPop = { kind: tr.dataset.pstrip, i: Number((location.hash.split('/')[2]) ?? 0) }; render(); main(t)?.querySelector('.pspop input')?.focus(); return true; }
  const as = t.closest('[data-psaddstop]');
  if (as) { ui.psPop = { kind: 'stop', i: Number(as.dataset.psaddstop) }; render(); main(t)?.querySelector('.pspop input')?.focus(); return true; }
  const ap = t.closest('[data-psaddplan]');
  if (ap) {
    const d = ap.dataset.psaddplan || ''; const tr = tripsOf(S.personal)[tripN()];
    let j = ap.dataset.psj != null ? Number(ap.dataset.psj) : (tr?.stops || []).findIndex((x) => d && inStop(x, d));
    if (!(j >= 0)) j = null;
    const day = d;
    ui.psPop = { kind: 'plan', i: tripN(), j, draft: { n: '', d: day, cat: '', img: '', link: '', cost: '', ok: false, notes: '' } }; render(); main(t)?.querySelector('.pspop input[name="n"]')?.focus(); return true;
  }
  const dp = t.closest('[data-psdpick]');
  if (dp && ui.psPop?.kind === 'plan') { keepPlanForm(t, ui.psPop); ui.psPop.draft.d = dp.dataset.psdpick; render(); return true; }
  const wr = t.closest('[data-pswantrm]');
  if (wr) {
    const [j, w] = wr.dataset.pswantrm.split('.').map(Number); const T = structuredClone(tripsOf(S.personal));
    if (dropWant(T, tripN(), j, w)) save(S, 'trips', T, send, render, reload);
    return true;
  }
  const we = t.closest('[data-pswantedit]');
  if (we) {
    const [j, w] = we.dataset.pswantedit.split('.').map(Number); const x = tripsOf(S.personal)[tripN()]?.stops?.[j]?.want?.[w];
    if (ui.psPop?.kind === 'build') return true;
    if (x) { ui.psPop = { kind: 'plan', i: tripN(), j, at: { j, w }, draft: { ...x, d: '' } }; render(); }
    return true;
  }
  const bd = t.closest('[data-psbuild]');
  if (bd) { buildDays(S, Number(bd.dataset.psbuild), send, render, reload); return true; }
  if (t.closest('[data-psbuildok]') && ui.psPop?.kind === 'build' && !ui.psPop.busy) {
    const p = ui.psPop; const T = structuredClone(tripsOf(S.personal)); const st = T[p.i]?.stops?.[p.j];
    if (!st?.want) { ui.psPop = null; render(); return true; }
    const moves = p.groups.flatMap((g) => g.ws.map((w) => [w, g.d]));
    T[p.i].plans = T[p.i].plans || {};
    for (const [w, d] of moves) { const x = st.want[w]; if (x) (T[p.i].plans[d] = T[p.i].plans[d] || []).push(x); }
    const gone = new Set(moves.map(([w]) => w)); st.want = st.want.filter((_, w) => !gone.has(w));
    ui.psPop = null; save(S, 'trips', T, send, render, reload); return true;
  }
  const pe = t.closest('[data-psplanedit]');
  if (pe) {
    const [d, k] = pe.dataset.psplanedit.split('.'); const x = tripsOf(S.personal)[tripN()]?.plans?.[d]?.[Number(k)];
    if (ui.psPop?.kind === 'build') return true;
    const tr = tripsOf(S.personal)[tripN()]; const j = (tr?.stops || []).findIndex((y) => inStop(y, d));
    if (x) { ui.psPop = { kind: 'plan', i: tripN(), j: j >= 0 ? j : null, at: { d, k: Number(k) }, draft: { ...x, d } }; render(); }
    return true;
  }
  if (t.closest('[data-psplanrm]') && ui.psPop?.kind === 'plan' && ui.psPop.at) {
    const T = structuredClone(tripsOf(S.personal)); const at = ui.psPop.at;
    if (at.w != null ? dropWant(T, ui.psPop.i, at.j, at.w) : dropPlan(T, ui.psPop.i, at.d, at.k)) { ui.psPop = null; save(S, 'trips', T, send, render, reload); } else { ui.psPop.err = 'That plan is already gone.'; render(); }
    return true;
  }
  if (t.closest('[data-psplanimgx]') && ui.psPop?.kind === 'plan') { keepPlanForm(t, ui.psPop); ui.psPop.draft.img = ''; render(); return true; }
  const ds = t.closest('[data-psdelstop]');
  if (ds) { const T = structuredClone(tripsOf(S.personal)); const n = Number(location.hash.split('/')[2]); T[n].stops.splice(Number(ds.dataset.psdelstop), 1); save(S, 'trips', T, send, render, reload); return true; }
  const es = t.closest('[data-psedstop]');
  if (es) { const j = Number(es.dataset.psedstop); ui.psPop = { kind: 'stop', i: tripN(), j, was: tripsOf(S.personal)[tripN()]?.stops?.[j]?.place }; render(); main(t)?.querySelector('.pspop input')?.focus(); return true; }
  const mv = t.closest('[data-psmove]');
  if (mv) { const [j, d] = mv.dataset.psmove.split('.').map(Number); reorder(S, j, j + d, send, render, reload); return true; }
  const cv = t.closest('[data-pscview]');
  if (cv) { ui.psCView = cv.dataset.pscview; render(); return true; }
  const bd2 = t.closest('[data-psbkdet]');
  if (bd2) {
    const [j, k] = bd2.dataset.psbkdet.split('.').map(Number); const it = tripsOf(S.personal)[tripN()]?.stops?.[j]?.items?.[k]; if (!it) return true;
    const det = { ...(it.det || {}) };
    if (bkKind(it.k) === 'go' && !det.from && !det.to) Object.assign(det, legOf(tripsOf(S.personal)[tripN()], j));
    ui.psPop = { kind: 'bk', i: tripN(), j, k, was: it.k, draft: { k: it.k, det, docs: [...(it.docs || [])], cost: it.cost, ok: !!it.ok } };
    render(); main(t)?.querySelector('.psbkpop .psbkf input')?.focus(); return true;
  }
  const bm = t.closest('[data-psbkmode]');
  if (bm && ui.psPop?.kind === 'bk') { keepBk(t, ui.psPop); ui.psPop.draft.k = bm.dataset.psbkmode; render(); return true; }
  const bx = t.closest('[data-psbkdocx]');
  if (bx && ui.psPop?.kind === 'bk') { keepBk(t, ui.psPop); ui.psPop.draft.docs.splice(Number(bx.dataset.psbkdocx), 1); render(); return true; }
  if (t.closest('[data-psmore]') && (ui.psPop?.kind === 'bk' || ui.psPop?.kind === 'plan')) { if (ui.psPop.kind === 'bk') keepBk(t, ui.psPop); else keepPlanForm(t, ui.psPop); ui.psPop.more = true; render(); return true; }
  const tv = t.closest('[data-pstview]');
  if (tv) { ui.psTView = tv.dataset.pstview; render(); return true; }
  return false;
}
const main = (el) => el.closest?.('#main') || document.getElementById('main');
// Keep what Jon has typed in the plan form before the pop-up is drawn again (after a photo upload, say).
function keepPlanForm(el, p) {
  const form = el.closest?.('form'); if (!form) return;
  const v = Object.fromEntries(new FormData(form).entries());
  p.draft = { ...p.draft, n: v.n ?? p.draft.n, d: v.d ?? p.draft.d, cat: v.cat ?? p.draft.cat, cost: v.cost ?? p.draft.cost, link: v.link ?? p.draft.link, notes: v.notes ?? p.draft.notes, ok: v.ok != null };
}
const tripN = () => Number(location.hash.split('/')[2]);
// Build my days: find each want-to-do place on OpenStreetMap (once; the spot is saved on the place), then group the
// places that are near each other onto the city's free days and show the plan before anything moves.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Find one thing on the map. A plan or want-to-do place asks Wikipedia first (it copes with spellings like "obido"
// and brings a photo), then OpenStreetMap; a stop or an address asks OpenStreetMap first. A match more than 700 km
// from the city is wrong (Braga is 330 km from Estoril, so 700). Nothing found marks it, so it isn't asked again until its name changes.
// One Wikipedia search per place (it copes with "obido" and "coa valley"): the right spelling, a photo, the spot
// and a category, each only when it's missing. Marked so it's asked once.
async function wikiFix(x, s, country) {
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1&gsrsearch=${encodeURIComponent(`${x.n} ${country || ''}`.trim())}&prop=coordinates%7Cpageimages%7Cdescription&piprop=thumbnail&pithumbsize=800`);
    const pg = r.ok ? Object.values((await r.json())?.query?.pages || {})[0] : null;
    if (pg) {
      const c = pg.coordinates?.[0]; const close = c && (!Number.isFinite(s?.lat) || km(s, c) < 700);
      const nm = fixName(x.n, pg.title); if (nm && (close || !c)) x.n = nm;
      if (close && !Number.isFinite(x.lat)) { x.lat = c.lat; x.lon = c.lon; delete x.nomap; }
      if (!x.img && pg.thumbnail?.source && (close || nm)) x.img = pg.thumbnail.source;
      if (!x.cat) x.cat = guessCat(`${x.n} ${pg.title} ${pg.description || ''}`, Number.isFinite(x.lat) && Number.isFinite(s?.lat) && km(s, x) > 25);
    } else if (!x.cat) x.cat = guessCat(x.n, false);
  } catch { /* try again next time */ return; }
  x.wv = 1;
  await sleep(150);
}
async function lookUp(o, { q, wq, near, photo }) {
  const okAt = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && (!near || !Number.isFinite(near.lat) || km(near, { lat, lon }) < 700);
  const osm = async () => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=en&q=${encodeURIComponent(q)}`);
      const b = r.ok ? await r.json() : []; const lat = Number(b[0]?.lat); const lon = Number(b[0]?.lon);
      if (okAt(lat, lon)) { o.lat = lat; o.lon = lon; }
    } catch { /* not found */ }
    await sleep(1100); // OpenStreetMap asks for one search a second at most
  };
  const wiki = async () => {
    try {
      const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1&gsrsearch=${encodeURIComponent(wq)}&prop=coordinates%7Cpageimages&piprop=thumbnail&pithumbsize=800`);
      const pg = r.ok ? Object.values((await r.json())?.query?.pages || {})[0] : null; const c = pg?.coordinates?.[0];
      if (c && okAt(c.lat, c.lon)) { o.lat = c.lat; o.lon = c.lon; if (photo && !o.img && pg.thumbnail?.source) o.img = pg.thumbnail.source; }
    } catch { /* not found */ }
  };
  if (wq) { await wiki(); if (!Number.isFinite(o.lat) && q) await osm(); } else await osm();
  if (!Number.isFinite(o.lat)) o.nomap = 1;
}
async function buildDays(S, j, send, render, reload) {
  const ui = S.ui; const n = tripN();
  const T = structuredClone(tripsOf(S.personal)); const t = T[n]; const st = t?.stops?.[j]; if (!st?.want?.length) return;
  const p = { kind: 'build', i: n, j, groups: [], left: [], busy: 'Finding the places on the map…', note: '' };
  ui.psPop = p; render();
  if (!Number.isFinite(st.lat)) await lookUp(st, { q: [st.place, t.name].filter(Boolean).join(', ') });
  const todo = st.want.filter((x) => !Number.isFinite(x.lat) && x.n);
  for (const [c, x] of todo.entries()) {
    if (ui.psPop !== p) return;
    p.busy = `Finding the places on the map… ${c + 1} of ${todo.length}`; render();
    await lookUp(x, { q: [x.n, st.place, t.name].filter(Boolean).join(', '), wq: `${x.n} ${t.name}`, near: st, photo: true });
  }
  if (ui.psPop !== p) return;
  await save(S, 'trips', structuredClone(T), send, () => {}, reload);
  const ps = plansOf(t);
  const free = stopDays(st).filter((d) => !ps.some((x) => x.d === d));
  const days = free.length ? free : stopDays(st);
  const g = groupNear(st.want.map((x, w) => ({ w, lat: x.lat, lon: x.lon, cat: x.cat })), days, st);
  p.groups = g.days; p.left = g.left; p.busy = '';
  const noMap = st.want.filter((x) => !Number.isFinite(x.lat)).length;
  p.note = [free.length ? '' : 'Every day already has a plan, so these go on top of them.', noMap ? `${noMap} place${noMap === 1 ? '' : 's'} could not be found on the map and stay on Want to do.` : ''].filter(Boolean).join(' ');
  render();
}
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
  // City page: drag a want-to-do or a plan onto a calendar day, or back onto Want to do.
  let plan = null;
  const unday = () => root.querySelectorAll('[data-psdropday].over, [data-psdragp].drag').forEach((x) => x.classList.remove('over', 'drag'));
  root.addEventListener('dragstart', (e) => {
    const c = on() && e.target.closest?.('[data-psdragp]'); if (!c) return;
    plan = c.dataset.psdragp; S.ui.psDrag = true; c.classList.add('drag');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', plan);
  });
  root.addEventListener('dragover', (e) => {
    const z = plan != null && e.target.closest?.('[data-psdropday]'); if (!z) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('[data-psdropday].over').forEach((x) => { if (x !== z) x.classList.remove('over'); }); z.classList.add('over');
  });
  const dropOn = (src, z) => {
    const T = structuredClone(tripsOf(S.personal)); const n = Number(location.hash.split('/')[2]); const j = Number(location.hash.split('/')[3]);
    const [kind, a, b] = src.split('.'); const at = kind === 'w' ? { j: Number(a), w: Number(b) } : { d: a, k: Number(b) };
    const x = kind === 'w' ? T[n]?.stops?.[at.j]?.want?.[at.w] : T[n]?.plans?.[at.d]?.[at.k]; if (!x) return;
    const d = z.dataset.psdropday || '';
    if ((kind === 'd' && d === at.d) || (kind === 'w' && !d)) return;
    if (!savePlan(T, n, { ...x, d, ok: x.ok ? true : null }, at, j)) save(S, 'trips', T, send, render, reload);
  };
  root.addEventListener('drop', (e) => {
    const z = plan != null && e.target.closest?.('[data-psdropday]'); if (!z) return;
    e.preventDefault(); const src = plan; plan = null; S.ui.psDrag = false; unday(); dropOn(src, z);
  });
  root.addEventListener('dragend', () => { plan = null; S.ui.psDrag = false; unday(); });
  // Meals: drag a meal onto another day of the week.
  let meal = null;
  const unmeal = () => root.querySelectorAll('[data-psmday].over, [data-psmdrag].drag').forEach((x) => x.classList.remove('over', 'drag'));
  const mealOn = (from, z) => { const meals = mealsOf(S.personal); if (moveMeal(meals, Number(from), z.dataset.psmday === '' ? null : Number(z.dataset.psmday))) save(S, 'meals', { list: meals }, send, render, reload); };
  root.addEventListener('dragstart', (e) => {
    const c = on() && e.target.closest?.('[data-psmdrag]'); if (!c) return;
    meal = c.dataset.psmdrag; S.ui.psDrag = true; c.classList.add('drag');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', meal);
  });
  root.addEventListener('dragover', (e) => {
    const z = meal != null && e.target.closest?.('[data-psmday]'); if (!z) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('[data-psmday].over').forEach((x) => { if (x !== z) x.classList.remove('over'); }); z.classList.add('over');
  });
  root.addEventListener('drop', (e) => {
    const z = meal != null && e.target.closest?.('[data-psmday]'); if (!z) return;
    e.preventDefault(); const f = meal; meal = null; S.ui.psDrag = false; unmeal(); mealOn(f, z);
  });
  root.addEventListener('dragend', () => { meal = null; S.ui.psDrag = false; unmeal(); });
  // Phones have no drag and drop: press and hold a tile, then slide it onto a day (the page scrolls near the edges).
  let tt = null;
  const tEnd = () => { if (!tt) return; clearTimeout(tt.timer); cancelAnimationFrame(tt.raf); tt.ghost?.remove(); unday(); unmeal(); S.ui.psDrag = false; tt = null; };
  root.addEventListener('touchstart', (e) => {
    const c = on() && e.target.closest?.('[data-psdragp], [data-psmdrag]'); if (!c || e.touches.length > 1) return;
    const p0 = e.touches[0];
    tt = { c, x: p0.clientX, y: p0.clientY, live: false, z: null };
    tt.timer = setTimeout(() => {
      if (!tt) return;
      tt.live = true; S.ui.psDrag = true; c.classList.add('drag'); navigator.vibrate?.(15);
      const r = c.getBoundingClientRect(); const g = c.cloneNode(true);
      g.className += ' psghost'; Object.assign(g.style, { width: `${r.width}px`, height: `${r.height}px` });
      tt.ox = tt.x - r.left; tt.oy = tt.y - r.top; tt.ghost = g; (c.closest('.d3') || document.body).appendChild(g); move();
      const edge = () => { if (!tt?.live) return; const h = innerHeight; if (tt.y < 70) scrollBy(0, -12); else if (tt.y > h - 70) scrollBy(0, 12); pick(); tt.raf = requestAnimationFrame(edge); };
      tt.raf = requestAnimationFrame(edge);
    }, 280);
  }, { passive: true });
  const move = () => { if (tt?.ghost) tt.ghost.style.transform = `translate(${tt.x - tt.ox}px, ${tt.y - tt.oy}px)`; };
  const pick = () => {
    const el = document.elementFromPoint(tt.x, tt.y); const z = el?.closest?.(tt.c.dataset.psmdrag != null ? '[data-psmday]' : '[data-psdropday]') || null;
    if (z !== tt.z) { tt.z?.classList.remove('over'); z?.classList.add('over'); tt.z = z; }
  };
  root.addEventListener('touchmove', (e) => {
    if (!tt) return; const p0 = e.touches[0];
    if (!tt.live) { if (Math.hypot(p0.clientX - tt.x, p0.clientY - tt.y) > 10) tEnd(); return; } // a scroll, not a drag
    e.preventDefault(); tt.x = p0.clientX; tt.y = p0.clientY; move(); pick();
  }, { passive: false });
  root.addEventListener('touchend', (e) => {
    if (!tt) return; const { live, z, c } = tt;
    if (live) { e.preventDefault(); const src = c.dataset.psdragp; const ml = c.dataset.psmdrag; tEnd(); if (z && ml != null) mealOn(ml, z); else if (z) dropOn(src, z); } else tEnd();
  });
  root.addEventListener('touchcancel', tEnd);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest?.('[data-psdragp], [data-psmdrag]')) e.preventDefault(); });
  let card = null;
  const unmark = () => root.querySelectorAll('.pstsea.over, [data-pstcard].drag').forEach((x) => x.classList.remove('over', 'drag'));
  root.addEventListener('dragstart', (e) => {
    const c = on() && e.target.closest?.('[data-pstcard]'); if (!c || c.getAttribute('draggable') !== 'true') return;
    card = Number(c.dataset.pstcard); S.ui.psDrag = true; c.classList.add('drag');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(card));
  });
  root.addEventListener('dragover', (e) => {
    const z = card != null && e.target.closest?.('[data-psdrop]'); if (!z) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('.pstyear.over').forEach((x) => { if (x !== z) x.classList.remove('over'); }); z.classList.add('over');
  });
  root.addEventListener('drop', (e) => {
    const z = card != null && e.target.closest?.('[data-psdrop]'); if (!z) return;
    e.preventDefault(); const i = card; card = null; S.ui.psDrag = false; unmark();
    const [yr, sea] = z.dataset.psdrop.split('.'); const T = structuredClone(tripsOf(S.personal));
    if (placeTrip(T, i, Number(yr) || null, sea)) save(S, 'trips', T, send, render, reload);
  });
  root.addEventListener('dragend', () => { card = null; S.ui.psDrag = false; unmark(); });
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
  if (t.matches('[data-psbkatt]')) {
    const files = [...(t.files || [])]; if (!files.length) return;
    const key = t.dataset.psbkatt; const [j, k] = key.split('.').map(Number); const n = tripN();
    attBusy = key; ui.psErr = ''; render();
    const got = [];
    for (const file of files) {
      try {
        const res = await fetch('/dashboard/api/personal/photo?read=0', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-CC': '1' }, body: file });
        const b = await res.json().catch(() => null);
        if (!res.ok || !b?.ok || !b.url) ui.psErr = `Could not attach ${file.name} (${b?.error || res.status}).`; else got.push({ n: (file.name || 'File').slice(0, 120), url: b.url });
      } catch (err) { ui.psErr = `Could not attach ${file.name} (${err.message}).`; }
    }
    attBusy = '';
    const T = structuredClone(tripsOf(S.personal)); const it = T[n]?.stops?.[j]?.items?.[k];
    if (it && got.length) { it.docs = [...(it.docs || []), ...got].slice(0, 20); await save(S, 'trips', T, send, render, reload); } else render();
    return;
  }
  if (t.matches('[data-psbkdoc]') && ui.psPop?.kind === 'bk') {
    const file = t.files?.[0]; if (!file) return;
    const p = ui.psPop; keepBk(t, p); p.busy = true; p.err = ''; render();
    try {
      const res = await fetch('/dashboard/api/personal/photo?read=0', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-CC': '1' }, body: file });
      const b = await res.json().catch(() => null);
      if (!res.ok || !b?.ok || !b.url) p.err = `Could not attach it (${b?.error || res.status}).`; else p.draft.docs.push({ n: file.name || 'File', url: b.url });
    } catch (err) { p.err = `Could not attach it (${err.message}).`; }
    p.busy = false; if (ui.psPop === p) render();
    return;
  }
  if (t.matches('[data-psbuildmv]') && ui.psPop?.kind === 'build') {
    const p = ui.psPop; const w = Number(t.dataset.psbuildmv); const d = t.value;
    p.groups.forEach((g) => { g.ws = g.ws.filter((x) => x !== w); }); p.left = p.left.filter((x) => x !== w);
    if (!d) p.left.push(w); else { let g = p.groups.find((x) => x.d === d); if (!g) { g = { d, ws: [] }; p.groups.push(g); p.groups.sort((a, b) => (a.d < b.d ? -1 : 1)); } g.ws.push(w); }
    render(); return;
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
  if (t.dataset.psbkk != null) {
    const T = structuredClone(tripsOf(S.personal)); const n = Number(location.hash.split('/')[2]); const [j, k] = t.dataset.psbkk.split('.').map(Number);
    const it = T[n]?.stops[j]?.items[k]; if (!it || !MODES.includes(t.value)) return;
    it.k = t.value; save(S, 'trips', T, send, render, reload); return;
  }
  if (t.matches('[data-psplanj]') && ui.psPop?.kind === 'plan') {
    keepPlanForm(t, ui.psPop); ui.psPop.j = Number(t.value); ui.psPop.draft.d = ''; render(); return;
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
    const err = savePlan(T, p.i, { ...p.draft, ok: p.draft.ok ? 'on' : null }, p.at || null, p.j ?? null);
    if (err) { p.err = err; render(); return true; }
    ui.psPop = null;
    await save(S, 'trips', T, send, render, reload);
    return true;
  }
  if (form.dataset.psform === 'bk' && ui.psPop?.kind === 'bk') {
    const p = ui.psPop; keepBk(form, p);
    const T = structuredClone(tripsOf(S.personal));
    const err = saveBk(T, p.i, p.j, p.k, p.was, p.draft);
    if (err) { p.err = err; render(); return true; }
    ui.psPop = null;
    await save(S, 'trips', T, send, render, reload);
    return true;
  }
  if (form.dataset.psform === 'quick') {
    const n = String(new FormData(form).get('n') || '').trim(); if (!n) return true;
    const T = structuredClone(tripsOf(S.personal));
    if (savePlan(T, tripN(), { n, d: '' }, null, Number(form.dataset.psj))) return true;
    S.ui.psQuick = Date.now(); // the page re-draws as it saves; personalAfter puts the cursor back in the box
    await save(S, 'trips', T, send, render, reload);
    document.querySelector('.psquick input')?.focus();
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
      else if (p.slot) { T.push({ name: name.slice(0, 80), bud: Math.max(0, Number(v.bud) || 0), stops: [], ...p.slot }); } // stays on the list, in its season
      else { T.push({ name: name.slice(0, 80), bud: Math.max(0, Number(v.bud) || 0), stops: [] }); location.hash = `#personal/trips/${T.length - 1}`; }
      ui.psPop = null;
    }
    await save(S, 'trips', T, send, render, reload);
    return true;
  }
  return false;
}
