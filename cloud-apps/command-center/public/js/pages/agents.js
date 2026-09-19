import { tiles, pg, pill, btn, job, head } from '../ui.js';

export function render(d) {
  const jobs = d.waiting.jobs.map(job).join('');
  const rows = d.all.rows.map((r) => {
    const action = r.restart
      ? btn(r.restart, { msg: r.restartMsg, sm: true })
      : btn('Open', { page: r.page, msg: r.msg, cls: 'line', sm: true });
    return `<tr><td>${r.agent}</td><td>${r.runs}</td><td>${r.now}</td><td><div class="cellpg">${pg(r.pct, r.pg)}<span>${r.job}</span></div></td><td>${pill(r.pill, r.pillCls || '')}</td><td class="num">${action}</td></tr>`;
  }).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub)}
  ${tiles(d.tiles)}
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
