import { upsertSnapshot } from './db.js';

export async function handleCron(env) {
  if (!env.DB) return;
  try {
    const r = await fetch('https://jonmac.ai/yt2/api/outliers');
    if (!r.ok) return;
    const data = await r.json();
    const now = new Date().toISOString();
    await upsertSnapshot(env.DB, 'youtube', JSON.stringify(data), now, now);
  } catch {}
}
