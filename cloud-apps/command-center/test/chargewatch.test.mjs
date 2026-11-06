import test from 'node:test';
import assert from 'node:assert/strict';
import { syncChargeWatch, answerKind, questionKey } from '../src/chargewatch.js';
import { sqliteD1 } from './sqlited1.mjs';

const FLAG = { kind: 'new_subscription', key: 'notion labs', merchant: 'NOTION LABS', amountCadMinor: '1350', amountNativeMinor: '1350', currency: 'CAD', frequency: 'monthly', firstSeen: '2026-10-02', lastSeen: '2026-11-02', count: 2, summary: 'NOTION LABS $13.50 CAD, monthly, first seen 2026-10-02' };
const ONE_OFF = { kind: 'one_off', key: 'acme parts', merchant: 'ACME PARTS', amountCadMinor: '45000', amountNativeMinor: '45000', currency: 'CAD', frequency: 'one-off', firstSeen: '2026-11-01', lastSeen: '2026-11-01', count: 1, summary: 'ACME PARTS $450.00 CAD, one time, first seen 2026-11-01' };

function fakeFetch(flags, { actionOk = true } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization });
    if (String(url).endsWith('/charge-watch')) return { ok: true, status: 200, json: async () => ({ flags }) };
    return { ok: actionOk, status: actionOk ? 200 : 500, json: async () => ({ ok: actionOk }) };
  };
  fn.calls = calls;
  return fn;
}
const env = () => ({ DB: sqliteD1(), MONEYCLAW_DASHBOARD_TOKEN: 'tok' });

test('answers map to keep, cancel or other', () => {
  assert.equal(answerKind('Keep'), 'keep');
  assert.equal(answerKind(' expected '), 'keep');
  assert.equal(answerKind('Cancel'), 'cancel');
  assert.equal(answerKind('Not expected'), 'cancel');
  assert.equal(answerKind('ask me in March'), 'other');
});

test('one question per flag, never duplicated by the next run', async () => {
  const e = env();
  const f = fakeFetch([FLAG, ONE_OFF]);
  assert.deepEqual(await syncChargeWatch(e, f, '2026-11-05T10:00:00Z'), { asked: 2, answered: 0 });
  assert.deepEqual(await syncChargeWatch(e, f, '2026-11-05T10:10:00Z'), { asked: 0, answered: 0 });
  const rows = (await e.DB.prepare("SELECT * FROM bot_questions ORDER BY idem_key").all()).results;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].idem_key, questionKey(ONE_OFF));
  assert.equal(rows[0].asked_by, 'moneyclaw');
  assert.deepEqual(JSON.parse(rows[0].options), ['Expected', 'Not expected']);
  assert.deepEqual(JSON.parse(rows[1].options), ['Keep', 'Cancel']);
  assert.match(rows[1].question, /^New charge: NOTION LABS \$13\.50 CAD/);
  assert.equal(f.calls[0].auth, 'Bearer tok');
});

test('a Keep answer is sent to MoneyClaw with the price, then the question closes', async () => {
  const e = env();
  const f = fakeFetch([FLAG]);
  await syncChargeWatch(e, f, '2026-11-05T10:00:00Z');
  await e.DB.prepare("UPDATE bot_questions SET status = 'answered', answer = 'Keep'").run();
  assert.deepEqual(await syncChargeWatch(e, f, '2026-11-05T10:10:00Z'), { asked: 0, answered: 1 });
  const post = f.calls.find((c) => c.body);
  assert.deepEqual(post.body, { action: 'charge_watch_answer', key: 'notion labs', answer: 'keep', amountCadMinor: '1350', amountNativeMinor: '1350', currency: 'CAD', frequency: 'monthly', merchant: 'NOTION LABS', kind: 'new_subscription' });
  assert.equal((await e.DB.prepare('SELECT status FROM bot_questions').first()).status, 'closed');
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM bot_tasks').first()).n, 0);
});

test('Cancel opens exactly one cancel card, even if the run repeats', async () => {
  const e = env();
  const f = fakeFetch([FLAG]);
  await syncChargeWatch(e, f, '2026-11-05T10:00:00Z');
  await e.DB.prepare("UPDATE bot_questions SET status = 'answered', answer = 'Cancel'").run();
  await syncChargeWatch(e, f, '2026-11-05T10:10:00Z');
  await e.DB.prepare("UPDATE bot_questions SET status = 'answered'").run(); // a retry after a crash
  await syncChargeWatch(e, f, '2026-11-05T10:20:00Z');
  const tasks = (await e.DB.prepare('SELECT * FROM bot_tasks').all()).results;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Cancel NOTION LABS');
  assert.equal(tasks[0].status, 'todo');
  assert.equal(tasks[0].project, 'accounting');
});

test('a failed save in MoneyClaw leaves the question answered so the next run retries', async () => {
  const e = env();
  await syncChargeWatch(e, fakeFetch([FLAG]), '2026-11-05T10:00:00Z');
  await e.DB.prepare("UPDATE bot_questions SET status = 'answered', answer = 'Cancel'").run();
  assert.deepEqual(await syncChargeWatch(e, fakeFetch([FLAG], { actionOk: false }), '2026-11-05T10:10:00Z'), { asked: 0, answered: 0 });
  assert.equal((await e.DB.prepare('SELECT status FROM bot_questions').first()).status, 'answered');
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM bot_tasks').first()).n, 0);
});

test('typed answers are saved as other; a bad flag is skipped; no token does nothing', async () => {
  const e = env();
  const f = fakeFetch([{ ...FLAG, amountNativeMinor: '13.50' }, ONE_OFF]);
  assert.equal((await syncChargeWatch(e, f)).asked, 1, 'a flag with a non-integer amount is skipped');
  await e.DB.prepare("UPDATE bot_questions SET status = 'answered', answer = 'it was the new truck part'").run();
  await syncChargeWatch(e, f);
  assert.equal(f.calls.find((c) => c.body).body.answer, 'other');
  assert.deepEqual(await syncChargeWatch({ DB: e.DB }, f), { asked: 0, answered: 0 });
});

test('a USD charge keeps one question when the exchange rate moves, and the answer carries its own currency', async () => {
  const e = env();
  const usd = { ...FLAG, key: 'claude ai', merchant: 'CLAUDE.AI', amountCadMinor: '2760', amountNativeMinor: '2000', currency: 'USD' };
  await syncChargeWatch(e, fakeFetch([usd]), '2026-11-05T10:00:00Z');
  assert.deepEqual(await syncChargeWatch(e, fakeFetch([{ ...usd, amountCadMinor: '2810' }]), '2026-11-05T10:10:00Z'), { asked: 0, answered: 0 });
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM bot_questions').first()).n, 1);
  await e.DB.prepare("UPDATE bot_questions SET status = 'answered', answer = 'Keep'").run();
  const f = fakeFetch([{ ...usd, amountCadMinor: '2810' }]);
  await syncChargeWatch(e, f, '2026-11-05T10:20:00Z');
  const body = f.calls.find((c) => c.body).body;
  assert.equal(body.amountNativeMinor, '2000');
  assert.equal(body.currency, 'USD');
  assert.equal(body.amountCadMinor, '2810');
});

test('a charge after a cancel asks in its own words and a Cancel answer opens its own card', async () => {
  const e = env();
  const flag = { ...FLAG, kind: 'after_cancel', summary: 'NOTION LABS charged $13.50 CAD on 2026-11-20, after you cancelled it on 2026-11-02' };
  await syncChargeWatch(e, fakeFetch([flag]), '2026-11-21T10:00:00Z');
  const q = await e.DB.prepare('SELECT * FROM bot_questions').first();
  assert.match(q.question, /^Charged after you cancelled: NOTION LABS/);
  assert.deepEqual(JSON.parse(q.options), ['Keep', 'Cancel']);
  await e.DB.prepare("UPDATE bot_questions SET status = 'answered', answer = 'Cancel'").run();
  await syncChargeWatch(e, fakeFetch([flag]), '2026-11-21T10:10:00Z');
  const task = await e.DB.prepare('SELECT * FROM bot_tasks').first();
  assert.equal(task.title, 'NOTION LABS charged after cancel');
  assert.match(task.note, /stop the billing and ask for a refund/);
});

test('an answer still saves when the flag has left the feed: no amounts are sent and MoneyClaw uses the newest charge', async () => {
  const e = env();
  await syncChargeWatch(e, fakeFetch([FLAG]), '2026-11-05T10:00:00Z');
  await e.DB.prepare("UPDATE bot_questions SET status = 'answered', answer = 'Keep'").run();
  const f = fakeFetch([]);
  assert.deepEqual(await syncChargeWatch(e, f, '2026-12-20T10:00:00Z'), { asked: 0, answered: 1 });
  const body = f.calls.find((c) => c.body).body;
  assert.equal(body.amountCadMinor, '');
  assert.equal(body.currency, '');
});
