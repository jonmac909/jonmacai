import { tiles, pill, head, esc } from '../ui.js';

const STAGES = ['Script', 'HeyGen', 'Pictures', 'Edit', 'Render', 'Ana check', 'Ready for Jon', 'Approved', 'Posted'];

function stageCell(r) {
  if (!r.stage) return '<span class="muted">unknown</span>';
  const cls = r.stage.toLowerCase().startsWith('ready') ? 'risk' : r.stageIdx >= 7 ? 'ok' : r.blocked || r.overCap ? 'crit' : 'blue';
  const pct = r.stagePct != null ? ` · ${Math.round(r.stagePct)}%` : '';
  const dots = STAGES.map((s, i) => `<i class="${i < r.stageIdx ? 'past' : i === r.stageIdx ? 'now' : ''}" title="${esc(s)}"></i>`).join('');
  const time = r.inStage != null ? `${r.inStage} min in stage${r.capMin != null ? ` of ${r.capMin}` : ''}` : 'time in stage unknown';
  const eta = r.eta ? ` · ETA ${esc(r.eta)}` : '';
  const blocked = r.blocked ? `<br><small class="bad">Blocked: ${esc(r.blocked)}</small>` : '';
  return `${pill(`${r.stage}${pct}`, cls)}<div class="stagedots">${dots}</div><small class="${r.overCap ? 'bad' : 'muted'}">${esc(time)}${eta}</small>${blocked}`;
}

function row(r) {
  const video = r.sourceUrl ? `${esc(r.video)} · <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">source</a>` : esc(r.video);
  const review = r.review.slug
    ? `<a href="/review/${esc(r.review.slug)}" target="_blank" rel="noopener">${pill(r.review.text, r.review.cls)}</a>`
    : `<span class="muted">${esc(r.review.text)}</span>`;
  return `<tr><td><b>${esc(r.name)}</b>${r.host ? `<br><small>${esc(r.host)}</small>` : ''}</td><td>${video}</td><td>${stageCell(r)}</td><td class="lastline">${esc(r.lastLine) || '<span class="muted">unknown</span>'}</td><td>${review}</td><td class="num"><span class="muted">no data</span> / ${r.target}</td></tr>`;
}

function table(title, rows, note) {
  const body = rows.length ? rows.map(row).join('') : '<tr><td colspan="6" class="muted">No rows in the production feed</td></tr>';
  return `<div class="card pad"><div class="cardhead"><h2>${esc(title)}</h2><span class="muted">${esc(note)}</span></div>
  <div class="tblwrap"><table><thead><tr><th>Channel</th><th>Current video</th><th>Stage</th><th>Latest</th><th>Review page</th><th class="num">Posts this week</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

export function render(d) {
  const rows = d.rows || [];
  const sub = d.stale ? `${pill('Stale')} ${esc(d.sub || '')}` : esc(d.sub || '');
  return `<div class="wrap">
  ${head('Videos', sub)}
  ${tiles(d.tiles || [])}
  ${table('ViralView channels', rows.filter((r) => r.kind === 'viralview'), '3 long-form videos a week each')}
  ${table('Affiliate channels', rows.filter((r) => r.kind === 'affiliate'), '1 video a day each')}
</div>`;
}
