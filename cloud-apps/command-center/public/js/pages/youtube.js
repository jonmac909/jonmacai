import { tiles, pg, pill, btn, job, head } from '../ui.js';

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg, cls: a.primary ? '' : 'line', href: a.href })).join('');
  const rows = d.pipeline.rows.map((r) => {
    const b = r.btn ? `<td class="num">${btn(r.btn, { page: r.page, msg: r.msg, cls: r.primary ? '' : 'line', sm: true })}</td>` : '<td></td>';
    return `<tr><td>${r.video}</td><td>${r.type}</td><td><div class="cellpg">${pg(r.pct, r.pg)}${pill(r.pill, r.pillCls)}</div></td><td>${r.due}</td><td>${r.next}</td>${b}</tr>`;
  }).join('');
  const jobs = d.remake.jobs.map((j) => job({ ...j, pillCls: 'ok', btn: j.btn || 'Remake with a template', href: j.href })).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="card pad">
    <div class="cardhead"><h2>${d.pipeline.title}</h2><span class="meta">${d.pipeline.meta}</span></div>
    <div class="tblwrap"><table><thead><tr><th>Video</th><th>Type</th><th>Progress</th><th>Due</th><th>Next step</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>
  <div class="sec">
    <div class="bar"><h2>${d.remake.title}</h2><button class="link" data-href="${d.remake.seeAllHref || 'https://jonmac.ai/yt2/'}">${d.remake.seeAll}</button></div>
    <div class="todo">${jobs}</div>
  </div>
</div>`;
}
