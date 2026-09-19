import { tiles, pg, pill, btn, pgrow, head, esc } from '../ui.js';

function actionBtn(a) {
  if (a.log) return `<button class="btn" data-log-post="1">${esc(a.label)}</button>`;
  return btn(a.label, { msg: a.msg, kind: a.kind, payload: a.payload });
}

function queueRow(r) {
  const payload = { id: r.id, body: r.quote || r.body, platform: r.platform, saveKind: 'content.save_draft', sendKind: r.kind || 'content.approve', discardKind: 'content.discard_draft' };
  const approve = btn('Approve', { draft: true, payload, done: true });
  return `<div class="r"><div><strong>${esc(r.title)}</strong><div class="quote">${esc(r.quote)}</div></div><div class="right">${btn('Edit', { draft: true, payload, cls: 'line' })}${approve}</div></div>`;
}

export function render(d) {
  const right = d.actions.map(actionBtn).join('');
  const heatDays = d.heat.days.map((x) => `<span class="h">${esc(x)}</span>`).join('');
  const heatRows = d.heat.rows.map((r) => {
    const cells = r.cells.map((c) => c.future
      ? '<span class="cell future">–</span>'
      : `<span class="cell" data-n="${c.n}" data-tip="${esc(c.tip)}">${c.n}</span>`).join('');
    return `<span class="p">${esc(r.p)}</span>${cells}`;
  }).join('');
  const queue = d.queue.rows.map(queueRow).join('');
  const more = d.queue.more
    ? `<div class="r"><div><strong>${esc(d.queue.more.title)}</strong><small>${esc(d.queue.more.sub)}</small></div><div class="right"><button class="link" data-msg="${esc(d.queue.more.msg)}">${esc(d.queue.more.btn)}</button></div></div>`
    : '';
  const yt = d.ytWeek.rows.map((r) => `<div class="r"><div><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small>${pg(r.pct, r.pg || '')}</div><div class="right">${r.pill ? pill(r.pill, r.pillCls) : btn(r.btn, { msg: r.msg, cls: 'line' })}</div></div>`).join('');
  const best = d.bestPosts.rows.map((r) => `<tr><td>${esc(r.post)}</td><td>${esc(r.platform)}</td><td class="num">${esc(r.views)}</td><td class="num">${esc(r.clicks)}</td><td class="num">${esc(r.sales)}</td><td class="num">${btn(d.bestPosts.btn, { msg: d.bestPosts.msg, kind: r.kind, payload: r.payload, cls: 'line', sm: true })}</td></tr>`).join('');
  const drafts = (d.drafts?.rows || []).map((r) => {
    const payload = { id: r.id, body: r.body, subject: r.subject, platform: r.platform, slot: r.slot, day: r.day, saveKind: r.saveKind, sendKind: r.sendKind, discardKind: r.discardKind };
    return `<div class="r"><div><strong>${esc(r.platform)}</strong><small>${esc(r.title)}</small></div><div class="right">${btn('Edit', { draft: true, payload, cls: 'line' })}${btn('Approve', { draft: true, payload })}</div></div>`;
  }).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="card pad">
    <div class="cardhead"><h2>${d.drafts?.title || "Today's drafts"}</h2><span class="meta">${esc(d.drafts?.meta || '')}</span></div>
    <div class="rows">${drafts || '<p class="note">No persisted drafts today. Cron or Fill today\'s drafts writes them; snapshot GET does not.</p>'}</div>
  </div>
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
      <div class="cardhead"><h2>${d.queue.title}</h2><div class="right" style="display:flex;gap:.5rem"><span class="meta">${esc(d.queue.meta)}</span>${btn(d.queue.approveAll, { msg: d.queue.approveAllMsg, kind: d.queue.approveAllKind, payload: d.queue.approveAllPayload, sm: true })}</div></div>
      <div class="rows">${queue}${more}</div>
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
