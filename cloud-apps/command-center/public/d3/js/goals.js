// Dashboard 3 Goals page (docs/dashboard-3.md). A pure function from the /dashboard/api/d2 and /dashboard/api/d3
// answers to HTML, laid out as the approved design (Home.dc.html). Every number comes from those answers; a number
// with no source reads "No feed" (nothing reports it yet) or "No data" (the source had nothing), with a grey dot.
// Targets always come from the data, never from this file.
import { esc, usd, toneOf, dayShare, icon } from './util.js';

const PILL = { r: 'bad', y: 'warn', g: 'ok', n: '' };
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const one = (v) => (Array.isArray(v) ? v[0] : v) || null;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

// The period the page draws against, all from d2.period (Vancouver).
export function periodOf(d2resp) {
  const p = d2resp?.d2?.period || {};
  const ymd = p.today?.ymd || '';
  const [y, mo, d] = ymd.split('-').map(Number);
  const wd = num(p.today?.weekday) ? p.today.weekday : 0;
  const dim = p.month?.daysInMonth || 30;
  const mShort = MONTHS[(mo || 1) - 1];
  const share = dayShare(d2resp?.asOf);
  return {
    ymd, year: y, day: d || 0, monthShort: mShort, monthName: (p.month?.label || '').split(' ')[0], weekdayName: WEEKDAYS[wd], weekday: wd, daysInMonth: dim,
    weekT: clamp01((wd + share) / 7), monthT: clamp01(num(p.month?.elapsed) ? p.month.elapsed : ((d || 1) - 1 + share) / dim), share,
    wk: { x0: 'Mon', x1: 'Sun' }, mo: { x0: `${mShort} 1`, x1: `${mShort} ${dim}` },
  };
}

// ---- trend series: [[x 0..1, y share of target], ...], real points only ----
const scaleOf = (target, values) => (num(target) && target > 0 ? target : Math.max(1, ...values.filter(num)));

// A week count with per-day values: 0 at Monday, then the running total at the end of each past day and at "now" today.
function weekSeries(m, P) {
  const days = Array.isArray(m?.days) ? m.days : [];
  if (days.length) {
    const pts = [[0, 0]];
    let cum = 0;
    const vals = [];
    days.forEach((x, i) => {
      if (!num(x.actual) || x.ymd > P.ymd) return;
      cum += x.actual;
      vals.push(cum);
      pts.push([x.ymd === P.ymd ? P.weekT : (i + 1) / 7, cum]);
    });
    if (pts.length < 2) return null;
    const s = scaleOf(m.target, vals);
    return pts.map(([x, v]) => [x, v / s]);
  }
  if (!num(m?.actual)) return null;
  const s = scaleOf(m.target, [m.actual]);
  return [[0, 0], [P.weekT, m.actual / s]];
}

// Month money: d2's weekly amounts (goal.trend) added up, each point at the end of its week inside the month.
function monthTrendSeries(goal, m, P) {
  const tr = Array.isArray(goal?.trend) ? goal.trend : [];
  const first = `${P.ymd.slice(0, 7)}-01`;
  const pts = [[0, 0]];
  let cum = 0;
  const vals = [];
  for (const w of tr) {
    if (!num(w.actual)) continue;
    cum += w.actual;
    vals.push(cum);
    const endIdx = daysBetween(first, w.start) + 7; // days of the month done by the week's end
    pts.push([w.current ? P.monthT : clamp01(endIdx / P.daysInMonth), cum]);
  }
  if (pts.length < 2) return null;
  const s = scaleOf(m?.target, vals);
  return pts.map(([x, v]) => [Math.min(x, P.monthT), v / s]);
}

// Month events by day ({ ymd: count } or a list of days): a running total stepping on each day.
function monthEventSeries(perDay, P, target) {
  if (!perDay) return null;
  const counts = Array.isArray(perDay) ? perDay.reduce((o, d) => ({ ...o, [d]: (o[d] || 0) + 1 }), {}) : perDay;
  const pts = [[0, 0]];
  let cum = 0;
  for (const ymd of Object.keys(counts).sort()) {
    if (ymd > P.ymd) continue;
    const x = clamp01((Number(ymd.slice(8, 10)) - 1) / P.daysInMonth);
    pts.push([x, cum]);
    cum += counts[ymd];
    pts.push([x, cum]);
  }
  pts.push([P.monthT, cum]);
  const s = scaleOf(target, [cum]);
  return pts.map(([x, v]) => [x, v / s]);
}

// ---- one key-result row ----
function noFeed(id, text, more) {
  return { id, text, v1: 'No feed', v2: '', nf: true, tone: 'n', hint: '', span: null, series: null, target: '', more };
}

function kr(id, text, m, { span, series, money = false, hint, bar = true, target, more, log } = {}) {
  if (!m) return noFeed(id, text, 'Nothing reports this yet.');
  const has = num(m.actual) && m.display !== 'No data'; // e.g. charges with no questions this month
  const tone = has ? toneOf(m.status) : 'n';
  const fmt = (x) => (money ? usd(x) : String(Math.round(x * 10) / 10));
  const hasTarget = num(m.target) && m.target > 0;
  const src = m.source?.label ? ` Source: ${m.source.label}${m.source.ageLabel ? `, ${m.source.ageLabel}` : ''}.` : '';
  return {
    id, text, tone,
    v1: has ? (money ? usd(m.actual) : m.display && /%$/.test(m.display) ? m.display : fmt(m.actual)) : (m.display && m.display !== 'No data' ? m.display : 'No data'),
    v2: has && hasTarget ? ` / ${fmt(m.target)}` : '',
    nf: !has,
    hasBar: bar && has && hasTarget,
    pct: has && hasTarget ? Math.min(100, Math.round((m.actual / m.target) * 100)) : 0,
    pace: has && hasTarget && num(m.pace) ? Math.min(100, Math.round((m.pace / m.target) * 100)) : 0,
    hint: hint ?? (m.source?.stale ? m.source.ageLabel : ''),
    span, series: has ? series : null,
    target: target ?? (hasTarget ? `Target ${fmt(m.target)}` : num(m.target) ? `Target ${fmt(m.target)}` : ''),
    paceLine: hasTarget,
    more: `${m.note || ''}${src}`.trim(),
    log,
  };
}

export function objectivesOf(d2resp, d3resp, P = periodOf(d2resp)) {
  const goals = d2resp?.d2?.goals || [];
  const G = (k) => goals.find((g) => g.key === k) || null;
  const g3 = d3resp?.d3?.goals || null;
  const sp = G('sponsors');
  const hgp = G('hgp');
  const jm = G('jonmac');
  const ai = G('jonmacai');
  const wk = (g, i) => g?.week?.[i] || null;
  const WK = (m) => ({ span: P.wk, series: weekSeries(m, P), hint: 'this week' });
  const collected = one(sp?.month);
  const tw = g3?.tokenWeeks || null;
  const wo = g3?.workouts || null;
  const dn = g3?.dateNights || null;
  const ch = g3?.charges || null;
  const qc = g3?.qcFirstTry || null;
  return [
    { title: 'Sponsor Revenue', owner: sp?.owner || 'Florence', icon: 'money', krs: [
      kr('a1', 'Collected', collected, { money: true, span: P.mo, series: monthTrendSeries(sp, collected, P), hint: 'this month' }),
      kr('a2', 'Deals signed', wk(sp, 0), WK(wk(sp, 0))),
      kr('a3', 'Sponsor videos delivered', wk(sp, 1), WK(wk(sp, 1))),
      kr('a4', 'Invoices waiting', wk(sp, 2), { bar: false, hint: 'target 0', span: P.wk, series: null }),
    ] },
    { title: 'Content Factory', owner: hgp?.owner || 'Elle', icon: 'video', krs: [
      kr('b1', jm?.title || 'Jon Mac', wk(jm, 0), WK(wk(jm, 0))),
      kr('b2', ai?.title || '@JonMacAI', wk(ai, 0), WK(wk(ai, 0))),
      kr('b3', hgp?.title || 'Home Guide Press', wk(hgp, 0), WK(wk(hgp, 0))),
      g3?.scoreboard ? kr('b4', 'QC-passed today', g3.scoreboard, { hint: 'today', span: null, series: null })
        : noFeed('b4', 'QC-passed today', 'QC results on renders could not be read.'),
      qc ? kr('b5', 'Passed QC first try', qc, { bar: false, hint: num(qc.total) ? `${qc.passed} of ${qc.total}` : 'this month', span: null, series: null, target: '' })
        : noFeed('b5', 'Passed QC first try', 'QC verdicts on renders could not be read.'),
      g3?.approvedWaiting ? kr('b6', 'Approved, not uploaded', g3.approvedWaiting, { bar: false, hint: g3.approvedWaiting.actual ? `oldest ${g3.approvedWaiting.oldestLabel}` : 'none waiting', span: null, series: null, target: 'Target 0' })
        : noFeed('b6', 'Approved, not uploaded', 'Approvals and the YouTube calendar could not be read.'),
    ] },
    { title: 'Operations', owner: 'Ana', icon: 'bot', krs: [
      tw ? kr('c1', 'Weeks token limit hit', tw, { bar: false, hint: 'target 0', span: P.mo, series: num(tw.actual) ? monthEventSeries(tw.hitDays || [], P, 0) : null })
        : noFeed('c1', 'Weeks token limit hit', "Ana's Claude usage check could not be read."),
      noFeed('c2', 'Dashboard 3 pages built', 'No feed counts built pages yet.'),
      noFeed('c3', 'Cost per video measured', 'Needs tokens saved on every run, per card.'),
      noFeed('c4', 'Times you typed "continue"', 'Nothing counts this yet.'),
    ] },
    { title: 'Personal', owner: 'You', icon: 'heart', krs: [
      wo ? kr('p1', 'Workouts', wo, { span: P.wk, series: weekSeries(wo, P), hint: 'this week', log: { kind: 'workout', done: !!wo.loggedToday } })
        : noFeed('p1', 'Workouts', 'Your habit log could not be read.'),
      dn ? kr('p2', 'Date nights', dn, { span: P.mo, series: num(dn.actual) ? monthEventSeries(dn.perDay || {}, P, dn.target) : null, hint: 'this month', log: { kind: 'date_night', done: !!dn.loggedToday } })
        : noFeed('p2', 'Date nights', 'Your habit log could not be read.'),
      ch ? kr('p3', 'Charges confirmed', ch, { hint: num(ch.open) && ch.open ? `${ch.open} open` : 'this month', span: null, series: null })
        : noFeed('p3', 'Charges confirmed', 'MoneyClaw charge questions could not be read.'),
    ] },
  ];
}

// ---- HTML ----
const px = (f) => Math.round(20 + f * 570);
const py = (f) => Math.round(125 - Math.min(f, 1.05) * 105);
const line = (pts) => pts.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');

function krHtml(k, open, busy) {
  const exp = open ? 'true' : 'false';
  const bar = k.hasBar ? `<span class="bar"><i class="${k.tone}" style="width: ${k.pct}%"></i>${k.pace > 0 ? `<b style="left: ${k.pace}%"></b>` : ''}</span>` : '';
  const log = k.log ? `<button type="button" class="btn sm" data-log="${esc(k.log.kind)}"${k.log.done || busy ? ' disabled' : ''}>${k.log.done ? 'Logged today' : '+ Log'}</button>` : '';
  let detail = '';
  if (open) {
    const t = k.span === null ? 0 : k.series ? k.series[k.series.length - 1][0] : 0;
    const chart = k.series
      ? `<svg viewBox="0 0 600 130" role="img" aria-label="Actual against pace" style="display: block; width: 100%; height: auto">
<line class="ax" x1="20" y1="125" x2="590" y2="125"></line>${k.paceLine ? '<line class="pace" x1="20" y1="125" x2="590" y2="20"></line>' : ''}
<polyline class="act ${k.tone}" points="${line(k.series)}"></polyline>
<line class="today" x1="${px(t)}" y1="22" x2="${px(t)}" y2="125"></line><text x="${px(t)}" y="14">today</text></svg>
<div class="mut" style="display: flex; justify-content: space-between; font-size: 12px"><span>${esc(k.span?.x0)}</span><span>${esc(k.span?.x1)}</span></div>`
      : '<p class="mut">No trend data yet.</p>';
    detail = `<div class="inner" style="gap: 6px"><div class="mut" style="text-align: right; font-size: 12px">${esc(k.target)}</div>${chart}${k.more ? `<p class="sub" style="font-size: 13px">${esc(k.more)}</p>` : ''}</div>`;
  }
  return `<div class="kr">
<button type="button" class="krb" aria-expanded="${exp}" data-kr="${esc(k.id)}"><span class="dot ${k.tone === 'n' ? '' : k.tone}" style="align-self: center"></span><span class="krn">${esc(k.text)}</span><span class="krv${k.nf ? ' nf' : ''}">${esc(k.v1)}<span class="dim">${esc(k.v2)}</span></span></button>
<div class="krl">${bar}<span class="mut" style="font-size: 12px">${esc(k.hint)}</span>${log}</div>
${detail}</div>`;
}

// sub (plain text) and pill (HTML) are for the other pages; Goals shows the week line and no pill.
function headerHtml(P, title, sub, pill = '') {
  const line = sub != null ? esc(sub) || '&nbsp;' : P.ymd ? `${esc(P.weekdayName)} · day ${esc(P.day)} of ${esc(P.daysInMonth)}` : '&nbsp;';
  return `<header class="hd" style="padding: 6px 4px 2px; gap: 14px">
<span class="datechip" aria-hidden="true"><b>${esc(P.day || '')}</b><span>${esc(P.monthShort || '')}</span></span>
<div style="display: flex; flex-direction: column; gap: 2px"><span class="mut">${line}</span><h1>${esc(title)}</h1></div>${pill}
</header>`;
}

function summaryHtml(objs) {
  const c = { r: 0, y: 0, g: 0, n: 0 };
  for (const o of objs) for (const k of o.krs) c[k.tone] += 1;
  const all = c.r + c.y + c.g + c.n;
  const pill = c.r ? '<span class="pill bad sp">Behind</span>' : c.y ? '<span class="pill warn sp">At risk</span>' : c.g ? '<span class="pill ok sp">On track</span>' : '<span class="pill sp">No data</span>';
  const rows = objs.map((o) => `<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); align-items: center; gap: 12px"><span class="sub" style="font-weight: 500">${esc(o.title)}</span><span style="display: flex; gap: 5px">${o.krs.map((k) => `<i class="sq ${k.tone === 'n' ? '' : k.tone}" title="${esc(k.text)}"></i>`).join('')}</span></div>`).join('');
  return `<section class="card" style="flex: 5 1 340px" aria-label="Key results">
<div class="hd"><span class="chip">${icon('goals')}</span><h2>Key results</h2>${pill}</div>
<div class="hd" style="align-items: baseline; gap: 8px"><b class="num">${c.r}</b><span class="dim" style="font-size: 16px">of ${all} off track</span></div>
<div style="display: flex; flex-direction: column; gap: 10px">${rows}</div>
<div class="hd mut" style="flex-wrap: wrap; gap: 6px 14px; font-size: 12px"><span class="hd" style="gap: 6px"><span class="dot r"></span>${c.r} off track</span><span class="hd" style="gap: 6px"><span class="dot y"></span>${c.y} at risk</span><span class="hd" style="gap: 6px"><span class="dot g"></span>${c.g} on track</span><span class="hd" style="gap: 6px"><span class="dot"></span>${c.n} no data</span></div>
</section>`;
}

function revenueHtml(d2resp, P) {
  const sp = (d2resp?.d2?.goals || []).find((g) => g.key === 'sponsors');
  const m = one(sp?.month);
  const has = num(m?.actual);
  const series = has ? monthTrendSeries(sp, m, P) : null;
  const sx = (f) => Math.round(f * 300);
  const sy = (f) => Math.round(100 - Math.min(f, 1.05) * 100);
  const tx = sx(P.monthT);
  let pills = '';
  if (has && num(m.pace)) {
    const diff = Math.round(m.actual - m.pace);
    const tone = PILL[toneOf(m.status)] || '';
    pills += `<span class="pill ${tone}">${diff < 0 ? `${esc(usd(-diff))} behind pace` : `${esc(usd(diff))} ahead of pace`}</span>`;
  }
  if (m?.source?.stale) pills += `<span class="pill">${esc(m.source.label)}</span>`;
  const big = has
    ? `<b class="num" style="font-size: 52px">${esc(usd(m.actual))}</b>${num(m.target) ? `<span class="dim" style="font-size: 16px">of ${esc(usd(m.target))}</span>` : ''}`
    : `<b class="num nf">${esc(m ? 'No data' : 'No feed')}</b>`;
  return `<section class="card" style="flex: 4 1 300px" aria-label="Sponsor Revenue">
<div class="hd"><span class="chip">${icon('money')}</span><h2>Sponsor Revenue</h2><a class="go sp" href="#money" aria-label="Open Money">${icon('open')}</a></div>
<div style="display: flex; flex-direction: column; gap: 4px"><div class="hd mut" style="gap: 12px"><span>Collected in ${esc(P.monthName)}</span><span class="hd sp" style="gap: 6px; font-size: 12px"><svg width="18" height="4" aria-hidden="true"><line class="pace" x1="0" y1="2" x2="18" y2="2"></line></svg>pace</span></div><div class="hd" style="align-items: baseline; gap: 8px">${big}</div></div>
<div style="flex: 1 1 0; min-height: 100px; display: flex; flex-direction: column; gap: 6px">
<svg viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="Collected so far against the pace line" style="display: block; width: 100%; flex: 1 1 0; min-height: 0; overflow: visible">
<line class="ax" x1="0" y1="100" x2="300" y2="100" vector-effect="non-scaling-stroke"></line>
${num(m?.target) && m.target > 0 ? '<line class="pace" x1="0" y1="100" x2="300" y2="0" vector-effect="non-scaling-stroke"></line>' : ''}
${series ? `<polyline class="act" points="${series.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}" vector-effect="non-scaling-stroke"></polyline>` : ''}
<line class="today" x1="${tx}" y1="0" x2="${tx}" y2="100" vector-effect="non-scaling-stroke"></line>
</svg>
<div class="mut" style="position: relative; display: flex; justify-content: space-between; font-size: 12px"><span>${esc(P.mo.x0)}</span><span style="position: absolute; left: ${Math.round(P.monthT * 100)}%; transform: translateX(-50%)">today</span><span>${esc(P.mo.x1)}</span></div>
</div>
${pills ? `<div class="hd" style="flex-wrap: wrap; gap: 6px">${pills}</div>` : ''}
</section>`;
}

// Pipeline revenue (Jon, 2026-11-11): deals still to close and money still to collect, from the Sponsors board and its
// money-owed list. To collect = every owed row plus agreed and in-work deals not on that list; To close = leads and
// talks. Paid and archived deals are left out. Each row opens its deal on the Money page.
const CLOSE_COLS = ['Leads', 'Negotiations'];
const COLLECT_COLS = ['Deals', 'Deposit Invoice', 'Deposit Paid', 'Video Production', 'Video Approved', 'Video Live', 'Balance Invoice'];
// One key for a deal across the Goals card and the Money page: its board id, else its name.
export const dealKey = (id, name) => (id ? String(id) : `n:${String(name || '').trim().toLowerCase()}`);
const money = (v) => (num(v) ? v : typeof v === 'string' && /\d/.test(v) ? Number(v.replace(/[^0-9.]/g, '')) : NaN);
export function pipelineOf(d2resp) {
  const sp = (d2resp?.d2?.pipeline?.boards || []).find((b) => b.goal === 'sponsors')?.sponsors;
  const cols = sp?.board?.columns;
  if (!Array.isArray(cols)) return null;
  const seen = new Set();
  const key = (id, name) => [id ? `i:${id}` : '', `n:${String(name || '').trim().toLowerCase()}`];
  const ok = (k) => k && k !== 'n:';
  const mark = (id, name) => key(id, name).filter(ok).forEach((k) => seen.add(k));
  const isSeen = (id, name) => key(id, name).some((k) => ok(k) && seen.has(k));
  const row = (id, name, amt) => ({ id: dealKey(id, name), name: name || 'Sponsor', amt: Number.isFinite(amt) && amt > 0 ? amt : null });
  const collect = [];
  for (const r of sp.collect?.rows || []) {
    const amt = money(r.owedUsd ?? r.owed);
    if (!(amt > 0)) continue;
    collect.push(row(r.payload?.id, r.sponsor, amt));
    mark(r.payload?.id, r.sponsor);
  }
  const deals = (titles) => cols.filter((c) => !c.archived && titles.includes(c.title)).flatMap((c) => c.cards || []);
  for (const k of deals(COLLECT_COLS)) {
    if (isSeen(k.id, k.name)) continue;
    collect.push(row(k.id, k.name, k.amt));
    mark(k.id, k.name);
  }
  const close = deals(CLOSE_COLS).filter((k) => !isSeen(k.id, k.name)).map((k) => row(k.id, k.name, k.amt));
  const sort = (a) => a.sort((x, y) => (y.amt ?? -1) - (x.amt ?? -1));
  const sum = (a) => a.reduce((n, r) => n + (r.amt || 0), 0);
  return { close: sort(close), collect: sort(collect), totals: { close: sum(close), collect: sum(collect) } };
}

function pipelineHtml(d2resp) {
  const p = pipelineOf(d2resp);
  const head = `<div class="hd"><span class="chip">${icon('money')}</span><h2>Pipeline revenue</h2><a class="go sp" href="#money" aria-label="Open Money">${icon('open')}</a></div>`;
  if (!p) return `<section class="card" style="flex: 3 1 220px; min-width: 0" aria-label="Pipeline revenue">${head}<p class="mut">No feed: the Sponsors board could not be read.</p></section>`;
  const block = (label, rows, total) => {
    const bare = rows.filter((r) => r.amt == null).length;
    const list = rows.map((r) => `<a class="hd" href="#money" data-deal="${esc(r.id)}" style="gap: 8px; color: inherit; text-decoration: none; padding: 3px 0"><span class="ell" style="flex: 1; min-width: 0">${esc(r.name)}</span>${r.amt == null ? '<span class="mut" style="font-size: 12px">no amount</span>' : `<b style="font-weight: 600">${esc(usd(r.amt))}</b>`}</a>`).join('');
    return `<div class="inner" style="gap: 6px">
<div class="hd" style="align-items: baseline; gap: 8px"><span class="sub" style="font-weight: 500">${label}</span><b class="num sp" style="font-size: 26px">${esc(usd(total))}</b></div>
<span class="mut" style="font-size: 12px">${rows.length} deal${rows.length === 1 ? '' : 's'}${bare ? ` · ${bare} no amount` : ''}</span>
${rows.length ? `<div style="display: flex; flex-direction: column; max-height: 180px; overflow: auto; font-size: 14px">${list}</div>` : '<span class="mut" style="font-size: 13px">None</span>'}
</div>`;
  };
  return `<section class="card" style="flex: 3 1 220px; min-width: 0; gap: 12px" aria-label="Pipeline revenue">${head}
${block('To close', p.close, p.totals.close)}
${block('To collect', p.collect, p.totals.collect)}
</section>`;
}

function objectiveHtml(o, ui) {
  let r = 0; let y = 0; let g = 0;
  for (const k of o.krs) { if (k.tone === 'r') r++; else if (k.tone === 'y') y++; else if (k.tone === 'g') g++; }
  const pill = r ? 'bad' : y ? 'warn' : g ? 'ok' : '';
  return `<section class="card" style="gap: 18px">
<div class="hd cardhd"><span class="chip">${icon(o.icon)}</span><h2>${esc(o.title)}</h2><span class="pill ${pill}">${g} of ${o.krs.length} on track</span><span class="hd sp mut" style="gap: 6px"><span class="av">${esc(o.owner.charAt(0))}</span>${esc(o.owner)}</span></div>
${o.krs.map((k) => krHtml(k, ui.openKr === k.id, ui.busy)).join('\n')}
</section>`;
}

// "due Nov 12" in a card's reason, as days from today.
function dueOf(why, P) {
  const m = /due (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})/.exec(why || '');
  if (!m || !P.ymd) return null;
  const mo = MONTHS.indexOf(m[1]) + 1;
  let y = P.year;
  const nowMo = Number(P.ymd.slice(5, 7));
  if (mo < nowMo - 6) y += 1;
  if (mo > nowMo + 6) y -= 1;
  return daysBetween(P.ymd, `${y}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`);
}

function scheduledHtml(d2resp, d3resp, P, ui) {
  const goals = d2resp?.d2?.goals || [];
  const G = (k) => goals.find((g) => g.key === k) || null;
  const sv = G('sponsors')?.week?.[1] || null;
  const open = d3resp?.d3?.openCards;
  // Sponsor videos not yet delivered this week, with their due dates.
  let sponsor;
  if (sv && Array.isArray(sv.behind)) {
    const items = sv.behind.slice(0, 4).map((b) => {
      const d = dueOf(b.why, P);
      const pill = d == null ? '<span class="pill sp">no due date</span>'
        : `<span class="pill ${d < 0 ? 'bad' : d <= 2 ? 'warn' : 'ok'} sp">${d < 0 ? `${-d} day${d === -1 ? '' : 's'} late` : d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'}`}</span>`;
      return `<div class="hd"><span>${esc(b.title)}</span>${pill}</div>`;
    }).join('');
    sponsor = `<div class="hd" style="align-items: baseline; gap: 6px"><b class="num" style="font-size: 32px">${sv.behind.length}</b><span class="dim">due</span></div><div style="display: flex; flex-direction: column; gap: 6px; margin-top: auto; font-size: 13px">${items}</div>`;
  } else {
    sponsor = '<div class="hd" style="align-items: baseline; gap: 6px"><b class="num nf">No feed</b></div>';
  }
  const project = (g) => {
    const m = g?.week?.[0];
    const name = g?.title || '';
    if (!m || !num(m.actual)) return `<div class="inner" style="flex: 1 1 180px"><span class="sub" style="font-weight: 500">${esc(name)}</span><div class="hd" style="align-items: baseline; gap: 6px"><b class="num nf">${m ? 'No data' : 'No feed'}</b></div></div>`;
    const t = num(m.target) ? m.target : 0;
    const pips = Array.from({ length: Math.min(t, 14) }, (_, i) => `<i class="pip${i < m.actual ? ' f' : ''}" style="height: 18px"></i>`).join('');
    const n = open && g.project in open ? open[g.project] : open ? 0 : null;
    const note = n == null ? 'Open cards: No feed' : `${n} open card${n === 1 ? '' : 's'}`;
    return `<div class="inner" style="flex: 1 1 180px"><span class="sub" style="font-weight: 500">${esc(name)}</span><div class="hd" style="align-items: baseline; gap: 6px"><b class="num" style="font-size: 32px">${esc(m.actual)}</b><span class="dim">of ${esc(t)}</span></div><div style="display: flex; flex-direction: column; gap: 8px; margin-top: auto">${pips ? `<span class="pips">${pips}</span>` : ''}<span class="mut" style="font-size: 12px">${esc(note)}</span></div></div>`;
  };
  const hgp = G('hgp');
  const hm = hgp?.week?.[0] || null;
  const rows = Array.isArray(hm?.rows) ? hm.rows : [];
  let hgpBody;
  if (hm && num(hm.actual)) {
    const each = [...new Set(rows.map((r) => r.target))];
    const per = each.length === 1 && num(each[0]) ? `, ${each[0]} each` : '';
    const cols = rows.map((r) => `<span class="col" title="${esc(r.label)}"><i style="height: ${num(r.target) && r.target > 0 ? Math.min(100, Math.round((r.actual / r.target) * 100)) : 0}%"></i></span>`).join('');
    hgpBody = `<div class="hd" style="align-items: baseline; gap: 6px"><b class="num" style="font-size: 32px">${esc(hm.actual)}</b><span class="dim">of ${esc(hm.target)} · ${rows.length} channel${rows.length === 1 ? '' : 's'}${esc(per)}</span></div>
<div class="cols" style="margin-top: auto" role="img" aria-label="One column per channel, filled by videos done out of its target">${cols}</div>`;
  } else {
    hgpBody = `<div class="hd" style="align-items: baseline; gap: 6px"><b class="num nf">${hm ? 'No data' : 'No feed'}</b></div>`;
  }
  const names = ui.hgpOpen && rows.length
    ? `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px">${rows.map((r) => {
      const t = toneOf(r.status);
      return `<div class="kc"><span class="dot ${t === 'n' ? '' : t}"></span><span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${esc(r.label)}</span><b style="font-weight: 600">${esc(r.actual)}<span class="dim"> / ${esc(r.target)}</span></b></div>`;
    }).join('')}</div>`
    : '';
  return `<section class="card">
<div class="hd"><span class="chip">${icon('film')}</span><h2>Videos Scheduled</h2><span class="pill sp">${esc(P.weekdayName)} · day ${P.weekday + 1} of 7</span></div>
<div class="row" style="gap: 12px">
<div class="inner" style="flex: 1 1 180px"><span class="sub" style="font-weight: 500">Sponsor videos</span>${sponsor}</div>
${project(G('jonmac'))}
${project(G('jonmacai'))}
<div class="inner" style="flex: 2.2 1 360px">
<div class="hd"><span class="sub" style="font-weight: 500">${esc(hgp?.title || 'Home Guide Press')}</span>${rows.length ? `<button type="button" class="btn sm sp" aria-expanded="${ui.hgpOpen ? 'true' : 'false'}" data-hgp>${ui.hgpOpen ? 'Hide names' : 'Channel names'}</button>` : ''}</div>
${hgpBody}
</div>
</div>
${names}
</section>`;
}

// Top of Goals (Jon, 2026-11-11): today's videos against the 6-a-day goal, each video's stage and 3-hour clock, and the
// approved videos not on YouTube yet in red.
const hm = (m) => (num(m) ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '–');
export function scoreboardHtml(d3resp) {
  const g3 = d3resp?.d3?.goals || {};
  const sb = g3.scoreboard;
  const aw = g3.approvedWaiting;
  if (!sb) {
    return `<section class="card" aria-label="Today's videos"><div class="hd"><span class="chip">${icon('video')}</span><h2>Today's videos</h2></div><p class="mut">No feed: QC results could not be read.</p></section>`;
  }
  const tone = PILL[toneOf(sb.status)] || '';
  const red = 'color: var(--bad-ink)';
  const rows = (sb.rows || []).map((r) => {
    const late = r.state === 'late';
    const stage = r.state === 'passed' ? '<span class="pill ok">Passed QC</span>'
      : `<span${late && r.stageMin > r.budgetMin ? ` style="${red}"` : ''}>${esc(r.stage)} ${esc(r.stageMin ?? '–')} of ${esc(r.budgetMin)} min</span>`;
    const clock = `<span class="num" style="font-size: 14px${late && r.clockMin > sb.clockBudget ? `; ${red}` : ''}">${esc(hm(r.clockMin))} of ${esc(hm(sb.clockBudget))}</span>`;
    return `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px">
<span class="dot ${r.state === 'passed' ? 'g' : late ? 'r' : 'y'}"></span><span style="flex: 1 1 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap${late ? `; ${red}` : ''}" title="${esc(r.title)}">${esc(r.title)}</span>${stage}${clock}</div>`;
  }).join('\n');
  const awLine = !aw ? '<p class="mut">Approved, not uploaded: no feed.</p>'
    : aw.actual ? `<p style="${red}; font-weight: 600">${esc(aw.actual)} approved, not uploaded, oldest ${esc(aw.oldestLabel)}: ${esc(aw.items.slice(0, 5).map((x) => x.title).join('; '))}${aw.items.length > 5 ? ` and ${aw.items.length - 5} more` : ''}</p>`
      : '<p class="mut">Every approved video is scheduled or live.</p>';
  return `<section class="card" aria-label="Today's videos">
<div class="hd"><span class="chip">${icon('video')}</span><h2>Today's videos</h2><span class="pill ${tone}">${esc(sb.actual)} of ${esc(sb.target)} passed today</span>${sb.late ? `<span class="pill bad">${esc(sb.late)} late</span>` : ''}</div>
${rows ? `<div style="display: flex; flex-direction: column; gap: 8px">${rows}</div>` : '<p class="mut">No video passed QC or is in a timed stage yet today.</p>'}
${awLine}
</section>`;
}

export function headerOnly(d2resp, title, sub, pill) {
  return headerHtml(periodOf(d2resp), title, sub, pill);
}

export function renderGoals(d2resp, d3resp, ui = {}) {
  const P = periodOf(d2resp);
  const objs = objectivesOf(d2resp, d3resp, P);
  const U = { openKr: ui.openKr || null, hgpOpen: !!ui.hgpOpen, busy: !!ui.busy };
  return `${headerHtml(P, 'Goals')}
${scoreboardHtml(d3resp)}
<div class="row">
${summaryHtml(objs)}
${revenueHtml(d2resp, P)}
${pipelineHtml(d2resp)}
</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr)); gap: 16px">
${objs.map((o) => objectiveHtml(o, U)).join('\n')}
</div>
${scheduledHtml(d2resp, d3resp, P, U)}`;
}
