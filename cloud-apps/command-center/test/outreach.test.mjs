import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { mergeSnapshot } from '../src/snapshot.js';
import { handleCron } from '../src/cron.js';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { dailyMax, overlayOutreach, launchCampaign } from '../src/outreach.js';
import { btn } from '../public/js/ui.js';
import { memD1 } from './memd1.mjs';

const NOW = Date.parse('2026-09-18T20:00:00-07:00');
const SECRET = 'test-session-secret-32-bytes-ok!';
const KEY = 'inst-test-key';
const CAMP = '01a0b689-0022-7091-9dd3-518a0ae56201';

const accounts = [
  { email: 'a@x.com', status: 1, daily_limit: 30, warmup_status: 1 },
  { email: 'b@x.com', status: 1, daily_limit: 20, warmup_status: 1 },
  { email: 'paused@x.com', status: 2, daily_limit: 99, warmup_status: 0 },
];

const campaign = {
  id: CAMP,
  name: 'Viral View first list',
  status: 0,
  sequences: [{
    steps: [
      { type: 'email', delay: 0, variants: [{ subject: 'Hi', body: 'One' }] },
      { type: 'email', delay: 2, variants: [{ subject: 'Hi again', body: 'Two' }] },
      { type: 'email', delay: 4, variants: [{ subject: 'Last', body: 'Three' }] },
    ],
  }],
};

function page() {
  return JSON.parse(JSON.stringify(snapshot.pages.outreach));
}

function envWith(db) {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: '909090',
    INSTANTLY_API_KEY: KEY,
    DB: db,
  };
}

function req(path, { method = 'GET', cookie, headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  return new Request(`https://jonmac.ai${path}`, { method, headers: h, body });
}

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

function instantlySnap(extra = {}) {
  return {
    dailyMax: 50,
    accounts: [
      { email: 'a@x.com', daily_limit: 30, status: 1, warmup_status: 1, health_score: 98 },
      { email: 'b@x.com', daily_limit: 20, status: 1, warmup_status: 1, health_score: 81 },
    ],
    campaign: {
      id: CAMP,
      name: 'Viral View first list',
      status: 0,
      leads_count: 40,
      step_count: 3,
    },
    sentToday: 0,
    open_count: 0,
    reply_count: 0,
    total_interested: 0,
    testSent: false,
    ...extra,
  };
}

test('daily max is the sum of active sending-account daily_limit values', () => {
  assert.equal(dailyMax(accounts), 50);
  assert.equal(dailyMax([]), 0);
});

test('setup ticks warmed, daily max, leads, and emails from Instantly data', () => {
  const out = overlayOutreach(page(), instantlySnap());
  assert.equal(out.setup.done, '4 of 6 done');
  assert.equal(out.setup.pct, 67);
  assert.equal(out.setup.steps[0].pill, 'Done');
  assert.equal(out.setup.steps[1].pill, 'Done');
  assert.equal(out.setup.steps[2].pill, 'Done');
  assert.equal(out.setup.steps[3].pill, 'Done');
  assert.equal(out.setup.steps[4].pill, undefined);
  assert.match(out.setup.steps[4].btn, /test/i);
  assert.equal(out.setup.steps[5].pill, 'Waiting on 5');
  assert.equal(out.live.rows[0].value, '0 of 50');
  assert.equal(out.inboxes.rows[0].value, '98');
});

test('test-sent is manual; launched ticks from campaign status 1', () => {
  const mid = overlayOutreach(page(), instantlySnap({ testSent: true }));
  assert.equal(mid.setup.done, '5 of 6 done');
  assert.equal(mid.setup.steps[4].pill, 'Done');
  assert.equal(mid.setup.steps[5].btn, 'Launch');
  assert.equal(mid.setup.steps[5].confirm, 'Start sending this campaign in Instantly?');
  assert.equal(mid.setup.steps[5].kind, 'outreach.launch');
  assert.equal(mid.setup.steps[5].payload.campaignId, CAMP);
  assert.equal(mid.setup.steps[5].payload.confirmed, true);

  const live = overlayOutreach(page(), instantlySnap({ testSent: true, campaign: { ...instantlySnap().campaign, status: 1 } }));
  assert.equal(live.setup.done, '6 of 6 done');
  assert.equal(live.pill, 'Live');
  assert.equal(live.setup.steps[5].pill, 'Done');
});

test('Launch without confirmed does not call Instantly activate', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method });
    return new Response('{}', { status: 200 });
  };
  await assert.rejects(
    () => launchCampaign({ INSTANTLY_API_KEY: KEY }, { campaignId: CAMP }, fetchFn),
    /confirm/i,
  );
  assert.equal(calls.length, 0);
});

test('Launch with confirmed POSTs /api/v2/campaigns/{id}/activate', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method, auth: opts?.headers?.authorization });
    return new Response(JSON.stringify({ id: CAMP, status: 1 }), { status: 200 });
  };
  const msg = await launchCampaign(
    { INSTANTLY_API_KEY: KEY },
    { campaignId: CAMP, confirmed: true },
    fetchFn,
  );
  assert.match(msg, /live/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `https://api.instantly.ai/api/v2/campaigns/${CAMP}/activate`);
  assert.equal(calls[0].auth, `Bearer ${KEY}`);
});

test('actions API launch without confirmed does not activate', async () => {
  const db = memD1();
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    return new Response('{}', { status: 200 });
  };
  try {
    const res = await handleApi(req('/dashboard/api/actions', {
      method: 'POST',
      cookie: await cookie(),
      headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
      body: JSON.stringify({
        kind: 'outreach.launch',
        payload: { campaignId: CAMP },
        idemKey: 'launch-no',
      }),
    }), envWith(db));
    assert.equal(res.status, 200);
    const row = await res.json();
    assert.equal(row.status, 'failed');
    assert.match(row.result, /confirm/i);
  } finally {
    globalThis.fetch = prev;
  }
  assert.equal(calls.length, 0);
});

test('cron pulls Instantly accounts, campaigns, analytics, and warmup', async () => {
  const db = memD1();
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('/api/v2/accounts/warmup-analytics')) {
      return new Response(JSON.stringify({
        aggregate_data: { 'a@x.com': { health_score: 98 }, 'b@x.com': { health_score: 81 } },
      }), { status: 200 });
    }
    if (u.includes('/api/v2/accounts')) {
      return new Response(JSON.stringify({ items: accounts }), { status: 200 });
    }
    if (u.includes('/api/v2/campaigns/analytics/overview')) {
      return new Response(JSON.stringify({ total_interested: 2 }), { status: 200 });
    }
    if (u.includes('/api/v2/campaigns/analytics')) {
      return new Response(JSON.stringify([{
        campaign_id: CAMP,
        leads_count: 40,
        emails_sent_count: 3,
        open_count: 1,
        reply_count: 0,
      }]), { status: 200 });
    }
    if (u.includes('/api/v2/campaigns')) {
      return new Response(JSON.stringify({ items: [campaign] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    await handleCron(envWith(db));
  } finally {
    globalThis.fetch = prev;
  }
  assert.ok(seen.some((u) => u.includes('https://api.instantly.ai/api/v2/accounts')));
  assert.ok(seen.some((u) => u.includes('/api/v2/accounts/warmup-analytics')));
  assert.ok(seen.some((u) => u.includes('/api/v2/campaigns?')));
  assert.ok(seen.some((u) => u.includes('/api/v2/campaigns/analytics?')));
  assert.ok(seen.some((u) => u.includes('/api/v2/campaigns/analytics/overview')));
  const row = db.snapshots.get('instantly');
  assert.ok(row);
  const data = JSON.parse(row.data);
  assert.equal(data.dailyMax, 50);
  assert.equal(data.campaign.leads_count, 40);
  assert.equal(data.sentToday, 3);
  assert.equal(data.total_interested, 2);
});

test('merge overlays the outreach page from the instantly snapshot', () => {
  const out = mergeSnapshot(snapshot, [{
    source: 'instantly',
    collected_at: '2026-09-18T18:00:00Z',
    data: JSON.stringify(instantlySnap()),
  }], NOW);
  assert.equal(out.pages.outreach.setup.done, '4 of 6 done');
  assert.equal(out.pages.outreach.live.rows[0].value, '0 of 50');
  assert.ok(out.sources.instantly);
});

test('Launch button asks for confirm before the action fires', () => {
  const html = btn('Launch', {
    kind: 'outreach.launch',
    confirm: 'Start sending this campaign in Instantly?',
    payload: { campaignId: CAMP, confirmed: true },
  });
  assert.match(html, /data-kind="outreach.launch"/);
  assert.match(html, /data-confirm="Start sending this campaign in Instantly\?"/);
});
