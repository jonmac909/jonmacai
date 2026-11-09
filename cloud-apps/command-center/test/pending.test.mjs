import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { buildPending, pendingData } from '../src/pending.js';

// Dashboard 2 Pending: the cards marked as Jon's ask, grouped, read only. The page imports /dashboard/js/* by absolute URL.
const pub = new URL('../public/', import.meta.url);
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith('/dashboard/js/') ? new URL(spec.slice('/dashboard/'.length), pub).href : spec, ctx) });
const { render } = await import('../public/d2/js/pages/pending.js');

const NOW = Date.parse('2026-11-09T22:00:00Z'); // Mon Nov 9, 2:00 PM in Kelowna
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
let n = 0;
const card = (db, t) => {
  const row = { id: `t_${String(++n).padStart(16, '0')}`, owner: 'developer', status: 'doing', created_by: 'ana', updated_by: 'ana', created_at: '2026-11-09T01:00:00Z', updated_at: '2026-11-09T21:00:00Z', ...t };
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO bot_tasks (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
  return row.id;
};

function seed() {
  const db = sqliteD1();
  card(db, { title: "Jon's ask: Dashboard 2 at jonmac.ai/dashboard-2", status: 'done', due: '2026-11-09', done_at: '2026-11-09T20:00:00Z', updated_at: '2026-11-09T20:00:00Z' });
  card(db, { title: 'Team watchdog (Jon’s ask)', status: 'done', done_at: '2026-11-08T20:00:00Z', updated_at: '2026-11-08T20:00:00Z' });
  card(db, { title: "Jon's ask: look check blocks QC", owner: 'moneyclaw', status: 'review', due: '2026-11-13' });
  card(db, { title: "Jon's ask: late one", owner: 'ana', status: 'todo', due: '2026-11-08' });
  card(db, { title: "Jon's ask: no due", owner: 'qc', status: 'qc' });
  card(db, { title: "Jon's ask: webinar seat email", owner: 'moneyclaw', status: 'waiting_on_jon', due: '2026-11-10', note: 'What happened:\n- Built\nYour move:\n- Pick the sender address D:\\AgentTeam\\x\\y.txt\nNext:\n- Send' });
  const asked = card(db, { title: "Jon's ask: price page", owner: 'home-guide-press', status: 'doing', due: '2026-11-12' });
  db.sqlite.prepare("INSERT INTO bot_questions (id, asked_by, project, question, options, status, task_id, created_at, updated_at) VALUES ('q_1', 'home-guide-press', 'home-guide-press', 'Which price?', '[]', 'open', ?, '2026-11-09T20:00:00Z', '2026-11-09T20:00:00Z')").run(asked);
  card(db, { title: "Jon's ask: source download", owner: 'viral-view', status: 'todo', due: '2026-11-13', note: 'What happened:\n- Tried\nBlocked: needs Lucy to open the YouTube source route\nNext:\n- Retry' });
  card(db, { title: "Jon's ask: dropped", status: 'cancelled' });
  card(db, { title: 'Ordinary card, nobody asked', status: 'doing' });
  card(db, { title: 'Jonas ask: not a match', status: 'doing' });
  return db;
}
const titles = (list) => list.map((r) => r.title);

test("Pending groups only the cards marked as Jon's ask: Done, In progress, Blocked", async () => {
  const p = buildPending(await pendingData(seed()), NOW);
  assert.deepEqual(titles(p.done), ["Jon's ask: Dashboard 2 at jonmac.ai/dashboard-2", 'Team watchdog (Jon’s ask)'], 'newest first; curly apostrophe counts; cancelled and unmarked cards are out');
  assert.deepEqual(titles(p.progress), ["Jon's ask: late one", "Jon's ask: look check blocks QC", "Jon's ask: no due"], 'by due day, no due last');
  assert.deepEqual(titles(p.blocked), ["Jon's ask: webinar seat email", "Jon's ask: price page", "Jon's ask: source download"]);
  const [done] = p.done;
  assert.deepEqual([done.owner, done.status, done.due.label, done.due.late, done.updated.label], ['Lucy', { text: 'Done', cls: 'ok' }, 'Due Nov 9', false, 'Done 2 hr ago']);
  const [late, review, none] = p.progress;
  assert.deepEqual([late.owner, late.status.text, late.due.label, late.due.late], ['Ana', 'Not started', 'Due Nov 8', true]);
  assert.deepEqual([review.owner, review.status.text, review.due.late, none.due.label, none.status.text], ['Mila', 'In Review', false, 'No due time set', 'In QC']);
  const [seat, price, source] = p.blocked;
  assert.deepEqual([seat.needs, seat.from], ['Pick the sender address y.txt', 'You']);
  assert.deepEqual([price.needs, price.from, price.status.text], ['Your answer to "Which price?"', 'You', 'Blocked']);
  assert.deepEqual([source.needs, source.from], ['needs Lucy to open the YouTube source route', 'Lucy']);
});

test('Pending page: ticks on done rows, what each blocked row needs and from whom, no raw ids or paths', async () => {
  const html = render({ pending: buildPending(await pendingData(seed()), NOW), d2: {} });
  const t = text(html);
  assert.match(html, /^<div class="wrap/);
  assert.equal((html.match(/<span class="d2mark ok"[^>]*>✓<\/span>/g) || []).length, 2, 'both done rows are ticked');
  assert.equal((html.match(/<span class="d2mark "[^>]*>○<\/span>/g) || []).length, 6, 'the rest are not');
  assert.match(t, /Needs from you: Pick the sender address y\.txt/);
  assert.match(t, /Needs from Lucy: needs Lucy to open the YouTube source route/);
  assert.match(t, /Lucy Due Nov 9 Done 2 hr ago/);
  assert.match(t, /Ana Due Nov 8 Late Updated 1 hr ago/);
  assert.doesNotMatch(t, /\bt_\d{16}\b|[A-Za-z]:\\|undefined|NaN|\[object Object\]/);
  assert.ok(html.indexOf('>Done<') < html.indexOf('>In progress<') && html.indexOf('>In progress<') < html.indexOf('>Blocked<'));
  assert.equal((html.match(/data-open="t_/g) || []).length, 8, 'every row opens its card');
});

test('Pending page with nothing, or when the cards could not be read, says so and never throws', async () => {
  const empty = render({ pending: buildPending(await pendingData(sqliteD1()), NOW), d2: {} });
  assert.match(text(empty), /Nothing done yet\. .*Nothing in progress\. .*Nothing is blocked\./);
  for (const d of [undefined, {}, { pending: null }]) assert.match(text(render(d)), /could not be read/);
  const broken = sqliteD1();
  broken.sqlite.exec('DROP TABLE bot_questions');
  assert.equal(await pendingData(broken), null);
  assert.equal(await pendingData(undefined), null);
});

test('/dashboard/api/d2 carries pending, and answers with pending null when it has no database', async () => {
  const SECRET = 'test-session-secret-32-bytes-ok!';
  const get = async (env) => {
    const real = Date.now;
    Date.now = () => NOW;
    try {
      const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
      const res = await handleApi(new Request('https://jonmac.ai/dashboard/api/d2', { headers: { Cookie: cookie } }), env);
      assert.equal(res.status, 200);
      return res.json();
    } finally { Date.now = real; }
  };
  const body = await get({ DB: seed(), SESSION_SECRET: SECRET });
  assert.deepEqual([body.pending.done.length, body.pending.progress.length, body.pending.blocked.length], [2, 3, 3]);
  assert.equal((await get({ SESSION_SECRET: SECRET })).pending, null);
});

test('Pending is in the Dashboard 2 nav and the page router', () => {
  const html = readFileSync(new URL('../public/d2/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button class="nav" data-page="pending" title="Pending">/);
  assert.match(readFileSync(new URL('../public/d2/js/app.js', import.meta.url), 'utf8'), /const pages = \{[^}]*\bpending\b[^}]*\}/);
});
