import { pg, pill, esc } from './ui.js';

const GB = (v) => (v == null ? '—' : `${Math.round(v)} GB`);

function statusPill(m) {
  if (!m.updatedAt) return pill('No data', 'crit');
  if (!m.online) return pill('Offline', 'crit');
  if (m.stale) return pill('Stale');
  return pill(m.alerts.length ? 'Check' : 'Online', m.alerts.length ? 'crit' : 'ok');
}

function meter(label, value, pct, cls) {
  return `<div class="pgrow"><div class="lab"><span>${esc(label)}</span><span>${esc(value)}</span></div>${pg(pct ?? 0, cls)}</div>`;
}

function gpuRows(m) {
  if (!m.gpus.length) return '<p class="mnote">GPU: no data</p>';
  return m.gpus.map((g) => {
    const vram = g.memTotalGb ? Math.round(g.memUsedGb / g.memTotalGb * 100) : null;
    const temp = g.tempC != null ? ` · ${g.tempC}°C` : '';
    return meter(`${g.name} use${temp}`, g.util == null ? 'no data' : `${g.util}%`, g.util, '')
      + meter('VRAM', g.memTotalGb ? `${g.memUsedGb} / ${g.memTotalGb} GB` : 'no data', vram, '');
  }).join('');
}

function memRows(m) {
  const ram = m.ram && m.ram.totalGb ? meter('RAM', `${m.ram.usedGb} / ${m.ram.totalGb} GB`, Math.round(m.ram.usedGb / m.ram.totalGb * 100), '') : '<p class="mnote">RAM: no data</p>';
  const c = m.commit;
  const commit = c && c.limitGb ? meter('Commit', `${c.usedGb} / ${c.limitGb} GB · ${c.pct}%`, c.pct, c.high ? 'crit' : c.pct > 75 ? 'risk' : '') : '<p class="mnote">Commit: no data</p>';
  return ram + commit;
}

function diskRows(m) {
  if (!m.disks.length) return '<p class="mnote">Drives: no data</p>';
  return m.disks.map((d) => meter(`${d.drive} free`, `${GB(d.freeGb)} of ${GB(d.totalGb)}`, d.usedPct, d.low ? 'crit' : d.usedPct > 90 ? 'risk' : '')).join('');
}

function runRows(m) {
  const rows = m.running.map((r) => `<li class="${r.on ? 'on' : ''}"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></li>`);
  if (m.gaming) rows.unshift(`<li class="${m.gaming.on ? 'warn' : ''}"><span>Gaming mode</span><b>${m.gaming.on ? `ON · ${esc(m.gaming.why)}` : 'off'}</b></li>`);
  return `<ul class="mrun">${rows.join('')}</ul>`;
}

export function machineCard(m, { full = false } = {}) {
  const cls = m.level === 'crit' ? ' crit' : m.level === 'stale' ? ' stale' : '';
  const alerts = m.alerts.length ? `<ul class="malert">${m.alerts.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '';
  const seen = `${esc(m.ageLabel)}${m.uptimeH != null ? ` · up ${m.uptimeH < 48 ? `${m.uptimeH} h` : `${Math.round(m.uptimeH / 24)} days`}` : ''}`;
  const errs = full && m.errors && m.errors.length ? `<p class="mnote">Collector notes: ${esc(m.errors.join(' · '))}</p>` : '';
  const body = m.updatedAt
    ? `<div class="mgrid"><div>${gpuRows(m)}${memRows(m)}</div><div>${diskRows(m)}</div></div>${runRows(m)}${errs}`
    : '<p class="mnote">No data yet. The 60-second heartbeat has not reported.</p>';
  return `<article class="card machine${cls}"><div class="top"><span class="area">${esc(m.label)} · ${esc(m.role)}</span>${statusPill(m)}</div><p class="mseen">${seen}</p>${alerts}${body}</article>`;
}

export function machinesSection(list, opts = {}) {
  if (!list || !list.length) return '';
  const link = opts.link ? '<button class="link" data-page="agents">Details</button>' : '';
  return `<div class="sec"><div class="bar"><h2>Machines</h2>${link}</div><div class="machines">${list.map((m) => machineCard(m, opts)).join('')}</div></div>`;
}
