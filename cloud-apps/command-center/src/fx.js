// The US dollar in Canadian dollars, from the Bank of Canada's daily average (no key needed). Home's PnL card uses it
// to put sponsor income (USD) and RBC spending (CAD) in one currency. Pulled by the cron at most every 6 hours.
import { upsertSnapshot } from './db.js';

export const FX_URL = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';
const EVERY = 6 * 3600000;

export function parseFx(data) {
  const o = data?.observations?.[0];
  const rate = Number(o?.FXUSDCAD?.v);
  return rate > 0.5 && rate < 3 && /^\d{4}-\d{2}-\d{2}$/.test(o?.d || '') ? { usdcad: rate, day: o.d } : null;
}

export async function readFx(env) {
  const row = await env.DB.prepare("SELECT data, received_at FROM snapshots WHERE source = 'fx_usdcad'").first();
  if (!row) return null;
  try { return { ...JSON.parse(row.data), at: row.received_at }; } catch { return null; }
}

export async function pullFx(env, fetchFn = globalThis.fetch, nowMs = Date.now()) {
  const have = await readFx(env);
  if (have?.at && nowMs - Date.parse(have.at) < EVERY) return;
  const fx = await fetchFn(FX_URL).then((r) => (r.ok ? r.json() : null)).then(parseFx).catch(() => null);
  if (!fx) return;
  const at = new Date(nowMs).toISOString();
  await upsertSnapshot(env.DB, 'fx_usdcad', JSON.stringify(fx), at, at);
}
