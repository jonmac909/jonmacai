import { upsertSnapshot } from './db.js';

const VIRAL_URL = 'https://app.viralview.io/api/internal/dashboard-summary';
const MONEY_URL = 'https://moneyclaw.jonmac.ai/api/internal/dashboard-summary';

async function pull(env, source, url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) return;
  const data = await res.json();
  if (!data || data.success === false) return;
  const now = new Date().toISOString();
  await upsertSnapshot(env.DB, source, JSON.stringify(data), now, now);
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
  await Promise.allSettled(jobs);
}
