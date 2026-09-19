import { listSnapshots, upsertSnapshot } from './db.js';

const BASE = 'https://api.instantly.ai/api/v2';
const TZ = 'America/Vancouver';
const CONFIRM = 'Start sending this campaign in Instantly?';

export function dailyMax(accounts = []) {
  return accounts.reduce((n, a) => n + (a.status === 1 ? Number(a.daily_limit) || 0 : 0), 0);
}

function ymd(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function itemsOf(data) {
  return Array.isArray(data) ? data : data?.items || [];
}

async function api(key, path, { method = 'GET', body } = {}, fetchFn) {
  const res = await fetchFn(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Instantly ${path} ${res.status}`);
  return res.json();
}

async function listAll(key, path, fetchFn) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ limit: '100' });
    if (cursor) q.set('starting_after', cursor);
    const data = await api(key, `${path}?${q}`, {}, fetchFn);
    const page = itemsOf(data);
    out.push(...page);
    cursor = data.next_starting_after;
    if (!cursor || !page.length) break;
  }
  return out;
}

function pickCampaign(list) {
  return list.find((c) => c.status === 1)
    || list.find((c) => c.status === 0 || c.status === 2 || c.status === 4)
    || list[0];
}

function stepCount(camp) {
  const steps = camp?.sequences?.[0]?.steps || [];
  return steps.filter((s) => (s.variants || []).some((v) => v.subject && v.body)).length;
}

function pgOf(score) {
  if (score >= 90) return 'ok';
  if (score >= 80) return 'risk';
  if (score > 0) return 'crit';
  return 'idle';
}

export async function collectInstantly(key, fetchFn = globalThis.fetch, nowMs = Date.now()) {
  const accounts = await listAll(key, '/accounts', fetchFn);
  const emails = accounts.map((a) => a.email).filter(Boolean).slice(0, 100);
  let scores = {};
  if (emails.length) {
    try {
      const warm = await api(key, '/accounts/warmup-analytics', { method: 'POST', body: { emails } }, fetchFn);
      scores = warm.aggregate_data || {};
    } catch { /* scores stay empty */ }
  }
  const mapped = accounts.map((a) => ({
    email: a.email,
    daily_limit: a.daily_limit,
    status: a.status,
    warmup_status: a.warmup_status,
    health_score: scores[a.email]?.health_score,
  }));
  const campaigns = await listAll(key, '/campaigns', fetchFn);
  let camp = pickCampaign(campaigns);
  if (camp?.id && !camp.sequences) {
    try { camp = { ...camp, ...await api(key, `/campaigns/${camp.id}`, {}, fetchFn) }; } catch { /* keep list row */ }
  }
  let analytics = [];
  try {
    const q = new URLSearchParams({ start_date: ymd(nowMs), end_date: ymd(nowMs) });
    if (camp?.id) q.set('id', camp.id);
    analytics = itemsOf(await api(key, `/campaigns/analytics?${q}`, {}, fetchFn));
  } catch { /* today stats stay 0 */ }
  let overview = {};
  try {
    overview = await api(key, `/campaigns/analytics/overview${camp?.id ? `?id=${camp.id}` : ''}`, {}, fetchFn);
  } catch { /* interested stays 0 */ }
  const row = analytics.find((a) => a.campaign_id === camp?.id) || analytics[0] || {};
  return {
    dailyMax: dailyMax(mapped),
    accounts: mapped,
    campaign: camp ? {
      id: camp.id,
      name: camp.name,
      status: camp.status,
      leads_count: Number(row.leads_count) || 0,
      step_count: stepCount(camp),
    } : null,
    sentToday: analytics.reduce((n, a) => n + (Number(a.emails_sent_count) || 0), 0),
    open_count: Number(row.open_count) || 0,
    reply_count: Number(row.reply_count) || 0,
    total_interested: Number(overview.total_interested) || 0,
  };
}

export async function pullInstantly(env, fetchFn = globalThis.fetch) {
  const key = env.INSTANTLY_API_KEY;
  if (!key || !env.DB) return;
  let testSent = false;
  try {
    const prev = (await listSnapshots(env.DB)).find((r) => r.source === 'instantly');
    if (prev) testSent = Boolean(JSON.parse(prev.data).testSent);
  } catch { /* first pull */ }
  const data = await collectInstantly(key, fetchFn, Date.now());
  data.testSent = testSent;
  const now = new Date().toISOString();
  await upsertSnapshot(env.DB, 'instantly', JSON.stringify(data), now, now);
}

export async function markTestSent(env) {
  if (!env.DB) return 'Test marked as sent';
  const prev = (await listSnapshots(env.DB)).find((r) => r.source === 'instantly');
  const data = prev ? JSON.parse(prev.data) : {};
  data.testSent = true;
  const now = new Date().toISOString();
  await upsertSnapshot(env.DB, 'instantly', JSON.stringify(data), prev?.collected_at || now, now);
  return 'Test marked as sent';
}

export async function launchCampaign(env, payload = {}, fetchFn = globalThis.fetch) {
  if (payload.confirmed !== true) throw new Error('Confirm first');
  const id = String(payload.campaignId || '');
  if (!id) throw new Error('No campaign');
  if (!env.INSTANTLY_API_KEY) throw new Error('Instantly is not connected');
  const res = await fetchFn(`${BASE}/campaigns/${id}/activate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.INSTANTLY_API_KEY}` },
  });
  if (!res.ok) throw new Error('Could not launch the campaign');
  return 'Campaign is live';
}

export async function runOutreach(env, kind, payload, fetchFn = globalThis.fetch) {
  if (kind === 'outreach.launch') return launchCampaign(env, payload, fetchFn);
  if (kind === 'outreach.mark_test') return markTestSent(env);
  if (kind === 'outreach.refresh') {
    await pullInstantly(env, fetchFn);
    return 'Read your Instantly limits';
  }
  throw new Error('Unknown action');
}

export function overlayOutreach(page, data = {}) {
  const accounts = data.accounts || [];
  const max = data.dailyMax ?? dailyMax(accounts);
  const camp = data.campaign || {};
  const active = accounts.filter((a) => a.status === 1);
  const warmed = active.length > 0 && active.every((a) => a.warmup_status === 1);
  const flags = [
    warmed,
    max > 0,
    (camp.leads_count || 0) > 0,
    (camp.step_count || 0) > 0,
    Boolean(data.testSent),
    camp.status === 1 || camp.status === 4,
  ];
  const n = flags.filter(Boolean).length;
  const first = flags.indexOf(false);
  const launched = flags[5];
  page.setup.steps = (page.setup.steps || []).map((t, i) => {
    const s = { n: i + 1, title: t.title, sub: t.sub };
    if (flags[i]) {
      s.pill = 'Done';
      s.pillCls = 'ok';
      if (i === 0) s.sub = 'Done · all inboxes healthy';
      if (i === 1) s.sub = `${max} emails a day from your sending accounts`;
      return s;
    }
    if (first >= 0 && i > first) {
      s.pill = `Waiting on ${first + 1}`;
      return s;
    }
    if (i === 4) return { ...s, btn: 'Mark test sent', kind: 'outreach.mark_test' };
    if (i === 5) {
      return {
        ...s,
        btn: 'Launch',
        kind: 'outreach.launch',
        confirm: CONFIRM,
        payload: { campaignId: camp.id, confirmed: true },
      };
    }
    return {
      ...s,
      btn: t.btn,
      msg: t.msg,
      btnCls: t.btnCls,
      kind: i === 1 ? 'outreach.refresh' : t.kind,
    };
  });
  page.setup.done = `${n} of 6 done`;
  page.setup.pct = Math.round((n / 6) * 100);
  page.pill = launched ? 'Live' : 'Setup';
  page.sub = launched ? 'Sending from Instantly' : (warmed ? 'Not sending yet · inboxes are warmed up in Instantly' : page.sub);
  if (accounts.length) {
    page.inboxes.rows = accounts.map((a) => {
      const score = Number(a.health_score);
      const has = Number.isFinite(score);
      return { label: a.email, value: has ? String(Math.round(score)) : '—', pct: has ? score : 0, pg: has ? pgOf(score) : 'idle' };
    });
  }
  const sent = Number(data.sentToday) || 0;
  page.live.rows = [
    { label: 'Sent today', value: `${sent} of ${max}`, pct: max ? Math.min(100, Math.round(sent / max * 100)) : 0, pg: launched ? '' : 'idle' },
    { label: 'Opened', value: data.open_count ? String(data.open_count) : '—', pct: 0, pg: 'idle' },
    { label: 'Replied', value: data.reply_count ? String(data.reply_count) : '—', pct: 0, pg: 'idle' },
    { label: 'Signed up for Viral View', value: data.total_interested ? String(data.total_interested) : '—', pct: 0, pg: 'idle' },
  ];
  return page;
}
