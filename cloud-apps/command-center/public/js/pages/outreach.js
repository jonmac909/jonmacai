import { pg, pill, btn, pgrow, head } from '../ui.js';

export function render(d) {
  const steps = d.setup.steps.map((s) => {
    const right = s.pill ? pill(s.pill, s.pillCls || '') : btn(s.btn, { msg: s.msg, cls: s.btnCls || '' });
    return `<div class="r"><div><strong>${s.n} · ${s.title}</strong><small>${s.sub}</small></div><div class="right">${right}</div></div>`;
  }).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, pill(d.pill))}
  <div class="card pad run">
    <div class="lab"><strong>${d.setup.title}</strong><span>${d.setup.done}</span></div>
    ${pg(d.setup.pct, 'tall')}
    <div class="rows" style="margin-top:.4rem">${steps}</div>
  </div>
  <div class="split even">
    <div class="card pad">
      <div class="cardhead"><h2>${d.inboxes.title}</h2><span class="meta">${d.inboxes.meta}</span></div>
      <div class="pgs">${d.inboxes.rows.map(pgrow).join('')}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.live.title}</h2></div>
      <div class="pgs">${d.live.rows.map(pgrow).join('')}</div>
      <div class="empty" style="margin-top:1rem"><strong>${d.live.empty}</strong> ${d.live.emptyRest}</div>
    </div>
  </div>
</div>`;
}
