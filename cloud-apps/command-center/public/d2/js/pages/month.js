import { esc, pill, head } from '/dashboard/js/ui.js';

// Shared by every Dashboard 2 page (docs/dashboard-2.md). Pages return HTML strings; app.js does the DOM.

// Every number names its source and age; a stale one gets a red pill.
export const age = (s) => (s ? `<span class="d2age">${esc(s.label)} · ${esc(s.ageLabel)}${s.stale ? ` ${pill('Stale', 'crit')}` : ''}</span>` : '');

export function banner(d2) {
  const list = d2?.stale || [];
  return list.length ? `<p class="d2stale" role="status"><b>These numbers are old:</b> ${list.map((s) => `${esc(s.label)} (${esc(s.ageLabel)})`).join(' · ')}</p>` : '';
}

export const top = (title, sub, d2) => head(title, esc(sub)) + banner(d2);
export const status = (s) => (s?.text ? pill(s.text, s.cls === 'idle' ? '' : s.cls) : '');

export function fmt(unit, n) {
  if (n == null) return '';
  if (unit === 'usd') return `$${Math.round(n).toLocaleString('en-US')}`;
  if (unit === 'yesno') return n ? 'Yes' : 'No';
  return String(Math.round(n * 10) / 10);
}

// Progress toward the target, with the pace mark where the number should be by now.
export function bar(x) {
  if (!x.target || x.actual == null) return '';
  const pct = Math.min(100, Math.round((x.actual / x.target) * 100));
  const pace = x.pace == null ? '' : `<span class="pacemark" style="left:${Math.min(100, Math.round((x.pace / x.target) * 100))}%" title="Where it should be by now"></span>`;
  return `<div class="gbar ${esc(x.status?.cls || '')}"><i style="width:${pct}%"></i>${pace}</div>`;
}

// The number, or the reason there is none (never a 0 standing in for "no data").
export const value = (x) => (x.actual == null ? `<span class="d2note">${esc(x.note || x.display)}</span>` : `<b>${esc(x.display)}</b>`);

// Week-by-week bars for the month, with each week's target as a line.
function trend(list, unit) {
  if (!list?.some((w) => w.target || w.actual)) return '';
  const max = Math.max(1, ...list.map((w) => Math.max(w.target || 0, w.actual || 0))) * 1.1;
  const y = (v) => 40 - (v / max) * 38;
  const bars = list.map((w, i) => {
    const cls = w.current ? 'now' : w.target && w.actual >= w.target ? 'ok' : '';
    const rect = w.actual ? `<rect class="${cls}" x="${i * 10 + 2}" y="${y(w.actual).toFixed(1)}" width="6" height="${(40 - y(w.actual)).toFixed(1)}" rx="1"/>` : '';
    const line = w.target ? `<line x1="${i * 10 + 0.5}" x2="${i * 10 + 9.5}" y1="${y(w.target).toFixed(1)}" y2="${y(w.target).toFixed(1)}"/>` : '';
    return rect + line;
  }).join('');
  const aria = list.map((w) => `${w.label}: ${w.actual == null ? 'no data' : fmt(unit, w.actual)}${w.target ? ` of ${fmt(unit, w.target)}` : ''}`).join(', ');
  return `<figure class="d2trend"><svg viewBox="0 0 ${list.length * 10} 40" preserveAspectRatio="none" role="img" aria-label="${esc(`Week by week. ${aria}`)}">${bars}</svg>
    <figcaption>${list.map((w) => `<span${w.current ? ' class="on"' : ''}>${esc(w.label)}</span>`).join('')}</figcaption></figure>`;
}

function row(g) {
  const x = g.month || {};
  const target = x.target == null || / of /.test(x.display) ? '' : ` <span class="muted">of ${esc(fmt(x.unit, x.target))}</span>`;
  const pace = x.pace == null || x.actual == null ? '' : `<span>Pace for today: ${esc(fmt(x.unit, x.pace))}</span>`;
  return `<li class="d2row">
    <div class="d2main">
      <div class="d2t"><b>${esc(g.title)}</b><span class="muted">${esc(g.owner)}</span>${status(x.status)}</div>
      <div class="d2lab">${esc(x.label)}</div>
      <div class="d2v">${value(x)}${x.actual == null ? '' : target}</div>
      ${bar(x)}
      <div class="d2meta">${pace}${age(x.source)}</div>
      ${x.rows?.length ? `<details class="d2chrows" data-keep="rows-${esc(g.key)}"><summary>By channel (${x.rows.length})</summary><ul class="d2ch">${x.rows.map((r) => `<li><span>${esc(r.label)}</span><b>${esc(r.display)}</b>${status(r.status)}</li>`).join('')}</ul></details>` : ''}
    </div>
    ${trend(g.trend, x.unit)}
  </li>`;
}

export function render(data) {
  const d2 = data?.d2 || {};
  const m = d2.period?.month || {};
  return `<div class="wrap">
  ${top('Month', `${m.label || ''}${m.daysLeft != null ? ` · ${m.daysLeft} days left` : ''}`, d2)}
  <div class="card pad"><ul class="d2rows">${(d2.goals || []).map(row).join('')}</ul></div>
</div>`;
}
