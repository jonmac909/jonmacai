import { pill, esc, linkLabel } from '../ui.js';

// Today (dashboard plan step 2): four goals, one Needs-you list with answer buttons in place,
// Ana's morning summary and Claude usage. Each card says where its numbers come from.
function src(s) {
  if (!s) return '';
  return `<p class="src${s.stale ? ' stale' : ''}">${esc(s.label)} · ${esc(s.ageLabel)}${s.stale ? ` ${pill('Stale', 'risk')}` : ''}</p>`;
}

export function goalCard(g) {
  const pace = g.pacePct == null ? '' : `<span class="pacemark" style="left:${Math.min(100, g.pacePct)}%" title="Where the number should be today"></span>`;
  const drivers = (g.drivers || []).map((d) => `<div><span>${esc(d.label)}</span><b>${esc(d.value)}</b></div>`).join('');
  return `<article class="card goal">
    <div class="ghead"><h3>${esc(g.label)}</h3>${pill(g.status.text, g.status.cls)}</div>
    <div class="big">${esc(g.value)} <span>${esc(g.goal)}</span></div>
    <div class="gbar ${g.usd == null ? 'idle' : g.status.cls}"><i style="width:${g.pct}%"></i>${pace}</div>
    ${g.meta ? `<div class="gmeta"><span>${esc(g.meta)}</span></div>` : ''}
    ${g.why ? `<p class="muted">${esc(g.why)}</p>` : ''}
    ${g.warn ? `<p class="gwarn">${esc(g.warn)}</p>` : ''}
    ${drivers ? `<div class="drivers">${drivers}</div>` : ''}
    ${src(g.source)}
  </article>`;
}

// Links come from pushed data: only web links and same-site paths become clickable.
const safeHref = (h) => (/^(https?:\/\/|\/(?![/\\]))/i.test(String(h || '')) ? h : '');

export function needItem(it, attrs = '') {
  it = { ...it, href: safeHref(it.href) };
  const meta = [it.from ? `<span class="jttag">${esc(it.from)}</span>` : '', it.project ? `<span>${esc(it.project)}</span>` : '', it.ageLabel ? `<span>${esc(it.ageLabel)}</span>` : '']
    .filter(Boolean).join('<i>·</i>');
  let act = '';
  if (it.kind === 'question') {
    const opts = (it.options || []).map((o) => `<button type="button" class="btn qopt" data-qopt="${esc(o)}">${esc(o)}</button>`).join('');
    act = `${opts ? `<div class="qopts">${opts}</div>` : ''}<div class="qform">
      <textarea class="qtext" rows="2" maxlength="4000" placeholder="Type your answer" aria-label="Your answer to: ${esc(it.title)}"></textarea>
      <button type="button" class="btn qsend" data-tsend="${esc(it.answerUrl)}">Send</button></div>`;
  } else if (it.kind === 'approval') {
    const preview = it.payloadPreview || '{}';
    const confirm = `Approve "${it.title}"? The bot will run ${it.action} with:\n${preview.length > 600 ? `${preview.slice(0, 600)}\n… (see the full list on the card)` : preview}`;
    act = `<details class="payload" open><summary>What it will run</summary><pre>${esc(preview)}</pre></details>
    <div class="qopts">
      <button type="button" class="btn" data-tdecide="${esc(it.decideUrl)}" data-decision="approve" data-confirm="${esc(confirm)}">Approve</button>
      <button type="button" class="btn line" data-tdecide="${esc(it.decideUrl)}" data-decision="reject">Reject</button></div>`;
  } else if (it.href) {
    act = `<div class="qopts"><a class="btn line" href="${esc(it.href)}" target="_blank" rel="noopener">${esc(it.btn || 'Open')}</a></div>`;
  } else if (it.page) {
    act = `<div class="qopts"><button type="button" class="btn line" data-page="${esc(it.page)}">${esc(it.btn || 'Open')}</button></div>`;
  }
  return `<li class="qcard nyi ${esc(it.cls || '')}"${attrs}>
    <div class="qmeta">${meta}</div>
    <h3 class="qq">${esc(it.title)}</h3>
    ${it.detail ? `<p class="qctx">${esc(it.detail)}</p>` : ''}
    ${it.context ? `<p class="qctx">${esc(it.context)}</p>` : ''}
    ${act}
  </li>`;
}

function needsCard(n) {
  const items = n.items || [];
  const list = items.length
    ? `<ul class="qlist nylist">${items.map((it) => needItem(it)).join('')}</ul>`
    : `<p class="muted">${n.available ? 'Nothing needs you right now.' : 'The bot tables could not be read.'}</p>`;
  return `<div class="card pad"><div class="cardhead"><h2>Needs you</h2><span class="meta">${items.length === 1 ? '1 item' : `${items.length} items`}</span></div>
    ${list}${(n.sources || []).map(src).join('')}</div>`;
}

// Ana writes the summary (and bots their card notes) in light Markdown: **bold**, [text](https://link), "- "
// bullets, blank line = new section. Escaped first, so only these forms become HTML; links must be http(s).
// A bare URL becomes a labelled link ("Open draft in Gmail"), never the raw address; a local path shows
// only its file name.
const LINKS = /\[([^\]]+)\]\((https?:\/\/(?:[^\s()<]|\([^\s()<]*\))+)\)|(https?:\/\/(?:[^\s<&]|&amp;)*(?:[^\s<&.,;:!?)\]]|&amp;))/g;
export const inline = (line) => esc(line)
  .replace(/\b[A-Za-z]:\\(?:[^\s<\\]+\\)*([^\s<\\]*)/g, '$1')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(LINKS, (m, text, href, bare) => (bare
    ? `<a href="${bare}" target="_blank" rel="noopener">${linkLabel(bare.replace(/&amp;/g, '&'))}</a>`
    : `<a href="${href}" target="_blank" rel="noopener">${text}</a>`));
export const HEADING = /^(?:\*\*)?(What happened|Your move|Next|Why|Status)(?:\*\*)?\s*:?\s*(?:\*\*)?$/i;

export function summaryHtml(text) {
  return String(text || '').trim().split(/\r?\n\s*\n/).map((section) => {
    const lines = section.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let html = '';
    let list = [];
    const flush = () => { if (list.length) html += `<ul>${list.join('')}</ul>`; list = []; };
    for (const line of lines) {
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      const heading = line.match(HEADING);
      if (bullet) list.push(`<li>${inline(bullet[1])}</li>`);
      else if (heading) { flush(); html += `<h4>${esc(heading[1])}</h4>`; }
      else { flush(); html += `<p>${inline(line)}</p>`; }
    }
    flush();
    return `<section>${html}</section>`;
  }).join('');
}

export function summaryCard(s) {
  const body = s.missing ? `<p class="muted">${esc(s.missing)}</p>` : `<div class="summary">${summaryHtml(s.text)}</div>`;
  return `<div class="card pad"><div class="cardhead"><h2>Morning summary</h2><span class="meta">${esc(s.date || '')}</span></div>${body}${src(s.source)}</div>`;
}

function usageCard(u) {
  const bots = u.bots ? `<p class="qctx">Bots reported ${u.bots.tokens.toLocaleString('en-US')} tokens over ${u.bots.runs} runs in the last 7 days.</p>` : '';
  const body = u.missing
    ? `<p class="muted">${esc(u.missing)}</p>`
    : `<div class="big">${esc(u.pct)}% <span>of the weekly limit</span></div>
      <div class="gbar ${esc(u.level.cls)}"><i style="width:${Math.min(100, u.pct)}%"></i><span class="pacemark" style="left:75%" title="75%"></span><span class="pacemark" style="left:90%" title="90%"></span></div>
      <p class="qctx">${pill(u.level.short, u.level.cls)} ${esc(u.level.text)}</p>${u.resets ? `<p class="qctx">Resets ${esc(u.resets)} PT</p>` : ''}${u.note ? `<p class="qctx">${esc(u.note)}</p>` : ''}`;
  return `<div class="card pad goal"><div class="cardhead"><h2>Claude usage this week</h2></div>${body}${bots}${src(u.source)}</div>`;
}

export function render(d) {
  const t = d || {};
  if (!t.goals) return '<div class="wrap"><div class="card pad"><p class="muted">Today has no data yet.</p></div></div>';
  return `<div class="wrap">
  <div class="head"><div><h1>Today</h1><p>${esc(t.date)} · ${esc(t.clock)} PT</p></div>
    <div class="right">${pill(`${t.total.value} of ${t.total.goal} this month`, t.total.pct >= 100 ? 'ok' : 'idle')} <span class="muted">${esc(t.total.reporting)}</span></div></div>
  <div class="goals four">${t.goals.map(goalCard).join('')}</div>
  <div class="homelists">${needsCard(t.needs)}<div class="todayside">${summaryCard(t.summary)}${usageCard(t.usage)}</div></div>
</div>`;
}
