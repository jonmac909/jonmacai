import { tiles, pg, pill, btn, kanban, pgrow, head } from '../ui.js';

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg, cls: 'line', href: a.href, kind: a.kind, payload: a.payload })).join('');
  const parts = d.septemberBar.parts;
  const bar = parts.map((p) => `<i style="width:${p.pct}%;background:${p.fill}" data-tip="${p.tip}"></i>`).join('');
  const legend = parts.map((p) => `<span style="--c:${p.fill}">${p.legend} <b class="tn">${p.amount}</b></span>`).join('')
    + `<span style="--c:var(--ink)">${d.septemberBar.line}</span>`;
  const collect = d.collect.rows.map((r) => `<tr><td>${r.sponsor}<small>${pill(r.pill, r.pillCls)}</small></td><td class="num">${r.total}</td><td class="num">${r.owed}</td><td><div class="cellpg">${pg(r.paidPct, r.pg)}<span>${r.paid}</span></div></td><td>${r.block}</td><td>${r.next}</td><td class="num">${btn(r.btn, { kind: r.kind, payload: r.payload, cls: r.btnCls || '', sm: true })}${btn('Mark paid', { kind: r.paidKind, payload: r.paidPayload, cls: 'line', sm: true })}</td></tr>`).join('');
  const emails = d.emails.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small></div><div class="right">${btn('Edit', { kind: 'sponsor.save_draft', payload: { id: r.id, subject: r.subject, body: r.body }, cls: 'line', edit: true })}${btn('Approve & send', { kind: 'sponsor.send_draft', payload: { id: r.id, subject: r.subject, body: r.body, msg: r.send }, done: true })}</div></div>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="card pad">
    <div class="cardhead"><h2>${d.septemberBar.title}</h2><span class="meta">${d.septemberBar.meta}</span></div>
    <div style="position:relative">
      <div class="pg tall stack" role="img" aria-label="${d.septemberBar.aria}">${bar}</div>
      <span style="position:absolute;left:${d.septemberBar.goalAt}%;top:-.35rem;bottom:-.35rem;width:2px;background:var(--ink)" title="$10,000 goal"></span>
    </div>
    <div class="legend">${legend}</div>
  </div>
  <div class="sec">
    <div class="bar"><h2>${d.board.title}</h2><span class="kmeta">${d.board.meta}</span></div>
    ${kanban(d.board.columns)}
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>${d.collect.title}</h2><span class="meta">${d.collect.meta}</span></div>
    <div class="tblwrap"><table><thead><tr><th>Sponsor</th><th class="num">Total</th><th class="num">Owed</th><th>Paid so far</th><th>What's blocking it</th><th>Next step</th><th></th></tr></thead><tbody>${collect}</tbody></table></div>
  </div>
  <div class="split">
    <div class="card pad">
      <div class="cardhead"><h2>${d.emails.title}</h2><span class="meta">${d.emails.meta}</span></div>
      <div class="rows">${emails}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.byMonth.title}</h2><span class="meta">${d.byMonth.meta}</span></div>
      <div class="pgs">${d.byMonth.rows.map(pgrow).join('')}</div>
    </div>
  </div>
</div>`;
}
