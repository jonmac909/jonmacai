import { tiles, pill, head, esc } from '../ui.js';

const STATUS = { pass: ['Green', 'ok'], fail: ['Failing', 'crit'], pending: ['In progress', 'risk'], none: ['No result', ''] };

function when(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT';
}

function checkRow(c) {
  const [label, cls] = STATUS[c.status] || STATUS.none;
  const at = when(c.at);
  return `<tr><td><b>${esc(c.name)}</b></td><td>${pill(label, cls)}</td><td class="lastline">${esc(c.note)}${at ? `<br><small>${esc(at)}</small>` : ''}</td></tr>`;
}

function sales(s) {
  if (!s.available) return '<p class="muted">Funnel database unavailable · no data</p>';
  const rows = s.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.charged}</td><td class="num">${r.hosted}</td></tr>`).join('');
  const sessions = s.sessions.map((x) => `<li>${esc(x.label)} · ${x.n}</li>`).join('');
  return `<p><b>${s.buyers}</b> live $47 buyer${s.buyers === 1 ? '' : 's'} recorded${s.live ? '' : ' · webinar not live yet'}</p>
  ${rows ? `<div class="tblwrap"><table><thead><tr><th>Upsell</th><th class="num">One-click charged</th><th class="num">Sent to hosted checkout</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No upsells yet</p>'}
  ${sessions ? `<h3>Session assignments</h3><ul>${sessions}</ul>` : ''}`;
}

export function render(d) {
  const sub = d.stale ? `${pill('Stale')} ${esc(d.sub || '')}` : esc(d.sub || '');
  return `<div class="wrap">
  ${head('Webinar', sub)}
  ${tiles(d.tiles || [])}
  <div class="card pad"><div class="cardhead"><h2>Ready by end of Mon Oct 19</h2><span class="muted">${esc(d.green || '')} · ${esc(d.deadlineLeft || '')} left</span></div>
    <div class="tblwrap"><table><thead><tr><th>Item</th><th>Status</th><th>Latest result</th></tr></thead><tbody>${(d.checklist || []).map(checkRow).join('')}</tbody></table></div>
    <p class="muted">Read from the JON-6 worker's results files. Nothing here changes the funnel.</p></div>
  <div class="card pad"><div class="cardhead"><h2>Buyers and upsells</h2></div>${sales(d.sales || {})}</div>
</div>`;
}
