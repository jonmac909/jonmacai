import { esc, pill } from '../ui.js';
import { shell, STATUS, youtubeFlag } from './channels.js';

// Track (2026-11-02): one row per Calendar video. A video not made yet shows its Calendar status.
const STAGE = { created: ['Created', 'blue'], posted: ['Posted to YouTube', 'violet'], scheduled: ['Scheduled', 'teal'], live: ['Live', 'ok'] };
const RANK = Object.keys(STAGE);
const TEXT = ['label', 'channelLabel', 'title'];

// Starts in the server's order: channels as on the Calendar, videos newest first. Kept across re-renders.
const sorts = { channels: {}, videos: {} };

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

const stat = (v, n, text) => (n != null ? text : v.connected ? '–' : '<span class="muted">not connected</span>');

function videoRow(v) {
  const [label, cls] = STAGE[v.status] || STATUS[v.calendarStatus] || [v.calendarStatus, ''];
  const link = v.url
    ? `<code class="tklink">${esc(v.url.replace(/^https?:\/\//, ''))}</code><button type="button" class="btn sm line" data-copy="${esc(v.url)}">Copy</button>`
    : '<span class="muted">No landing page</span>';
  return `<tr><td>${esc(v.channelLabel)}</td><td>${esc(v.title)}</td><td>${pill(label, cls)}${youtubeFlag(v)}</td>
    <td class="num">${stat(v, v.impressions, Number(v.impressions).toLocaleString('en-US'))}</td>
    <td class="num">${stat(v, v.ctr, `${v.ctr}%`)}</td>
    <td class="num">${stat(v, v.views, Number(v.views).toLocaleString('en-US'))}</td>
    <td class="num">${v.clicks.toLocaleString('en-US')}</td><td class="tkcell">${link}</td></tr>`;
}

export function track(d, _data, sub) {
  return shell('Track', d, sub, (c) => {
    const channels = (c.all ? d.channels.slice(1) : [c]).map((x) => ({ ...x, ...x.counts }));
    const videos = c.all ? d.videos : d.videos.filter((v) => v.channel === c.slug);
    return `<div class="card pad">
    <div class="cardhead"><h2>Channels</h2><span class="meta">Each video counts once, at its current status</span></div>
    <div class="tblwrap"><table><thead><tr>${th('channels', 'label', 'Channel')}${RANK.map((s) => th('channels', s, STAGE[s][0], true)).join('')}</tr></thead>
    <tbody>${sorted(channels, sorts.channels).map((x) => `<tr data-page="track/${esc(x.slug)}"><td>${esc(x.label)}</td>${RANK.map((s) => `<td class="num">${x[s]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  </div>
  <div class="card pad">
    <div class="cardhead"><h2>Videos</h2><span class="meta">${videos.length} on the calendar</span></div>
    ${videos.length ? `<div class="tblwrap"><table><thead><tr>${th('videos', 'channelLabel', 'Channel')}${th('videos', 'title', 'Title')}${th('videos', 'status', 'Status')}${th('videos', 'impressions', 'Impressions', true)}${th('videos', 'ctr', 'Click-through rate', true)}${th('videos', 'views', 'Views', true)}${th('videos', 'clicks', 'Clicks', true)}<th>Link</th></tr></thead>
    <tbody>${sorted(videos, sorts.videos).map(videoRow).join('')}</tbody></table></div>` : '<p class="muted">No videos on the calendar yet.</p>'}
  </div>`;
  });
}
