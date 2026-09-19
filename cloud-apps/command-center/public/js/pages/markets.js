import { tiles, pg, pill, btn, pgrow, head } from '../ui.js';

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg, cls: 'line' })).join('');
  const rows = d.discount.rows.map((r) => `<tr><td>${r.fund}<small>${r.small}</small></td><td class="num">${r.price}</td><td class="num">${r.ath}</td><td class="num ${r.todayCls}">${r.today}</td><td><div class="cellpg">${pg(r.pct, r.pg)}<span>${r.off}</span></div></td><td class="num">${r.rise}</td><td>${pill(r.read, r.readCls || '')}</td></tr>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="card pad">
    <div class="cardhead"><h2>${d.discount.title}</h2><span class="meta">${d.discount.meta}</span></div>
    <div class="tblwrap"><table><thead><tr><th>Fund</th><th class="num">Price</th><th class="num">All-time high</th><th class="num">Today</th><th>Off its high</th><th class="num">Needs to rise</th><th>Read</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>
  <div class="split even">
    <div class="card pad insight">
      <div class="cardhead" style="margin-bottom:.8rem"><h2><svg class="ic"><use href="#i-bulb"/></svg>Today's read</h2></div>
      <hr><span class="pill">${d.read.pill}</span>
      <h3>${d.read.heading}</h3><p>${d.read.body}</p>
      <div class="box"><h4>${d.read.boxTitle}</h4><p>${d.read.box}</p></div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.rules.title}</h2><span class="meta">${d.rules.meta}</span></div>
      <div class="pgs">${d.rules.rows.map(pgrow).join('')}</div>
      <div class="box"><p>${d.rules.box}</p>${btn('Add a rule', { msg: 'New rule box opened', cls: 'line wide' })}</div>
    </div>
  </div>
</div>`;
}
