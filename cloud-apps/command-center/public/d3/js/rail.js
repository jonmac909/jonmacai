// The rail's live parts: the four status lines and the Blockers and Review counts. Plain functions over the
// /dashboard/api/d2 and /dashboard/api/d3 answers, so tests run them without a browser.
import { esc } from './util.js';

const LINES = [['dispatcher', 'Dispatcher'], ['bots', 'Bots'], ['tokens', 'Tokens'], ['youtube', 'YouTube']];

// Each line is real, or "<name> · No feed" in muted text with a grey dot.
export function statHtml(d3) { // the /dashboard/api/d3 answer
  const rail = d3?.d3?.rail || {};
  return LINES.map(([key, name]) => {
    const l = rail[key];
    if (!l || l.state === 'none' || !['g', 'y', 'r'].includes(l.state)) {
      const text = l && l.text && l.text !== 'No feed' ? l.text : `${name} · No feed`;
      return `<div><span class="dot"></span><span class="nfl">${esc(text)}</span></div>`;
    }
    return `<div><span class="dot ${l.state}"></span>${esc(l.text)}</div>`;
  }).join('');
}

// Counts only from real data; null (hidden) when the source could not be read.
export function railCounts(d2, d3) {
  const blockers = d2?.d2?.today?.blockers;
  const review = d3?.d3?.review;
  return { blockers: Array.isArray(blockers) ? blockers.length : null, review: review ? review.count : null };
}
