import { updatedLabel } from './tasks.js';
import { TZ } from './life.js';

// YouTube page (2026-10-24): one Kanban board per channel, built only from youtube.json
// (published by push.py with tasks.json). Read-only: the page links out to the review page
// and to YouTube Studio and never changes a video. A card that is not known sits in
// "Unknown" instead of being guessed into a column.
export const STAGES = [
  { key: 'production', label: 'In production' },
  { key: 'review', label: "Ready for Jon's review" },
  { key: 'approved', label: 'Approved' },
  { key: 'draft', label: 'Private draft in Studio' },
  { key: 'live', label: 'Scheduled / Live' },
];
const STAGE_KEYS = new Set(STAGES.map((s) => s.key));
const GROUPS = { affiliate: 'Affiliate', viralview: 'Viral View', jon: 'Jon' };

function httpLink(value) {
  const s = String(value || '').trim();
  return /^https:\/\//i.test(s) ? s : '';
}

function clip(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function stamp(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : NaN;
}

function whenLabel(ms) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch {
    return '';
  }
}

export function buildChannels(payload, nowMs = Date.now(), collectedAt = '') {
  const data = payload && typeof payload === 'object' ? payload : {};
  const raw = Array.isArray(data.channels) ? data.channels : [];
  const channels = raw.slice(0, 40).map((c) => {
    const ch = c && typeof c === 'object' ? c : {};
    const cards = (Array.isArray(ch.cards) ? ch.cards : []).slice(0, 60).map((v) => {
      const r = v && typeof v === 'object' ? v : {};
      const stage = STAGE_KEYS.has(r.stage) ? r.stage : 'unknown';
      const ms = stamp(r.updated);
      return {
        id: clip(r.id, 80),
        title: clip(r.title, 200) || 'Untitled',
        version: clip(r.version, 40),
        stage,
        reviewUrl: httpLink(r.review_url),
        studioUrl: httpLink(r.studio_url),
        blocker: clip(r.blocker, 300),
        note: clip(r.note, 300),
        updated: Number.isFinite(ms) ? new Date(ms).toISOString() : '',
        updatedLabel: Number.isFinite(ms) ? whenLabel(ms) : '',
        age: Number.isFinite(ms) ? updatedLabel(new Date(ms).toISOString(), nowMs) : '',
      };
    });
    const columns = STAGES.map((s) => {
      const list = cards.filter((x) => x.stage === s.key).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      return { key: s.key, label: s.label, count: list.length, cards: list };
    });
    const unknown = cards.filter((x) => x.stage === 'unknown');
    if (unknown.length) columns.push({ key: 'unknown', label: 'Unknown', count: unknown.length, cards: unknown });
    return {
      id: clip(ch.id, 60) || clip(ch.name, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: clip(ch.name, 80),
      group: GROUPS[ch.group] ? ch.group : 'jon',
      groupLabel: GROUPS[ch.group] || GROUPS.jon,
      studioUrl: httpLink(ch.studio_url),
      note: clip(ch.note, 300),
      total: cards.length,
      blocked: cards.filter((x) => x.blocker).length,
      columns,
    };
  }).filter((c) => c.name);
  const updated = String(data.updated || collectedAt || '');
  return {
    available: channels.length > 0,
    updated,
    updatedLabel: updatedLabel(updated, nowMs),
    studioHome: httpLink(data.studio_home) || 'https://studio.youtube.com/',
    channels,
    total: channels.reduce((n, c) => n + c.total, 0),
  };
}
