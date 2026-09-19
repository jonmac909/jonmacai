import { tiles, pg, pill, btn, job, head } from '../ui.js';

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg, cls: 'line' })).join('');
  const jobs = d.picks.jobs.map((j) => job({ ...j, lineBtn: 'Park', lineMsg: 'Parked for later', done: true, btn: 'Send to Planner', msg: 'Sent to Planner as a task' })).join('');
  const building = d.building.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small>${pg(r.pct, r.pg || '')}</div><div class="right">${pill(r.pill, r.pillCls)}</div></div>`).join('');
  const parked = d.parked.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small></div><div class="right">${btn('Send to Planner', { msg: 'Sent to Planner as a task', cls: 'line', sm: true, done: true })}</div></div>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="sec">
    <div class="bar"><h2>${d.picks.title}</h2></div>
    <div class="todo">${jobs}</div>
  </div>
  <div class="split even">
    <div class="card pad">
      <div class="cardhead"><h2>${d.building.title}</h2><span class="meta">${d.building.meta}</span></div>
      <div class="rows">${building}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.parked.title}</h2><span class="meta">${d.parked.meta}</span></div>
      <div class="rows">${parked}<div class="r"><div><strong>${d.parked.more.title}</strong><small>${d.parked.more.sub}</small></div><div class="right"><button class="link" data-msg="${d.parked.more.msg}">${d.parked.more.btn}</button></div></div></div>
    </div>
  </div>
</div>`;
}
