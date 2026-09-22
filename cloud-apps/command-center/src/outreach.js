import { listSnapshots, upsertSnapshot, completeAction } from './db.js';

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
  let analytics = null;
  try {
    const q = new URLSearchParams({ start_date: ymd(nowMs), end_date: ymd(nowMs) });
    if (camp?.id) q.set('id', camp.id);
    analytics = itemsOf(await api(key, `/campaigns/analytics?${q}`, {}, fetchFn));
  } catch { analytics = null; }
  let interested = null;
  try {
    const overview = await api(key, `/campaigns/analytics/overview${camp?.id ? `?id=${camp.id}` : ''}`, {}, fetchFn);
    interested = Number(overview.total_interested) || 0;
  } catch { interested = null; }
  const row = analytics?.find((a) => a.campaign_id === camp?.id) || analytics?.[0] || {};

  return {
    dailyMax: dailyMax(mapped),
    accounts: mapped,
    campaign: camp ? {
      id: camp.id,
      name: camp.name,
      status: camp.status,
      leads_count: analytics ? (Number(row.leads_count) || 0) : null,
      step_count: stepCount(camp),
    } : null,
    sentToday: analytics ? analytics.reduce((n, a) => n + (Number(a.emails_sent_count) || 0), 0) : null,
    open_count: analytics ? (Number(row.open_count) || 0) : null,
    reply_count: analytics ? (Number(row.reply_count) || 0) : null,
    total_interested: interested,
  };
}

const MISSING = 'Instantly is not connected. Add INSTANTLY_API_KEY on the command center worker.';

function readOnly(fetchFn) {
  return async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts.method || 'GET').toUpperCase();
    const warm = method === 'POST' && u.includes('/api/v2/accounts/warmup-analytics');
    if ((method !== 'GET' && !warm) || /\/activate|\/leads/.test(u)) throw new Error('Blocked Instantly write');
    return fetchFn(url, opts);
  };
}

export async function syncInstantly(env, fetchFn = globalThis.fetch) {
  if (!env.INSTANTLY_API_KEY) throw new Error(MISSING);
  if (!env.DB) throw new Error('Instantly store is not available.');
  let testSent = false;
  try {
    const prev = (await listSnapshots(env.DB)).find((r) => r.source === 'instantly');
    if (prev) testSent = Boolean(JSON.parse(prev.data).testSent);
  } catch { /* first pull */ }
  const data = await collectInstantly(env.INSTANTLY_API_KEY, fetchFn, Date.now());
  data.testSent = testSent;
  const now = new Date().toISOString();
  await upsertSnapshot(env.DB, 'instantly', JSON.stringify(data), now, now);
  return data;
}

export async function pullInstantly(env, fetchFn = globalThis.fetch) {
  if (!env.INSTANTLY_API_KEY || !env.DB) return;
  await syncInstantly(env, fetchFn);
}

export async function finishOutreachCheck(env, id, fetchFn = globalThis.fetch) {
  try {
    const data = await syncInstantly(env, readOnly(fetchFn));
    const msg = `Read Instantly · ${data.accounts.length} accounts · daily max ${data.dailyMax}`;
    await completeAction(env.DB, id, 'done', msg, new Date().toISOString());
  } catch (err) {
    await completeAction(env.DB, id, 'failed', err.message || 'Instantly read failed', new Date().toISOString());
  }
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
const CAMP_STATUS = { 0: 'Draft', 1: 'Active', 2: 'Paused', 3: 'Completed', 4: 'Running subsequences' };

function campLine(camp) {
  if (!camp?.id) return '';
  return `${camp.name || 'Campaign'} · ${CAMP_STATUS[camp.status] || 'Unknown status'}`;
}

export function blankOutreach(page) {
  page.pill = 'Not connected';
  page.sub = 'No Instantly reading yet. Check now reads accounts and campaigns. Nothing is sent.';
  page.setup.done = '0 of 6';
  page.setup.pct = 0;
  page.setup.steps = (page.setup.steps || []).map((t, i) => {
    const s = { n: i + 1, title: t.title, sub: 'Waiting on a reading' };
    if (i === 1) {
      return {
        ...s,
        sub: 'Reads daily max, accounts, and campaign status. Nothing is sent.',
        btn: 'Check now',
        kind: 'outreach.refresh',
      };
    }
    s.pill = 'Waiting';
    return s;
  });
  page.inboxes = { ...(page.inboxes || {}), meta: 'No accounts read', rows: [] };
  page.live = {
    ...(page.live || {}),
    rows: (page.live?.rows || []).map((r) => ({ ...r, value: '—', pct: 0, pg: 'idle' })),
    empty: 'No campaign stats until Instantly is read.',
    emptyRest: 'Check now does not send email, add leads, or launch a campaign.',
  };
  return page;
}

export function applyOutreachStatus(page, job, source) {
  if (job?.status === 'running' || job?.status === 'queued' || job?.status === 'claimed') {
    page.check = { status: 'pending', label: 'Checking Instantly…' };
  } else if (job?.status === 'failed') {
    page.check = { status: 'error', label: job.result || 'Instantly read failed' };
  } else if (job?.status === 'done') {
    page.check = { status: 'success', label: job.result || 'Read Instantly' };
  } else if (!source) {
    page.check = { status: 'idle', label: 'Not checked' };
  }
  if (source?.ageLabel && !String(page.sub || '').includes(source.ageLabel)) {
    page.sub = `${page.sub} · ${source.ageLabel}`;
  }
  return page;
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
      if (i === 0) s.sub = `${active.length} sending accounts warmed up`;
      if (i === 1) s.sub = `${max} emails a day from your sending accounts`;
      if (i === 2) s.sub = `${camp.leads_count} leads in ${camp.name || 'the campaign'}`;
      if (i === 3) s.sub = `${camp.step_count} emails in the campaign`;
      if (i === 5 && camp.id) s.sub = campLine(camp);
      return s;
    }
    if (first >= 0 && i > first) {
      s.pill = `Waiting on ${first + 1}`;
      if (i === 5 && camp.id) s.sub = campLine(camp);
      return s;
    }
    if (i === 2) return { ...s, pill: 'Not in this check', sub: 'Check now does not load leads.' };
    if (i === 3) return { ...s, pill: 'Not in this check', sub: 'Check now does not write emails.' };

    if (i === 4) return { ...s, btn: 'Mark test sent', kind: 'outreach.mark_test' };
    if (i === 5) {
      return {
        ...s,
        sub: camp.id ? campLine(camp) : s.sub,
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
    page.inboxes.meta = `${accounts.length} accounts · ${active.length} sending`;
    page.inboxes.rows = accounts.map((a) => {
      const score = Number(a.health_score);
      const has = Number.isFinite(score);
      return { label: a.email, value: has ? String(Math.round(score)) : '—', pct: has ? score : 0, pg: has ? pgOf(score) : 'idle' };
    });
  }
  const sent = data.sentToday;
  page.live.rows = [
    { label: 'Sent today', value: sent == null ? '—' : `${sent} of ${max}`, pct: max && sent != null ? Math.min(100, Math.round(sent / max * 100)) : 0, pg: launched ? '' : 'idle' },
    { label: 'Opened', value: data.open_count ? String(data.open_count) : '—', pct: 0, pg: 'idle' },
    { label: 'Replied', value: data.reply_count ? String(data.reply_count) : '—', pct: 0, pg: 'idle' },
    { label: 'Signed up for Viral View', value: data.total_interested ? String(data.total_interested) : '—', pct: 0, pg: 'idle' },
  ];
  return page;
}
