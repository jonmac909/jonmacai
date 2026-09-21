import { pg, pill, btn, pgrow, head, esc } from '../ui.js';

export function render(d) {
  const steps = d.setup.steps.map((s) => {
    const right = s.pill ? pill(s.pill, s.pillCls || '') : (s.btn ? btn(s.btn, { msg: s.msg, cls: s.btnCls || '', kind: s.kind, payload: s.payload, confirm: s.confirm }) : '');
    return `<div class="r"><div><strong>${s.n} · ${s.title}</strong><small>${s.sub}</small></div><div class="right">${right}</div></div>`;
  }).join('');
  const connect = d.connect ? `<div class="card pad"><div class="cardhead"><h2>${esc(d.connect.title)}</h2></div><p>${esc(d.connect.body)}</p></div>` : '';
  const campaign = d.campaign ? `<div class="card pad"><div class="cardhead"><h2>${esc(d.campaign.title)}</h2><span class="meta">${esc(d.campaign.meta || '')}</span></div></div>` : '';
  const inboxes = (d.inboxes.rows || []).length
    ? d.inboxes.rows.map(pgrow).join('')
    : '<div class="empty">No live Instantly inboxes</div>';
  return `<div class="wrap">
  ${head(d.title, d.sub, pill(d.pill))}
  ${connect}
  ${campaign}
  <div class="card pad run">
    <div class="lab"><strong>${d.setup.title}</strong><span>${d.setup.done}</span></div>
    ${pg(d.setup.pct, 'tall')}
    <div class="rows" style="margin-top:.4rem">${steps}</div>
  </div>
  <div class="split even">
    <div class="card pad">
      <div class="cardhead"><h2>${d.inboxes.title}</h2><span class="meta">${d.inboxes.meta}</span></div>
      <div class="pgs">${inboxes}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.live.title}</h2></div>
      <div class="pgs">${d.live.rows.map(pgrow).join('')}</div>
      <div class="empty" style="margin-top:1rem"><strong>${d.live.empty}</strong> ${d.live.emptyRest}</div>
    </div>
  </div>
</div>`;
}
