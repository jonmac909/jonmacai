// System page (design: briefs\dashboard3\System.dc.html). Map, How work moves, Team and your day, December goals.
// No live numbers: the text is the system as designed on 2026-11-10, in system-data.js (Ana keeps its In place pills true).
import { esc } from './util.js';
import { headerOnly } from './goals.js';
import { chipIc, tabsHtml, krRow } from './bluesky.js';
import { CATS, AREAS, VST, L, OBJ, P, ROLES, rules, day, rhythm } from './system-data.js';

export const SY_TABS = [['map', 'Map'], ['moves', 'How work moves'], ['team', 'Team and your day'], ['goals', 'December goals']];
const SP = { on: ['On', 'ok'], paused: ['Off for now', 'warn'], ondemand: ['On demand', ''], none: ['No goal', ''] };
const BP = { ready: ['In place', 'ok'], fix: ['To fix', 'warn'], build: ['To build', ''] };
const IC_MAP = '<path d="M10 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"></path><path d="M3 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z"></path><path d="M17 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z"></path><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path><path d="M12 12V8"></path>';

// Derived once, as the design does: each project's parts (plus its project file), counts by kind, and its key results.
const uses = {};
export const PROJ = P.map((p) => {
  const items = p.parts.map((id) => {
    if (!L[id]) throw new Error(`No part ${id}`);
    uses[id] = (uses[id] || 0) + 1;
    return { id, it: L[id] };
  });
  if (p.pf) items.push({ id: `pf_${p.id}`, it: { c: 'sop', n: `${p.name} project file`, o: 'Loaded only for this project’s cards', w: `${p.pf} 4 KB at most.` } });
  const byCat = {};
  for (const x of items) byCat[x.it.c] = (byCat[x.it.c] || 0) + 1;
  const krs = [];
  for (const o of OBJ) for (const k of o.krs) if (k[3] === p.id) krs.push({ o, k });
  return { ...p, items, byCat, krs };
});
const byId = (id) => PROJ.find((p) => p.id === id);
const posOf = (i, n) => `${i === 0 ? 'first ' : ''}${i === n - 1 ? 'last' : ''}`;
const krOf = (k, i, withProj) => ({ n: String(i + 1), first: i === 0 ? 'first' : '', t: k[0], type: k[1] === 'C' ? 'Committed' : 'Aspirational', start: k[2], proj: withProj ? byId(k[3]).name : '' });
const flowHtml = (list) => `<ol class="flow">${list.map((s, i) => {
  const who = s[1] || '';
  const cls = /^You/.test(who) ? 'you' : ((who === 'Script' || who === 'Bot') ? 'scr' : '');
  return `<li class="${cls}${i < list.length - 1 ? ' nx' : ''}"><b>${esc(s[0])}</b>${who ? `<span>${esc(who)}</span>` : ''}</li>`;
}).join('')}</ol>`;
const firstCat = (p) => (CATS.find((c) => p.byCat[c.id]) || { id: 'card' }).id;

function mapHtml(ui) {
  const selP = byId(ui.sySel) || PROJ[0];
  const cat = selP.byCat[ui.syCat] ? ui.syCat : firstCat(selP);

  const all = []; const seen = {};
  for (const p of PROJ) for (const x of p.items) if (!seen[x.id]) { seen[x.id] = 1; all.push(x.it); }
  const nReady = all.filter((i) => i.b === 'ready').length;
  const nFix = all.filter((i) => i.b === 'fix').length;
  const cn = {}; for (const i of all) if (i.c === 'card') cn[i.n] = 1;
  const nOn = PROJ.filter((p) => p.state === 'on' && p.area !== 'life').length;
  const nOff = PROJ.filter((p) => p.state === 'paused').length;
  const nLife = PROJ.filter((p) => p.area === 'life').length;
  const tiles = [
    { label: 'Projects', n: PROJ.length, note: `${nOn} on, ${nOff} off for now, ${PROJ.length - nOn - nOff - nLife} on demand, ${nLife} life` },
    { label: 'Roles', n: ROLES.length, note: 'One starter: the dispatcher' },
    { label: 'Parts', n: all.length, note: `${Object.keys(cn).length} card types, plus SOPs, routines, scripts and events · ${nReady} in place, ${nFix} to fix` },
    { label: 'December objectives', n: OBJ.length, note: '3 for the team, 1 personal' },
    { label: 'Your batches a day', n: 2, note: '8:00 AM and 4:00 PM Pacific' },
  ];

  const areas = AREAS.map((a, ai) => {
    const ps = PROJ.filter((p) => p.area === a.id);
    const rows = ps.map((p, pi) => {
      const s = SP[p.state];
      const chips = CATS.map((c) => {
        const n = p.byCat[c.id] || 0;
        const cls = `${n ? '' : 'zero'}${p.id === selP.id && c.id === cat ? ' sel' : ''}`;
        return `<button type="button" class="schip ${cls}" aria-label="${esc(`${p.name}: ${n} ${c.name}`)}" data-sysel="${esc(p.id)}" data-sycat="${esc(c.id)}"><b>${n}</b><span>${esc(c.short)}</span></button>`;
      }).join('');
      return `<div class="sprow ${posOf(pi, ps.length)}">
<button type="button" class="sproj" aria-pressed="${p.id === selP.id}" data-sysel="${esc(p.id)}" data-sycat="card"><span class="hd" style="gap: 8px"><b class="ell">${esc(p.name)}</b><span class="mut sp ell" style="font-size: 12px">${esc(p.t)}</span></span><span class="hd" style="gap: 6px"><span class="pill ${s[1]}">${esc(s[0])}</span>${p.obj ? `<span class="pill">${esc(p.obj)}</span>` : ''}</span></button>
<div class="schips">${chips}</div>
</div>`;
    }).join('');
    return `<div class="sbranch ${posOf(ai, AREAS.length)}">
<div class="sarea"><b>${esc(a.name)}</b><span class="mut" style="font-size: 12px">${esc(a.note)}</span></div>
<div class="sprojs">${rows}</div>
</div>`;
  }).join('');

  // The picked project's card.
  const groups = []; const gi = {};
  for (const x of selP.krs) {
    if (!gi[x.o.id]) { gi[x.o.id] = { title: `December key results it carries for ${x.o.id}: ${x.o.o}`, raw: [] }; groups.push(gi[x.o.id]); }
    gi[x.o.id].raw.push(x.k);
  }
  let month = '';
  if (!selP.krs.length) month = selP.obj ? `It feeds ${selP.obj} through the other projects’ key results.` : (selP.state === 'paused' ? 'Off, so it has no goal this month.' : 'No key result this month. It runs as business as usual.');
  const list = selP.items.filter((x) => x.it.c === cat);
  const sps = SP[selP.state];
  const next = selP.next || [];
  const bare = !selP.known && !next.length && !selP.ask;
  const lines = selP.items.filter((x) => x.it.c === 'card').map((x) => `<div class="stack" style="gap: 8px"><span class="mut">${esc(`How a ${x.it.n.toLowerCase()} moves`)}</span>${flowHtml(x.it.st)}</div>`).join('');
  const items = list.map((x, i) => {
    const it = x.it; const b = BP[it.b || 'build'];
    return `<div class="srow ${i === 0 ? 'first' : ''}" style="grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 150px; align-items: start; padding: 12px 0"><div class="stack" style="gap: 2px"><b style="overflow-wrap: anywhere">${esc(it.n)}</b><span class="mut" style="font-size: 12px">${esc(it.o || '')}</span></div><span class="sub" style="font-size: 13px">${esc(it.t || '')}</span><span class="hd" style="gap: 4px; flex-wrap: wrap; justify-content: flex-end"><span class="pill ${b[1]}">${esc(b[0])}</span>${uses[x.id] > 1 ? '<span class="pill">Shared</span>' : ''}</span>${it.w ? `<span class="sub" style="grid-column: 1 / -1; font-size: 13px; max-width: 100ch">${esc(it.w)}</span>` : ''}</div>`;
  }).join('');
  const parts = selP.items.length
    ? `<div class="hd" role="group" aria-label="Kind of part" style="gap: 6px; flex-wrap: wrap; padding-top: 4px">${CATS.map((c) => `<button type="button" class="btn sm" aria-pressed="${cat === c.id}" data-sysel="${esc(selP.id)}" data-sycat="${esc(c.id)}">${esc(c.name)} ${selP.byCat[c.id] || 0}</button>`).join('')}</div>
<div>${items}${list.length ? '' : '<p class="sub" style="margin: 12px 0 0">This project needs none of these.</p>'}</div>`
    : '<p class="sub" style="margin: 0">No parts. It is a page, not a line of work.</p>';

  return `<div class="row">${tiles.map((t) => `<div class="tile" style="flex: 1 1 170px; flex-direction: column; align-items: flex-start; gap: 6px"><div class="hd" style="width: 100%; gap: 8px"><b>${esc(t.label)}</b><b class="num sp" style="font-size: 28px">${t.n}</b></div><span class="mut" style="font-size: 12px">${esc(t.note)}</span></div>`).join('')}</div>
<section class="card">
<div class="hd cardhd"><span class="chip"><svg class="ic" aria-hidden="true" viewBox="0 0 24 24">${IC_MAP}</svg></span><h2>The map</h2><span class="mut">you, five branches, 16 projects · pick a project or a number</span></div>
<div class="smap"><div class="sroot">You</div><div class="sbranches">${areas}</div></div>
</section>
<section class="card">
<div class="hd cardhd" style="flex-wrap: wrap"><h2 style="font-size: 22px">${esc(selP.name)}</h2><span class="pill ${sps[1]}">${esc(sps[0])}</span>${selP.obj ? `<span class="pill">${esc(selP.obj)}</span>` : ''}<span class="mut">Owner: ${esc(selP.owner)}</span><span class="mut sp">${selP.items.length} parts</span></div>
<div class="row" style="gap: 16px">
<div class="inner" style="flex: 3 1 380px; gap: 8px">
<span class="mut">Target</span><span class="krv" style="font-size: 20px; white-space: normal; line-height: 1.3">${esc(selP.t)}</span><p class="sub" style="margin: 0">${esc(selP.tl)}</p>
${groups.map((g) => `<span class="mut" style="padding-top: 8px">${esc(g.title)}</span>${g.raw.map((k, i) => krRow(krOf(k, i, false), '20px minmax(0, 1fr); padding: 8px 0')).join('')}`).join('')}
${month ? `<span class="mut" style="padding-top: 8px">This month</span><p class="sub" style="margin: 0">${esc(month)}</p>` : ''}
</div>
<div class="inner" style="flex: 2 1 280px; gap: 8px">
${selP.known ? `<span class="mut">Last known, Nov 10</span><p class="sub" style="margin: 0 0 6px">${esc(selP.known)}</p>` : ''}
${next.length ? `<span class="mut">First work after the restart</span>${next.map((n) => `<div class="hd" style="gap: 8px; align-items: flex-start"><span class="dot" style="flex: none; margin-top: 7px"></span><span>${esc(n)}</span></div>`).join('')}<span style="height: 6px"></span>` : ''}
${selP.ask ? `<span class="mut">Open question for you</span><p class="sub" style="margin: 0">${esc(selP.ask)}</p>` : ''}
${bare ? '<span class="mut">Nothing on record yet.</span>' : ''}
</div>
</div>
${lines}
${parts}
</section>`;
}

function movesHtml() {
  return `<section class="card">
<div class="hd cardhd">${chipIc('pulse')}<h2>How work moves</h2></div>
<p style="font-family: var(--disp); font-size: 20px; line-height: 1.45; font-weight: 400; margin: 0; max-width: 62ch; text-wrap: pretty">Every job is a card. The dispatcher looks every minute and starts one short, capped run for the role the card’s stage names. When that run posts its proof, the card moves on. No bot messages another bot.</p>
<div class="stack" style="gap: 8px"><span class="mut">The video line, shared by every video project</span>${flowHtml(VST)}</div>
<div class="hd" style="gap: 10px; flex-wrap: wrap"><span class="pill warn">Two QC fails</span><span class="sub">go to the Stuck list. Ana clears it in one run a day, and at most 3 cards reach you per batch.</span></div>
</section>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 16px">
${rules.map((r) => `<section class="card" style="gap: 6px; padding: 18px"><span class="krv" style="font-size: 15px; color: var(--muted)">${esc(r.n)}</span><b style="font-size: 15px">${esc(r.t)}</b><span class="sub" style="font-size: 13px">${esc(r.d)}</span></section>`).join('')}
</div>`;
}

function teamHtml() {
  return `<div class="row">
<section class="card" style="flex: 3 1 440px; gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px">${chipIc('team')}<h2>The team: nine roles</h2></div>
<p class="sub" style="margin: 8px 0 4px">A role is a workspace with its rules, tools and model. A project is a rule file that comes with the card, so one Writer serves every channel.</p>
${ROLES.map((r) => `<div class="srow" style="grid-template-columns: 124px minmax(0, 1fr) 150px; align-items: start"><div class="stack"><b>${esc(r[0])}</b><span class="mut" style="font-size: 12px">${esc(r[1])}</span></div><span class="sub">${esc(r[2])}</span><span class="mut" style="font-size: 12px">${esc(r[3])}</span></div>`).join('')}
</section>
<section class="card" style="flex: 2 1 320px; gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px">${chipIc('clock')}<h2>Your day</h2></div>
<p class="sub" style="margin: 8px 0 4px">Two batches, at 8:00 AM and 4:00 PM Pacific, in one queue.</p>
${day.map((r) => `<div class="srow" style="grid-template-columns: 84px minmax(0, 1fr); align-items: start"><b>${esc(r.t)}</b><span class="sub">${esc(r.d)}</span></div>`).join('')}
</section>
</div>`;
}

function goalsHtml() {
  const cards = OBJ.map((o) => `<section class="card" style="gap: 0">
<div class="hd cardhd" style="align-items: flex-start; margin-bottom: 4px"><span class="pill" style="flex: none">${esc(o.id)}</span><div class="stack" style="gap: 4px"><h2 style="line-height: 1.3">${esc(o.o)}</h2><span class="mut" style="font-size: 12px">Owner: ${esc(o.owner)} · ${esc(o.star)}</span></div></div>
${o.krs.map((k, i) => { const r = krOf(k, i, true); return krRow(r, '20px minmax(0, 1fr)', `<span>${esc(r.proj)}</span>`); }).join('')}
</section>`).join('');
  return `<p class="sub" style="margin: 0; padding: 0 4px; max-width: 110ch">December 2026: one set of objectives for the whole team, three at most, plus your personal one. Everything else on the map runs as business as usual and shows as a health number, not a goal.</p>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(440px, 100%), 1fr)); gap: 16px">${cards}</div>
<section class="card" style="gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px">${chipIc('list')}<h2>How goals run</h2></div>
${rhythm.map((r) => `<div class="srow ${r.first}" style="grid-template-columns: 120px minmax(0, 1fr); align-items: start"><b>${esc(r.t)}</b><span class="sub">${esc(r.d)}</span></div>`).join('')}
</section>`;
}

const BODY = { map: mapHtml, moves: movesHtml, team: teamHtml, goals: goalsHtml };

export function renderSystem(d2resp, ui = {}) {
  const tab = BODY[ui.syTab] ? ui.syTab : 'map';
  return `${headerOnly(d2resp, 'System', 'Every project, its target, and the parts behind it', '<span class="pill sp">The new system, as designed on Nov 10</span>')}
${tabsHtml(SY_TABS, tab, 'data-sytab')}
${BODY[tab](ui)}`;
}
