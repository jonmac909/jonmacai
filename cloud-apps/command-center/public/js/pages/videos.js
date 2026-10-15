import { tiles, pill, head, esc } from '../ui.js';

const STAGES = ['script', 'HeyGen', 'build', 'render', 'Ana check', 'ready for Jon', 'approved', 'posted'];

function stageCell(r) {
  if (!r.stage) return '<span class="muted">no data</span>';
  const cls = r.stage === 'ready for Jon' ? 'risk' : r.stage === 'approved' || r.stage === 'posted' ? 'ok' : 'blue';
  const dots = STAGES.map((s, i) => `<i class="${i < r.stageIdx ? 'past' : i === r.stageIdx ? 'now' : ''}" title="${esc(s)}"></i>`).join('');
  return `${pill(r.stage, cls)}<div class="stagedots">${dots}</div>`;
}

function row(r) {
  const video = r.video ? `${esc(r.video)}${r.key && r.video !== r.key ? `<br><small>${esc(r.key)}</small>` : ''}` : '<span class="muted">none in progress</span>';
  const more = r.more ? `<br><small>${esc(r.more)}</small>` : '';
  const review = r.review.slug
    ? `<a href="/review/${esc(r.review.slug)}" target="_blank" rel="noopener">${pill(r.review.text, r.review.cls)}</a>`
    : `<span class="muted">${esc(r.review.text)}</span>`;
  const posts = r.posts == null ? `<span class="muted">no data</span> / ${r.target}` : `${r.posts} / ${r.target}`;
  return `<tr><td><b>${esc(r.name)}</b></td><td>${video}${more}</td><td>${stageCell(r)}</td><td>${review}</td><td class="num">${posts}</td></tr>`;
}

function table(title, rows, note) {
  return `<div class="card pad"><div class="cardhead"><h2>${esc(title)}</h2><span class="muted">${esc(note)}</span></div>
  <div class="tblwrap"><table><thead><tr><th>Channel</th><th>Current video</th><th>Stage</th><th>Review page</th><th class="num">Posts this week</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div></div>`;
}

export function render(d) {
  const rows = d.rows || [];
  const sub = d.stale ? `${pill('Stale')} ${esc(d.sub || '')}` : esc(d.sub || '');
  if (!rows.length) return `<div class="wrap">${head('Videos', sub)}<div class="card pad"><p>No data yet. The GPU2 videos feed has not reported.</p></div></div>`;
  return `<div class="wrap">
  ${head('Videos', sub)}
  ${tiles(d.tiles || [])}
  ${table('ViralView channels', rows.filter((r) => r.kind === 'viralview'), '3 long-form videos a week each · built on GPU1 in DaVinci')}
  ${table('Affiliate channels', rows.filter((r) => r.kind === 'affiliate'), '1 video a day each · Avatar Studio on GPU2')}
</div>`;
}
