import { tiles, pg, pill, btn, pgrow, head } from '../ui.js';

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg, cls: 'line' })).join('');
  const ops = d.pieces.ops;
  const eq = d.pieces.parts.map((p, i) => {
    const t = `<div class="t${p.total ? ' total' : ''}${p.zero ? ' zero' : ''}"><b>${p.amount}</b><small>${p.label}</small></div>`;
    return t + (ops[i] ? `<span class="op">${ops[i]}</span>` : '');
  }).join('');
  const stack = d.pieces.bar.map((p) => `<i style="width:${p.pct}%;background:${p.fill}" data-tip="${p.tip}"></i>`).join('');
  const legend = d.pieces.bar.map((p) => `<span style="--c:${p.fill}">${p.legend} <b class="tn">${p.amount}</b></span>`).join('');
  const cols = d.byMonthChart.cols.map((c) => `<div class="colb" data-tip="${c.tip}"><span>${c.label}</span><i style="height:${c.height}"></i></div>`).join('');
  const xs = d.byMonthChart.cols.map((c) => `<span>${c.x}</span>`).join('');
  const cash = d.check.cash.map((r) => `<div class="r"><div><strong>${r.label}</strong></div><div class="right"><span class="amt">${r.amount}</span></div></div>`).join('');
  const plans = d.plans.rows.map((r) => `<tr><td>${r.plan}</td><td class="num">${r.customers}</td><td class="num">${r.month}</td><td><div class="cellpg">${pg(r.pct)}<span>${r.share}</span></div></td></tr>`).join('');
  const keepRows = d.keeping.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong>${r.sub ? `<small>${r.sub}</small>` : ''}</div><div class="right">${r.pill ? pill(r.pill, r.pillCls) : `<span class="amt${r.down ? ' down' : ''}">${r.amount}</span>`}</div></div>`).join('');
  const cohort = d.cohort.rows.map((r) => `<tr><td>${r.joined}</td><td class="num">${r.first}</td>${r.cells.map(([cls, v]) => `<td class="c ${cls}">${v}</td>`).join('')}</tr>`).join('');
  const foot = d.cohort.foot.map(([cls, v]) => `<td class="c ${cls}">${v}</td>`).join('');
  const months = d.monthTable.rows.map((r) => `<tr><td>${r.month}</td><td class="num">${r.rev}</td><td class="num${r.changeCls ? ' ' + r.changeCls : ''}">${r.change}</td><td class="num${r.neuCls ? ' ' + r.neuCls : ''}">${r.neu}</td><td class="num${r.upgCls ? ' ' + r.upgCls : ''}">${r.upg}</td><td class="num${r.canCls ? ' ' + r.canCls : ''}">${r.can}</td><td class="num">${r.cust}</td></tr>`).join('');
  const traffic = d.traffic.rows.map((r) => `<tr><td>${r.source}</td><td class="num">${r.clicks}</td><td class="num">${r.carts}</td><td class="num">${r.sales}</td><td class="num">${r.rev}</td><td>${r.pill ? pill(r.pill) : `<div class="cellpg">${pg(r.pct)}<span>${r.share}</span></div>`}</td></tr>`).join('');
  const ads = d.ads.rows.map((r) => `<tr><td>${r.ad}<small>${pill(r.pill, 'crit')}</small></td><td class="num">${r.spent}</td><td class="num">${r.back}</td><td><div class="cellpg">${pg(r.pct, 'crit')}<span>${r.per}</span></div></td><td class="num">${btn('Pause', { msg: r.msg, cls: 'line', sm: true })}</td></tr>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${tiles(d.tiles)}
  <div class="card pad">
    <div class="cardhead"><h2>${d.pieces.title}</h2><span class="meta">${d.pieces.meta}</span></div>
    <div class="eq tn">${eq}</div>
    <div class="pg tall stack" style="margin-top:1rem" role="img" aria-label="${d.pieces.barAria}">${stack}</div>
    <div class="legend">${legend}</div>
  </div>
  <div class="split">
    <div class="card pad">
      <div class="cardhead"><h2>${d.byMonthChart.title}</h2><span class="meta">${d.byMonthChart.meta}</span></div>
      <div class="chart"><div class="cols" style="grid-template-columns:repeat(6,1fr);height:19rem">${cols}</div><div class="colx" style="grid-template-columns:repeat(6,1fr)">${xs}</div></div>
    </div>
    <div class="card pad insight">
      <div class="cardhead" style="margin-bottom:.8rem"><h2><svg class="ic"><use href="#i-bulb"/></svg>Worth checking</h2></div>
      <hr><span class="pill risk">${d.check.pill}</span>
      <h3>${d.check.heading}</h3><p>${d.check.body}</p>
      <div class="box"><div class="rows">${cash}</div><p>${d.check.note}</p>${btn('Send to Planner', { msg: 'Sent to Planner as a task', cls: 'wide' })}</div>
    </div>
  </div>
  <div class="thirds">
    <div class="card pad">
      <div class="cardhead"><h2>${d.plans.title}</h2><span class="meta">${d.plans.meta}</span></div>
      <div class="tblwrap"><table><thead><tr><th>Plan</th><th class="num">Customers</th><th class="num">A month</th><th>Share</th></tr></thead><tbody>${plans}</tbody></table></div>
      <p class="note" style="text-align:left;margin:.7rem 0 0">${d.plans.note}</p>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.keeping.title}</h2><span class="meta">${d.keeping.meta}</span></div>
      <div class="pgs">${d.keeping.bars.map((b) => pgrow({ label: b.label, value: b.value, pct: b.pct, pg: b.pg, tall: true })).join('')}</div>
      <div class="rows" style="margin-top:1rem">${keepRows}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.customersByMonth.title}</h2></div>
      <div class="pgs">${d.customersByMonth.rows.map(pgrow).join('')}</div>
      <div class="empty" style="margin-top:1rem"><strong>${d.customersByMonth.empty}</strong> ${d.customersByMonth.emptyRest}</div>
    </div>
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>${d.cohort.title}</h2><div class="key"><span style="--c:var(--accent)">Grew</span><span style="--c:var(--ok-fill)">Kept it all</span><span style="--c:var(--risk-fill)">Lost some</span><span style="--c:var(--crit-fill)">Lost most</span></div></div>
    <p class="note" style="text-align:left;margin:-.4rem 0 .8rem">${d.cohort.note}</p>
    <div class="tblwrap"><table class="coh"><thead><tr>${d.cohort.headers.map((h, i) => `<th${i === 1 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${cohort}</tbody><tfoot><tr><td>Average</td><td></td>${foot}</tr></tfoot></table></div>
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>${d.monthTable.title}</h2><span class="meta">${d.monthTable.meta}</span></div>
    <div class="tblwrap"><table><thead><tr><th>Month</th><th class="num">Revenue a month</th><th class="num">Change</th><th class="num">New customers</th><th class="num">Upgrades</th><th class="num">Cancelled</th><th class="num">Customers</th></tr></thead><tbody>${months}</tbody></table></div>
  </div>
  <div class="sec">
    <div class="bar"><h2>${d.traffic.title}</h2><span class="kmeta">${d.traffic.meta}</span></div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.traffic.tableTitle}</h2><span class="meta">${d.traffic.tableMeta}</span></div>
      <div class="tblwrap"><table><thead><tr><th>Source</th><th class="num">Clicks</th><th class="num">Carts</th><th class="num">Sales</th><th class="num">Revenue</th><th>Share of revenue</th></tr></thead><tbody>${traffic}</tbody><tfoot><tr><td>Total</td><td class="num">${d.traffic.foot.clicks}</td><td class="num">${d.traffic.foot.carts}</td><td class="num">${d.traffic.foot.sales}</td><td class="num">${d.traffic.foot.rev}</td><td></td></tr></tfoot></table></div>
    </div>
  </div>
  <div class="split even">
    <div class="card pad">
      <div class="cardhead"><h2>${d.dropoff.title}</h2><span class="meta">${d.dropoff.meta}</span></div>
      <div class="pgs">${d.dropoff.bars.map((b) => pgrow({ label: b.label, value: b.value, pct: b.pct, min: b.min, tall: true })).join('')}</div>
      <div class="box"><h4>${d.dropoff.leakTitle}</h4><p>${d.dropoff.leak}</p>${btn('Send to Planner', { msg: 'Sent to Planner as a task', cls: 'wide' })}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.ads.title}</h2><span class="meta">${d.ads.meta}</span></div>
      <div class="tblwrap"><table><thead><tr><th>Ad</th><th class="num">Spent</th><th class="num">Back</th><th>Back per $1</th><th></th></tr></thead><tbody>${ads}</tbody></table></div>
      <p class="note" style="text-align:left;margin:.7rem 0 0">${d.ads.note}</p>
    </div>
  </div>
</div>`;
}
