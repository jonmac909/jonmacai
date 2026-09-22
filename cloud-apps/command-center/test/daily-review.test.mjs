import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { buildSponsorsPage } from '../src/sponsors.js';
import { overlaySupport } from '../src/support.js';
import { plannerDestination } from '../src/review.js';
import { render as renderSponsors } from '../public/js/pages/sponsors.js';
import { render as renderSupport } from '../public/js/pages/support.js';
import { formatJobResult } from '../public/js/ui.js';
import { memD1 } from './memd1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(root, 'fixtures/snapshot.json'), 'utf8'));
const SECRET = 'test-session-secret-32-bytes-ok!';
const py = process.platform === 'win32' ? 'python' : 'python3';
const NOW = Date.parse('2026-09-19T17:00:00Z');

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

function post(env, path, body) {
  return handleApi(new Request(`https://jonmac.ai${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: env._ck, 'x-cc': '1' },
    body: JSON.stringify(body),
  }), env);
}

test('morning stays at zero until a manual click', () => {
  const snap = mergeSnapshot(structuredClone(fixture), [
    { source: 'sponsors', data: JSON.stringify({ cards: [] }), collected_at: new Date(NOW).toISOString() },
    { source: 'support', data: JSON.stringify({ tickets: [] }), collected_at: new Date(NOW).toISOString() },
  ], NOW, {}, [], [], [], {
    habits: [{ day: '2026-09-19', kind: 'workout', done: 1 }],
    checklist: [{ day: '2026-09-19', item: 'market_check', how: 'auto', done_at: '2026-09-19T19:45:55.853Z' }],
  });
  assert.equal(snap.pages.home.runThrough.done, 0);
  assert.ok(snap.pages.home.runThrough.steps.every((s) => s.done === false && s.item));
});

test('manual checklist click persists and the next Kelowna day is zero', async () => {
  const env = { DB: memD1(), SESSION_SECRET: SECRET };
  env._ck = await cookie();
  assert.equal((await post(env, '/dashboard/api/checklist', { day: '2026-09-19', item: 'bank_scan', how: 'manual' })).status, 200);
  assert.equal((await post(env, '/dashboard/api/checklist', { day: '2026-09-19', item: 'market_check', how: 'auto' })).status, 200);
  const morning = mergeSnapshot(structuredClone(fixture), [], NOW, {}, [], [], [], {
    checklist: [...env.DB.checklist.values()],
  });
  const items = Object.fromEntries(morning.pages.home.runThrough.steps.map((s) => [s.item, s.done]));
  assert.equal(items.bank_scan, true);
  assert.equal(items.market_check, false);
  assert.equal(morning.pages.home.runThrough.done, 1);
  assert.equal((await post(env, '/dashboard/api/checklist', { day: '2026-09-19', item: 'bank_scan', done: false })).status, 200);
  const cleared = mergeSnapshot(structuredClone(fixture), [], NOW, {}, [], [], [], {
    checklist: [...env.DB.checklist.values()],
  });
  assert.equal(cleared.pages.home.runThrough.done, 0);
  const next = mergeSnapshot(structuredClone(fixture), [], Date.parse('2026-09-20T17:00:00Z'), {}, [], [], [], {
    checklist: [{ day: '2026-09-19', item: 'sponsor_emails', how: 'manual' }],
  });
  assert.equal(next.pages.home.runThrough.done, 0);
});

test('sponsor, support, and kanban review open an editable draft instead of sending', () => {
  const page = buildSponsorsPage({
    cards: [{
      id: 'c1', sponsor: 'Flova', stage: 'negotiating', to: 'ada@example.com', subject: 'Rates',
      draftReply: { status: 'needs-review', subject: 'Re: Rates', body: 'Hi Ada' },
    }],
    collections: { items: [] },
  }, NOW);
  const card = page.board.columns.flatMap((c) => c.cards).find((c) => c.id === 'c1');
  assert.equal(card.draft, true);
  assert.equal(card.kind, undefined);
  assert.equal(card.payload.to, 'ada@example.com');
  assert.equal(card.payload.subject, 'Re: Rates');
  assert.equal(card.payload.body, 'Hi Ada');
  assert.equal(card.payload.sendKind, 'sponsor.send_draft');
  assert.equal(card.payload.discardKind, 'sponsor.discard_draft');
  const html = renderSponsors({
    ...page,
    actions: [],
    septemberBar: { title: '', meta: '', aria: '', goalAt: 0, parts: [], line: '' },
  });
  assert.match(html, /data-draft="1"/);
  assert.match(html, /ada@example.com/);
  assert.doesNotMatch(html, /data-kind="sponsor.send_draft"/);

  const support = structuredClone(fixture.pages.support);
  overlaySupport(support, {
    tickets: [{ uid: '9', to: 'bea@example.com', subject: 'Export', body: 'Restarted it.', money: false }],
  });
  const row = support.drafts.rows[0];
  assert.equal(row.to, 'bea@example.com');
  assert.equal(row.subject, 'Export');
  assert.equal(row.body, 'Restarted it.');
  assert.equal(row.discardKind, 'support.discard_draft');
  const supportHtml = renderSupport(support);
  assert.match(supportHtml, /data-draft="1"/);
  assert.doesNotMatch(supportHtml, /data-kind="support.send"/);
});

test('isolated draft save and discard persist without queueing mail', async () => {
  const env = { DB: memD1(), SESSION_SECRET: SECRET };
  env._ck = await cookie();
  const save = await post(env, '/dashboard/api/actions', {
    kind: 'sponsor.save_draft',
    idemKey: 'qa-save',
    payload: { id: 'qa-daily-review', to: 'qa@example.com', subject: 'QA', body: 'isolated', isolated: true },
  });
  assert.equal((await save.json()).result, 'Draft saved');
  assert.equal(env.DB.actions.filter((a) => a.target === 'mac').length, 0);
  const shown = mergeSnapshot(structuredClone(fixture), [...env.DB.snapshots.values()], NOW);
  const row = shown.pages.sponsors.emails.rows.find((r) => r.id === 'qa-daily-review');
  assert.equal(row.body, 'isolated');
  assert.equal(row.to, 'qa@example.com');
  const send = await post(env, '/dashboard/api/actions', {
    kind: 'sponsor.send_draft',
    idemKey: 'qa-send',
    payload: { id: 'qa-daily-review', to: 'qa@example.com', subject: 'QA', body: 'isolated' },
  });
  assert.equal((await send.json()).result, 'Not sent · isolated draft');
  assert.equal(env.DB.actions.filter((a) => a.kind === 'sponsor.send_draft').length, 0);
  await post(env, '/dashboard/api/actions', {
    kind: 'sponsor.discard_draft',
    idemKey: 'qa-drop',
    payload: { id: 'qa-daily-review', isolated: true },
  });
  const gone = mergeSnapshot(structuredClone(fixture), [...env.DB.snapshots.values()], NOW);
  assert.equal(gone.pages.sponsors.emails.rows.some((r) => r.id === 'qa-daily-review'), false);
});

test('inbox scan result is a finished count, not a queued toast', () => {
  assert.equal(formatJobResult('sponsor.scan_inbox', JSON.stringify({ scanned: 4, drafts: 1, error: null })), 'Scanned 4 · 1 drafts');
  assert.match(formatJobResult('sponsor.scan_inbox', JSON.stringify({ scanned: 0, drafts: 0, error: 'down' })), /failed/i);
});

test('Send to Planner explains the Orca destination and does not queue twice', async () => {
  assert.match(plannerDestination('Pause Instantly'), /under Planner in Orca/);
  const env = { DB: memD1(), SESSION_SECRET: SECRET };
  env._ck = await cookie();
  const body = {
    kind: 'mastermind.send_to_planner',
    payload: { id: 'qa-plan', title: 'QA-TEST daily review', body: 'isolated', area: 'QA' },
  };
  assert.equal((await post(env, '/dashboard/api/actions', { ...body, idemKey: 'p1' })).status, 200);
  const again = await (await post(env, '/dashboard/api/actions', { ...body, idemKey: 'p2' })).json();
  assert.match(again.result, /under Planner in Orca/);
  assert.equal(env.DB.actions.filter((a) => a.kind === 'mastermind.send_to_planner').length, 1);
  const snap = mergeSnapshot(structuredClone(fixture), [
    { source: 'mastermind', data: JSON.stringify({ picks: [], scanned: 1 }), collected_at: new Date(NOW).toISOString() },
  ], NOW, {}, [...env.DB.ideas.values()]);
  const built = snap.pages.mastermind.building.rows.find((r) => r.title === 'QA-TEST daily review');
  assert.match(built.sub, /Planner/);
});

test('collector scan finishes with counts and refuses isolated sends', () => {
  const code = [
    'import json, sponsors',
    'calls = []',
    'sponsors._req = lambda *a, **k: calls.append(a) or {}',
    'sponsors.collect_snapshot = lambda: {"cards": [{"draftReply": {"body": "hi"}}, {"id": "x"}]}',
    'ok, result = sponsors.handle("sponsor.scan_inbox", {})',
    'print(ok)',
    'print(result)',
    'print(calls[0][0], calls[0][1])',
    'ok2, result2 = sponsors.handle("sponsor.send_draft", {"id": "qa-daily-review", "to": "a@b.c"})',
    'print(ok2)',
    'print(result2)',
    'print(len(calls))',
    'from planner_task import destination',
    'print(destination("Pause Instantly"))',
  ].join('\n');
  const run = spawnSync(py, ['-c', code], { encoding: 'utf8', cwd: join(root, 'collectors/lib') });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'True');
  assert.deepEqual(JSON.parse(lines[1]), { scanned: 2, drafts: 1, error: null });
  assert.equal(lines[2], 'POST /api/refresh');
  assert.equal(lines[3], 'False');
  assert.match(lines[4], /not_sent:isolated/);
  assert.equal(lines[5], '1');
  assert.match(lines[6], /under Planner in Orca/);
});
