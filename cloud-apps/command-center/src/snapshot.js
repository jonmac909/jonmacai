import { buildSponsorsPage, sourceEditedAt } from './sponsors.js';
import { applyReviewDrafts } from './review.js';
import { overlayMoney, overlayBankScan } from './money.js';
import { overlayViral } from './viral.js';
import { overlayLife } from './life.js';
import { overlayWebinar } from './webinar.js';
import { buildCash, withoutExcluded } from './cash.js';
import { buildToday } from './today.js';
import { buildProjects } from './projects.js';
import { buildTodo } from './todo.js';

export const COLLECTOR_INTERVAL_MS = 5 * 60 * 1000;

export const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

const MACHINE_INTERVAL_MS = 60 * 1000; // GPU1 and GPU2 heartbeats

export const INTERVALS = {
  sponsors: COLLECTOR_INTERVAL_MS,
  viralview: DEFAULT_INTERVAL_MS,
  moneyclaw: DEFAULT_INTERVAL_MS,
  calendar: DEFAULT_INTERVAL_MS,
  bank_scan: COLLECTOR_INTERVAL_MS,
  machine_gpu1: MACHINE_INTERVAL_MS,
  machine_gpu2: MACHINE_INTERVAL_MS,
  sponsors_cash: COLLECTOR_INTERVAL_MS,
};

export function ageLabel(ageMs) {
  const m = Math.floor(ageMs / 60000);
  if (m < 1) return 'updated just now';
  if (m === 1) return 'updated 1 min ago';
  if (m < 60) return `updated ${m} min ago`;
  const h = Math.floor(m / 60);
  if (h === 1) return 'updated 1 hr ago';
  if (h < 48) return `updated ${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'updated 1 day ago' : `updated ${d} days ago`;
}

export function freshness(collectedAt, nowMs, intervalMs) {
  const t = Date.parse(collectedAt);
  if (!Number.isFinite(t)) return { ageMs: Infinity, stale: true, label: 'updated unknown' };
  const ageMs = Math.max(0, nowMs - t);
  return { ageMs, stale: ageMs > 3 * intervalMs, label: ageLabel(ageMs) };
}

function parseData(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export function mergeSnapshot(fixture, rows, nowMs = Date.now(), overrides = {}, extra = {}) {
  extra = extra || {};
  const out = JSON.parse(JSON.stringify(fixture));
  const by = {};
  for (const row of rows || []) {
    by[row.source] = row.source === 'sponsors' || row.source === 'sponsors_cash'
      ? { ...row, data: withoutExcluded(row.source, row.data) }
      : row;
    if (row.source === 'google_oauth' || row.source === 'telegram_sent') continue;
    const interval = INTERVALS[row.source] ?? DEFAULT_INTERVAL_MS;
    const f = freshness(row.collected_at, nowMs, interval);
    out.sources[row.source] = { updatedAt: row.collected_at, stale: f.stale, ageLabel: f.label };
  }
  const cash = buildCash(by.sponsors_cash, by.sponsors, nowMs, by.moneyclaw);
  const sponsors = by.sponsors;
  if (sponsors && out.pages.sponsors) {
    const data = parseData(sponsors.data);
    if (data.collections) {
      const page = buildSponsorsPage(data, nowMs, overrides, cash);
      const copiedMs = Date.parse(sponsors.collected_at);
      const copied = Number.isFinite(copiedMs) ? ageLabel(Math.max(0, nowMs - copiedMs)).replace(/^updated /, '') : 'unknown';
      page.sub = `Source edited ${sourceEditedAt(data) || 'unknown'} · copied ${copied} · ${cash.available ? `money from deposits (${cash.source.label})` : 'not reconciled cash'}`;
      out.pages.sponsors = page;
    }
  }
  if (out.pages.sponsors) out.pages.sponsors.cash = cash;
  if (out.pages.money) {
    if (by.moneyclaw) overlayMoney(out.pages.money, parseData(by.moneyclaw.data), nowMs);
    overlayBankScan(out.pages.money, by.bank_scan, nowMs);
  }
  if (out.pages.viral && by.viralview) overlayViral(out.pages.viral, parseData(by.viralview.data), nowMs);
  if (out.pages.life) {
    overlayLife(out.pages.life, { ...(by.calendar ? parseData(by.calendar.data) : {}), habits: extra.habits || [], nowMs });
    if (!by.calendar) {
      out.pages.life.actions = [{ label: 'Connect calendar', href: '/dashboard/api/google/start' }, ...(out.pages.life.actions || [])];
    }
  }
  if (out.pages.webinar) overlayWebinar(out.pages.webinar, extra.funnel, nowMs);
  applyReviewDrafts(out, by.cc_review_drafts ? parseData(by.cc_review_drafts.data) : []);
  buildToday(out, by, cash, extra, nowMs);
  buildProjects(out, by, cash, extra, nowMs);
  buildTodo(out, extra, nowMs);
  return out;
}
