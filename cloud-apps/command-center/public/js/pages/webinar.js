import { tiles, head, esc } from '../ui.js';

function sales(s) {
  if (!s.available) return '<p class="muted">Funnel database unavailable · no data</p>';
  const rows = s.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.charged}</td><td class="num">${r.hosted}</td></tr>`).join('');
  const sessions = s.sessions.map((x) => `<li>${esc(x.label)} · ${x.n}</li>`).join('');
  return `<p><b>${s.buyers}</b> live $47 buyer${s.buyers === 1 ? '' : 's'} recorded${s.live ? '' : ' · webinar not live yet'}</p>
  ${rows ? `<div class="tblwrap"><table><thead><tr><th>Upsell</th><th class="num">One-click charged</th><th class="num">Sent to hosted checkout</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No upsells yet</p>'}
  ${sessions ? `<h3>Session assignments</h3><ul>${sessions}</ul>` : ''}`;
}

export function render(d) {
  return `<div class="wrap">
  ${head('Webinar', esc(d.sub || ''))}
  ${tiles(d.tiles || [])}
  <div class="card pad"><div class="cardhead"><h2>Buyers and upsells</h2></div>${sales(d.sales || {})}</div>
</div>`;
}
