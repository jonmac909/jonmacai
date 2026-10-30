import { esc, pill } from '../ui.js';

// Calendar and Content (2026-10-30): one tab per YouTube channel, a row of tabs per group (scrolls
// sideways on phones). Links show as labelled buttons, never raw URLs, and only http(s) ones at all.
const web = (url) => /^https?:\/\//i.test(url || '');

export function linkLabel(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Open link'; }
  if (host === 'studio.youtube.com') return 'Open in Studio';
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return 'Watch on YouTube';
  if (host === 'docs.google.com') return 'Open doc';
  return 'Open link';
}

const linkButton = (url) => (web(url) ? `<a class="btn sm line" href="${esc(url)}" target="_blank" rel="noopener">${esc(linkLabel(url))}</a>` : '');

function tabs(page, all, current) {
  const groups = [...new Set(all.map((c) => c.group))];
  return `<nav class="cctabs" aria-label="Channels">${groups.map((g) => `<div class="ccgrp"><b>${esc(g)}</b>${all.filter((c) => c.group === g).map((c) => {
    const on = c === current;
    return `<button type="button" class="chip${on ? ' on' : ''}" data-page="${page}/${esc(c.slug)}"${on ? ' aria-current="page"' : ''}>${esc(c.label)}${c.count ? `<span class="ccn">${c.count}</span>` : ''}</button>`;
  }).join('')}</div>`).join('')}</nav>`;
}

function shell(title, d, sub, body) {
  const all = d?.channels || [];
  if (!all.length) return `<div class="wrap"><div class="card pad"><p class="muted">${esc(title)} has no data yet.</p></div></div>`;
  const c = all.find((x) => x.slug === sub) || all[0];
  const unread = d.available ? '' : `<p class="muted">The ${esc(title.toLowerCase())} tables could not be read.</p>`;
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(title)}</h1><p>${esc(c.label)}</p></div></div>
  ${tabs(title.toLowerCase(), all, c)}
  ${unread}${body(c)}
</div>`;
}

// One colour per stage, from idea (grey) to published (green).
const STATUS = {
  idea: ['Idea', ''], planned: ['Planned', ''], scripted: ['Scripted', 'blue'], recording: ['Recording', 'violet'],
  editing: ['Editing', 'violet'], qc: ['In QC', 'risk'], review: ['Ready for review', 'risk'], scheduled: ['Scheduled', 'teal'],
  published: ['Published', 'ok'],
};

function videoRow(v, all) {
  const [label, cls] = STATUS[v.status] || [v.status, ''];
  const when = `${esc(v.dateLabel)}${v.timeLabel ? `<small>${esc(v.timeLabel)}</small>` : ''}`;
  const title = all ? `<span class="ccch">${esc(v.channel)}</span>${esc(v.title)}` : esc(v.title);
  return `<li class="ccrow"><span class="ccdate">${when}</span><span class="cct">${title}</span><span class="ccend">${pill(label, cls)}${linkButton(v.link)}</span></li>`;
}

const videoList = (title, rows, all) => (rows.length ? `<h3 class="cch">${esc(title)}</h3><ul class="cclist">${rows.map((v) => videoRow(v, all)).join('')}</ul>` : '');

export function calendar(d, _data, sub) {
  return shell('Calendar', d, sub, (c) => `<div class="card pad">
    <div class="cardhead"><h2>${esc(c.label)}</h2><span class="meta">${c.all ? `${c.count} coming up` : `Posting days: ${c.schedule ? `<b>${esc(c.schedule)}</b>` : 'not set'}`}</span></div>
    ${c.upcoming.length || c.earlier.length ? videoList('Coming up', c.upcoming, c.all) + videoList('Last 60 days', c.earlier, c.all) : '<p class="muted">No videos on the calendar yet.</p>'}
  </div>`);
}

function outlierRow(o) {
  const thumb = web(o.thumb) ? `<img class="octhumb" src="${esc(o.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="octhumb"></span>';
  const select = `<button type="button" class="btn sm${o.selected ? '' : ' line'}" data-osel="${esc(o.selectUrl)}" data-on="${o.selected ? '1' : '0'}" aria-pressed="${o.selected}">${o.selected ? 'Selected for production' : 'Select for production'}</button>`;
  return `<li class="ocrow${o.selected ? ' on' : ''}">${thumb}<div class="ocbody"><span class="oct">${esc(o.title)}</span>
    <span class="ocm"><b>${esc(o.multipleLabel)}</b><i>·</i> <span>${esc(o.viewsLabel)}</span><i>·</i> <span>${esc(o.ageLabel)}</span></span>
    <span class="ocact">${linkButton(o.link)}${select}</span></div></li>`;
}

export function content(d, _data, sub) {
  return shell('Content', d, sub, (c) => `<div class="card pad">
    <div class="cardhead"><h2>Outliers for ${esc(c.label)}</h2><span class="meta">Best first, by views against their channel's average</span></div>
    ${c.outliers.length ? `<ul class="oclist">${c.outliers.map(outlierRow).join('')}</ul>` : '<p class="muted">No outliers found for this channel yet.</p>'}
  </div>`);
}
