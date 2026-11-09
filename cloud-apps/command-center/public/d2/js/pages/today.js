import { esc, botName } from '/dashboard/js/ui.js';
import { needItem } from '/dashboard/js/pages/today.js';
import { age, status, top } from './month.js';

// Today: at most 3 things for Jon, the team's targets for today, the daily checks, blockers, then the rest
// of Needs you. Questions and approvals use /dashboard's own cards, so Send, Approve and Reject work the same.
const web = (h) => /^https?:\/\//i.test(String(h || ''));
const linkBtn = (l) => (l && web(l.href) ? `<a class="btn line sm" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label || 'Open')}</a>` : '');
const item = (it) => needItem({ ...it, from: botName(it.from), project: '' }); // names, never bot slugs
const key = (it) => it.decideUrl || it.answerUrl || it.id || it.title;

function forJon(list, goals) {
  const title = (k) => goals.find((g) => g.key === k)?.title || '';
  const rows = list.slice(0, 3).map((it) => `<li class="d2jon">
    <p class="d2why">${title(it.goal) ? `Unblocks <b>${esc(title(it.goal))}</b> · ` : ''}${esc(it.minutes ?? 2)} min ${linkBtn(it.link)}</p>
    <ul class="qlist">${item(it)}</ul></li>`).join('');
  return `<section class="card pad"><div class="cardhead"><h2>For you</h2><span class="meta">${list.length ? 'What unblocks the most first' : ''}</span></div>
    ${rows ? `<ol class="d2jonlist">${rows}</ol>` : '<p class="muted">Nothing needs you right now.</p>'}</section>`;
}

function targets(list) {
  const rows = (list || []).map((t) => `<li><div class="d2t"><b>${esc(t.label)}</b>${status(t.status)}</div>
    <div class="d2meta">${t.display && t.display !== t.status?.text ? `<span><b>${esc(t.display)}</b></span>` : ''}<span>${esc(t.goalTitle)} · ${esc(t.owner)}</span>${age(t.source)}</div></li>`).join('');
  return `<section class="card pad"><div class="cardhead"><h2>Team targets today</h2></div>${rows ? `<ul class="d2list">${rows}</ul>` : '<p class="muted">No daily targets.</p>'}</section>`;
}

const MARK = { true: ['ok', '✓'], false: ['miss', '✗'], null: ['', 'not yet'] };
function checks(list) {
  if (!list?.length) return '';
  const rows = list.map((c) => {
    const t = c.today || {};
    const [cls, mark] = MARK[t.ok ?? null];
    const facts = (t.facts || []).map((f) => `<span>${esc(f.label)}: <b>${esc(f.value)}</b></span>`).join('');
    const links = (t.links || []).map(linkBtn).join('');
    return `<li><div class="d2t"><span class="d2mark ${cls}">${mark}</span><b>${esc(c.title)}</b><span class="muted">${esc(c.owner)}</span>${status(t.status)}</div>
      ${facts ? `<div class="d2facts">${facts}</div>` : ''}${links ? `<div class="qopts">${links}</div>` : ''}<div class="d2meta">${age(t.source)}</div></li>`;
  }).join('');
  return `<section class="card pad"><div class="cardhead"><h2>Daily checks</h2></div><ul class="d2list">${rows}</ul></section>`;
}

function blockers(list) {
  if (!list?.length) return '';
  const rows = list.map((b) => `<li${b.open ? ` tabindex="0" data-open="${esc(b.open)}"` : ''}><div class="d2t"><b>${esc(b.title)}</b></div>
    <div class="d2meta"><span>${esc(b.owner)}${b.ageLabel ? ` · ${esc(b.ageLabel)}` : ''}</span>${b.why ? `<span>${esc(b.why)}</span>` : ''}</div></li>`).join('');
  return `<section class="card pad"><div class="cardhead"><h2>Blockers</h2><span class="meta">${list.length}</span></div><ul class="d2list d2block">${rows}</ul></section>`;
}

// The rest of Needs you. Known charges sit folded under the one Expenses review item, answerable there.
function needs(t) {
  const n = t.needs || {};
  const shown = new Set((t.jon || []).map(key));
  const exp = t.expenses || {};
  const rows = (n.items || []).filter((it) => !shown.has(key(it))).map((it) => (exp.label && it.title === exp.label
    ? `<li class="nyi d2exp"><details data-keep="expenses"><summary><b>${esc(exp.label)}</b> <span class="muted">${esc(exp.count ?? (exp.items || []).length)} charges</span></summary>
        ${it.detail ? `<p class="qctx">${esc(it.detail)}</p>` : ''}<ul class="qlist">${(exp.items || []).map(item).join('')}</ul></details></li>`
    : item(it))).join('');
  const health = n.healthToAna ? `<p class="muted d2health">${n.healthToAna} team health alert${n.healthToAna === 1 ? '' : 's'} went to Ana</p>` : '';
  return `<section class="card pad"><div class="cardhead"><h2>Also needs you</h2></div>
    ${rows ? `<ul class="qlist nylist">${rows}</ul>` : '<p class="muted">Nothing else.</p>'}${health}</section>`;
}

// Daily Summary (docs/dashboard-2.md): the server words every line; this only lays it out. Open on a desktop, folded on a phone.
function summary(sum) {
  if (!sum?.sections?.length) return '';
  const wide = typeof matchMedia === 'function' ? matchMedia('(min-width: 700px)').matches : true;
  const body = (s) => {
    const rows = s.rows.map((r) => `<li class="${esc(r.cls || '')}"><span class="k">${esc(r.label)}</span>${r.value ? `<b class="v">${esc(r.value)}</b>` : ''}${r.sub ? `<span class="s">${esc(r.sub)}</span>` : ''}</li>`).join('');
    return `${s.line ? `<p class="d2note">${esc(s.line)}</p>` : ''}${rows ? `<ul class="d2sumrows">${rows}</ul>` : ''}${s.notes.map((n) => `<p class="d2sumnote">${esc(n)}</p>`).join('')}
      <p class="d2meta">${s.sources.length ? s.sources.map(age).join('') : `<span class="d2age">No source yet · owner ${esc(s.owner)}</span>`}</p>`;
  };
  return `<section class="card pad d2sum"><div class="cardhead"><h2>Daily Summary</h2></div><div class="d2sumgrid">${sum.sections.map((s) =>
    `<details class="d2sec d2sec-${esc(s.key)}" data-keep="sum-${esc(s.key)}"${wide ? ' open' : ''}><summary><b>${esc(s.title)}</b> <span class="muted">${esc(s.owner)}</span></summary>${body(s)}</details>`).join('')}</div></section>`;
}

export function render(data) {
  const d2 = data?.d2 || {};
  const t = d2.today || {};
  const day = d2.period?.today || {};
  return `<div class="wrap">
  ${top('Today', `${day.label || ''}${day.clock ? ` · ${day.clock} PT` : ''}`, d2)}
  ${summary(d2.summary)}
  ${forJon(t.jon || [], d2.goals || [])}
  <div class="split even">${targets(t.targets)}${checks(d2.checks)}</div>
  ${blockers(t.blockers)}
  ${needs(t)}
</div>`;
}
