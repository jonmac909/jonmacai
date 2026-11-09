import { esc, pill } from '/dashboard/js/ui.js';
import { STATUS } from '/dashboard/js/pages/channels.js';
import { chipOf } from '/dashboard/js/pages/factory.js';

// Video stages (Jon, 2026-11-09) for Jon Mac, @JonMacAI and Home Guide Press, drawn from the Factory feed
// (GET /dashboard/api/v1/factory). A video sits at the first Factory step that is not done; a video already on a
// channel calendar sits at Schedule (scheduled) or Published (live). Factory steps, in order:
// Outlier, Script, Script QC, A-roll, Images, Clips, Preflight, Edit, Video QC, Thumbnail, Upload.
export const STAGES = ['Outlier', 'Script', 'HeyGen', 'Edit', 'QC', 'Review', 'Schedule', 'Published'];
const OF_STEP = ['Outlier', 'Script', 'Script', 'HeyGen', 'Edit', 'Edit', 'Edit', 'Edit', 'QC', 'Review', 'Review'];

export function stageOf(t) {
  if (!Array.isArray(t.cells)) return t.stage === 'published' ? 'Published' : 'Schedule';
  const i = t.cells.findIndex((c) => c?.s !== 'done');
  return i < 0 ? 'Schedule' : OF_STEP[i] || 'Review'; // every step done = uploaded, waiting for its time
}

const msg = (t) => `<div class="card pad"><p class="muted">${esc(t)}</p></div>`;
const name = (t) => { const s = String(t.title ?? ''); return t.channel && s.endsWith(` - ${t.channel}`) ? s.slice(0, -(t.channel.length + 3)) : s; };
const wait = (min) => (min == null ? '' : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

function tile(t) {
  const link = /^https:\/\//.test(t.link || '') ? ` <a href="${esc(t.link)}" target="_blank" rel="noopener">Open</a>` : '';
  const sub = [t.channel, t.owner, t.note || wait(t.waitMin)].filter(Boolean).map(esc).join(' · ');
  return `<li class="d2stc"><b>${esc(name(t))}</b>${t.stuck ? pill('Stuck', 'crit') : ''}<small>${sub}${link}</small></li>`;
}

// `feed` is the Factory answer { factory, channels, asOf }; `channels` the goal's [{ slug, label }].
export function stageBoard(feed, channels) {
  const tiles = feed?.factory?.tiles;
  if (!Array.isArray(tiles)) return msg('The video board has no data yet. The Factory feed on GPU1 has not posted.');
  const by = new Map(STAGES.map((s) => [s, []]));
  for (const t of tiles) {
    const slug = chipOf(t.channel, channels);
    if (channels.some((c) => c.slug === slug)) by.get(stageOf(t)).push(t);
  }
  return `<div class="sec"><div class="bar"><h2>Videos by stage</h2><span class="kmeta">Every open video, and what is scheduled or live</span></div>
    <div class="d2st">${STAGES.map((s) => `<div class="d2stcol"><h3>${esc(s)} <span class="kn">${by.get(s).length}</span></h3><ul>${by.get(s).map(tile).join('') || '<li class="muted">None</li>'}</ul></div>`).join('')}</div></div>`;
}

const mins = (l) => { const m = /^(\d+):(\d+) (AM|PM)/.exec(l || ''); return m ? ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 1e4; };

// Mon to Sun, every channel: the videos planned or scheduled this week (and any already live).
export function weekCalendar(data) {
  const days = data?.d2?.period?.week?.days || [];
  const all = (data?.pages?.calendar?.channels || []).find((c) => c.all);
  if (!all || !days.length) return msg('The calendar has no data yet.');
  const vids = [...(all.earlier || []), ...(all.upcoming || [])].filter((v) => v.status !== 'idea');
  return `<div class="sec"><div class="bar"><h2>This week</h2><span class="kmeta">${esc(data.d2.period.week.label || '')} · all channels</span></div>
    <div class="d2wk">${days.map((d) => {
    const list = vids.filter((v) => v.date === d.ymd).sort((a, b) => mins(a.timeLabel) - mins(b.timeLabel));
    return `<div class="d2wkday${d.isToday ? ' today' : ''}"><h3>${esc(d.label)}</h3><ul>${list.map((v) => {
      const [label, cls] = STATUS[v.status] || [v.status, ''];
      return `<li><small>${esc(v.timeLabel || '')}</small><b>${esc(v.title)}</b><small>${esc(v.channel)}</small>${pill(label, cls)}</li>`;
    }).join('') || '<li class="muted">Nothing</li>'}</ul></div>`;
  }).join('')}</div></div>`;
}
