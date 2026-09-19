import { listSnapshots, upsertSnapshot } from './db.js';
import { pullInstantly } from './outreach.js';
import { pullCalendar } from './life.js';

export const DEDUPE_MS = 45 * 1000;
export const PULL_TIMEOUT_MS = 8000;
const VIRAL_URL = 'https://app.viralview.io/api/internal/dashboard-summary';
const MONEY_URL = 'https://moneyclaw.jonmac.ai/api/internal/dashboard-summary';
const YT_URL = 'https://jonmac.ai/yt2/api/outliers';

function parseData(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function timed(fetchFn, timeoutMs) {
  return (url, opts = {}) => fetchFn(url, { ...opts, signal: opts.signal || AbortSignal.timeout(timeoutMs) });
}

function serviceFetch(binding) {
  return (url, opts = {}) => binding.fetch(new Request(url, { method: opts.method || 'GET', headers: opts.headers }));
}

async function touchReceived(env, source, by, nowIso) {
  const row = by[source];
  await upsertSnapshot(env.DB, source, row?.data || '{}', row?.collected_at || '', nowIso);
}

function failName(e) {
  return e?.name === 'AbortError' || e?.name === 'TimeoutError' ? 'timeout' : String(e?.message || e);
}

async function pull(env, source, url, headers, fetchFn, nowIso, errors, by) {
  try {
    const res = await fetchFn(url, { headers });
    if (!res.ok) {
      errors[source] = `HTTP ${res.status}`;
      await touchReceived(env, source, by, nowIso);
      return;
    }
    const data = await res.json();
    if (!data || data.success === false) {
      errors[source] = 'empty or unsuccessful payload';
      await touchReceived(env, source, by, nowIso);
      return;
    }
    await upsertSnapshot(env.DB, source, JSON.stringify(data), nowIso, nowIso);
    delete errors[source];
  } catch (e) {
    errors[source] = failName(e);
    await touchReceived(env, source, by, nowIso);
  }
}

function due(row, nowMs) {
  const t = Date.parse(row?.received_at || '') || Date.parse(row?.collected_at || '') || 0;
  return !t || nowMs - t >= DEDUPE_MS;
}

export async function revalidateSources(env, { nowMs = Date.now(), fetchFn = globalThis.fetch, timeoutMs = PULL_TIMEOUT_MS } = {}) {
  if (!env?.DB) return { skipped: true, errors: {}, pulled: [] };
  const rows = await listSnapshots(env.DB);
  const by = Object.fromEntries((rows || []).map((r) => [r.source, r]));
  const errors = { ...parseData(by.health?.data).errors };
  const pulled = [];
  const nowIso = new Date(nowMs).toISOString();
  const fetchTimed = timed(fetchFn, timeoutMs);
  const jobs = [];

  if (env.VIRALVIEW_SUMMARY_SECRET && due(by.viralview, nowMs)) {
    pulled.push('viralview');
    jobs.push(pull(env, 'viralview', VIRAL_URL, {
      'x-cron-secret': env.VIRALVIEW_SUMMARY_SECRET,
      authorization: `Bearer ${env.VIRALVIEW_SUMMARY_SECRET}`,
    }, fetchTimed, nowIso, errors, by));
  }
  if (env.MONEYCLAW_DASHBOARD_TOKEN && due(by.moneyclaw, nowMs)) {
    pulled.push('moneyclaw');
    jobs.push(pull(env, 'moneyclaw', MONEY_URL, {
      authorization: `Bearer ${env.MONEYCLAW_DASHBOARD_TOKEN}`,
    }, fetchTimed, nowIso, errors, by));
  }
  if (env.YT2_REVALIDATE === '1' && due(by.youtube, nowMs)) {
    pulled.push('youtube');
    const ytFetch = env.YT2 ? serviceFetch(env.YT2) : fetchTimed;
    jobs.push(pull(env, 'youtube', env.YT2_OUTLIERS_URL || YT_URL, {}, ytFetch, nowIso, errors, by));
  }
  if (env.INSTANTLY_API_KEY && due(by.instantly, nowMs)) {
    pulled.push('instantly');
    jobs.push(pullInstantly({ ...env, fetchFn: fetchTimed }, fetchTimed).then(() => {
      delete errors.instantly;
    }).catch(async (e) => {
      errors.instantly = failName(e);
      await touchReceived(env, 'instantly', by, nowIso);
    }));
  }
  if (due(by.calendar, nowMs) && (env.GOOGLE_REFRESH_TOKEN || by.google_oauth)) {
    pulled.push('calendar');
    jobs.push(pullCalendar(env, fetchTimed, nowMs).then(() => {
      delete errors.calendar;
    }).catch(async (e) => {
      errors.calendar = failName(e);
      await touchReceived(env, 'calendar', by, nowIso);
    }));
  }

  await Promise.allSettled(jobs);
  await upsertSnapshot(env.DB, 'health', JSON.stringify({ errors, pulled, at: nowIso }), nowIso, nowIso);
  return { skipped: false, errors, pulled };
}
