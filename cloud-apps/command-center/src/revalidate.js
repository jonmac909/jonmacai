import { listSnapshots, upsertSnapshot } from './db.js';
import { pullInstantly } from './outreach.js';
import { pullCalendar } from './life.js';

export const DEDUPE_MS = 45 * 1000;
const VIRAL_URL = 'https://app.viralview.io/api/internal/dashboard-summary';
const MONEY_URL = 'https://moneyclaw.jonmac.ai/api/internal/dashboard-summary';
const YT_URL = 'https://jonmac.ai/yt2/api/outliers';

function parseData(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

async function pull(env, source, url, headers, fetchFn, nowIso, errors) {
  const res = await fetchFn(url, { headers });
  if (!res.ok) {
    errors[source] = `HTTP ${res.status}`;
    return;
  }
  const data = await res.json();
  if (!data || data.success === false) {
    errors[source] = 'empty or unsuccessful payload';
    return;
  }
  await upsertSnapshot(env.DB, source, JSON.stringify(data), nowIso, nowIso);
}

function due(row, nowMs) {
  const t = Date.parse(row?.received_at || '') || Date.parse(row?.collected_at || '') || 0;
  return !t || nowMs - t >= DEDUPE_MS;
}

export async function revalidateSources(env, { nowMs = Date.now(), fetchFn = globalThis.fetch } = {}) {
  if (!env?.DB) return { skipped: true, errors: {}, pulled: [] };
  const rows = await listSnapshots(env.DB);
  const by = Object.fromEntries((rows || []).map((r) => [r.source, r]));
  const errors = { ...parseData(by.health?.data).errors };
  const pulled = [];
  const nowIso = new Date(nowMs).toISOString();
  const jobs = [];

  if (env.VIRALVIEW_SUMMARY_SECRET && due(by.viralview, nowMs)) {
    pulled.push('viralview');
    jobs.push(pull(env, 'viralview', VIRAL_URL, {
      'x-cron-secret': env.VIRALVIEW_SUMMARY_SECRET,
      authorization: `Bearer ${env.VIRALVIEW_SUMMARY_SECRET}`,
    }, fetchFn, nowIso, errors).catch((e) => { errors.viralview = String(e.message || e); }));
  }
  if (env.MONEYCLAW_DASHBOARD_TOKEN && due(by.moneyclaw, nowMs)) {
    pulled.push('moneyclaw');
    jobs.push(pull(env, 'moneyclaw', MONEY_URL, {
      authorization: `Bearer ${env.MONEYCLAW_DASHBOARD_TOKEN}`,
    }, fetchFn, nowIso, errors).catch((e) => { errors.moneyclaw = String(e.message || e); }));
  }
  if (env.YT2_REVALIDATE === '1' && due(by.youtube, nowMs)) {
    pulled.push('youtube');
    jobs.push(pull(env, 'youtube', env.YT2_OUTLIERS_URL || YT_URL, {}, fetchFn, nowIso, errors).catch((e) => {
      errors.youtube = String(e.message || e);
    }));
  }
  if (env.INSTANTLY_API_KEY && due(by.instantly, nowMs)) {
    pulled.push('instantly');
    jobs.push(pullInstantly({ ...env, fetchFn }, fetchFn).catch((e) => { errors.instantly = String(e.message || e); }));
  }
  if (due(by.calendar, nowMs) && (env.GOOGLE_REFRESH_TOKEN || by.google_oauth)) {
    pulled.push('calendar');
    jobs.push(pullCalendar(env, fetchFn, nowMs).catch((e) => { errors.calendar = String(e.message || e); }));
  }

  await Promise.allSettled(jobs);
  await upsertSnapshot(env.DB, 'health', JSON.stringify({ errors, pulled, at: nowIso }), nowIso, nowIso);
  return { skipped: false, errors, pulled };
}
