import { tiles, pgrow, btn, head } from '../ui.js';

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg })).join('');
  const drafts = d.drafts.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small><div class="quote">${r.quote}</div></div><div class="right">${btn('Edit', { msg: 'Draft opened for editing', cls: 'line' })}${btn('Approve & send', { msg: 'Reply sent', done: true })}</div></div>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="split">
    <div class="card pad">
      <div class="cardhead"><h2>${d.drafts.title}</h2><span class="meta">${d.drafts.meta}</span></div>
      <div class="rows">${drafts}</div>
    </div>
    <div class="stackcol">
      <div class="card pad">
        <div class="cardhead"><h2>${d.money.title}</h2><span class="pill ${d.money.pillCls}">${d.money.pill}</span></div>
        <div class="rows"><div class="r"><div><strong>${d.money.title2}</strong><small>${d.money.sub}</small></div><div class="right">${btn(d.money.decline, { msg: d.money.declineMsg, cls: 'line', done: true })}${btn(d.money.refund, { msg: d.money.refundMsg, done: true })}</div></div></div>
      </div>
      <div class="card pad">
        <div class="cardhead"><h2>${d.topics.title}</h2><span class="meta">${d.topics.meta}</span></div>
        <div class="pgs">${d.topics.rows.map(pgrow).join('')}</div>
        <div class="box"><p>${d.topics.box}</p>${btn('Send to Planner', { msg: 'Sent to Planner as a task', cls: 'wide' })}</div>
      </div>
    </div>
  </div>
</div>`;
}
