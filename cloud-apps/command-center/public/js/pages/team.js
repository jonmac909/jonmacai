import { pill, pg, esc } from '../ui.js';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function slot(s) {
  const cls = s.state === 'next' ? ' next' : s.state === 'past' ? ' past' : '';
  const note = s.note || '';
  return `<div class="slot${cls}"><span class="xs muted">${esc(s.time)}</span><b>${s.state === 'next' ? 'Next' : '·'}</b><span class="xs">${esc(note)}</span></div>`;
}

function paulCard(p) {
  if (!p) return '<div class="card pad"><p class="muted">Paul\'s slots need the 4-hour clock. No data.</p></div>';
  return `<div class="card pad">
    <div class="cardhead"><h2>${esc(p.title)}</h2>${pill(`Next in ${p.next.label}`, 'ok')}</div>
    <div class="slots">${p.slots.map(slot).join('')}</div>
    <p class="note" style="text-align:left;margin:.7rem 0 0">${esc(p.note || '')}</p>
  </div>`;
}

function gpuBars(g) {
  if (!g.online) return '<p class="muted xs">No load reported: the machine heartbeat is stale or missing.</p>';
  const util = g.util == null ? 'no data' : `${Math.round(g.util)}%`;
  const vram = g.memUsedGb == null || g.memTotalGb == null ? 'no data' : `${g.memUsedGb} / ${g.memTotalGb} GB`;
  return `<div class="gpurow"><span class="xs">GPU</span><span class="xs tn">${esc(util)}</span></div>${pg(g.util, g.util == null ? 'idle' : '')}
    <div class="gpurow"><span class="xs">VRAM</span><span class="xs tn">${esc(vram)}</span></div>${pg(g.vramPct, 'ok')}
    ${g.tempC == null ? '' : `<div class="gpurow"><span class="xs">Temp</span><span class="xs tn">${esc(g.tempC)} °C</span></div>`}`;
}

function gpuCard(g) {
  const name = [g.label, g.gpuName].filter(Boolean).join(' · ');
  const head = g.online ? pill(g.stale ? `Stale · ${g.ageLabel}` : g.ageLabel || 'Live', g.stale ? 'risk' : 'ok') : pill('No heartbeat', 'crit');
  const note = g.online && g.note ? `<p class="note" style="text-align:left;margin:.6rem 0 0">${esc(g.note)}</p>` : '';
  return `<div class="card pad gpu"><div class="cardhead"><h2>${esc(name)}</h2>${head}</div>${gpuBars(g)}${note}</div>`;
}

function botCard(b) {
  const dot = `<span class="dot ${esc(b.dot)}"></span>`;
  const status = b.stuck ? pill(b.statusLabel, b.statusCls) : dot;
  const task = b.task || 'No current task';
  const next = b.next
    ? `<span title="${esc(b.next.name)}">${esc(b.next.time)}</span>`
    : '<span>No routine</span>';
  return `<article class="card bot${b.stuck ? ' stuck' : ''}">
    <div class="row"><div class="av">${esc(initials(b.name))}</div><div class="grow"><b>${esc(b.name)}</b><div class="xs muted trunc">${esc(b.role)}</div></div>${status}</div>
    <div class="task">${esc(task)}</div>
    <div class="ft"><span>${esc(b.model)}</span>${next}</div>
  </article>`;
}

export function render(d) {
  const pills = (d.pills || []).map((p) => pill(p.label, p.cls)).join('');
  const gpus = (d.gpus || []).map(gpuCard).join('');
  const sections = (d.sections || []).map((s) => `<div class="sec">
    <div class="bar"><h2>${esc(s.title)}</h2><span class="xs muted">${s.bots.length} ${s.bots.length === 1 ? 'bot' : 'bots'}</span></div>
    <div class="bots">${s.bots.map(botCard).join('')}</div>
  </div>`).join('');
  const empty = d.available ? '' : `<div class="card pad"><div class="empty"><strong>Bot cards · no data</strong><br>${esc(d.reason || 'The team collector has not reported.')}</div></div>`;
  const stale = d.stale && d.available ? `<p class="note" style="text-align:left">Team collector is stale · last report ${esc(d.asOf || 'unknown')}</p>` : '';
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(d.title || 'Team')}</h1><p>${esc(d.sub || '')}</p></div><div class="right">${pills}</div></div>
  <div class="teamtop">${paulCard(d.paul)}${gpus || '<div class="card pad"><p class="muted">GPU load needs the machine heartbeat. No data.</p></div>'}</div>
  ${stale}${empty}${sections}
</div>`;
}
