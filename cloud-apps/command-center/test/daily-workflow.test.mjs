import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { mergeSnapshot, honestyChip } from '../src/snapshot.js';
import { nextMorningStep } from '../src/home.js';
import { overlayLife, DATE_NIGHT_BOOK_HREF } from '../src/life.js';
import { overlayViral } from '../src/viral.js';
import { overlaySupport } from '../src/support.js';
import { overlaySponsors, COLLECTIONS_HREF } from '../src/sponsors.js';
import { isAiUgc, templateIdFor } from '../src/youtube.js';
import { overlayOutreach } from '../src/outreach.js';
import { persistQueueDrafts, listDrafts } from '../src/drafts.js';
import { revalidateSources, DEDUPE_MS } from '../src/revalidate.js';
import { render as renderSponsors } from '../public/js/pages/sponsors.js';
import { memD1 } from './memd1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(root, 'fixtures/snapshot.json'), 'utf8'));
const SECRET = 'test-session-secret-32-bytes-ok!';
const cookie = async (db) => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
};

async function snap(env) {
  env.SESSION_SECRET = env.SESSION_SECRET || SECRET;
  const ck = await cookie(env.DB);
  return handleApi(new Request('https://jonmac.ai/dashboard/api/snapshot', { headers: { cookie: ck } }), env);
}

test('new Vancouver day starts with all morning steps unchecked', () => {
  const now = Date.parse('2026-09-19T17:00:00Z');
  const snap = mergeSnapshot(structuredClone(fixture), [], { nowMs: now, extra: { checklist: [] } });
  assert.equal(snap.pages.home.runThrough.done, 0);
  assert.ok(snap.pages.home.runThrough.steps.every((s) => s.done === false));
});

test('empty sponsor and support queues do not auto-complete morning', () => {
  const now = Date.parse('2026-09-19T17:00:00Z');
  const snap = mergeSnapshot(structuredClone(fixture), [
    { source: 'sponsors', data: JSON.stringify({ cards: [] }), collected_at: new Date(now).toISOString() },
    { source: 'support', data: JSON.stringify({ threads: [] }), collected_at: new Date(now).toISOString() },
  ], { nowMs: now, extra: { checklist: [] } });
  const items = Object.fromEntries(snap.pages.home.runThrough.steps.map((s) => [s.item, s.done]));
  assert.equal(items.sponsor_emails, false);
  assert.equal(items.support_replies, false);
});
test('workout habit does not auto-complete morning checklist', () => {
  const now = Date.parse('2026-09-19T17:00:00Z');
  const snap = mergeSnapshot(structuredClone(fixture), [], {
    nowMs: now,
    extra: { checklist: [], habits: [{ kind: 'workout', done: 1, day: '2026-09-19' }] },
  });
  assert.equal(snap.pages.home.runThrough.steps.find((s) => s.item === 'workout').done, false);
});

test('checklist persists one item and resets the next Vancouver day', async () => {
  const env = { DB: memD1(), SESSION_SECRET: SECRET };
  const day = '2026-09-19';
  const req = new Request('https://jonmac.ai/dashboard/api/checklist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookie(env.DB), 'x-cc': '1' },
    body: JSON.stringify({ day, item: 'bank_scan' }),
  });
  assert.equal((await handleApi(req, env)).status, 200);
  const morning = mergeSnapshot(structuredClone(fixture), [], {
    nowMs: Date.parse('2026-09-19T17:00:00Z'),
    extra: { checklist: [...env.DB.checklist.values()] },
  });
  assert.equal(morning.pages.home.runThrough.steps.find((s) => s.item === 'bank_scan').done, true);
  const next = mergeSnapshot(structuredClone(fixture), [], {
    nowMs: Date.parse('2026-09-20T17:00:00Z'),
    extra: { checklist: [...env.DB.checklist.values()] },
  });
  assert.equal(next.pages.home.runThrough.done, 0);
});

test('Start my morning first undone step stays on checklist not auto-nav', () => {
  const now = Date.parse('2026-09-19T17:00:00Z');
  const snap = mergeSnapshot(structuredClone(fixture), [], { nowMs: now, extra: { checklist: [] } });
  assert.equal(nextMorningStep(snap.pages.home.runThrough).page, 'sponsors');
  assert.equal(nextMorningStep(snap.pages.home.runThrough).item, 'sponsor_emails');
});

test('one live source does not label Home as Live', () => {
  const now = Date.now();
  const snap = mergeSnapshot(structuredClone(fixture), [
    { source: 'agents_mac', data: JSON.stringify({ collectedAt: now, agents: [] }), collected_at: new Date(now).toISOString() },
  ], { nowMs: now });
  assert.notEqual(snap.pages.home.chip, 'Live · numbers from your pages');
  assert.match(snap.pages.home.chip, /Partial|Mockup|stale|missing/i);
});

test('honestyChip stays fixture when no sources', () => {
  assert.equal(honestyChip({}, Date.now(), 'Mockup · numbers are examples'), 'Mockup · numbers are examples');
});

test('snapshot GET revalidates worker sources once then dedupes', async () => {
  const env = {
    DB: memD1(),
    VIRALVIEW_SUMMARY_SECRET: 's',
  };
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ success: true, mrr: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const first = await revalidateSources(env, { nowMs: 1_000_000, fetchFn });
  assert.ok(first.pulled.includes('viralview'));
  assert.equal(calls.length, 1);
  const second = await revalidateSources(env, { nowMs: 1_000_000 + DEDUPE_MS - 1, fetchFn });
  assert.deepEqual(second.pulled, []);
  assert.equal(calls.length, 1);
  const third = await revalidateSources(env, { nowMs: 1_000_000 + DEDUPE_MS + 1, fetchFn });
  assert.ok(third.pulled.includes('viralview'));
  assert.equal(calls.length, 2);
});

test('snapshot GET does not insert drafts, actions, or jobs', async () => {
  const env = { DB: memD1() };
  const res = await snap(env);
  assert.equal(res.status, 200);
  assert.equal(env.DB.actions.length, 0);
  const body = await res.json();
  assert.ok(body.pages.home);
});

test('date night is an OpenTable booking href not a calendar insert', () => {
  const page = overlayLife(structuredClone(fixture.pages.life), { connected: true, events: [], nowMs: Date.parse('2026-09-19T17:00:00Z') });
  const row = page.dateNight.rows[0];
  assert.equal(row.href, DATE_NIGHT_BOOK_HREF);
  assert.ok(row.href.includes('opentable'));
  assert.equal(row.kind, undefined);
});

test('collections action always has a working href', () => {
  const page = overlaySponsors(structuredClone(fixture.pages.sponsors), { cards: [] });
  const open = page.actions.find((a) => /collections/i.test(a.label));
  assert.equal(open.href, COLLECTIONS_HREF);
  const scan = page.actions.find((a) => /scan inbox/i.test(a.label));
  assert.equal(scan.kind, 'sponsor.scan_inbox');
});

test('Viral and Support planner buttons queue mastermind.send_to_planner', () => {
  const viral = overlayViral(structuredClone(fixture.pages.viral), {
    generatedAt: new Date().toISOString(),
    kpis: { mrr: { currentCents: 0, previousCents: 0 } },
    cash: { stripeAvailableCents: 0, stripePendingCents: 0, wiseAvailableCents: 0, lastPayoutCents: 0, lastPayoutAt: null, mismatch: true },
  }, Date.now());
  assert.equal(viral.check.kind, 'mastermind.send_to_planner');
  assert.equal(viral.check.payload.id, 'viral-cash');
  const support = overlaySupport(structuredClone(fixture.pages.support), { threads: [] });
  assert.equal(support.topics.kind, 'mastermind.send_to_planner');
  assert.ok(support.topics.payload.id);
});

test('second planner click with same id does not queue another GPU2 job', async () => {
  const env = { DB: memD1(), SESSION_SECRET: SECRET };
  const body = JSON.stringify({
    kind: 'mastermind.send_to_planner',
    payload: { id: 'viral-cash', title: 'Cash', body: 'Mismatch', area: 'Viral View' },
  });
  const post = async () => handleApi(new Request('https://jonmac.ai/dashboard/api/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookie(env.DB), 'x-cc': '1' },
    body,
  }), env);
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  const queued = env.DB.actions.filter((a) => a.kind === 'mastermind.send_to_planner' && a.status === 'queued');
  assert.equal(queued.length, 1);
});

test('AI UGC filter is word-boundary not substring ai', () => {
  assert.equal(isAiUgc('AI UGC ads that sell'), true);
  assert.equal(isAiUgc('Best AI video generation tools'), true);
  assert.equal(isAiUgc('Talking head talking'), false);
  assert.equal(isAiUgc('side hustles with email'), false);
  assert.ok(templateIdFor('AI UGC ads'));
});

test('outreach Check now stays a real refresh kind when Instantly is missing', () => {
  const page = overlayOutreach(structuredClone(fixture.pages.outreach), null, { missing: true });
  const check = page.setup.steps.find((s) => /check now/i.test(s.title) || s.n === 2);
  assert.equal(check.kind, 'outreach.refresh');
  assert.ok(page.unverified);
});

test('content ingest persists at most 3 drafts per platform per day and GET does not add more', async () => {
  const db = memD1();
  await persistQueueDrafts(db, {
    queued: [
      { id: 'a', platform: 'x', firstLine: 'one' },
      { id: 'b', platform: 'x', firstLine: 'two' },
      { id: 'c', platform: 'x', firstLine: 'three' },
      { id: 'd', platform: 'x', firstLine: 'four' },
      { id: 'a2', platform: 'x', firstLine: 'one' },
    ],
  }, '2026-09-19T17:00:00Z');
  const rows = await listDrafts(db, '2026-09-19');
  assert.equal(rows.filter((r) => r.platform === 'X').length, 3);
  await persistQueueDrafts(db, { queued: [{ id: 'e', platform: 'x', firstLine: 'one' }] }, '2026-09-19T17:00:00Z');
  assert.equal((await listDrafts(db, '2026-09-19')).filter((r) => r.platform === 'X').length, 3);
});

test('agents overlay keeps unpinned running agents', () => {
  const snap = mergeSnapshot(structuredClone(fixture), [{
    source: 'agents_mac',
    data: JSON.stringify({
      collectedAt: Date.now(),
      agents: [
        { name: 'Random Worker', machine: 'Mac', status: 'working', now: 'Coding', job: 'Coding', last: 'now', lastMs: Date.now(), pin: false },
        { name: 'Command Center', machine: 'Mac', status: 'not_running', now: 'Not running', job: 'Not running', last: '—', lastMs: 0, pin: true },
      ],
    }),
    collected_at: new Date().toISOString(),
  }], { nowMs: Date.now() });
  assert.ok(snap.pages.agents.all.rows.some((r) => r.name === 'Random Worker'));
  assert.ok(snap.pages.agents.all.rows.some((r) => r.name === 'Command Center' && /not.?running/i.test(String(r.status))));
});

test('sponsor email buttons open draft modal instead of prompt send', () => {
  const html = renderSponsors({
    title: 'Sponsors', sub: '', actions: [], tiles: [],
    septemberBar: { title: '', meta: '', aria: '', goalAt: 0, parts: [], line: '' },
    board: { title: '', meta: '', columns: [] },
    collect: { title: '', meta: '', rows: [] },
    emails: { title: '', meta: '', rows: [{
      id: 'c1', title: 'Flova', sub: 'Hi', to: 'a@b.c', subject: 'Hi', body: 'Hello',
      saveKind: 'sponsor.save_draft', sendKind: 'sponsor.send_draft', discardKind: 'sponsor.discard_draft',
    }] },
    byMonth: { title: '', meta: '', rows: [] },
  });
  assert.match(html, /data-draft="1"/);
  assert.doesNotMatch(html, /data-edit/);
  assert.doesNotMatch(html, /data-kind="sponsor.send_draft"/);
});
