import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { listSnapshots, upsertSnapshot } from './db.js';
import { pullCalendar } from './life.js';
import { mergeSnapshot } from './snapshot.js';
import { pushCriticalTelegram } from './alerts.js';
import { funnelMonth } from './webinar.js';
import { monthWindow } from './today.js';
import { settleApproved } from './videoreview.js';
import { syncReach, syncStats } from './youtube.js';
import { syncChargeWatch } from './chargewatch.js';
import { pullFx } from './fx.js';

const VIRAL_URL = 'https://app.viralview.io/api/internal/dashboard-summary';
const MONEY_URL = 'https://moneyclaw.jonmac.ai/api/internal/dashboard-summary';
export function sourceCollectedAt(source, data, fetchedAt) {
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

// Webinar funnel money this month for the Today page, read every 10 minutes instead of per page load.
export async function pullWebinarMonth(env, nowMs = Date.now()) {
  const win = monthWindow(nowMs);
  const f = await funnelMonth(env.CLONE_DB, win.start, win.end);
  if (!f) return;
  const at = new Date(nowMs).toISOString();
  await upsertSnapshot(env.DB, 'webinar_funnel', JSON.stringify({ ...f, month: win.key }), at, at);
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
  jobs.push(syncChargeWatch(env).catch((err) => console.error('charge watch', err.message))); // new subscriptions and odd charges become Questions
  jobs.push(pullWebinarMonth(env));
  jobs.push(pullCalendar(env));
  jobs.push(pullFx(env).catch((err) => console.error('fx', err.message))); // USD in CAD for Home's PnL card
  jobs.push(settleApproved(env).catch((err) => console.error('settle approved', err)));
  jobs.push(syncReach(env).catch((err) => console.error('youtube reach', err.message))); // impressions and CTR, 6-hourly a channel
  jobs.push(syncStats(env).catch((err) => console.error('youtube stats', err.message))); // views, status, subs, hourly a channel
  await Promise.allSettled(jobs);
  const snap = mergeSnapshot(snapshot, await listSnapshots(env.DB), Date.now());
  await pushCriticalTelegram(env, snap);
}
