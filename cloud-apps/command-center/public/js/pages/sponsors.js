import { tiles, pg, pill, btn, kanban, pgrow, head, esc } from '../ui.js';
import { cashCard } from '../cash.js';

function partnersCard(p) {
  if (!p) return '';
  if (!p.available) return `<div class="card pad"><div class="cardhead"><h2>${esc(p.title)}</h2></div><p>${esc(p.note)}</p></div>`;
  const secs = p.sections.map((s) => `<div class="r"><div><strong>${esc(s.title)}</strong>${s.items.map((i) => `<small>${esc(i)}</small>`).join('')}</div></div>`).join('');
  const deals = p.pipeline ? p.pipeline.deals.map((d) => `<tr><td>${esc(d.brand)}</td><td>${pill(d.stage, d.stage === 'Negotiating' ? 'risk' : 'ok')}</td><td class="num">${esc(d.value)}</td><td>${esc(d.next)}</td><td>${esc(d.nextDate)}</td></tr>`).join('') : '';
  const pipe = p.pipeline ? `<div class="cardhead"><h2>Deal tracker</h2><span class="meta">${esc(p.pipeline.meta)} · ${esc(p.pipeline.counts)}</span></div>
    <div class="tblwrap"><table><thead><tr><th>Brand</th><th>Stage</th><th class="num">Value</th><th>Next step</th><th>When</th></tr></thead><tbody>${deals}</tbody></table></div>` : '';
  return `<div class="card pad">
    <div class="cardhead"><h2>${esc(p.title)} · ${esc(p.date)}</h2><span class="meta">${pill(p.status, p.current ? 'ok' : 'crit')} ${esc(p.updated)}</span></div>
    ${p.note ? `<p class="meta">${esc(p.note)}</p>` : ''}
    <div class="rows">${secs}</div>
    ${pipe}
  </div>`;
}

export function render(d) {
  const right = d.actions.map((a) => btn(a.label, { msg: a.msg, cls: 'line', href: a.href, kind: a.kind, payload: a.payload })).join('');
  const parts = d.septemberBar.parts;
  const bar = parts.map((p) => `<i style="width:${p.pct}%;background:${p.fill}" data-tip="${p.tip}"></i>`).join('');
  const legend = parts.map((p) => `<span style="--c:${p.fill}">${p.legend} <b class="tn">${p.amount}</b></span>`).join('')
    + `<span style="--c:var(--ink)">${d.septemberBar.line}</span>`;
  const collect = d.collect.rows.map((r) => `<tr><td>${r.sponsor}<small>${pill(r.pill, r.pillCls)}</small></td><td class="num">${r.total}</td><td class="num">${r.owed}</td><td><div class="cellpg">${pg(r.paidPct, r.pg)}<span>${r.paid}</span></div></td><td>${r.block}</td><td>${r.next}</td><td class="num">${btn(r.btn, { kind: r.kind, payload: r.payload, cls: r.btnCls || '', sm: true })}${btn('Mark paid', { kind: r.paidKind, payload: r.paidPayload, cls: 'line', sm: true })}</td></tr>`).join('');
  const emails = d.emails.rows.map((r) => {
    const payload = {
      id: r.id, to: r.to, subject: r.subject, body: r.body, isolated: r.isolated || String(r.id || '').startsWith('qa-'),
      saveKind: r.saveKind || 'sponsor.save_draft',
      sendKind: r.sendKind || 'sponsor.send_draft',
      discardKind: r.discardKind || 'sponsor.discard_draft',
    };
    return `<div class="r"><div><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small></div><div class="right">${btn('Review', { draft: true, payload, cls: 'line' })}</div></div>`;
  }).join('');
  return `<div class="wrap">
  ${head(d.title, d.sub, right)}
  ${partnersCard(d.partners)}
  ${cashCard(d.cash)}
  ${tiles(d.tiles)}
  <div class="card pad">
    <div class="cardhead"><h2>${d.septemberBar.title}</h2><span class="meta">${d.septemberBar.meta}</span></div>
    <div style="position:relative">
      <div class="pg tall stack" role="img" aria-label="${d.septemberBar.aria}">${bar}</div>
      <span style="position:absolute;left:${d.septemberBar.goalAt}%;top:-.35rem;bottom:-.35rem;width:2px;background:var(--ink)" title="$10,000 goal"></span>
    </div>
    <div class="legend">${legend}</div>
  </div>
  <div class="sec">
    <div class="bar"><h2>${d.board.title}</h2><span class="kmeta">${d.board.meta}</span></div>
    ${kanban(d.board.columns)}
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>${d.collect.title}</h2><span class="meta">${d.collect.meta}</span></div>
    <div class="tblwrap"><table><thead><tr><th>Sponsor</th><th class="num">Total</th><th class="num">Owed</th><th>Paid so far</th><th>What's blocking it</th><th>Next step</th><th></th></tr></thead><tbody>${collect}</tbody></table></div>
  </div>
  <div class="split">
    <div class="card pad">
      <div class="cardhead"><h2>${d.emails.title}</h2><span class="meta">${d.emails.meta}</span></div>
      <div class="rows">${emails}</div>
    </div>
    <div class="card pad">
      <div class="cardhead"><h2>${d.byMonth.title}</h2><span class="meta">${d.byMonth.meta}</span></div>
      <div class="pgs">${d.byMonth.rows.map(pgrow).join('')}</div>
    </div>
  </div>
</div>`;
}
