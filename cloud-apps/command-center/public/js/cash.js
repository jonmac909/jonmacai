import { tile, pill, esc } from './ui.js';

const usd = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

export function cashCard(c, { compact = false } = {}) {
  if (!c) return '';
  if (!c.available) {
    return `<div class="card pad"><div class="cardhead"><h2>Sponsor cash</h2>${pill('Stale')}</div><p class="muted">No data. cash_ledger.csv has not reported from GPU2.</p></div>`;
  }
  const t = c.trailing;
  const unpaid = c.unpaid.map((u) => `<tr><td>${esc(u.sponsor)}</td><td class="num">${usd(u.owed)}</td><td>${u.due ? esc(u.due) : '<span class="muted">no due date on file</span>'}</td><td class="muted">${esc(u.status)}${u.lastEmail ? ` · last email ${esc(u.lastEmail)}` : ''}</td></tr>`).join('');
  const tiles = `<div class="tiles">${tile({ icon: 'dollar', label: `${c.month.label} cash received`, value: usd(c.month.usd), sub: `${c.month.payments} payment${c.month.payments === 1 ? '' : 's'}${c.month.unknown ? ` · ${c.month.unknown} amount unknown` : ''}` })}${tile({ icon: 'chart', label: 'Trailing 90-day average', value: usd(t.avg), goal: '/ $10k a month', pct: c.pct, pg: c.pct >= 100 ? 'ok' : c.pct >= 50 ? 'risk' : 'crit', sub: `${usd(t.total)} received since ${t.since}${t.unknown ? ` · ${t.unknown} amount unknown` : ''}` })}${tile({ icon: 'clock', label: 'Unpaid invoices', value: usd(c.owed), sub: `${c.unpaid.length} sponsor${c.unpaid.length === 1 ? '' : 's'}` })}</div>`;
  if (compact) return tiles;
  return `<div class="sec"><div class="bar"><h2>Cash received</h2><span class="muted">From cash_ledger.csv · deposits seen, not invoices</span></div>${tiles}
  ${c.unpaidAvailable ? `<div class="card pad"><div class="cardhead"><h2>Unpaid invoices</h2><span class="muted">Sponsor sheet${c.unpaidEditedAt ? ` · edited ${esc(c.unpaidEditedAt)}` : ''}</span></div><div class="tblwrap"><table><thead><tr><th>Sponsor</th><th class="num">Owed</th><th>Due</th><th>Status</th></tr></thead><tbody>${unpaid || '<tr><td colspan="4">None</td></tr>'}</tbody></table></div></div>` : '<p class="muted">Unpaid invoices: no data</p>'}</div>`;
}
