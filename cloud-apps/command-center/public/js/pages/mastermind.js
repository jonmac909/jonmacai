import { tiles, pg, pill, btn, job, head, esc } from '../ui.js';

export function render(d) {
  const right = (d.actions || []).map((a) => btn(a.label, { msg: a.msg, kind: a.kind, payload: a.payload, cls: 'line' })).join('');
  const note = d.picks?.note ? `<p>${esc(d.picks.note)}</p>` : '';
  const jobs = (d.picks?.jobs || []).map((j) => job(j)).join('');
  const building = (d.building?.rows || []).map((r) => `<div class="r"><div><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small>${pg(r.pct, r.pg || '')}</div><div class="right">${pill(r.pill, r.pillCls)}</div></div>`).join('');
  const parked = (d.parked?.rows || []).map((r) => `<div class="r"><div><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small></div><div class="right">${btn('Send to Planner', { kind: 'mastermind.send_to_planner', payload: { id: r.id, title: r.title, body: r.body, area: r.area, msg: 'Created under Planner in Orca. Open that worktree.' }, cls: 'line', sm: true, done: true })}</div></div>`).join('');
  const more = d.parked?.more?.title
    ? `<div class="r"><div><strong>${d.parked.more.title}</strong><small>${d.parked.more.sub}</small></div><div class="right"><button class="link" data-msg="${d.parked.more.msg}">${d.parked.more.btn}</button></div></div>`
    : '';
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="sec">
    <div class="bar"><h2>${esc(d.picks?.title || '')}</h2></div>
    ${note}
    <div class="todo">${jobs}</div>
  </div>
  <div class="split even">
    <div class="card pad">
      <div class="cardhead"><h2>${d.building.title}</h2><span class="meta">${d.building.meta}</span></div>
      <div class="rows">${building}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.parked.title}</h2><span class="meta">${d.parked.meta}</span></div>
      <div class="rows">${parked}${more}</div>
    </div>
  </div>
</div>`;
}
