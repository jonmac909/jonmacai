import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { listSnapshots } from './db.js';
import { mergeSnapshot } from './snapshot.js';
import { pushCriticalTelegram } from './home.js';
import { revalidateSources } from './revalidate.js';

export async function handleCron(env) {
  if (!env?.DB) return;
  await revalidateSources(env, { nowMs: Date.now() - 60_000 });
  const nowMs = Date.now();
  const snap = mergeSnapshot(snapshot, await listSnapshots(env.DB), nowMs);
  await pushCriticalTelegram(env, snap);
}
