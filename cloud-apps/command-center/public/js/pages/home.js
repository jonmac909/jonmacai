import { tiles, pill, job, esc } from '../ui.js';
import { machinesSection } from '../machines.js';

function needsJon(n) {
  const head = `<div class="cardhead"><h2><svg class="ic"><use href="#i-clock"/></svg>Needs Jon</h2>${n.stale ? pill('Stale') : `<span class="muted">${esc(n.updated)}</span>`}</div>`;
  if (!n.available) return `<div class="card pad">${head}<p class="muted">No data. Waiting On You.md has not reported from GPU2.</p></div>`;
  const items = n.items.map((i) => `<li>${i.area ? `<b>${esc(i.area)}</b> · ` : ''}${esc(i.ask)}</li>`).join('');
  return `<div class="card pad">${head}${items ? `<ol class="asks">${items}</ol>` : '<p>Nothing waiting on you.</p>'}</div>`;
}

function ready(r) {
  const head = '<div class="cardhead"><h2><svg class="ic"><use href="#i-film"/></svg>Videos ready for Jon</h2><button class="link" data-page="videos">All videos</button></div>';
  if (!r.available) return `<div class="card pad">${head}<p class="muted">No data. The videos feed has not reported.</p></div>`;
  const items = r.items.map((v) => `<li><b>${esc(v.channel)}</b> · ${esc(v.video)}${v.slug ? ` · <a href="/review/${esc(v.slug)}" target="_blank" rel="noopener">open review</a>` : ''}</li>`).join('');
  return `<div class="card pad">${head}${items ? `<ul class="asks">${items}</ul>` : '<p>Nothing to review right now.</p>'}</div>`;
}

export function render(d) {
  const now = d.now || { tiles: [], needsJon: { available: false }, ready: { available: false } };
  const steps = d.runThrough.steps.map((s) => `<button type="button" class="step" data-item="${esc(s.item || '')}" data-page="${esc(s.page || '')}" aria-pressed="${s.done ? 'true' : 'false'}">${esc(s.label)}</button>`).join('');
  const jobs = d.needsYou.jobs.map(job).join('');
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(d.greeting)}</h1><p id="date">${esc(d.date)}</p></div><span class="chip">${esc(d.chip)}</span></div>
  ${tiles(now.tiles)}
  <div class="split two">${needsJon(now.needsJon)}${ready(now.ready)}</div>
  ${machinesSection(d.machines, { link: true })}
  <div class="card pad run">
    <div class="lab"><strong>${esc(d.runThrough.title)}</strong><span id="runcount">${d.runThrough.done} of ${d.runThrough.total} done</span></div>
    <div class="pg tall ok"><i id="runbar" style="width:${d.runThrough.pct}%"></i></div>
    <div class="steps">${steps}</div>
  </div>
  <div class="sec">
    <div class="bar"><h2>${esc(d.needsYou.title)}</h2><button class="link" data-view-all="1">${esc(d.needsYou.viewAll)}</button></div>
    <div class="todo">${jobs}</div>
  </div>
</div>`;
}
