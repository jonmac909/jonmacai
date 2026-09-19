import { tiles, pg, pill, btn, pgrow, head } from '../ui.js';

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg })).join('');
  const heatDays = d.heat.days.map((x) => `<span class="h">${x}</span>`).join('');
  const heatRows = d.heat.rows.map((r) => {
    const cells = r.cells.map((c) => c.future
      ? '<span class="cell future">–</span>'
      : `<span class="cell" data-n="${c.n}" data-tip="${c.tip}">${c.n}</span>`).join('');
    return `<span class="p">${r.p}</span>${cells}`;
  }).join('');
  const queue = d.queue.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><div class="quote">${r.quote}</div></div><div class="right">${btn('Edit', { msg: 'Post opened for editing', cls: 'line' })}${btn('Approve', { msg: r.msg, done: true })}</div></div>`).join('');
  const yt = d.ytWeek.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small>${pg(r.pct, r.pg || '')}</div><div class="right">${r.pill ? pill(r.pill, r.pillCls) : btn(r.btn, { msg: r.msg, cls: 'line' })}</div></div>`).join('');
  const best = d.bestPosts.rows.map((r) => `<tr><td>${r.post}</td><td>${r.platform}</td><td class="num">${r.views}</td><td class="num">${r.clicks}</td><td class="num">${r.sales}</td><td class="num">${btn(d.bestPosts.btn, { msg: d.bestPosts.msg, cls: 'line', sm: true })}</td></tr>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="split even">
    <div class="card pad">
      <div class="cardhead"><h2>${d.todayPlatforms.title}</h2><span class="meta">${d.todayPlatforms.meta}</span></div>
      <div class="pgs">${d.todayPlatforms.rows.map(pgrow).join('')}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.heat.title}</h2><span class="meta">${d.heat.meta}</span></div>
      <div class="tblwrap"><div class="heat tn"><span></span>${heatDays}${heatRows}</div></div>
    </div>
  </div>
  <div class="split">
    <div class="card pad">
      <div class="cardhead"><h2>${d.queue.title}</h2><div class="right" style="display:flex;gap:.5rem"><span class="meta">${d.queue.meta}</span>${btn(d.queue.approveAll, { msg: d.queue.approveAllMsg, sm: true })}</div></div>
      <div class="rows">${queue}<div class="r"><div><strong>${d.queue.more.title}</strong><small>${d.queue.more.sub}</small></div><div class="right"><button class="link" data-msg="${d.queue.more.msg}">${d.queue.more.btn}</button></div></div></div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.ytWeek.title}</h2></div>
      <div class="rows">${yt}</div>
      <p class="note" style="text-align:left;margin:.8rem 0 0">${d.ytWeek.note}</p>
    </div>
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>${d.bestPosts.title}</h2><span class="meta">${d.bestPosts.meta}</span></div>
    <div class="tblwrap"><table><thead><tr><th>Post</th><th>Platform</th><th class="num">Views</th><th class="num">Clicks</th><th class="num">Sales</th><th></th></tr></thead><tbody>${best}</tbody></table></div>
  </div>
</div>`;
}
