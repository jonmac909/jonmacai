// Critical alerts: shown at the top of Today's "Needs you" and sent once each to Telegram by the cron.
function lateDays(pill) {
  const m = String(pill || '').match(/(\d+) days late/);
  return m ? Number(m[1]) : 0;
}

export function criticalAlerts(snap) {
  const out = [];
  if (snap.sources?.bank_scan) {
    for (const r of snap.pages?.money?.bankScan?.rows || []) {
      if (r.pill === 'Needs code') out.push({ key: `bank_code:${r.title}`, text: `Bank code needed: ${r.title}` });
    }
  }
  if (snap.sources?.sponsors) {
    for (const col of snap.pages?.sponsors?.board?.columns || []) {
      for (const card of col.cards || []) {
        const days = lateDays(card.pill);
        if (days > 7) out.push({ key: `late:${card.id || card.name}`, text: `Payment ${days} days late: ${card.name}` });
      }
    }
  }
  return out;
}

export function unsentCritical(alerts, sent = {}) {
  return alerts.filter((a) => !sent[a.key]);
}

export async function pushCriticalTelegram(env, snap, fetchFn = globalThis.fetch) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.DB) return;
  const row = (await env.DB.prepare('SELECT source, data, collected_at, received_at FROM snapshots').all()).results?.find((r) => r.source === 'telegram_sent');
  let sent = {};
  try { sent = row ? JSON.parse(row.data).sent || {} : {}; } catch { sent = {}; }
  const next = unsentCritical(criticalAlerts(snap), sent);
  for (const a of next) {
    await fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: a.text }),
    }).catch(() => {});
    sent[a.key] = new Date().toISOString();
  }
  if (next.length) {
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT OR REPLACE INTO snapshots (source, data, collected_at, received_at) VALUES (?, ?, ?, ?)')
      .bind('telegram_sent', JSON.stringify({ sent }), now, now).run();
  }
}
