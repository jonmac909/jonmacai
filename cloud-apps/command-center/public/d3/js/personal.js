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
const tripCost = (t) => t.stops.reduce((a, s) => a + s.items.reduce((b, x) => b + (Number(x.cost) || 0), 0), 0);
const tripBooked = (t) => { let n = 0; let all = 0; t.stops.forEach((s) => s.items.forEach((x) => { all++; if (x.ok) n++; })); return [n, all]; };
const tripDates = (t) => { const ds = t.stops.flatMap((s) => [s.from, s.to]).filter(Boolean).sort(); return ds.length ? `${fmtD(ds[0])} – ${fmtD(ds[ds.length - 1])}` : 'Dates not set'; };
const budLine = (t) => (t.bud ? `${usd0(tripCost(t))} of ${usd0(t.bud)} budget` : `${usd0(tripCost(t))} · no budget`);
const tripBar = (t) => (t.bud ? bar((tripCost(t) / t.bud) * 100, tripCost(t) > t.bud ? 'bad' : '') : '');
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
function tripsPage(S, sub, ui) {
  const T = tripsOf(S.personal); const n = sub[1] != null ? Number(sub[1]) : null; const t = n != null ? T[n] : null;
  let html;
  if (!t) {
    html = `<div class="pstrhead"><span></span><button type="button" class="btn primary" data-pstrip="new">+ Add trip</button></div>
<div class="psgrid">${T.map((x, i) => { const [b, a] = tripBooked(x); return `<div class="pscard pstcard"><a href="#personal/trips/${i}"><b>${esc(x.name)}</b><em>${esc(tripDates(x))} · ${x.stops.length} stop${x.stops.length === 1 ? '' : 's'}</em></a><div class="psfoot">${tripBar(x)}<span>${a ? `${b} of ${a} booked` : 'No stops yet'} · ${esc(budLine(x))}</span><button type="button" class="btn sm primary" data-psaddstop="${i}">+ Add stop</button></div></div>`; }).join('') || '<p class="mut">No trips yet.</p>'}</div>`;
  } else {
    const [b, a] = tripBooked(t);
    html = `<section class="card pstrip"><div class="psthead"><div class="psthrow"><h2>${esc(t.name)}</h2><span class="mut">${esc(tripDates(t))}</span><button type="button" class="pslnk" data-pstrip="edit">Edit</button></div>${tripBar(t)}<span class="mut">${esc(budLine(t))} · ${a ? `${b} of ${a} booked` : 'nothing to book yet'}</span></div>
${t.stops.length ? t.stops.map((s, j) => `<div class="psstop"><div class="psst2h"><b>${esc(s.place)}</b>${s.ex ? '<span class="psex">example</span>' : ''}<span class="mut">${s.from ? fmtD(s.from) : '?'} – ${s.to ? fmtD(s.to) : '?'}</span><button type="button" class="pslnk" data-psdelstop="${j}">Remove</button></div>
<div class="psbk3">${s.items.map((x, k) => `<div class="psbk${x.ok ? ' on' : ''}"><label><input type="checkbox" data-psbook="${j}.${k}"${x.ok ? ' checked' : ''}> ${x.k}${x.ok ? ' · booked' : ''}</label><span class="pscost">$<input type="number" min="0" step="10" data-pscost="${j}.${k}" value="${esc(x.cost)}" placeholder="cost" aria-label="${x.k} cost"></span></div>`).join('')}</div></div>`).join('')
  : '<p class="mut psstop">No stops yet. Add the first place you\'re going.</p>'}
<div class="psstop psrowend"><button type="button" class="btn" data-psaddstop="${n}">+ Add stop</button><a class="btn primary" href="#personal/trips">Done</a></div></section>`;
  }
  return html + (ui.psPop ? popHtml(ui.psPop, T) : '');
}
function popHtml(p, T) {
  const t = T[p.i];
  const body = p.kind === 'stop'
    ? '<label>Where<input name="place" placeholder="Lisbon"></label><div class="pstf2"><label>Arrive<input type="date" name="from"></label><label>Leave<input type="date" name="to"></label></div>'
    : `<label>Where<input name="name" value="${p.kind === 'edit' && t ? esc(t.name) : ''}" placeholder="Portugal"></label><label>Budget $<input type="number" min="0" step="100" name="bud" value="${p.kind === 'edit' && t?.bud ? t.bud : ''}" placeholder="5000"></label>`;
  const title = p.kind === 'stop' ? `Add a stop to ${t?.name || 'the trip'}` : p.kind === 'edit' ? 'Edit trip' : 'New trip';
  return `<div class="hmhost" data-psback><form class="hmed pspop" data-psform="pop"><div class="hmedh"><b class="hmedt">${esc(title)}</b><button type="button" class="btn sm" data-psx aria-label="Close">✕</button></div>
<div class="pstfb">${body}</div><div class="hmedf"><span class="psbad">${esc(p.err || '')}</span><button type="button" class="btn" data-psx style="margin-left:auto">Cancel</button><button class="btn primary">${p.kind === 'stop' ? 'Add stop' : p.kind === 'edit' ? 'Save' : 'Add trip'}</button></div></form></div>`;
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
  const head = `${mnavHtml('personal')}<header class="hd pshead">${crumbs(k ? [k] : [], extra)}</header>`;
  if (!S.personal) return `${head}<section class="card"><p class="mut">${S.personalErr ? esc(S.personalErr) : 'Loading'}</p></section>`;
  const body = k === 'meals' ? mealsPage(S, now, ui) : k === 'workouts' ? workoutsPage(S, now, ui) : k === 'date' ? datePage(S, now, ui)
    : k === 'trips' ? tripsPage(S, sub, ui) : k === 'home' ? homePage(S) : k === 'budget' ? `<div class="psexwrap">${expensesCard('personal', S.personal, ui, now.ymd)}</div>` : overview(S, now);
  return `${head}${body}`;
}

// ---- events ----
// Saves one stored key (optimistic: the page shows the change at once; a failed save says so and reloads).
async function save(S, key, value, send, render, reload) {
  S.personal.store = { ...S.personal.store, [key]: value };
  render();
  const r = await send('PUT', `/personal/${key}`, value);
  if (!r.ok) { S.ui.psErr = `Could not save (${r.error}).`; await reload(); }
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

export function personalPopOpen(ui) { return !!(ui.psMeal || ui.psPop); }

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
  const ds = t.closest('[data-psdelstop]');
  if (ds) { const T = structuredClone(tripsOf(S.personal)); const n = Number(location.hash.split('/')[2]); T[n].stops.splice(Number(ds.dataset.psdelstop), 1); save(S, 'trips', T, send, render, reload); return true; }
  return false;
}
const main = (el) => el.closest?.('#main') || document.getElementById('main');

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
  if (form.dataset.psform === 'pop' && ui.psPop) {
    const v = Object.fromEntries(new FormData(form).entries());
    const T = structuredClone(tripsOf(S.personal)); const p = ui.psPop;
    if (p.kind === 'stop') {
      const place = String(v.place || '').trim();
      if (!place) { p.err = 'Add the place'; render(); return true; }
      if (v.from && v.to && v.to < v.from) { p.err = 'Leave date is before arrive date'; render(); return true; }
      const t = T[p.i]; if (!t) return true;
      t.stops.push({ place: place.slice(0, 80), from: v.from || '', to: v.to || '', items: items3() });
      t.stops.sort((x, y) => (x.from || '9').localeCompare(y.from || '9'));
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
