export function barWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return `max(2px, ${Math.min(100, n)}%)`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function ico(name) {
  return `<span class="ico"><svg class="ic"><use href="#i-${esc(name)}"/></svg></span>`;
}

export function pg(value, cls = '', min) {
  const w = barWidth(value);
  const extra = min ? `;min-width:${min}` : '';
  return `<div class="pg${cls ? ` ${esc(cls)}` : ''}"><i style="width:${w}${extra}"></i></div>`;
}

export function pill(text, cls = '') {
  return `<span class="pill${cls ? ` ${esc(cls)}` : ''}">${esc(text)}</span>`;
}

export function tile(t) {
  const goal = t.goal ? ` <span>${esc(t.goal)}</span>` : '';
  const bar = t.pct == null ? '' : pg(t.pct, t.pg || (t.tall ? 'tall' : ''));
  const sub = t.subHtml ? `<span class="sub">${t.subHtml}</span>` : (t.sub ? `<span class="sub">${esc(t.sub)}</span>` : '');
  return `<div class="card tile"><div class="t">${ico(t.icon)}<div><small>${esc(t.label)}</small><b>${esc(t.value)}${goal}</b></div></div>${bar}${sub}</div>`;
}

export function tiles(list) {
  return `<div class="tiles">${list.map(tile).join('')}</div>`;
}

export function pgrow(r) {
  const cls = [r.pg, r.tall ? 'tall' : ''].filter(Boolean).join(' ');
  return `<div class="pgrow"><div class="lab"><span>${esc(r.label)}</span><span>${esc(r.value)}</span></div>${pg(r.pct, cls, r.min)}</div>`;
}

export function card(inner, cls = 'pad') {
  return `<div class="card ${cls}">${inner}</div>`;
}

export function btn(label, { page, msg, done, cls = '', sm, kind, payload, href, edit } = {}) {
  const bits = [`class="btn${cls ? ` ${cls}` : ''}${sm ? ' sm' : ''}"`];
  if (page) bits.push(`data-page="${esc(page)}"`);
  if (kind) bits.push(`data-kind="${esc(kind)}"`);
  if (payload) bits.push(`data-payload="${esc(JSON.stringify(payload))}"`);
  if (href) bits.push(`data-href="${esc(href)}"`);
  if (edit) bits.push('data-edit="1"');
  if (msg) bits.push(`data-msg="${esc(msg)}"`);
  if (done) bits.push('data-done');
  return `<button ${bits.join(' ')}>${label}</button>`;
}

export function job(j) {
  const foot = [
    j.lineBtn ? btn(j.lineBtn, { page: j.linePage, msg: j.lineMsg, cls: 'line' }) : '',
    j.btn ? btn(j.btn, { page: j.page, msg: j.msg, done: j.done, cls: j.btnCls || '' }) : '',
  ].join('');
  return `<article class="card job"><div class="top"><span class="area">${esc(j.area)}</span>${pill(j.pill, j.pillCls || '')}</div><h3>${esc(j.title)}</h3><ul>${(j.lines || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul><div class="foot">${foot}</div></article>`;
}

export function table(headers, rows, foot) {
  const th = headers.map((h) => (h.num ? `<th class="num">${esc(h.label)}</th>` : `<th>${esc(h.label)}</th>`)).join('');
  return `<div class="tblwrap"><table><thead><tr>${th}</tr></thead><tbody>${rows.join('')}</tbody>${foot || ''}</table></div>`;
}

export function kanban(columns) {
  const cols = columns.map((c) => {
    const cards = (c.cards || []).map((k) => {
      const b = k.btn ? btn(k.btn, { page: k.page, msg: k.msg, cls: k.btnCls || '', sm: true, kind: k.kind, payload: k.payload }) : '';
      return `<article class="kcard" draggable="true" data-amt="${k.amt || 0}" data-id="${esc(k.id || '')}"><div class="ktop"><strong>${esc(k.name)}</strong>${pill(k.pill, k.pillCls || '')}</div><small>${esc(k.detail)}</small>${pg(k.pct, k.pg || '')}<div class="kfoot"><span class="kamt">${esc(k.amtLabel)}</span>${b}</div></article>`;
    }).join('');
    const empty = c.empty ? `<p class="kempty"${c.cards?.length ? ' hidden' : ''}>${esc(c.empty)}</p>` : '';
    return `<div class="kcol" data-stage="${esc(c.stage)}" data-board="${esc(c.boardStage || '')}"><h3>${esc(c.stage)} <span class="kn"></span></h3>${cards}${empty}</div>`;
  }).join('');
  return `<div class="kan" id="kan">${cols}</div>`;
}

export function dots(list) {
  return `<div class="dots">${list.map((d) => {
    const [cls, ch] = d.split(':');
    return `<i class="${esc(cls)}">${esc(ch)}</i>`;
  }).join('')}</div>`;
}

export function head(title, sub, right = '') {
  return `<div class="head"><div><h1>${esc(title)}</h1><p>${sub}</p></div>${right ? `<div class="right">${right}</div>` : ''}</div>`;
}

export function cardhead(title, meta, icon) {
  const h = icon
    ? `<h2><svg class="ic"><use href="#i-${esc(icon)}"/></svg>${esc(title)}</h2>`
    : `<h2>${title}</h2>`;
  return `<div class="cardhead">${h}${meta || ''}</div>`;
}
