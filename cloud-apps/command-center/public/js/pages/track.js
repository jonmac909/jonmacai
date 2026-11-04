import { esc, pill } from '../ui.js';
import { shell, STATUS, youtubeFlag } from './channels.js';

// Track (2026-11-02): one row per Calendar video. A video not made yet shows its Calendar status.
const STAGE = { created: ['Created', 'blue'], posted: ['Posted to YouTube', 'violet'], scheduled: ['Scheduled', 'teal'], live: ['Live', 'ok'] };
const RANK = Object.keys(STAGE);
const TEXT = ['label', 'channelLabel', 'title', 'onAir'];
const COUNTS_NOTE = 'Created is everything at QC or later. Posted is everything on YouTube. Scheduled and live are as they stand now.';

// Starts in the server's order: channels as on the Calendar, videos newest first. Kept across re-renders.
const sorts = { all: {}, channels: {}, videos: {} };

export function setSort(spec) {
  const [table, key] = spec.split(':');
  const s = sorts[table];
  sorts[table] = { key, dir: s.key === key ? -s.dir : TEXT.includes(key) ? 1 : -1 };
}

const value = (row, key) => (key === 'status' ? RANK.indexOf(row.status) : row[key]);

function sorted(rows, { key, dir }) {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const x = value(a, key);
    const y = value(b, key);
    if (x == null || y == null) return (x == null) - (y == null); // blanks last, either way
    return dir * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y)));
  });
}

function th(table, key, label, num) {
  const { key: on, dir } = sorts[table];
  const mark = on === key ? (dir > 0 ? ' ▲' : ' ▼') : '';
  return `<th${num ? ' class="num"' : ''}${on === key ? ` aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}><button type="button" class="thsort" data-tsort="${table}:${key}">${label}${mark}</button></th>`;
}

const stat = (n, text) => (n != null ? text : ''); // blank when Studio has no value, never a guess

function videoRow(v) {
  const [label, cls] = STAGE[v.status] || STATUS[v.calendarStatus] || [v.calendarStatus, ''];
  const none = v.linked ? '<span class="muted">No landing page</span>' : '';
  const link = v.url
    ? `<code class="tklink" title="${esc(v.url)}">${esc(v.url.replace(/^https?:\/\/[^/]+/, ''))}</code><button type="button" class="btn sm line" data-copy="${esc(v.url)}">Copy</button>`
    : none;
  return `<tr><td>${esc(v.channelLabel)}</td><td>${esc(v.title)}</td><td>${pill(label, cls)}${youtubeFlag(v)}</td>
    <td class="num">${stat(v.impressions, Number(v.impressions).toLocaleString('en-US'))}</td>
    <td class="num">${stat(v.ctr, `${esc(v.ctr)}%`)}</td>
    <td class="num">${stat(v.views, Number(v.views).toLocaleString('en-US'))}</td>
    <td class="num">${stat(v.clicks, Number(v.clicks).toLocaleString('en-US'))}</td><td class="tkcell">${link}</td>
    <td class="tkcell">${esc(v.updated)}</td></tr>`;
}

const num = (n) => (n != null ? Number(n).toLocaleString('en-US') : '');
const total = (vs, key) => (vs.some((v) => v[key] != null) ? vs.reduce((a, v) => a + (v[key] ?? 0), 0) : null); // blank when Studio has none

// All (Jon, 2026-11-04): one row per channel. Videos is everything on YouTube, Scheduled not public yet, Posted public.
function channelRow(c, videos) {
  const mine = videos.filter((v) => v.channel === c.slug);
  const on = mine.filter((v) => ['posted', 'scheduled', 'live'].includes(v.status));
  const live = on.filter((v) => v.status === 'live').length;
  return { slug: c.slug, label: c.label, onAir: live ? 'Yes' : 'No', videos: on.length, scheduled: on.filter((v) => v.status === 'scheduled').length, posted: live,
    impressions: total(mine, 'impressions'), views: total(mine, 'views'), subs: total(mine, 'subs') };
}

function allTable(d, last) {
  const rows = sorted(d.channels.slice(1).map((c) => channelRow(c, d.videos)), sorts.all);
  const cols = [['impressions', 'Impressions'], ['views', 'Views'], ['subs', 'Subs']];
  return `<div class="card pad">
    <div class="cardhead"><h2>Channels</h2><span class="meta">Videos counts every calendar video on YouTube, private ones too. Totals add up those videos; Subs is net subscribers from them.${last ? `Studio data last updated ${esc(last.updated)}` : 'No Studio data yet'}</span></div>
    <div class="tblwrap"><table><thead><tr>${th('all', 'label', 'Channel')}${th('all', 'onAir', 'Live')}${th('all', 'videos', 'Videos', true)}${th('all', 'scheduled', 'Scheduled', true)}${th('all', 'posted', 'Posted', true)}${cols.map(([k, l]) => th('all', k, l, true)).join('')}</tr></thead>
    <tbody>${rows.map((x) => `<tr data-page="track/${esc(x.slug)}"><td>${esc(x.label)}</td><td>${pill(x.onAir, x.onAir === 'Yes' ? 'ok' : '')}</td><td class="num">${x.videos}</td><td class="num">${x.scheduled}</td><td class="num">${x.posted}</td>${cols.map(([k]) => `<td class="num">${num(x[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  </div>`;
}

export function track(d, _data, sub) {
  return shell('Track', d, sub, (c) => {
    const channels = (c.all ? d.channels.slice(1) : [c]).map((x) => ({ ...x, ...x.counts }));
    const videos = c.all ? d.videos : d.videos.filter((v) => v.channel === c.slug);
    const last = videos.reduce((a, v) => (v.updatedAt > (a?.updatedAt || '') ? v : a), null);
    if (c.all) return allTable(d, last);
    return `<div class="card pad">
    <div class="cardhead"><h2>Channels</h2><span class="meta">${COUNTS_NOTE}</span></div>
    <div class="tblwrap"><table><thead><tr>${th('channels', 'label', 'Channel')}${RANK.map((s) => th('channels', s, STAGE[s][0], true)).join('')}</tr></thead>
    <tbody>${sorted(channels, sorts.channels).map((x) => `<tr data-page="track/${esc(x.slug)}"><td>${esc(x.label)}</td>${RANK.map((s) => `<td class="num">${x[s]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>Videos</h2><span class="meta">${videos.length} on the calendar. ${last ? `Studio data last updated ${esc(last.updated)}` : 'No Studio data yet'}</span></div>
    ${videos.length ? `<div class="tblwrap"><table class="tktable"><thead><tr>${th('videos', 'channelLabel', 'Channel')}${th('videos', 'title', 'Title')}${th('videos', 'status', 'Status')}${th('videos', 'impressions', 'Impressions', true)}${th('videos', 'ctr', 'CTR', true)}${th('videos', 'views', 'Views', true)}${th('videos', 'clicks', 'Clicks', true)}<th>Link</th>${th('videos', 'updatedAt', 'Updated')}</tr></thead>
    <tbody>${sorted(videos, sorts.videos).map(videoRow).join('')}</tbody></table></div>` : '<p class="muted">No videos on the calendar yet.</p>'}
  </div>`;
  });
}
