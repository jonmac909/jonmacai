import { tiles, pg, pill, job, btn, dots, esc } from '../ui.js';

export function render(d) {
  const date = d.date;
  const steps = d.runThrough.steps.map((s) => `<button type="button" class="step" data-item="${esc(s.item || '')}" data-page="${esc(s.page || '')}" aria-pressed="${s.done ? 'true' : 'false'}">${esc(s.label)}</button>`).join('');
  const jobs = d.needsYou.jobs.map(job).join('');
  const rows = d.glance.rows.map((r) => `<tr data-page="${r.page}"><td>${r.area}</td><td>${r.today}</td><td>${r.goal}</td><td><div class="cellpg">${pg(r.pct, r.pg)}${pill(r.pill, r.pillCls)}</div></td></tr>`).join('');
  const L = d.life;
  return `<div class="wrap">
  <div class="head"><div><h1>${d.greeting}</h1><p id="date">${date}</p></div><span class="chip">${d.chip}</span></div>
  ${tiles(d.tiles)}
  <div class="card pad run">
    <div class="lab"><strong>${d.runThrough.title}</strong><span id="runcount">${d.runThrough.done} of ${d.runThrough.total} done</span></div>
    <div class="pg tall ok"><i id="runbar" style="width:${d.runThrough.pct}%"></i></div>
    <div class="steps">${steps}</div>
  </div>
  <div class="sec">
    <div class="bar"><h2>${d.needsYou.title}</h2><button class="link" data-view-all="1">${d.needsYou.viewAll}</button></div>
    <div class="todo">${jobs}</div>
  </div>
  <div class="split three">
    <div class="card pad">
      <div class="cardhead"><h2><svg class="ic"><use href="#i-chart"/></svg>Business at a glance</h2><div class="key"><span style="--c:var(--crit-fill)">Behind</span><span style="--c:var(--risk-fill)">Watch</span><span style="--c:var(--ok-fill)">On track</span></div></div>
      <div class="tblwrap"><table><thead><tr><th>Area</th><th>Today</th><th>Goal</th><th>Progress</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <div class="card pad insight">
      <div class="cardhead" style="margin-bottom:.8rem"><h2><svg class="ic"><use href="#i-bulb"/></svg>Mastermind pick</h2></div>
      <hr><span class="pill ok">${esc(d.mastermindPick.pill)}</span>
      <h3>${esc(d.mastermindPick.heading)}</h3>
      <p>${esc(d.mastermindPick.body)}</p>
      <div class="box"><h4>${esc(d.mastermindPick.fitTitle)}</h4><p>${esc(d.mastermindPick.fit)}</p><p><b>Effort:</b> ${esc(d.mastermindPick.effort)}</p>${btn(d.mastermindPick.btn, { msg: d.mastermindPick.msg, cls: 'wide', kind: d.mastermindPick.kind, payload: d.mastermindPick.payload })}</div>
      <div class="pager"><span>${d.mastermindPick.pager}</span><button class="link" data-page="mastermind">See all</button></div>
    </div>
    <div class="card pad life">
      <div class="cardhead" style="margin-bottom:0"><h2><svg class="ic"><use href="#i-heart"/></svg>Life this week</h2></div>
      <div class="habit"><div><strong>${L.workout.title}</strong><small>${L.workout.sub}</small></div>${dots(L.workout.dots)}</div>
      ${pg(L.workout.pct, 'ok')}
      <hr class="divider">
      <div class="habit"><div><strong>${L.dateNight.title}</strong><small>${L.dateNight.sub}</small></div>${btn(L.dateNight.btn, { msg: L.dateNight.msg, cls: 'line', kind: L.dateNight.kind, payload: L.dateNight.payload, confirm: L.dateNight.confirm })}</div>
      <hr class="divider">
      <div class="habit"><div><strong>${L.agents.title}</strong><small>${L.agents.sub}</small></div><button class="link" data-page="agents">Open</button></div>
    </div>
  </div>
</div>`;
}
