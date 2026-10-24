import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { normalizeQuestions, buildQuestions } from '../src/questions.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-10-24T18:00:00Z'); // 11:00 Vancouver

function memDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      const stmt = {
        args: [],
        bind(...a) { stmt.args = a; return stmt; },
        async run() {
          const a = stmt.args;
          let changes = 1;
          if (sql.includes('INSERT INTO questions')) {
            const prev = rows.get(a[0]);
            rows.set(a[0], {
              ...(prev || { answer: null, answered_at: null, collected_at: null }),
              id: a[0], asked_at: a[1], asker: a[2], project: a[3], question: a[4], context: a[5], options: a[6],
              status: prev && prev.answer ? 'answered' : a[7], source: a[8], updated_at: a[9],
            });
          } else if (sql.includes('DELETE FROM questions')) rows.delete(a[0]);
          else if (sql.includes('SET answer')) Object.assign(rows.get(a[2]), { answer: a[0], answered_at: a[1], status: 'answered' });
          else if (sql.includes('SET collected_at')) {
            const r = rows.get(a[1]);
            if (r && r.answer && !r.collected_at) r.collected_at = a[0]; else changes = 0;
          }
          return { success: true, meta: { changes } };
        },
        async all() {
          const a = stmt.args;
          if (sql.includes('FROM questions WHERE source')) return { results: [...rows.values()].filter((r) => r.source === a[0]) };
          if (sql.includes('collected_at IS NULL')) return { results: [...rows.values()].filter((r) => r.answer && !r.collected_at) };
          return { results: [] };
        },
        async first() {
          return rows.get(stmt.args[0]) || null;
        },
      };
      return stmt;
    },
  };
}

const envWith = (db) => ({ SESSION_SECRET: SECRET, MACHINE_TOKEN_GPU1: 'gpu1-token-value', DB: db });
const req = (path, { method = 'GET', cookie, headers = {}, body } = {}) => {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  return new Request(`https://jonmac.ai${path}`, { method, headers: h, body });
};
const session = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
const machine = { Authorization: 'Bearer gpu1-token-value', 'Content-Type': 'application/json' };
const push = (env, questions) => handleApi(req('/dashboard/api/ingest', {
  method: 'POST', headers: machine,
  body: JSON.stringify({ source: 'jon_tasks', collectedAt: '2026-10-24T17:00:00Z', data: { questions } }),
}), env);
const q = (id, extra = {}) => ({ id, asked_at: '2026-10-24T09:00:00-07:00', from: 'Ana', project: 'Sponsors', question: `Question ${id}?`, ...extra });

test('questions normalize: options cleaned, bad rows and duplicate ids dropped', () => {
  const rows = normalizeQuestions([q('a', { options: ['Yes', ' ', 'No'], context: 'ctx' }), q('a'), { id: 'b' }, q('c', { status: 'answered' })], 'jon_tasks');
  assert.deepEqual(rows.map((r) => r.id), ['a', 'c']);
  assert.equal(rows[0].options, '["Yes","No"]');
  assert.equal(rows[1].status, 'answered');
});

test('page lists open questions newest first, answered ones apart', () => {
  const rows = normalizeQuestions([
    q('old', { asked_at: '2026-10-23T09:00:00-07:00' }), q('new', { asked_at: '2026-10-24T10:00:00-07:00', options: ['A'] }), q('done'),
  ], 'jon_tasks');
  rows[2].answer = 'Yes please';
  rows[2].answered_at = '2026-10-24T17:30:00Z';
  const page = buildQuestions(rows, NOW);
  assert.equal(page.openCount, 2);
  assert.deepEqual(page.open.map((x) => x.id), ['new', 'old']);
  assert.deepEqual(page.open[0].options, ['A']);
  assert.deepEqual(page.answered.map((x) => [x.id, x.answer, x.answeredLabel]), [['done', 'Yes please', '10:30 AM']]);
});

test('push, answer from the page, collect with the machine key, and removal rules', async () => {
  const db = memDb();
  const env = envWith(db);
  assert.equal((await push(env, [q('q1'), q('q2')])).status, 200);
  assert.equal(db.rows.size, 2);

  const body = JSON.stringify({ answer: 'Go with option A' });
  const hdr = { 'Content-Type': 'application/json', 'X-CC': '1' };
  assert.equal((await handleApi(req('/dashboard/api/questions/q1/answer', { method: 'POST', headers: hdr, body }), env)).status, 401);
  const ck = await session();
  assert.equal((await handleApi(req('/dashboard/api/questions/q1/answer', { method: 'POST', cookie: ck, headers: hdr, body: '{"answer":"  "}' }), env)).status, 400);
  assert.equal((await handleApi(req('/dashboard/api/questions/nope/answer', { method: 'POST', cookie: ck, headers: hdr, body }), env)).status, 404);
  const ok = await handleApi(req('/dashboard/api/questions/q1/answer', { method: 'POST', cookie: ck, headers: hdr, body }), env);
  assert.equal(ok.status, 200);
  const again = await handleApi(req('/dashboard/api/questions/q1/answer', { method: 'POST', cookie: ck, headers: hdr, body: '{"answer":"changed"}' }), env);
  assert.equal((await again.json()).duplicate, true);
  assert.equal(db.rows.get('q1').answer, 'Go with option A');

  // Ana drops both from the file: the unanswered one goes, the uncollected answer stays.
  await push(env, []);
  assert.deepEqual([...db.rows.keys()], ['q1']);

  assert.equal((await handleApi(req('/dashboard/api/answers'), env)).status, 401);
  const got = await (await handleApi(req('/dashboard/api/answers', { headers: machine }), env)).json();
  assert.deepEqual(got.answers.map((a) => [a.id, a.question, a.answer]), [['q1', 'Question q1?', 'Go with option A']]);
  const done = await (await handleApi(req('/dashboard/api/answers/collect', { method: 'POST', headers: machine, body: '{"ids":["q1","zzz"]}' }), env)).json();
  assert.equal(done.collected, 1);
  assert.deepEqual((await (await handleApi(req('/dashboard/api/answers', { headers: machine }), env)).json()).answers, []);

  // Collected and missing from the next push: removed.
  await push(env, []);
  assert.equal(db.rows.size, 0);
});
