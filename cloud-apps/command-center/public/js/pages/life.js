import { tiles, pill, btn, dots, head, esc } from '../ui.js';

function actionBtn(a) {
  if (a.href) return `<a class="btn line" href="${esc(a.href)}">${esc(a.label)}</a>`;
  return btn(a.label, { msg: a.msg, cls: a.primary ? '' : 'line', kind: a.kind, payload: a.payload, confirm: a.confirm });
}

export function render(d) {
  const right = d.actions.map(actionBtn).join('');
  const weeks = d.workouts.weeks.map((w) => `<div class="habit"><div><strong>${w.title}</strong><small>${w.sub}</small></div>${dots(w.dots)}</div>`).join('');
  const nights = d.dateNight.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small></div><div class="right">${r.btn ? btn(r.btn, { href: r.href, msg: r.msg, kind: r.kind, payload: r.payload, confirm: r.confirm, done: true }) : pill(r.pill, r.pillCls)}</div></div>`).join('');
  const today = d.today.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small></div><div class="right">${r.btn ? btn(r.btn, { page: r.page, cls: 'line', sm: true }) : pill(r.pill, r.pillCls || '')}</div></div>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="split even">
    <div class="card pad">
      <div class="cardhead"><h2>${d.workouts.title}</h2><span class="meta">${d.workouts.meta}</span></div>
      <div class="pgs">${weeks}</div>
      <div class="box"><p>${d.workouts.box}</p>${btn(d.workouts.btn, { msg: d.workouts.msg, cls: 'wide', kind: d.workouts.kind, payload: d.workouts.payload, confirm: d.workouts.confirm })}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.dateNight.title}</h2>${pill(d.dateNight.pill, d.dateNight.pillCls)}</div>
      <div class="rows">${nights}</div>
      <div class="box"><h4>${d.dateNight.ideasTitle}</h4><p>${d.dateNight.ideas}</p></div>
    </div>
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>${d.today.title}</h2><span class="meta">${d.today.meta}</span></div>
    <div class="rows">${today}</div>
  </div>
</div>`;
}
