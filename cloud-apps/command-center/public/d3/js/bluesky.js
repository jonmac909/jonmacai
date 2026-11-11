// Bluesky page (design: briefs\dashboard3\Bluesky.dc.html). Six sections as buttons; the text is in bluesky-data.js.
// No live numbers: it is Jon's Bluesky 2027 doc as it stood on 2026-11-10.
import { esc } from './util.js';
import { headerOnly } from './goals.js';
import { TABS, values, horizons, okrs, quarters, depts, highlights, learn, calls } from './bluesky-data.js';

const IC = {
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>',
  list: '<path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path>',
  bars: '<path d="M4 20V10"></path><path d="M10 20V4"></path><path d="M16 20v-7"></path><path d="M22 20H2"></path>',
  clock: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"></path><path d="M12 7v5l3 2"></path>',
  team: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"></path>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><path d="M22 4 12 14.01l-3-3"></path>',
  you: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path>',
};
export const chipIc = (k) => `<span class="chip"><svg class="ic" aria-hidden="true" viewBox="0 0 24 24">${IC[k]}</svg></span>`;
export const TAB_IDS = TABS.map((t) => t[0]);
export const tabsHtml = (list, on, attr) => `<div class="hd" role="group" aria-label="Sections" style="gap: 6px; flex-wrap: wrap; padding: 0 4px">${list.map(([id, label]) => `<button type="button" class="btn sm" ${attr}="${esc(id)}" aria-pressed="${id === on}">${esc(label)}</button>`).join('')}</div>`;
// A key result row: number, text, Committed/Aspirational pill and its start (shared with the System page).
export const krRow = (k, cols, extra = '', tail = '') => `<div class="srow ${esc(k.first)}" style="grid-template-columns: ${cols}"><span class="mut">${esc(k.n)}</span><div class="stack" style="gap: 5px; align-items: flex-start"><span style="font-weight: 500">${esc(k.t)}</span><span class="hd mut" style="gap: 8px; flex-wrap: wrap; font-size: 12px"><span class="pill">${esc(k.type)}</span>${extra}<span>Start: ${esc(k.start)}</span></span></div>${tail}</div>`;

function vision() {
  const vals = values.map((v) => `<div class="srow ${esc(v.first)}" style="grid-template-columns: 24px minmax(0, 1fr)"><span class="krv" style="font-size: 15px; color: var(--muted)">${esc(v.n)}</span><div class="stack" style="gap: 2px"><b>${esc(v.t)}</b><span class="sub" style="font-size: 13px">${esc(v.d)}</span></div></div>`).join('');
  const cols = 'grid-template-columns: 150px repeat(3, minmax(0, 1fr))';
  const rows = horizons.map((h) => `<div class="srow" style="${cols}; align-items: start; padding: 14px 0">
<div class="stack" style="gap: 2px"><b>${esc(h.alt)}</b><span class="mut" style="font-size: 12px">${esc(h.when)}</span></div>
${h.cells.map((c) => `<div class="stack" style="gap: 4px; align-items: flex-start">${c.hasV ? `<span class="krv" style="font-size: 22px">${esc(c.v)}</span>` : ''}${c.hasS ? `<span class="sub" style="font-size: 13px">${esc(c.s)}</span>` : ''}${c.hasTag ? `<span class="pill">${esc(c.tag)}</span>` : ''}</div>`).join('')}
</div>`).join('');
  return `<div class="row">
<section class="card" style="flex: 3 1 420px">
<div class="hd cardhd">${chipIc('cloud')}<h2>Vision</h2><span class="pill sp">Draft</span></div>
<p style="font-family: var(--disp); font-size: 23px; line-height: 1.4; font-weight: 400; margin: 0; text-wrap: pretty">A one-person media and software company, run by a small AI team, that earns from four engines (sponsors, ebooks, software, and a webinar funnel) while Jon spends two short check-ins a day on it and the rest of his time on his own videos and his family.</p>
<p class="mut" style="margin: auto 0 0; font-size: 12px">The four engines and the two check-ins come from the team’s written goals and from Jon’s decisions on Nov 10, 2026. The sentence itself is a draft for Jon to rewrite.</p>
</section>
<section class="card" style="flex: 2 1 320px; gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px">${chipIc('list')}<h2>Values</h2><span class="pill sp">Draft</span></div>
${vals}
</section>
</div>
<section class="card" style="gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px">${chipIc('bars')}<h2>Strategic business plans</h2><span class="mut">three numbers, four heights</span></div>
<div class="srow first thead" style="${cols}"><span>Horizon</span><span>Income a month (USD)</span><span>Jon’s time on the team</span><span>Finished videos a week</span></div>
${rows}
<p class="mut" style="margin: 10px 0 0; font-size: 12px">Finished video means one that passed QC. The weekly token limit was reached on Nov 3, 6 and 10, so the 12-month line also needs zero weeks at the limit.</p>
</section>`;
}

function okrsHtml() {
  const cards = okrs.map((o) => `<section class="card" style="gap: 0">
<div class="hd cardhd" style="align-items: flex-start; margin-bottom: 4px"><span class="pill" style="flex: none">${esc(o.id)}</span><h2 style="line-height: 1.3">${esc(o.title)}</h2><span class="krv sp" style="font-size: 15px; color: var(--muted); white-space: nowrap">– / ${esc(o.total)}</span></div>
${o.krs.map((k) => krRow(k, '20px minmax(0, 1fr) 44px', '', '<span class="mut" style="text-align: right; white-space: nowrap">– / 1</span>')).join('')}
<div class="inner" style="margin-top: 12px; gap: 6px; padding: 12px 14px"><span><b>Owner:</b> ${esc(o.owner)}</span><span class="sub" style="font-size: 13px">${esc(o.why)}</span></div>
</section>`).join('');
  return `<p class="sub" style="margin: 0; padding: 0 4px; max-width: 110ch">Four company objectives and one personal one, each with an owner and numbered key results. Committed means it must be hit in full. Aspirational means a score of 0.7 is a good year. Results and scores are filled at each first-Friday review; the first is Dec 4, 2026.</p>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(440px, 100%), 1fr)); gap: 16px">${cards}</div>`;
}

function quartersHtml() {
  const cols = 'grid-template-columns: 220px minmax(0, 1fr) 110px';
  return quarters.map((q) => `<section class="card" style="gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px; flex-wrap: wrap">${chipIc('clock')}<h2>${esc(q.title)}</h2><span class="mut">${esc(q.kind)}</span></div>
<p class="sub" style="margin: 8px 0 6px">${esc(q.intro)}</p>
<div class="srow thead" style="${cols}"><span>Project</span><span>Done looks like</span><span>Owner</span></div>
${q.rows.map((r) => `<div class="srow" style="${cols}; align-items: start"><b>${esc(r.p)}</b><span class="sub">${esc(r.d)}</span><span><span class="pill">${esc(r.o)}</span></span></div>`).join('')}
${q.hasNote ? `<p class="mut" style="margin: 10px 0 0; font-size: 12px">${esc(q.note)}</p>` : ''}
</section>`).join('');
}

function deptsHtml() {
  const cols = 'grid-template-columns: 130px 120px minmax(0, 1fr) minmax(0, 1fr)';
  return `<section class="card" style="gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px">${chipIc('team')}<h2>Bluesky per department</h2><span class="mut">each department is a role on the 9-role team, one objective a quarter</span></div>
<div class="srow first thead" style="${cols}"><span>Department</span><span>Who</span><span>Q1 2027 (Jan to Mar)</span><span>Q2 2027 (Apr to Jun)</span></div>
${depts.map((d) => `<div class="srow" style="${cols}; align-items: start"><b>${esc(d.d)}</b><span class="mut">${esc(d.w)}</span><span class="sub">${esc(d.q1)}</span><span class="sub">${esc(d.q2)}</span></div>`).join('')}
</section>`;
}

function y2026Html() {
  const cols = 'grid-template-columns: 150px minmax(0, 1.3fr) minmax(0, 1fr)';
  return `<div class="row">
<section class="card" style="flex: 2 1 320px">
<div class="hd cardhd">${chipIc('pulse')}<h2>2026 in one line</h2></div>
<p style="font-family: var(--disp); font-size: 20px; line-height: 1.45; font-weight: 400; margin: 0; text-wrap: pretty">2026 built the team and the video line but not yet the income.</p>
<p class="sub" style="margin: 0">The team’s files show $1,500 of sponsor money in November, $0 of ebook sales in the week of Nov 2 to 8, and $146 a month from Viral View. The team’s records start in October 2026, so anything earlier is Jon’s to add.</p>
</section>
<section class="card" style="flex: 3 1 420px; gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px">${chipIc('check')}<h2>Highlights</h2></div>
${highlights.map((h) => `<div class="srow ${esc(h.first)}" style="grid-template-columns: 14px minmax(0, 1fr); align-items: start"><span class="dot ${esc(h.tone)}" style="margin-top: 7px"></span><span>${esc(h.t)}</span></div>`).join('')}
</section>
</div>
<section class="card" style="gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px">${chipIc('list')}<h2>By department</h2></div>
<div class="srow first thead" style="${cols}"><span>Department</span><span>What happened in 2026</span><span>Learning for 2027</span></div>
${learn.map((l) => `<div class="srow" style="${cols}; align-items: start"><b>${esc(l.d)}</b><span class="sub">${esc(l.w)}</span><span>${esc(l.l)}</span></div>`).join('')}
</section>`;
}

function callHtml() {
  return `<section class="card" style="gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px">${chipIc('you')}<h2>Your call</h2><span class="mut">these lines are guesses or gaps</span><span class="pill warn sp">${calls.length} open</span></div>
${calls.map((c) => `<div class="srow ${esc(c.first)}" style="grid-template-columns: 24px minmax(0, 1fr)"><span class="krv" style="font-size: 15px; color: var(--muted)">${esc(c.n)}</span><span>${esc(c.t)}</span></div>`).join('')}
</section>`;
}

const BODY = { vision, okrs: okrsHtml, quarters: quartersHtml, depts: deptsHtml, y2026: y2026Html, call: callHtml };

export function renderBluesky(d2resp, ui = {}) {
  const tab = BODY[ui.bsTab] ? ui.bsTab : 'vision';
  return `${headerOnly(d2resp, 'Bluesky 2027', 'First draft for 2027 · yours to change', '<span class="pill sp">Draft = a proposal · Written goal = from the team’s files</span>')}
${tabsHtml(TABS, tab, 'data-bstab')}
${BODY[tab]()}`;
}
