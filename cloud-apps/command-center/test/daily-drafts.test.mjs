import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { handleCron } from '../src/cron.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { render } from '../public/js/pages/content.js';
import {
  fillDailyDrafts, topicsFrom, vancouverDay, draftId,
} from '../src/daily-drafts.js';
import { memD1 } from './memd1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const PDT_BEFORE = Date.parse('2026-09-21T06:59:59Z');
const PDT_AFTER = Date.parse('2026-09-21T07:00:00Z');
const PST_BEFORE = Date.parse('2026-01-15T07:59:59Z');
const PST_AFTER = Date.parse('2026-01-15T08:00:00Z');

function envWith(db, tenant = 'jon') {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: '909090',
    CONTENT_TENANT: tenant,
    CONTENT_PLATFORMS: 'X,Instagram',
    DB: db,
  };
}

function req(path, { method = 'GET', cookie, body } = {}) {
  const headers = new Headers({ 'X-CC': '1' });
  if (cookie) headers.set('Cookie', cookie);
  if (body) headers.set('Content-Type', 'application/json');
  return new Request(`https://jonmac.ai${path}`, { method, headers, body });
}

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

const facts = {
  outliers: [{ title: 'Claude plus Higgsfield UGC workflow', channel: 'Jon Mac' }],
  picks: [{ title: 'Built With AI pick' }],
};

function fixture() {
  return {
    nav: { badges: {} },
    goal: { pct: 0 },
    sources: {},
    pages: {
      content: {
        title: 'Content',
        sub: 'fixture',
        actions: [],
        tiles: [{}, {}, {}],
        todayPlatforms: { title: 'Today', meta: '', rows: [] },
        heat: { title: 'Week', meta: '', days: [], rows: [] },
        queue: { title: 'Queue', rows: [] },
        ytWeek: { title: 'YouTube', note: '', rows: [] },
        bestPosts: { title: 'Best', meta: '', rows: [], btn: 'Remix', msg: 'x' },
      },
    },
  };
}

test('Vancouver day flips at midnight, including winter PST', () => {
  assert.equal(vancouverDay(PDT_BEFORE), '2026-09-20');
  assert.equal(vancouverDay(PDT_AFTER), '2026-09-21');
  assert.equal(vancouverDay(PST_BEFORE), '2026-01-14');
  assert.equal(vancouverDay(PST_AFTER), '2026-01-15');
});

test('exact slot count follows configured platforms, not a hardcoded four', async () => {
  const db = memD1();
  const two = await fillDailyDrafts(db, {
    nowMs: PDT_AFTER, tenant: 'jon', platforms: ['X', 'Instagram'], sources: facts,
  });
  assert.equal(two.inserted, 6);
  assert.equal(db.drafts.size, 6);
  const five = memD1();
  const out = await fillDailyDrafts(five, {
    nowMs: PDT_AFTER, tenant: 'jon',
    platforms: ['TikTok', 'YouTube', 'X', 'LinkedIn', 'Facebook'],
    sources: facts,
  });
  assert.equal(out.inserted, 15);
  assert.equal(five.drafts.size, 15);
  for (const platform of out.platforms) {
    const n = [...five.drafts.values()].filter((r) => r.platform === platform && r.day === '2026-09-21').length;
    assert.equal(n, 3);
  }
});

test('midnight boundary does not reuse the previous local day', async () => {
  const db = memD1();
  await fillDailyDrafts(db, { nowMs: PDT_BEFORE, tenant: 'jon', platforms: ['X'], sources: facts });
  await fillDailyDrafts(db, { nowMs: PDT_AFTER, tenant: 'jon', platforms: ['X'], sources: facts });
  const days = new Set([...db.drafts.values()].map((r) => r.day));
  assert.deepEqual([...days].sort(), ['2026-09-20', '2026-09-21']);
  assert.equal(db.drafts.size, 6);
  assert.ok(db.drafts.has(draftId('jon', '2026-09-20', 'X', 1)));
  assert.ok(db.drafts.has(draftId('jon', '2026-09-21', 'X', 3)));
});

test('duplicate fill, cron, and action retry do not add slots or overwrite', async () => {
  const db = memD1();
  const env = envWith(db);
  const first = await fillDailyDrafts(db, {
    nowMs: PDT_AFTER, tenant: 'jon', platforms: ['X', 'Instagram'], sources: facts,
  });
  const again = await fillDailyDrafts(db, {
    nowMs: PDT_AFTER, tenant: 'jon', platforms: ['X', 'Instagram'], sources: facts,
  });
  assert.equal(first.inserted, 6);
  assert.equal(again.inserted, 0);
  assert.equal(db.drafts.size, 6);
  const prev = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  const kept = [...db.drafts.values()].map((r) => ({ id: r.id, body: r.body, status: r.status }));
  try {
    await handleCron(env);
    const after = db.drafts.size;
    await handleCron(env);
    assert.equal(db.drafts.size, after);
  } finally {
    globalThis.fetch = prev;
  }
  for (const row of kept) {
    const now = db.drafts.get(row.id);
    assert.equal(now.body, row.body);
    assert.equal(now.status, row.status);
  }
  const ck = await cookie();
  const gen = () => handleApi(req('/dashboard/api/actions', {
    method: 'POST', cookie: ck,
    body: JSON.stringify({ kind: 'content.generate_drafts', idemKey: 'gen-1', payload: {} }),
  }), env);
  const a = await gen();
  const b = await gen();
  assert.equal(a.status, 200);
  const aj = await a.json();
  const bj = await b.json();
  assert.equal(aj.id, bj.id);
  assert.equal(db.drafts.size, 6);
  assert.equal(db.actions.filter((x) => x.kind === 'content.generate_drafts').length, 1);
});

test('snapshot refresh does not insert drafts', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  const res = await handleApi(req('/dashboard/api/snapshot', { cookie: ck }), env);
  assert.equal(res.status, 200);
  assert.equal(db.drafts.size, 0);
  const page = (await res.json()).pages.content;
  assert.equal(page.dailyDrafts.rows.length, 0);
  assert.match(page.dailyDrafts.meta, /does not publish/i);
});

test('human edits survive refill and a later generate', async () => {
  const db = memD1();
  const env = envWith(db);
  await fillDailyDrafts(db, {
    nowMs: PDT_AFTER, tenant: 'jon', platforms: ['X'], sources: facts,
  });
  const id = draftId('jon', '2026-09-21', 'X', 2);
  const ck = await cookie();
  const save = await handleApi(req('/dashboard/api/actions', {
    method: 'POST', cookie: ck,
    body: JSON.stringify({
      kind: 'content.save_draft', idemKey: 'save-1',
      payload: { id, body: 'Human wrote this line\nand kept the second.' },
    }),
  }), env);
  assert.equal(save.status, 200);
  await fillDailyDrafts(db, {
    nowMs: PDT_AFTER, tenant: 'jon', platforms: ['X'], sources: facts,
  });
  await handleApi(req('/dashboard/api/actions', {
    method: 'POST', cookie: ck,
    body: JSON.stringify({ kind: 'content.generate_drafts', idemKey: 'gen-2', payload: {} }),
  }), env);
  const row = db.drafts.get(id);
  assert.equal(row.body, 'Human wrote this line\nand kept the second.');
  assert.equal(row.status, 'edited');
  const snap = await handleApi(req('/dashboard/api/snapshot', { cookie: ck }), env);
  const shown = (await snap.json()).pages.content.dailyDrafts.rows.find((r) => r.id === id);
  assert.equal(shown.body, row.body);
  assert.equal(shown.statusLabel, 'Edited · not published');
});

test('approve persists and does not queue a publish', async () => {
  const db = memD1();
  const env = envWith(db);
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('{}', { status: 500 });
  };
  try {
    await fillDailyDrafts(db, {
      nowMs: PDT_AFTER, tenant: 'jon', platforms: ['X'], sources: facts,
    });
    const id = draftId('jon', '2026-09-21', 'X', 1);
    const ck = await cookie();
    const res = await handleApi(req('/dashboard/api/actions', {
      method: 'POST', cookie: ck,
      body: JSON.stringify({ kind: 'content.approve_draft', idemKey: 'ap-1', payload: { id } }),
    }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'done');
    assert.match(body.result, /not published/i);
    assert.equal(db.drafts.get(id).status, 'approved');
    const again = await handleApi(req('/dashboard/api/snapshot', { cookie: ck }), env);
    const shown = (await again.json()).pages.content.dailyDrafts.rows.find((r) => r.id === id);
    assert.equal(shown.status, 'approved');
    assert.equal(shown.statusLabel, 'Approved · not published');
    assert.equal(db.actions.some((a) => a.target === 'gpu2' && String(a.payload).includes(id)), false);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = prev;
  }
});

test('tenant access cannot read or edit another tenant slot', async () => {
  const db = memD1();
  await fillDailyDrafts(db, {
    nowMs: PDT_AFTER, tenant: 'jon', platforms: ['X'], sources: facts,
  });
  await fillDailyDrafts(db, {
    nowMs: PDT_AFTER, tenant: 'qa-other', platforms: ['X'], sources: facts,
  });
  assert.equal(db.drafts.size, 6);
  const ck = await cookie();
  const jon = await handleApi(req('/dashboard/api/snapshot', { cookie: ck }), envWith(db, 'jon'));
  const ids = (await jon.json()).pages.content.dailyDrafts.rows.map((r) => r.id);
  assert.equal(ids.length, 3);
  assert.ok(ids.every((id) => id.startsWith('d:jon:')));
  const otherId = draftId('qa-other', '2026-09-21', 'X', 1);
  const before = db.drafts.get(otherId).body;
  const denied = await handleApi(req('/dashboard/api/actions', {
    method: 'POST', cookie: ck,
    body: JSON.stringify({
      kind: 'content.save_draft', idemKey: 'cross-1',
      payload: { id: otherId, tenant: 'qa-other', body: 'stolen' },
    }),
  }), envWith(db, 'jon'));
  assert.equal(denied.status, 403);
  assert.equal(db.drafts.get(otherId).body, before);
  assert.notEqual(db.drafts.get(otherId).status, 'edited');
});

test('missing facts and unconfigured platforms are explicit, not invented posts', async () => {
  assert.equal(topicsFrom({}).length, 0);
  const db = memD1();
  const out = await fillDailyDrafts(db, {
    nowMs: PDT_AFTER, tenant: 'jon', platforms: ['X'], sources: {},
  });
  assert.equal(out.inserted, 3);
  assert.equal(out.failed, 3);
  for (const row of db.drafts.values()) {
    assert.equal(row.status, 'failed');
    assert.match(row.error, /no connected product facts/i);
    assert.equal(row.body, '');
  }
  const page = mergeSnapshot(fixture(), [], PDT_AFTER, {}, [], [], [], {
    drafts: [...db.drafts.values()],
    platforms: ['X'],
    unavailable: ['Instagram', 'Facebook', 'LinkedIn'],
  }).pages.content;
  assert.equal(page.dailyDrafts.rows[0].statusLabel, 'Generation failed');
  assert.deepEqual(page.dailyDrafts.unavailable.map((u) => u.platform), ['Instagram', 'Facebook', 'LinkedIn']);
  const html = render(page);
  assert.match(html, /Generation failed/);
  assert.match(html, /Unavailable/);
  assert.match(html, /content\.approve_draft/);
  assert.match(html, /Nothing will be posted/);
  assert.doesNotMatch(html, /approved and scheduled/i);
});
