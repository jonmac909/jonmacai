import { tile, pill, esc } from './ui.js';

const usd = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
// Deposits keep their cents: $8,888.75 is not $8,889.
const usdx = (n) => {
  const x = Math.round((Number(n) || 0) * 100) / 100;
  return `$${x.toLocaleString('en-US', Number.isInteger(x) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export function cashCard(c, { compact = false } = {}) {
  if (!c) return '';
  if (!c.available) {
    return `<div class="card pad"><div class="cardhead"><h2>Sponsor cash</h2>${pill('Stale')}</div><p class="muted">No data. No deposit feed or cash_ledger.csv has reported.</p></div>`;
  }
  const t = c.trailing;
  const src = c.source || {};
  const unpaid = c.unpaid.map((u) => `<tr><td>${esc(u.sponsor)}</td><td class="num">${usd(u.owed)}</td><td>${u.due ? esc(u.due) : '<span class="muted">no due date on file</span>'}</td><td class="muted">${esc(u.status)}${u.lastEmail ? ` · last email ${esc(u.lastEmail)}` : ''}</td></tr>`).join('');
  const tiles = `<div class="tiles">${tile({ icon: 'dollar', label: `${c.month.label} deposits received`, value: usdx(c.month.usd), sub: `${c.month.payments} deposit${c.month.payments === 1 ? '' : 's'}${c.month.unknown ? ` · ${c.month.unknown} amount unknown` : ''}` })}${tile({ icon: 'chart', label: 'Trailing 90-day average', value: usd(t.avg), goal: '/ $10k a month', pct: c.pct, pg: c.pct >= 100 ? 'ok' : c.pct >= 50 ? 'risk' : 'crit', sub: `${usdx(t.total)} received since ${t.since}${t.unknown ? ` · ${t.unknown} amount unknown` : ''}` })}${tile({ icon: 'clock', label: 'Unpaid invoices', value: usd(c.owed), sub: `${c.unpaid.length} sponsor${c.unpaid.length === 1 ? '' : 's'}` })}</div>`;
  if (compact) return tiles;
  const month = (c.recent || []).filter((r) => String(r.date).startsWith(c.month.key || ''));
  const deposits = month.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.sponsor)}</td><td class="num">${r.usd == null ? '<span class="muted">unknown</span>' : usdx(r.usd)}</td></tr>`).join('');
  const warn = src.stale ? `<p class="gwarn">${esc(src.note || 'This feed may be missing recent deposits.')}</p>` : '';
  return `<div class="sec"><div class="bar"><h2>Cash received</h2><span class="muted">${esc(src.label || 'Deposit ledger')} · every deposit into the USD account, not only invoices</span>${src.stale ? pill('Stale', 'risk') : ''}</div>${warn}${tiles}
  <div class="card pad"><div class="cardhead"><h2>${esc(c.month.label)} deposits counted</h2><span class="muted">${usdx(c.month.usd)} total</span></div><div class="tblwrap"><table><thead><tr><th>Date</th><th>From</th><th class="num">Amount</th></tr></thead><tbody>${deposits || '<tr><td colspan="3">No deposits this month</td></tr>'}</tbody></table></div></div>
  ${c.unpaidAvailable ? `<div class="card pad"><div class="cardhead"><h2>Unpaid invoices</h2><span class="muted">Sponsor sheet${c.unpaidEditedAt ? ` · edited ${esc(c.unpaidEditedAt)}` : ''}</span></div><div class="tblwrap"><table><thead><tr><th>Sponsor</th><th class="num">Owed</th><th>Due</th><th>Status</th></tr></thead><tbody>${unpaid || '<tr><td colspan="4">None</td></tr>'}</tbody></table></div></div>` : '<p class="muted">Unpaid invoices: no data</p>'}</div>`;
}
