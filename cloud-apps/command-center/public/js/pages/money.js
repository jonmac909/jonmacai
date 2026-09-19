import { pg, pill, btn, pgrow, head } from '../ui.js';

function stages(list) {
  return `<div class="stages" style="margin-bottom:1rem">${list.map((s) => `<div class="stage"><small>${s.label}</small><b>${s.value}</b></div>`).join('')}</div>`;
}

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg, cls: 'line', kind: a.kind || (a.label === 'Scan banks now' ? 'bank.scan_now' : undefined), payload: a.payload })).join('');
  const scan = d.bankScan.rows.map((r) => `<div class="r"><div><strong>${r.title}</strong><small>${r.sub}</small></div><div class="right">${pill(r.pill, r.pillCls)}${r.btn ? btn(r.btn, { msg: r.msg, sm: true, done: true, kind: r.kind, payload: r.payload }) : ''}</div></div>`).join('');
  const charges = d.charges.rows.map((r) => `<tr><td>${r.date}</td><td>${r.charge}</td><td>${r.card}</td><td>${pill(r.filed, r.filedCls || '')}</td><td class="num">${r.amount}</td></tr>`).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  <div class="split even">
    <div class="card pad">
      <div class="cardhead"><h2>${d.personal.title}</h2><span class="meta">${d.personal.meta}</span></div>
      ${stages(d.personal.stages)}
      <div class="pgrow"><div class="lab"><span>${d.personal.barLabel}</span><span>${d.personal.barValue}</span></div>${pg(d.personal.pct, d.personal.pg + ' tall')}</div>
      <p class="note" style="text-align:left;margin:.6rem 0 0">${d.personal.note}</p>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.business.title}</h2><span class="meta">${d.business.meta}</span></div>
      ${stages(d.business.stages)}
      <div class="pgrow"><div class="lab"><span>${d.business.barLabel}</span><span>${d.business.barValue}</span></div>${pg(d.business.pct, d.business.pg + ' tall')}</div>
      <p class="note" style="text-align:left;margin:.6rem 0 0">${d.business.note}</p>
    </div>
  </div>
  <div class="split">
    <div class="card pad">
      <div class="cardhead"><h2>${d.categories.title}</h2><span class="meta tn">${d.categories.meta}</span></div>
      <div class="pgs">${d.categories.rows.map(pgrow).join('')}</div>
      <p class="note" style="text-align:left;margin:.8rem 0 0">${d.categories.note}</p>
    </div>
    <div class="stackcol">
      <div class="card pad insight">
        <div class="cardhead" style="margin-bottom:.8rem"><h2><svg class="ic"><use href="#i-bulb"/></svg>Worth fixing</h2></div>
        <hr><span class="pill crit">${d.fix.pill}</span>
        <h3>${d.fix.heading}</h3><p>${d.fix.body}</p>
        <div class="box"><p>${d.fix.box}</p>${btn(d.fix.btn, { msg: d.fix.msg, cls: 'wide' })}</div>
      </div>
      <div class="card pad">
        <div class="cardhead"><h2>${d.bankScan.title}</h2><span class="meta">${d.bankScan.meta}</span></div>
        ${pg(d.bankScan.pct, d.bankScan.pg + ' tall')}
        <div class="rows" style="margin-top:.9rem">${scan}</div>
      </div>
      <div class="card pad">
        <div class="cardhead"><h2>${d.netWorth.title}</h2><span class="meta">${d.netWorth.meta}</span></div>
        <div style="display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap"><span class="bignum" id="nw">${d.netWorth.hidden}</span><button class="link" id="nwbtn" type="button">Show</button></div>
        <svg class="spark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-label="Net worth trend, example shape"><path d="${d.netWorth.spark} L300,60 0,60Z" fill="var(--accent)" opacity=".1"/><path d="${d.netWorth.spark}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      </div>
    </div>
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>${d.charges.title}</h2><button class="link" data-msg="Opens MoneyClaw transactions">See all</button></div>
    <div class="tblwrap"><table><thead><tr><th>Date</th><th>Charge</th><th>Card</th><th>Filed under</th><th class="num">Amount</th></tr></thead><tbody>${charges}</tbody></table></div>
  </div>
</div>`;
}
