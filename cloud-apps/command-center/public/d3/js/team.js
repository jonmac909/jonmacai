// Dashboard 3 Team page (docs/dashboard-3.md). A pure function from the /dashboard/api/d2 and /dashboard/api/d3 answers
// to HTML, laid out as the approved design (Team.dc.html). The roster and every number come from d3.team (dashboard
// cards, proofs and runs; the video board from each card's stage); runs, tokens and cost have no feed yet and say "No feed".
import { esc, icon } from './util.js';
import { headerOnly, periodOf } from './goals.js';

// The video line's stages and their time limits, as designed. The limits are proposed, not agreed (the note says so).
const STAGES = [['Brief', '4 h'], ['Script', '4 h'], ['Script QC', '2 h'], ['A-roll', '4 h'], ['Pack', '8 h'], ['Edit', '8 h'], ['Render QC', '2 h'], ['Publish', '3 d']];
const COUNTS = [['doing', 'doing'], ['waiting_on_jon', 'waiting on you'], ['qc', 'in QC'], ['todo', 'to do'], ['review', 'in Review']];
const NF = '<span class="mut nf">No feed</span>';
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const kTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

function tile(ic, label, sub, value) {
  const v = value == null ? '<b class="num sp nf">No feed</b>' : `<b class="num sp" style="font-size: 30px">${esc(value)}</b>`;
  return `<div class="tile" style="flex: 1 1 200px"><span class="chip">${icon(ic)}</span><span class="stack" style="white-space: nowrap"><b>${esc(label)}</b><span class="mut">${esc(sub)}</span></span>${v}</div>`;
}

function botRow(b, open, costHd) {
  const c = b.card;
  const counts = b.counts || {};
  const last = [];
  if (c?.updated) last.push(`updated ${c.updated} ago`);
  if (!c && counts.review) last.push(`${counts.review} in Review`);
  if (b.failedToday) last.push(`${b.failedToday} failed today`);
  const working = c
    ? `<span class="ell" style="font-weight: 500">${esc(c.title)}</span>`
    : '<span class="ell nf" style="font-weight: 500">No open card</span>';
  const running = b.running == null ? NF : `<span class="krv">${esc(b.running || '–')}</span>`;
  const row = `<button type="button" class="brow" aria-expanded="${open}" data-bot="${esc(b.slug)}">
<span class="hd"><span class="av" style="width: 32px; height: 32px; font-size: 13px">${esc((b.names[0] || '?').charAt(0))}</span><span class="stack"><b class="ell">${esc(b.names.join(', '))}</b><span class="mut ell" style="font-size: 12px">${esc(b.role)}</span></span></span>
<span class="stack"><span class="hd" style="gap: 8px"><span class="dot ${esc(b.tone)}"></span>${working}</span><span class="mut ell" style="font-size: 12px; padding-left: 16px">${esc(last.join(' · ') || ' ')}</span></span>
<span><span class="pill">${esc(c ? c.stage : 'Idle')}</span></span>
${running}
<span class="sub">${esc(c?.due || '–')}</span>
${num(b.tokens) ? `<span class="sub">${esc(kTokens(b.tokens))}</span>` : NF}
<span style="text-align: right" aria-label="${esc(costHd)}">${NF}</span>
</button>`;
  if (!open) return `<div>\n${row}\n</div>`;
  const done = b.finishedToday == null ? `<span class="nf">No data</span>`
    : b.finishedToday.length ? b.finishedToday.map((t) => `<div class="hd" style="gap: 8px"><span class="dot g"></span><span>${esc(t)}</span></div>`).join('')
      : '<span class="sub">Nothing yet</span>';
  const tally = COUNTS.filter(([k]) => counts[k]).map(([k, w]) => `${counts[k]} ${w}`);
  const work = c ? `<p class="sub" style="white-space: pre-line">${esc(c.note || 'No note on this card yet.')}</p>` : '<p class="sub">No open card.</p>';
  return `<div>
${row}
<div class="row" style="gap: 12px; padding-bottom: 14px">
<div class="inner" style="flex: 1 1 240px"><span class="mut">Finished today</span>${done}</div>
<div class="inner" style="flex: 2 1 360px"><span class="mut">Work so far</span>${work}<span class="mut">${esc(tally.length ? `Open cards: ${tally.join(', ')}` : 'No open cards')}</span></div>
</div>
</div>`;
}

// The video board from d3.team.line: every open card with a stage, by stage, with the count, the oldest card's time in
// the stage and up to 3 cards per stage (oldest first). No line (cards could not be read): each stage says No feed.
function boardHtml(L) {
  const cols = L ? L.stages : STAGES.map(([name, limit]) => ({ name, limit, none: true }));
  const stages = cols.map((s) => {
    const body = s.none ? '<span class="nf" style="font-size: 12px">No feed</span>'
      : s.n ? `${s.cards.map((c) => `<div class="vcard"><span style="font-weight: 500; font-size: 12px; line-height: 1.3; overflow-wrap: anywhere">${esc(c.title)}</span><span class="hd mut" style="gap: 6px; font-size: 12px"><span class="dot ${esc(c.tone)}" style="width: 7px; height: 7px"></span>${esc(c.age)}</span></div>`).join('')}${s.more ? `<span class="mut" style="font-size: 12px">+${s.more} more</span>` : ''}`
        : '<span class="mut" style="font-size: 12px">None</span>';
    const sub = [s.limit ? `limit ${s.limit}` : 'no limit', s.oldest ? `oldest ${s.oldest}` : ''].filter(Boolean).join(' · ');
    return `<div class="stage" data-stage="${esc(s.key || s.name)}">
<div class="hd" style="justify-content: space-between; gap: 4px"><b class="ell" style="font-size: 13px">${esc(s.name)}</b><span class="krv${s.none ? ' nf' : ''}">${s.none ? '–' : s.n}</span></div>
<span class="mut" style="font-size: 11px; margin-top: -6px">${esc(sub)}</span>
${body}
</div>`;
  }).join('\n');
  const late = !L ? '<span class="pill sp">Late: No feed</span>' : `<span class="pill${L.late ? ' bad' : ''} sp">${L.late} late</span>`;
  return `<section class="card">
<div class="hd cardhd"><span class="chip">${icon('board')}</span><h2>Video board</h2><span class="mut">every video in the line, by stage</span>${late}</div>
<div class="board" style="grid-template-columns: repeat(${cols.length}, minmax(0, 1fr))">
${stages}
</div>
<div class="hd mut" style="gap: 6px 14px; flex-wrap: wrap; font-size: 12px"><span class="hd" style="gap: 6px"><span class="dot g"></span>inside the limit</span><span class="hd" style="gap: 6px"><span class="dot r"></span>past the limit</span><span>Limits are proposed, not agreed.</span></div>
</section>`;
}

// ---- Cards by owner (Jon, 2026-11-11): chips per bot, then the All view (five counts per bot) or one bot's kanban. ----
// The cards are d3.team.bots[].cards (+ d3.team.others); each opens the Projects page's card view on the old dashboard.
const KAN = [['todo', 'To do'], ['doing', 'Doing'], ['qc', 'QC'], ['waiting_on_jon', 'Needs you'], ['review', 'Review']];
const nOf = (b, k) => b.cards?.[k]?.length || 0;
const openN = (b) => KAN.reduce((n, [k]) => n + nOf(b, k), 0);
const first = (b) => (b.names?.[0] || b.slug).split(' ')[0];

function cardsHtml(T, ui) {
  const owners = [...T.bots, ...(T.others ? [T.others] : [])];
  const sel = owners.find((b) => b.slug === ui.teamBot) || null;
  const chip = (slug, label, sub, on, off) => `<button type="button" class="btn tm${off ? ' off' : ''}" data-tm="${esc(slug)}" aria-pressed="${on}"><b>${esc(label)}</b><span class="mut">${esc(sub)}</span></button>`;
  const chips = [chip('all', 'All', `${T.openTotal} open`, !sel, false)].concat(owners.map((b) => {
    const n = openN(b);
    return chip(b.slug, first(b), n ? `${b.role}: ${nOf(b, 'doing')} doing, ${nOf(b, 'review')} review` : `${b.role}: no open cards`, sel === b, !n);
  })).join('');
  const cut = T.cut ? `<p class="mut">List cut at ${T.openTotal} open cards.</p>` : '';
  let body;
  if (!sel) {
    const head = `<div class="tmrow thead"><span>Bot</span>${KAN.map(([, w]) => `<span>${esc(w)}</span>`).join('')}</div>`;
    body = head + owners.map((b) => `<div class="tmrow"><span class="ell"><b>${esc(first(b))}</b> <span class="mut">${esc(b.role)}</span></span>${KAN.map(([k, w]) => {
      const n = nOf(b, k);
      return n ? `<button type="button" class="btn tmn" data-tmcol="${esc(b.slug)}|${k}" aria-label="${esc(`${first(b)} ${w}: ${n}`)}">${n}</button>` : '<span class="mut tmn">0</span>';
    }).join('')}</div>`).join('');
  } else {
    body = `<div class="tmkan">${KAN.map(([k, w]) => {
      const cs = sel.cards?.[k] || [];
      const items = cs.length ? cs.map((c) => `<a class="vcard tmcard" href="/dashboard/?card=${esc(c.id)}#projects"><span style="font-weight: 500; overflow-wrap: anywhere">${esc(c.title)}</span><span class="mut" style="font-size: 12px">${esc([c.project, c.stage, c.ago].filter(Boolean).join(' · '))}</span></a>`).join('')
        : '<span class="mut" style="font-size: 12px">None</span>';
      return `<div class="stage${ui.teamCol === k ? ' tmon' : ''}" data-tmk="${k}"><div class="hd" style="justify-content: space-between"><b>${esc(w)}</b><span class="krv">${cs.length}</span></div>${items}</div>`;
    }).join('')}</div>`;
  }
  return `<section class="card">
<div class="hd cardhd"><span class="chip">${icon('board')}</span><h2>Cards by bot</h2><span class="mut">every open card, by owner</span></div>
<div class="tmchips">${chips}</div>
${cut}${body}
</section>`;
}

export function renderTeam(d2resp, d3resp, ui = {}) {
  const T = d3resp?.d3?.team || null;
  const P = periodOf(d2resp);
  const span = P.ymd ? `${P.monthShort} 1–${P.day}` : 'this month';
  const costHd = `Cost ${span}`;
  // Header and Working tile read the same counts: bot names and roster roles.
  const roles = T ? plural(T.bots.length, 'role') : '';
  const sub = T ? `${plural(T.names, 'bot')} · ${roles}` : '';
  const head = headerOnly(d2resp, 'Team', sub, '<span class="pill sp">Runs, tokens and cost: No feed</span>');
  const tiles = `<div class="row">
${tile('bolt', 'Working', T ? `of ${roles}` :'cards in Doing', T ? T.working : null)}
${tile('you', 'Waiting on you', T?.waiting?.oldest ? `oldest ${T.waiting.oldest}` : 'cards', T ? T.waiting.count : null)}
${tile('blockers', 'Failed', 'today', T && num(T.failedToday) ? T.failedToday : null)}
${tile('money', 'Cost', span, null)}
</div>`;
  const rows = T
    ? T.bots.map((b) => botRow(b, ui.openBot === b.slug, costHd)).join('\n')
    : '<p class="mut" style="padding-top: 12px">No feed: the dashboard cards could not be read.</p>';
  return `${head}
${T ? cardsHtml(T, ui) : ''}
${tiles}
<section class="card" style="gap: 0">
<div class="hd cardhd" style="margin-bottom: 4px"><span class="chip">${icon('team')}</span><h2>Bots</h2><span class="mut sp">Click a row to see its work</span></div>
<div class="brow thead"><span>Bot</span><span>Working on</span><span>Stage</span><span>Running</span><span>Due</span><span>Tokens</span><span style="text-align: right">${esc(costHd)}</span></div>
${rows}
</section>
${boardHtml(T?.line)}`;
}
