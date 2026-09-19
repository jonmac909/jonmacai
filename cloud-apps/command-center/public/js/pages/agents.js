import { tiles, pg, pill, btn, job, head, esc } from '../ui.js';

function machineCard(m) {
  const status = m.stale ? pill('Stale') : pill(m.ageLabel, m.updatedAt ? 'ok' : '');
  const ping = btn('Ping', { kind: 'ping', payload: { machine: m.id }, sm: true, cls: 'line' });
  return `<article class="card job"><div class="top"><span class="area">${m.label}</span>${status}</div><h3>${m.hostname || m.label}</h3><ul><li>${m.ageLabel}</li></ul><div class="foot">${ping}</div></article>`;
}

export function render(d) {
  const jobs = d.waiting.jobs.map(job).join('');
  const rows = d.all.rows.map((r) => {
    const action = r.restart
      ? btn(r.restart, { kind: 'agent.restart', payload: { machine: r.machine, name: r.agent, msg: r.restartMsg }, sm: true })
      : r.page
        ? btn('Open', { page: r.page, cls: 'line', sm: true })
        : '';
    return `<tr><td>${esc(r.agent)}</td><td>${esc(r.runs)}</td><td>${esc(r.now)}</td><td><div class="cellpg">${pg(r.pct, r.pg)}<span>${esc(r.job)}</span></div></td><td>${pill(r.pill, r.pillCls || '')}</td><td class="num">${action}</td></tr>`;
  }).join('');
  const machines = (d.machines || []).map(machineCard).join('');
  const stale = (d.staleSources || []).map((s) => `<li>${s.label || s.source} · ${s.ageLabel}</li>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub)}
  ${tiles(d.tiles)}
  ${machines ? `<div class="sec"><div class="bar"><h2>Machines</h2></div><div class="todo">${machines}</div></div>` : ''}
  ${stale ? `<div class="card pad"><div class="cardhead"><h2>Stale</h2></div><ul>${stale}</ul></div>` : ''}
  <div class="sec">
    <div class="bar"><h2>${d.waiting.title}</h2></div>
    <div class="todo">${jobs}</div>
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>${d.all.title}</h2><div class="key"><span style="--c:var(--risk-fill)">Needs you</span><span style="--c:var(--ok-fill)">Working</span><span style="--c:var(--crit-fill)">Quiet too long</span></div></div>
    <div class="tblwrap"><table><thead><tr><th>Agent</th><th>Runs on</th><th>Doing now</th><th>Today's job</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>
</div>`;
}
