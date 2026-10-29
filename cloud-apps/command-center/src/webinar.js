// Webinar page: countdown, and buyers/upsells from the clone funnel's D1 (read-only, counts only, no emails).
// Jon moved the event to Thu Oct 29: 7 PM ET = 4 PM PT. Zoom Meeting, so no registration list.
export const WEBINAR_AT = '2026-10-29T23:00:00Z'; // Thu Oct 29, 4 PM PT / 7 PM ET
export const WEBINAR_LABEL = 'Thu Oct 29 · 4 PM PT';
export const OFFERS = {
  software: '$97/mo software',
  trial: '$1 7-day trial',
  audit: '$497 audit',
  vault: '$297 vault',
  vault_plan: '$99 x3 vault plan',
};

function left(ms) {
  if (ms <= 0) return 'now';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export async function listFunnel(db) {
  if (!db) return null;
  try {
    const buyers = await db.prepare('SELECT count(*) AS n, max(paid_at) AS last FROM clone_purchase_proofs').first();
    const upsells = (await db.prepare('SELECT offer, state, count(*) AS n FROM clone_upsell_claims GROUP BY offer, state').all()).results || [];
    const sessions = (await db.prepare('SELECT session_label, count(*) AS n FROM clone_webinar_sessions GROUP BY session_label').all()).results || [];
    return { buyers: Number(buyers?.n) || 0, lastPaidAt: buyers?.last ?? null, upsells, sessions };
  } catch {
    return null;
  }
}

// Webinar funnel money between two instants (ms): verified Commas payments minus refunds, as
// recorded by the clone Worker's scorecard (clone_session_events). Read-only.
export async function funnelMonth(db, startMs, endMs) {
  if (!db) return null;
  try {
    const m = await db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount_cents ELSE 0 END), 0) AS gross,
              COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount_cents ELSE 0 END), 0) AS refunds,
              COALESCE(SUM(kind = 'payment'), 0) AS payments, COALESCE(SUM(kind = 'visit'), 0) AS visits,
              MAX(occurred_at) AS last
         FROM clone_session_events WHERE occurred_at >= ? AND occurred_at < ?`,
    ).bind(startMs, endMs).first();
    return {
      netCents: (Number(m?.gross) || 0) - (Number(m?.refunds) || 0),
      payments: Number(m?.payments) || 0,
      visits: Number(m?.visits) || 0,
      lastEventAt: m?.last == null ? null : new Date(Number(m.last)).toISOString(),
    };
  } catch {
    return null;
  }
}

export function overlayWebinar(page, funnel, nowMs) {
  const at = Date.parse(WEBINAR_AT);
  page.title = 'Webinar';
  page.sub = `${WEBINAR_LABEL} · jonmac.ai/clone`;
  page.webinarAt = WEBINAR_AT;
  page.countdown = left(at - nowMs);
  const live = nowMs >= at - 6 * 3600000 || (funnel && funnel.buyers > 0);
  const charged = {};
  const fallback = {};
  for (const u of funnel?.upsells || []) {
    const name = OFFERS[u.offer] || u.offer;
    if (u.state === 'charged') charged[name] = (charged[name] || 0) + Number(u.n || 0);
    else if (u.state === 'fallback') fallback[name] = (fallback[name] || 0) + Number(u.n || 0);
  }
  page.sales = {
    available: !!funnel,
    live,
    buyers: funnel ? funnel.buyers : null,
    rows: Object.keys({ ...charged, ...fallback }).map((name) => ({ name, charged: charged[name] || 0, hosted: fallback[name] || 0 })),
    sessions: (funnel?.sessions || []).map((s) => ({ label: String(s.session_label).slice(0, 60), n: Number(s.n) || 0 })),
  };
  page.tiles = [
    { icon: 'clock', label: 'Webinar starts in', value: page.countdown, sub: WEBINAR_LABEL },
    { icon: 'wallet', label: 'Live buyers ($47)', value: funnel ? String(funnel.buyers) : 'no data', sub: funnel ? 'Recorded by the clone funnel' : 'Funnel database unavailable' },
  ];
  return page;
}
