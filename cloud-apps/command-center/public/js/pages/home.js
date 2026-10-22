import { pill, btn, esc } from '../ui.js';

function goalCard(g) {
  const width = g.pct == null ? 0 : Math.min(100, g.pct);
  const pace = g.pacePct == null ? '' : `<span class="pacemark" style="left:${Math.min(100, g.pacePct)}%" title="${esc(g.paceTitle || 'Where the number should be today')}"></span>`;
  const barCls = g.noData ? 'idle' : (g.status?.cls || '');
  const drivers = (g.drivers || []).map((d) => `<div><span>${esc(d.label)}</span><b>${esc(d.value)}</b></div>`).join('');
  return `<article class="card goal">
    <div class="ghead"><h3>${esc(g.label)}</h3>${pill(g.status?.text || 'No data', g.status?.cls || 'idle')}</div>
    <div class="big">${esc(g.value)} <span>${esc(g.goal)}</span></div>
    <div class="gbar ${barCls}"><i style="width:${width}%"></i>${pace}</div>
    <div class="gmeta"><span>${esc(g.metaLeft || '')}</span><span>${esc(g.metaRight || '')}</span></div>
    ${g.warn ? `<p class="gwarn">${esc(g.warn)}</p>` : ''}
    <div class="drivers">${drivers}</div>
  </article>`;
}

function askList(w) {
  const items = (w.items || []).map((it) => {
    const action = it.href
      ? `<a class="btn sm" href="${esc(it.href)}" target="_blank" rel="noopener">${esc(it.btn || 'Open')}</a>`
      : it.page
        ? btn(it.btn || 'Open', { page: it.page, cls: 'sm line' })
        : '';
    return `<li class="ask"><span class="dot ${it.pillCls === 'crit' ? 'crit' : it.pillCls === 'risk' ? 'risk' : 'idle'}"></span>
      <div class="grow"><div class="t">${esc(it.title)}</div><div class="s">${esc(it.detail || '')}</div></div>${action}</li>`;
  }).join('');
  const empty = items
    ? ''
    : w.available
      ? '<li class="ask"><div class="grow"><div class="t">Nothing waiting on you.</div><div class="s">The Waiting On You list and the production feed are both clear.</div></div></li>'
      : `<li class="ask"><div class="grow"><div class="t">No data.</div><div class="s">${esc(w.why || 'Neither source has reported.')}</div></div></li>`;
  return `<div class="card pad"><div class="cardhead"><h2>${esc(w.title || 'Waiting on you')}</h2><span class="meta">${w.count === 1 ? '1 item' : `${w.count || 0} items`}</span></div><ul class="asks2">${items}${empty}</ul></div>`;
}

function movedList(m) {
  const rows = (m.items || []).map((it) => `<li><span class="pill ${esc(it.cls || 'idle')}">${esc(it.pill)}</span><div class="grow">${esc(it.text)}</div></li>`).join('');
  return `<div class="card pad"><div class="cardhead"><h2>${esc(m.title || 'What moved the goals this week')}</h2><span class="meta">Last 7 days</span></div><ul class="list2">${rows}</ul></div>`;
}

// One row: checkbox, bold title (2 lines), status and note, then owner tag and time.
// A row with a link opens it on tap; the app handles [data-href] clicks.
function taskItem(t) {
  const tick = t.done ? '<svg class="ic"><use href="#i-check"/></svg>' : '';
  const stat = t.statusLabel ? `<span class="jtstat ${esc(t.tone || 'idle')}">${esc(t.statusLabel)}</span>` : '';
  const note = t.note ? `<span class="jtnote">${esc(t.note)}</span>` : '';
  const second = stat || note ? `<span class="jts">${stat}${stat && note ? '<i>·</i>' : ''}${note}</span>` : '';
  const meta = [t.ownerTag ? `<span class="jttag">${esc(t.ownerTag)}</span>` : '', t.asked ? `<span>${esc(t.asked)}</span>` : ''].filter(Boolean).join('<i>·</i>');
  const cls = `jtrow${t.done ? ' isdone' : ''}${t.link ? ' islink' : ''}`;
  const open = t.link ? ` data-href="${esc(t.link)}" role="link" tabindex="0"` : '';
  return `<li class="${cls}"${open}><span class="jtbox" aria-hidden="true">${tick}</span><span class="jtbody"><span class="jtt">${esc(t.task)}</span>${second}${meta ? `<span class="jtm">${meta}</span>` : ''}</span></li>`;
}

function taskList(list, empty) {
  if (!list || !list.length) return `<p class="jtnone">${esc(empty)}</p>`;
  return `<ul class="jtlist">${list.map(taskItem).join('')}</ul>`;
}

function taskBoard(t) {
  if (!t) return '';
  let tab = 'active';
  try { if (localStorage.getItem('cc-jt-tab') === 'next') tab = 'next'; } catch {}
  const done = t.doneToday || [];
  const active = `<div data-jtpanel="active"${tab === 'active' ? '' : ' hidden'}>${taskList(t.active, 'Nothing active.')}${done.length ? `<details class="jtdone"><summary>Done today ${done.length}</summary>${taskList(done, '')}</details>` : ''}</div>`;
  const next = `<div data-jtpanel="next"${tab === 'next' ? '' : ' hidden'}>${taskList(t.upNext, 'Nothing queued.')}</div>`;
  return `<section class="card pad jtcard" aria-label="Jon's tasks">
    <div class="jttabs" role="tablist">
      <button type="button" class="jttab${tab === 'active' ? ' on' : ''}" data-jtab="active" role="tab" aria-selected="${tab === 'active'}">Active</button>
      <button type="button" class="jttab${tab === 'next' ? ' on' : ''}" data-jtab="next" role="tab" aria-selected="${tab === 'next'}">Up next</button>
    </div>
    <p class="jtmeta"><span>Needs you ${Number(t.needsYou) || 0}</span><span>${t.updatedLabel ? `Updated ${esc(t.updatedLabel)}` : 'Not updated yet'}</span></p>
    ${active}${next}
  </section>`;
}

function stripCard(s) {
  const p = s.pill ? `<span class="pill ${esc(s.cls || 'idle')}">${esc(s.pill)}</span>` : '';
  return `<div class="card stripc"><small>${esc(s.label)}</small><div class="sv"><b>${esc(s.value)}</b>${p}</div><div class="s">${esc(s.sub || '')}</div></div>`;
}

export function render(d) {
  const g = d.goalCards || [];
  const strip = d.strip || [];
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(d.goalTitle || 'Three goals, $30k a month')}</h1><p>${esc(d.date || '')}${d.clock ? ` · ${esc(d.clock)} PT` : ''}</p></div>${d.goalPill ? pill(d.goalPill.text, d.goalPill.cls) : ''}</div>
  ${taskBoard(d.tasks)}
  <div class="goals">${g.map(goalCard).join('') || '<div class="card pad"><p class="muted">No goal data. The sponsor ledger, Viral View feed and funnel database have not reported.</p></div>'}</div>
  <div class="homelists">${askList(d.waiting || { items: [] })}${movedList(d.moved || { items: [] })}</div>
  <div class="strip">${strip.map(stripCard).join('')}</div>
</div>`;
}
