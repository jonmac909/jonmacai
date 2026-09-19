import { tiles, pgrow, btn, head, esc } from '../ui.js';

function moneyRows(d) {
  if (d.money.rows) return d.money.rows;
  return [{
    title: d.money.title2,
    sub: d.money.sub,
    decline: d.money.decline,
    declineMsg: d.money.declineMsg,
    refund: d.money.refund,
    refundMsg: d.money.refundMsg,
  }];
}

function draftBtns(r) {
  const payload = {
    ...(r.payload || {}),
    to: r.to, subject: r.subject, body: r.body,
    saveKind: r.saveKind || 'support.save',
    sendKind: r.sendKind || r.kind || 'support.send',
    discardKind: r.discardKind || 'support.discard_draft',
  };
  return btn('Edit', { draft: true, payload, cls: 'line' })
    + btn('Approve & send', { draft: true, payload, done: true });
}

function moneyBtns(r) {
  if (r.kind) {
    return btn(r.decline, { kind: r.declineKind || r.kind, payload: r.declinePayload || { ...r.payload, decision: 'decline', msg: r.declineMsg }, cls: 'line', done: true })
      + btn(r.refund, { kind: r.kind, payload: r.payload, done: true });
  }
  return btn(r.decline, { msg: r.declineMsg, cls: 'line', done: true })
    + btn(r.refund, { msg: r.refundMsg, done: true });
}

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg, kind: a.kind, payload: a.payload })).join('');
  const drafts = d.drafts.rows.map((r) => `<div class="r"><div><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small><div class="quote">${esc(r.quote)}</div></div><div class="right">${draftBtns(r)}</div></div>`).join('');
  const money = moneyRows(d).map((r) => `<div class="r"><div><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small></div><div class="right">${moneyBtns(r)}</div></div>`).join('');
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
        <div class="cardhead"><h2>${d.money.title}</h2><span class="pill ${d.money.pillCls}">${esc(d.money.pill)}</span></div>
        <div class="rows">${money}</div>
      </div>
      <div class="card pad">
        <div class="cardhead"><h2>${d.topics.title}</h2><span class="meta">${d.topics.meta}</span></div>
        <div class="pgs">${d.topics.rows.map(pgrow).join('')}</div>
        <div class="box"><p>${esc(d.topics.box)}</p>${btn(d.topics.btn || 'Create Planner task', { kind: d.topics.kind, payload: d.topics.payload, cls: 'wide' })}</div>
      </div>
    </div>
  </div>
</div>`;
}
