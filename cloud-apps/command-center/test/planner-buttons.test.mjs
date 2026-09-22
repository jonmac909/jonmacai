import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { plannerDestination } from '../src/review.js';
import { render as renderSupport } from '../public/js/pages/support.js';
import { render as renderViral } from '../public/js/pages/viral.js';
import { memD1 } from './memd1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(root, 'fixtures/snapshot.json'), 'utf8'));
const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-09-19T17:00:00Z');

function unescape(s) {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function plannerPayloads(html) {
  return [...html.matchAll(/data-kind="mastermind\.send_to_planner"[^>]*data-payload="([^"]+)"/g)]
    .map((m) => JSON.parse(unescape(m[1])));
}

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

test('Support and Viral Planner buttons create owned tasks instead of a toast', () => {
  const support = renderSupport(fixture.pages.support);
  const viralPage = mergeSnapshot(fixture, [{
    source: 'viralview',
    data: JSON.stringify({ subscriptions: { current: { mrrCents: 100 } }, traffic: [{ clicks: 10, carts: 4, sales: 1, revenueCents: 100 }] }),
    collected_at: new Date(NOW).toISOString(),
  }], NOW).pages.viral;
  const viral = renderViral(viralPage);
  const rows = [...plannerPayloads(support), ...plannerPayloads(viral)];
  const byId = Object.fromEntries(rows.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(byId).sort(), ['support-topics', 'viral-check', 'viral-dropoff']);
  assert.equal(byId['support-topics'].area, 'Support');
  assert.equal(byId['support-topics'].source, 'support-topics');
  assert.equal(byId['viral-check'].area, 'Viral View');
  assert.equal(byId['viral-check'].source, 'viral-check');
  assert.equal(byId['viral-dropoff'].area, 'Viral View');
  assert.equal(byId['viral-dropoff'].source, 'viral-dropoff');
  for (const row of rows) {
    assert.equal(row.msg, plannerDestination(row.title));
    assert.match(row.body, new RegExp(`Owner: ${row.area}`));
  }
  assert.doesNotMatch(support, /data-kind="support\.send"/);
  assert.doesNotMatch(support + viral, /Sent to Planner as a task/);
});

test('Support and Viral Planner clicks are idempotent and do not send mail', async () => {
  const env = { DB: memD1(), SESSION_SECRET: SECRET };
  env._ck = await cookie();
  async function post(idemKey, payload) {
    const res = await handleApi(new Request('https://jonmac.ai/dashboard/api/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: env._ck, 'x-cc': '1' },
      body: JSON.stringify({ kind: 'mastermind.send_to_planner', idemKey, payload }),
    }), env);
    return res.json();
  }
  const payload = {
    id: 'support-topics',
    title: 'Support topics',
    body: 'Owner: Support\nSource: support-topics',
    area: 'Support',
    source: 'support-topics',
  };
  await post('s1', payload);
  const again = await post('s2', payload);
  assert.match(again.result, /under Planner in Orca/);
  assert.equal(env.DB.actions.filter((a) => a.kind === 'mastermind.send_to_planner').length, 1);
  assert.equal(env.DB.actions.filter((a) => a.kind === 'support.send' || a.kind === 'support.decide_refund').length, 0);
  const snap = mergeSnapshot(structuredClone(fixture), [
    { source: 'mastermind', data: JSON.stringify({ picks: [], scanned: 1 }), collected_at: new Date(NOW).toISOString() },
  ], NOW, {}, [...env.DB.ideas.values()]);
  const built = snap.pages.mastermind.building.rows.find((r) => r.title === 'Support topics');
  assert.equal(built.sub, 'Support · Orca worktree under Planner');
});
