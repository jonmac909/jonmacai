import { pill, esc } from '../ui.js';

// Team page, status lanes (Jon picked Option A, 2026-10-23). Five lanes, left to
// right: Active Agents, Waiting, Stuck, Review, Done. Everything here comes from
// the snapshot: the live roster, Ana's tasks.json and the deliverables table.

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function avatar(name) {
  return `<div class="tav">${esc(initials(name))}</div>`;
}

function metaBits(bits) {
  const shown = bits.filter(Boolean);
  if (!shown.length) return '';
  return `<div class="tmt">${shown.map((b) => `<span>${esc(b)}</span>`).join('<i>·</i>')}</div>`;
}

function botCard(b) {
  const dot = b.status === 'working' ? '<span class="dot ok"></span>' : '';
  return `<article class="tcard">
    <div class="ttop">${avatar(b.name)}<div class="grow"><div class="tnm">${esc(b.name)}</div><div class="trole trunc">${esc(b.role || b.team || 'Bot')}</div></div>${dot}</div>
    <div class="ttask">${esc(b.title || 'No current task')}</div>
    ${metaBits([b.team, b.when])}
  </article>`;
}

function taskCard(t) {
  const link = t.link ? ` data-href="${esc(t.link)}" role="link" tabindex="0"` : '';
  const open = t.link ? '<div class="topen">Open link</div>' : '';
  return `<article class="tcard${t.link ? ' islink' : ''}"${link}>
    <div class="ttask strong">${esc(t.title)}</div>
    ${t.note ? `<div class="tnote">${esc(t.note)}</div>` : ''}
    ${metaBits([t.owner, t.when])}${open}
  </article>`;
}

function deliverableCard(r) {
  return `<article class="tcard islink" data-href="${esc(r.href || '/dashboard/#tasks')}" role="link" tabindex="0">
    <div class="ttask strong">${esc(r.title)}</div>
    ${metaBits([r.type, r.owner, r.when])}
    <div class="topen">${r.inProgress ? 'Open page' : 'Open review'}</div>
  </article>`;
}

function itemCard(item) {
  if (item.kind === 'bot') return botCard(item);
  if (item.kind === 'deliverable') return deliverableCard(item);
  return taskCard(item);
}

function idleRow(b) {
  return `<div class="tmini"><span class="dot idle"></span><span class="tnm">${esc(b.name)}</span><span class="muted trunc grow">${esc(b.title || '')}</span><span class="muted xs">${esc(b.when || '')}</span></div>`;
}

const EMPTY = {
  active: ['No bot is working right now', 'A bot lands here while a run is live.'],
  waiting: ['Nothing waiting on you', 'A bot lands here when it stops for a sign-in, answer or payment.'],
  stuck: ['No bot is stuck', 'Failed runs and blockers that are not you surface here.'],
  review: ['Nothing to review', 'Finished work waiting on your approval lands here, with its link.'],
  done: ['Nothing finished today yet', 'Finished work and idle bots collect here.'],
};

function emptyState(lane) {
  const [head, body] = EMPTY[lane.key] || ['Nothing here', ''];
  return `<div class="tempty"><b>${esc(head)}</b><span>${esc(body)}</span></div>`;
}

function laneBlock(lane) {
  const dotCls = lane.key === 'active' ? 'ok'
    : lane.key === 'waiting' ? 'risk'
      : lane.key === 'stuck' ? 'crit'
        : 'idle';
  const body = lane.items.map(itemCard).join('');
  let extra = '';
  if (lane.key === 'done' && lane.idleCount) {
    extra = `<details class="tidle"><summary>Show ${lane.idleCount} idle ${lane.idleCount === 1 ? 'bot' : 'bots'}</summary><div class="tbody2">${(lane.idle || []).map(idleRow).join('')}</div></details>`;
  }
  const contents = body || (lane.key === 'done' && lane.idleCount ? '' : emptyState(lane));
  return `<section class="tlane" aria-label="${esc(lane.title)}">
    <header><span class="dot ${dotCls}"></span>${esc(lane.title)}<span class="n">${lane.count}</span></header>
    <div class="tbody2">${contents}</div>${extra}
  </section>`;
}

export function render(d) {
  const pills = (d.pills || []).map((p) => pill(p.label, p.cls)).join('');
  const lanes = (d.lanes || []).map(laneBlock).join('');
  const stale = d.stale && d.available ? `<p class="note" style="text-align:left">Team data is stale · last report ${esc(d.asOf || 'unknown')}</p>` : '';
  const empty = d.available ? '' : `<div class="card pad"><div class="empty"><strong>Team lanes · no data</strong><br>${esc(d.reason || 'The team collector has not reported.')}</div></div>`;
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(d.title || 'Team')}</h1><p>${esc(d.sub || '')}</p></div><div class="right">${pills}</div></div>
  ${stale}${empty}
  <div class="tlanes">${lanes}</div>
</div>`;
}
