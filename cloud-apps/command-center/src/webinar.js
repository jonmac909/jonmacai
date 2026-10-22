// Webinar page: countdown, readiness checklist from the JON-6 results files (GPU2 `webinar`
// source), and buyers/upsells from the clone funnel's D1 (read-only, counts only, no emails).
// Jon moved the event to Thu Oct 29: 7 PM ET = 4 PM PT. Zoom Meeting, so no registration list.
export const WEBINAR_AT = '2026-10-29T23:00:00Z'; // Thu Oct 29, 4 PM PT / 7 PM ET
export const WEBINAR_LABEL = 'Thu Oct 29 · 4 PM PT';
export const DEADLINE_AT = '2026-10-27T06:59:59Z'; // end of Mon Oct 26 PT
export const OFFERS = {
  software: '$97/mo software',
  trial: '$1 7-day trial',
  audit: '$497 audit',
  vault: '$297 vault',
  vault_plan: '$99 x3 vault plan',
};

const ITEMS = [
  ['stress', 'One-click stress test'],
  ['trial', '$1 trial'],
  ['sessions', 'Session assignment'],
  ['meta', 'Meta tracking'],
  ['ads', 'Ads'],
];

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function left(ms) {
  if (ms <= 0) return 'now';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function stressNote(s) {
  if (s.note) return s.note;
  const parts = (s.offers || []).map((o) => `${OFFERS[o.offer] || o.offer} ${o.firstTry + o.retried}/${o.firstTry + o.retried + o.refused}`);
  return `${s.charged} of ${s.charges} one-click charges went through across ${s.buyers} test buyers · ${parts.join(' · ')}`;
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

export function overlayWebinar(page, row, funnel, nowMs, label) {
  const d = row ? parse(row.data) : null;
  const items = d?.items || {};
  const at = Date.parse(WEBINAR_AT);
  const due = Date.parse(DEADLINE_AT);
  page.title = 'Webinar';
  page.sub = `${WEBINAR_LABEL} · jonmac.ai/clone · ${d ? `test results ${label}` : 'no test results from GPU2 yet'}`;
  page.stale = !d;
  page.webinarAt = WEBINAR_AT;
  page.deadlineAt = DEADLINE_AT;
  page.countdown = left(at - nowMs);
  page.deadlineLeft = left(due - nowMs);
  const onOct29 = (funnel?.sessions || []).filter((s) => /October 29/.test(String(s.session_label))).reduce((n, s) => n + Number(s.n || 0), 0);
  page.checklist = ITEMS.map(([id, name]) => {
    const it = items[id];
    if (id === 'stress' && it) return { id, name, status: it.status, note: stressNote(it), at: it.at };
    if (it) return { id, name, status: it.status, note: it.note || '', at: it.at };
    if (id === 'sessions' && funnel) {
      return { id, name, status: 'pending', note: `No test result yet · ${onOct29} buyer${onOct29 === 1 ? '' : 's'} assigned to Oct 29 so far` };
    }
    return { id, name, status: 'none', note: 'No test result yet' };
  });
  const green = page.checklist.filter((c) => c.status === 'pass').length;
  page.green = `${green} of ${page.checklist.length} green`;
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
    { icon: 'check', label: 'Funnel green by Mon Oct 26', value: `${green} / ${page.checklist.length}`, pct: Math.round(green / page.checklist.length * 100), pg: green === page.checklist.length ? 'ok' : 'risk', sub: `${page.deadlineLeft} left` },
    { icon: 'wallet', label: 'Live buyers ($47)', value: funnel ? String(funnel.buyers) : 'no data', sub: funnel ? 'Recorded by the clone funnel' : 'Funnel database unavailable' },
  ];
  return page;
}
