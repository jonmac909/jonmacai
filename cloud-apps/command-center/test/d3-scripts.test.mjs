// Dashboard 3 Scripts page: API part (d3.scripts) and page render.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderScripts } from '../public/d3/js/scripts.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-10T19:00:00Z');
const H = (h) => new Date(NOW - h * 3600000).toISOString();
const ins = (db, table, row) => {
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
};
const d3Of = async (db) => {
  const real = Date.now;
  Date.now = () => NOW;
  try {
    const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
    return await (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: cookie } }), { DB: db, SESSION_SECRET: SECRET })).json();
  } finally { Date.now = real; }
};

function scriptsDb() {
  const db = sqliteD1();
  const t = (id, title, status, at, extra = {}) => ins(db, 'bot_tasks', { id, title, owner: 'jonmacai', project: 'jonmacai', status, created_by: 'ana', updated_by: 'ana', created_at: at, updated_at: at, ...extra });
  const doc = (n) => `https://docs.google.com/document/d/${n}/edit`;
  t('s1', 'Edit Nov 2 @JonMacAI video: Make AI UGC Real', 'waiting_on_jon', H(200), { note: `Your move\n- Record it. Script Doc: [UGC script](${doc('AAA')})` });
  t('s2', 'GPT-6 Astra Ads (No Camera) - @JonMacAI', 'waiting_on_jon', H(50), { note: `Script Doc: [Astra](${doc('BBB')}) and https://docs.google.com/document/d/ZZZ/edit` });
  t('s3', 'Rebuild Any Winning Ad - @JonMacAI', 'review', H(40), { note: 'Read Doc ready.' }); // Doc only on a proof
  t('s4', 'No Doc yet - @JonMacAI (record + pack)', 'doing', H(30), { note: 'Writing.' }); // trailing note in the title
  t('s12', 'Get 3 edit packs ready for the first @JonMacAI videos (Nov 2) and hand them to Video Editor', 'doing', H(29)); // not a video card
  t('s5', 'Edited one - @JonMacAI', 'doing', H(20), { stage: 'edit', note: `Script Doc: [x](${doc('CCC')})` }); // past recording
  t('s6', 'A-roll in - @JonMacAI', 'doing', H(10), { note: `Script Doc: [y](${doc('DDD')})` });
  t('s7', 'TEAM (Olivia, QC): Rebuild Any Winning Ad - @JonMacAI', 'waiting_on_jon', H(5)); // QC helper card
  t('s8', 'AI UGC batch week of Nov 9: 3 scripts + packaging', 'waiting_on_jon', H(4)); // not a video card
  t('s13', 'TEAM: How to Sell AI UGC Ads for $500 (Step by Step Guide) - @JonMacAI', 'review', H(4.5)); // QC helper card
  t('s14', 'Team: lower case helper – @JonMacAI', 'review', H(4.6)); // QC helper card, en dash
  t('s15', 'Packed before recording – @JonMacAI', 'doing', H(0.5), { stage: 'pack' }); // en dash; pack is not past recording
  t('s9', 'Finished - @JonMacAI', 'done', H(3)); // closed
  t('s10', 'Other channel - @JonMacAI', 'doing', H(2), { project: 'jonmac' }); // other project
  t('s11', 'Waiting in a-roll - @JonMacAI', 'doing', H(1), { stage: 'a-roll' }); // recording stage itself: To record
  const proof = (id, task, kind, link, status, note) => ins(db, 'bot_proofs', { id, task_id: task, kind, link, note, status, created_by: 'x', created_at: H(1) });
  proof('p1', 's3', 'url', doc('OLD'), 'failed', 'Read Doc for Jon');
  proof('p2', 's3', 'url', doc('EEE'), 'passed', 'Read Doc for Jon');
  proof('p3', 's1', 'render', 'C:\\x\\draft.mp4', 'failed', "DRAFT: footage 41%, waiting on Jon's a-roll"); // failed QC: not recorded
  proof('p4', 's6', 'render', 'https://x/aroll.mp4', 'passed', 'Jon A-roll received, 24 min');
  proof('p5', 's4', 'url', 'https://evil.example/docs.google.com/x', 'passed', 'not a Doc');
  proof('p6', 's2', 'render', 'https://x/thumb.jpg', 'pending', 'raw footage check'); // not passed yet: not recorded
  proof('p7', 's2', 'render', 'https://x/draft.mp4', 'passed', "footage 41%, waiting on Jon's 6 studio takes"); // waiting: not recorded
  return db;
}

test('GET /dashboard/api/d3: 401 without a session', async () => {
  assert.equal((await handleApi(new Request('https://jonmac.ai/dashboard/api/d3'), { SESSION_SECRET: SECRET })).status, 401);
});

test('d3.scripts: open @JonMacAI video cards, newest first, Doc from note then proof, Recorded rule', async () => {
  const S = (await d3Of(scriptsDb())).d3.scripts;
  assert.deepEqual(S.map((s) => [s.id, s.status]), [['s15', 'To record'], ['s11', 'To record'], ['s6', 'Recorded'], ['s5', 'Recorded'], ['s4', 'To record'],
    ['s3', 'To record'], ['s2', 'To record'], ['s1', 'To record']]);
  const by = Object.fromEntries(S.map((s) => [s.id, s]));
  assert.equal(by.s1.doc, 'https://docs.google.com/document/d/AAA/edit');
  assert.equal(by.s2.doc, 'https://docs.google.com/document/d/BBB/edit'); // first link in the note
  assert.equal(by.s3.doc, 'https://docs.google.com/document/d/EEE/edit'); // passed proof before failed
  assert.equal(by.s4.doc, null);
  assert.equal(by.s1.title, 'Edit Nov 2 @JonMacAI video: Make AI UGC Real');
  assert.equal(by.s1.at, H(200));
  const db = scriptsDb();
  db.sqlite.exec('DROP TABLE bot_tasks');
  assert.equal((await d3Of(db)).d3.scripts, null);
});

test('Scripts page: Doc links open in a new tab, No Doc, status pills, escaped, rail link, No feed', async () => {
  const body = await d3Of(scriptsDb());
  body.d3.scripts.push({ id: 'x', title: '<b>bad</b>', at: H(1), doc: 'javascript:alert(1)', status: 'To record' });
  const html = renderScripts(null, body);
  assert.match(html, /<h1>Scripts<\/h1>/);
  assert.match(html, /7 to record/);
  assert.equal((html.match(/class="scrow/g) || []).length, 9);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer">Open script/g) || []).length, 5);
  assert.match(html, /href="https:\/\/docs\.google\.com\/document\/d\/AAA\/edit"/);
  assert.equal((html.match(/class="nf">No Doc/g) || []).length, 4);
  assert.doesNotMatch(html, /javascript:|<b>bad/);
  assert.match(html, /&lt;b&gt;bad/);
  assert.equal((html.match(/pill ok">Recorded/g) || []).length, 2);
  assert.ok(html.indexOf('data-script="s6"') < html.indexOf('data-script="s1"'));
  const none = renderScripts(null, { d3: { scripts: null } });
  assert.match(none, /No feed: the dashboard cards could not be read/);
  assert.doesNotMatch(none, /NaN|undefined/);
  const empty = renderScripts(null, { d3: { scripts: [] } });
  assert.match(empty, /No open @JonMacAI video cards/);
  const index = readFileSync(new URL('../public/d3/index.html', import.meta.url), 'utf8');
  assert.match(index, /<a href="#scripts" data-nav="scripts">/);
  const app = readFileSync(new URL('../public/d3/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /scripts: renderScripts/);
});
