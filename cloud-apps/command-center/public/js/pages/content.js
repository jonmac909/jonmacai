import { pg, pill, btn, esc } from '../ui.js';

function actionBtn(a) {
  if (a.log) return `<button class="btn" data-log-post="1">${esc(a.label)}</button>`;
  return btn(a.label, { msg: a.msg, kind: a.kind, payload: a.payload });
}

function draftCard(d) {
  const daily = d.dailyDrafts;
  if (!daily) return '';
  const filter = daily.filter || 'all';
  const platforms = [...new Set(daily.rows.map((r) => r.platform))];
  const filters = ['all', ...platforms].map((p) => {
    const on = filter === p ? ' btn' : ' btn line';
    return `<button class="${on.trim()}" data-draft-filter="${esc(p)}">${esc(p === 'all' ? 'All' : p)}</button>`;
  }).join('');
  const rows = daily.rows.filter((r) => filter === 'all' || r.platform === filter).map((r) => {
    const approve = r.status === 'approved' ? '' : btn('Approve', {
      kind: r.approveKind, payload: { id: r.id }, confirm: 'Approve this draft? Nothing will be posted.', cls: 'line', sm: true,
    });
    const save = btn('Save edit', {
      kind: r.saveKind, payload: { id: r.id }, cls: 'line', sm: true, readDraft: true,
    });
    const err = r.error ? `<small>${esc(r.error)}</small>` : '';
    return `<div class="r" data-draft-platform="${esc(r.platform)}"><div><strong>${esc(r.platform)} · slot ${esc(r.slot)}</strong> ${pill(r.statusLabel, r.status === 'failed' ? 'crit' : r.status === 'approved' ? 'ok' : '')}${err}<textarea class="draftbody" data-draft-body>${esc(r.body)}</textarea></div><div class="right">${save}${approve}</div></div>`;
  }).join('');
  const missing = (daily.unavailable || []).map((u) => `<div class="r"><div><strong>${esc(u.platform)}</strong><small>Unavailable · ${esc(u.reason)}</small></div></div>`).join('');
  const empty = rows ? '' : `<p class="note">${esc(daily.error || 'No drafts for this day yet. Fill uses connected product facts and does not post.')}</p>`;
  const n = daily.rows.length;
  return `<details class="card pad drafts"><summary><h2>${esc(daily.title)}</h2><span class="meta">${n} draft${n === 1 ? '' : 's'} · ${esc(daily.meta)}</span></summary><div class="dfilters">${filters}</div>${daily.error ? `<p class="note">${esc(daily.error)}</p>` : ''}<div class="rows">${rows}${missing}${empty}</div></details>`;
}

function outputCard(o) {
  const bar = o.pct == null
    ? '<div class="pg idle"><i style="width:0"></i></div>'
    : pg(o.pct, o.pct >= 80 ? 'ok' : o.pct >= 40 ? 'risk' : 'crit');
  return `<div class="card fcard" data-fkind="${esc(o.key)}">
    <div class="sm muted">${esc(o.label)} · ${esc(o.owner)}</div>
    <div class="fnum"><b>${esc(o.value)}</b> <span class="muted">/ ${esc(o.target)}</span></div>
    ${bar}
    <div class="xs muted">${esc(o.sub)}</div>
  </div>`;
}

function flow(f) {
  const steps = (f.steps || []).map((s) => `<div><span class="sm muted">${esc(s.label)}</span><b>${esc(s.value)}</b><span class="xs muted">${esc(s.sub)}</span></div>`).join('');
  return `<div class="card pad"><div class="cardhead"><h2>${esc(f.title)}</h2><span class="meta">${esc(f.note)}</span></div><div class="fflow">${steps}</div></div>`;
}

function boardItem(it) {
  const blocked = it.blocked ? `<div class="xs bad">${esc(it.blocked)}</div>` : '';
  const action = it.slug
    ? `<a class="btn sm line" href="/review/${esc(it.slug)}" target="_blank" rel="noopener">Open</a>`
    : '';
  return `<article class="fit" data-fkind="${esc(it.kind)}">
    <div class="ch">${esc(it.chip || it.kind)}</div>
    <div class="t">${esc(it.title)}</div>
    <div class="m"><span>${esc(it.stage || '')}</span><span>${esc(it.meta || '')}</span></div>
    ${blocked}${action}
  </article>`;
}

function board(b) {
  const cols = (b || []).map((c) => `<div class="fcol">
    <h3>${esc(c.title)} <span class="kn">${c.items.length}</span></h3>
    ${c.items.map(boardItem).join('')}
    ${c.items.length ? '' : `<p class="kempty">${esc(c.empty || 'Nothing here')}</p>`}
    ${c.note ? `<p class="kempty">${esc(c.note)}</p>` : ''}
  </div>`).join('');
  return `<div class="fkan">${cols}</div>`;
}

export function render(d, data) {
  const fm = d.factory || { title: d.title, sub: d.sub, chips: [], outputs: [], funnel: null, board: [] };
  const right = `${(d.actions || []).map(actionBtn).join('')}${data?.pages?.home?.waiting?.count ? pill(`${data.pages.home.waiting.count} waiting on you`, 'risk') : ''}`;
  const chips = (fm.chips || []).map((c, i) => `<button class="chip${i === 0 ? ' on' : ''}" data-chip="${esc(c.id)}">${esc(c.label)}</button>`).join('');
  const best = (d.bestPosts?.rows || []).map((r) => `<tr><td>${esc(r.post)}</td><td>${esc(r.platform)}</td><td class="num">${esc(r.views)}</td><td class="num">${esc(r.clicks)}</td><td class="num">${esc(r.sales)}</td><td class="num">${btn(d.bestPosts.btn, { msg: d.bestPosts.msg, kind: r.kind, payload: r.payload, cls: 'line', sm: true })}</td></tr>`).join('');
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(fm.title || 'Content Factory')}</h1><p>${esc(fm.sub || '')}</p></div><div class="right">${right}</div></div>
  <div class="chips">${chips}</div>
  ${fm.note ? `<p class="note" style="text-align:left">${esc(fm.note)}</p>` : ''}
  <div class="fout">${(fm.outputs || []).map(outputCard).join('')}</div>
  ${fm.funnel ? flow(fm.funnel) : ''}
  ${board(fm.board)}
  ${draftCard(d)}
  ${best ? `<div class="card pad"><div class="cardhead"><h2>${esc(d.bestPosts.title)}</h2><span class="meta">${esc(d.bestPosts.meta)}</span></div><div class="tblwrap"><table><thead><tr><th>Post</th><th>Platform</th><th class="num">Views</th><th class="num">Clicks</th><th class="num">Sales</th><th></th></tr></thead><tbody>${best}</tbody></table></div></div>` : ''}
</div>`;
}
