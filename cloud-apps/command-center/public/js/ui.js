export function barWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return `max(2px, ${Math.min(100, n)}%)`;
}

// Jon: never one word alone on a line. CSS text-wrap:pretty catches most; this joins the last two
// words of each line of text with a no-break space, but only when the pair fits on one line of its
// box, so a narrow phone card still wraps instead of overflowing. Table columns widen to fit, so a
// cell takes any pair up to 24 characters ("Oct 19"). Takes a node or a list, reads every width
// first, then writes (one layout). Running it twice changes nothing. Words are capped at 60
// characters so a long run with no spaces (raw JSON) stays fast.
const LAST_PAIR = /(\S{1,60}) (\S{1,60})(?=[ \t\r]*(?:\n|$))/g;
export function noLoneWords(roots) {
  const nodes = [];
  for (const root of [].concat(roots)) {
    if (root.nodeType === 3) nodes.push(root);
    else for (let w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
  }
  const edits = [];
  for (const n of nodes) {
    if (!n.parentElement || n.parentElement.closest('textarea,pre,code,script,style,option')) continue;
    let box = n.parentElement;
    while (box && !box.clientWidth) box = box.parentElement; // inline parents have no width
    const cell = box?.closest('td,th');
    const css = box && getComputedStyle(box);
    const room = box ? box.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) : 0;
    const r = document.createRange();
    // A word's widest box: Chrome adds a stray box for a word that ends at a line break.
    const measure = (from, to) => { r.setStart(n, from); r.setEnd(n, to); return Math.max(0, ...[...r.getClientRects()].map((x) => x.width)); };
    const t = n.nodeValue.replace(LAST_PAIR, (m, a, b, at) => {
      // Each word on its own: a space at a line break measures to the end of the line.
      const width = measure(at, at + a.length) + measure(at + a.length + 1, at + m.length);
      // Not laid out yet (hidden): join only short pairs.
      return (cell ? m.length <= 24 : width ? width + 6 <= room : m.length <= 18) ? `${a}\u00a0${b}` : m;
    });
    if (t !== n.nodeValue) edits.push([n, t]);
  }
  for (const [n, t] of edits) n.nodeValue = t;
}

// The team by first name: Jon reads names, not bot slugs.
export const BOT_NAMES = {
  jon: 'You', ana: 'Ana', sponsors: 'Florence', 'video-editor': 'Olivia', 'viral-view': 'Scarlett', 'jon-mac-youtube': 'Sydney',
  'home-guide-press': 'Elle', 'short-form': 'Samantha', accounting: 'Elizabeth', developer: 'Lucy', qc: 'Jessica', inbox: 'Zendaya',
  spotify: 'Daisy', moneyclaw: 'Mila', historient: 'Emma',
};
export const botName = (slug) => BOT_NAMES[String(slug ?? '').toLowerCase()] || String(slug ?? '');

// What a link does when Jon clicks it, never the raw URL.
export function linkLabel(url, kind) {
  const u = String(url || '').toLowerCase();
  if (u.includes('mail.google.com')) return /draft/.test(u) ? 'Open draft in Gmail' : 'Open in Gmail';
  if (/youtube\.com|youtu\.be|jonmac\.ai\/review|\.(mp4|mov|webm)(\?|#|$)/.test(u) || kind === 'render') return 'Watch video';
  if (/\.pdf(\?|#|$)/.test(u) || kind === 'pdf') return 'Open PDF';
  if (u.includes('docs.google.com/spreadsheets')) return 'Open sheet';
  if (u.includes('docs.google.com')) return 'Open doc';
  if (u.includes('drive.google.com')) return 'Open in Drive';
  if (kind === 'test') return 'Open test results';
  return 'Open page';
}

// "today 10:50", "yesterday 10:50", "Oct 28" (plus the year when it isn't this year).
export function friendlyWhen(at, now = new Date()) {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return `today ${time}`;
  if (diff === 1) return `yesterday ${time}`;
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Bots by first name (Jon, 2026-10-30); the chips on Feed list them in this order.
export const BOT_NAMES = {
  sponsors: 'Florence', 'video-editor': 'Olivia', 'viral-view': 'Scarlett', 'jon-mac-youtube': 'Sydney', 'home-guide-press': 'Elle',
  'short-form': 'Samantha', accounting: 'Elizabeth', developer: 'Lucy', qc: 'Jessica', ana: 'Ana', inbox: 'Zendaya', spotify: 'Daisy',
};
export const botName = (slug) => (slug === 'jon' ? 'Jon' : Object.hasOwn(BOT_NAMES, slug) ? BOT_NAMES[slug] : String(slug ?? ''));

// Friendly dates in Jon's time zone: "today 10:50", "yesterday 18:05", "Mon 09:10", "Oct 12", "Oct 12, 2025".
const TZ = 'America/Vancouver';
const fmt = (ms, opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(ms);
const dayNo = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000;
const ymdOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ms);

// A YYYY-MM-DD day: "today", "yesterday", "tomorrow", else "Oct 27".
export function dayLabel(ymd, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return '';
  const diff = dayNo(ymdOf(now)) - dayNo(ymd);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff === -1) return 'tomorrow';
  const ms = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), 12);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(ymd.slice(0, 4) !== ymdOf(now).slice(0, 4) ? { year: 'numeric' } : {}) }).format(ms);
}

// A moment: "today 10:50", "yesterday 10:50", "Mon 10:50" this week, else the day.
export function whenLabel(at, now = Date.now()) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return '';
  const time = fmt(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const diff = dayNo(ymdOf(now)) - dayNo(ymdOf(t));
  if (diff >= 0 && diff <= 1) return `${diff ? 'yesterday' : 'today'} ${time}`;
  if (diff > 1 && diff < 7) return `${fmt(t, { weekday: 'short' })} ${time}`;
  return dayLabel(ymdOf(t), now);
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Text with its web links as short, clickable host labels (never a raw URL), everything escaped.
export const URL_RE = /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]])/i;
export function linkify(text) {
  return String(text ?? '').split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    const host = hostOf(part);
    return host ? `<a href="${esc(part)}" target="_blank" rel="noopener">${esc(host)}</a>` : 'link';
  }).join('');
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

export function btn(label, { page, msg, done, cls = '', sm, kind, payload, href, edit, confirm, draft } = {}) {
  const bits = [`class="btn${cls ? ` ${cls}` : ''}${sm ? ' sm' : ''}"`];
  if (page) bits.push(`data-page="${esc(page)}"`);
  if (kind) bits.push(`data-kind="${esc(kind)}"`);
  if (payload) bits.push(`data-payload="${esc(JSON.stringify(payload))}"`);
  if (href) bits.push(`data-href="${esc(href)}"`);
  if (edit) bits.push('data-edit="1"');
  if (draft) bits.push('data-draft="1"');
  if (confirm) bits.push(`data-confirm="${esc(confirm)}"`);
  if (msg) bits.push(`data-msg="${esc(msg)}"`);
  if (done) bits.push('data-done');
  return `<button ${bits.join(' ')}>${label}</button>`;
}

export function table(headers, rows, foot) {
  const th = headers.map((h) => (h.num ? `<th class="num">${esc(h.label)}</th>` : `<th>${esc(h.label)}</th>`)).join('');
  return `<div class="tblwrap"><table><thead><tr>${th}</tr></thead><tbody>${rows.join('')}</tbody>${foot || ''}</table></div>`;
}

export function kanban(columns) {
  const cols = columns.map((c) => {
    const cards = (c.cards || []).map((k) => {
      const b = k.btn ? btn(k.btn, { page: k.page, msg: k.msg, cls: k.btnCls || '', sm: true, kind: k.draft ? '' : k.kind, payload: k.payload, draft: k.draft }) : '';
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

export function formatJobResult(kind, result) {
  if (!result) return 'Done';
  try {
    const r = JSON.parse(result);
    if (r && typeof r === 'object') {
      if (r.access === 'unavailable' || r.error) return `Scan failed: ${r.error || r.connector || 'source unavailable'}`;
      if (r.empty) return `No messages in the last 24 hours${r.scannedAt ? ` · ${r.scannedAt}` : ''}`;
      if (kind === 'sponsor.scan_inbox') return `Scanned ${r.scanned ?? 0} · ${r.drafts ?? r.picks ?? 0} drafts`;
    }
  } catch { /* plain text */ }
  return String(result);
}
