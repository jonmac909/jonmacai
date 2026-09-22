import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { listSnapshots, upsertSnapshot } from './db.js';
import { pullInstantly } from './outreach.js';
import { pullCalendar } from './life.js';
import { mergeSnapshot } from './snapshot.js';
import { pushCriticalTelegram } from './home.js';
import { fillFromEnv } from './daily-drafts.js';

const VIRAL_URL = 'https://app.viralview.io/api/internal/dashboard-summary';
const MONEY_URL = 'https://moneyclaw.jonmac.ai/api/internal/dashboard-summary';
const YT_URL = 'https://jonmac.ai/yt2/api/outliers';
function sourceCollectedAt(source, data, fetchedAt) {
  if (source !== 'viralview') return fetchedAt;
  const raw = data?.lastSyncAt;
  const ms = typeof raw === 'number' && Number.isFinite(raw) ? raw : Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fetchedAt;
}


async function pull(env, source, url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) return;
  const data = await res.json();
  if (!data || data.success === false) return;
  const fetchedAt = new Date().toISOString();
  await upsertSnapshot(env.DB, source, JSON.stringify(data), sourceCollectedAt(source, data, fetchedAt), fetchedAt);
}

export async function handleCron(env) {
  if (!env?.DB) return;
  const jobs = [];
  if (env.VIRALVIEW_SUMMARY_SECRET) {
    jobs.push(pull(env, 'viralview', VIRAL_URL, {
      'x-cron-secret': env.VIRALVIEW_SUMMARY_SECRET,
      authorization: `Bearer ${env.VIRALVIEW_SUMMARY_SECRET}`,
    }));
  }
  if (env.MONEYCLAW_DASHBOARD_TOKEN) {
    jobs.push(pull(env, 'moneyclaw', MONEY_URL, {
      authorization: `Bearer ${env.MONEYCLAW_DASHBOARD_TOKEN}`,
    }));
  }
  jobs.push(pull(env, 'youtube', YT_URL, {}));
  if (env.INSTANTLY_API_KEY) jobs.push(pullInstantly(env));
  jobs.push(pullCalendar(env));
  await Promise.allSettled(jobs);
  const nowMs = Date.now();
  try { await fillFromEnv(env, nowMs); } catch { /* page shows the ensure error */ }
  const snap = mergeSnapshot(snapshot, await listSnapshots(env.DB), nowMs);
  await pushCriticalTelegram(env, snap);
}
