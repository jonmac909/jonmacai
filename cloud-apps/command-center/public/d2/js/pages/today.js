import { esc, botName } from '/dashboard/js/ui.js';
import { needItem } from '/dashboard/js/pages/today.js';
import { age, status, top } from './month.js';

// Today: at most 3 things for Jon (the rest and the blockers go to Ana: one muted line says how many), the team's
// targets for today and the daily checks. Questions and approvals use /dashboard's own cards, so Send, Approve and
// Reject work the same.
const web = (h) => /^https?:\/\//i.test(String(h || ''));
const linkBtn = (l) => (l && web(l.href) ? `<a class="btn line sm" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label || 'Open')}</a>` : '');
const item = (it) => needItem({ ...it, from: botName(it.from), project: '' }); // names, never bot slugs

// Known charges sit folded under the one Expenses review item (Fridays), answerable there.
function fold(it, exp) {
  return `<li class="nyi d2exp"><details data-keep="expenses"><summary><b>${esc(exp.label)}</b> <span class="muted">${esc(exp.count ?? (exp.items || []).length)} charges</span></summary>
    ${it.detail ? `<p class="qctx">${esc(it.detail)}</p>` : ''}<ul class="qlist">${(exp.items || []).map(item).join('')}</ul></details></li>`;
}

// What went to Ana instead: everything past Jon's 3 and the bot health alerts, as one muted line.
function toAna(a) {
  const parts = [a?.count && `${a.count} more went to Ana`, a?.health && `${a.health} team health alert${a.health === 1 ? '' : 's'} went to Ana`].filter(Boolean);
  return parts.length ? `<p class="muted d2ana">${esc(parts.join(' · '))}</p>` : '';
}

function forJon(t, goals) {
  const list = t.jon || [];
  const exp = t.expenses || {};
  const title = (k) => goals.find((g) => g.key === k)?.title || '';
  const rows = list.slice(0, 3).map((it) => `<li class="d2jon">
    <p class="d2why">${title(it.goal) ? `Unblocks <b>${esc(title(it.goal))}</b> · ` : ''}${esc(it.minutes ?? 2)} min ${linkBtn(it.link)}</p>
    <ul class="qlist">${exp.label && it.title === exp.label ? fold(it, exp) : item(it)}</ul></li>`).join('');
  return `<section class="card pad"><div class="cardhead"><h2>For you</h2><span class="meta">${list.length ? 'What unblocks the most first' : ''}</span></div>
    ${rows ? `<ol class="d2jonlist">${rows}</ol>` : '<p class="muted">Nothing needs you right now.</p>'}${toAna(t.toAna)}</section>`;
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
  ${top('Today', `${day.label || ''}${day.clock ? ` · ${day.clock} PT` : ''}`)}
  ${summary(d2.summary)}
  ${forJon(t, d2.goals || [])}
  <div class="split even">${targets(t.targets)}${checks(d2.checks)}</div>
</div>`;
}
