import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { overlaySupport } from '../src/support.js';
import { overlaySponsors } from '../src/sponsors.js';
import { overlayVideo } from '../src/video.js';
import { overlayMoney, overlayMarkets, usd } from '../src/money.js';
import { persistQueueDrafts, listDrafts, upsertDraft } from '../src/drafts.js';
import { revalidateSources, DEDUPE_MS } from '../src/revalidate.js';
import { upsertSnapshot, completeAction } from '../src/db.js';
import { bindModals, openDraft } from '../public/js/modals.js';
import { render as renderHome } from '../public/js/pages/home.js';
import { render as renderSupport } from '../public/js/pages/support.js';
import { render as renderSponsors } from '../public/js/pages/sponsors.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { memD1 } from './memd1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const SECRET = 'test-session-secret-32-bytes-ok!';
const now = Date.parse('2026-09-18T18:00:00Z');

function envWith(db, extra = {}) {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: '909090',
    MACHINE_TOKEN_MAC: 'mac-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    MACHINE_TOKEN_GPU2: 'gpu-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    DB: db,
    ...extra,
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

function runPy(code) {
  return spawnSync(py, ['-c', code], { encoding: 'utf8', cwd: join(root, 'collectors/lib') });
}

function supportPage(data, age = '') {
  return overlaySupport(structuredClone(snapshot.pages.support), data, now, age);
}

test('High1 overlay saveKind matches collector support.save_draft', () => {
  const page = supportPage({
    tickets: [{ uid: '1', subject: 'Hi', body: 'draft', money: false, to: 'a@x.com' }],
  });
  assert.equal(page.drafts.rows[0].saveKind, 'support.save_draft');
  const html = renderSupport(page);
  assert.match(html, /support\.save_draft/);
  assert.doesNotMatch(html, /"saveKind":"support\.save"/);
});

test('High1 collector rejects support.save and accepts support.save_draft kind name', () => {
  const r = runPy(
    'from support_mail import handle\n'
    + 'ok, msg = handle("support.save", {"uid":"1"})\n'
    + 'print(ok)\n'
    + 'print(msg)\n',
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'False');
  assert.match(lines[1], /unknown action support\.save/);
});

test('High2 send re-enables the draft Send button after act', async () => {
  const sendBtn = { dataset: { draftAct: 'send' }, disabled: false, closest() { return this; } };
  const fields = { to: { value: 'a@b.c' }, subject: { value: 's' }, body: { value: 'b' } };
  const listeners = {};
  const draft = {
    dataset: { payload: JSON.stringify({ sendKind: 'support.send', uid: '1' }) },
    querySelector(sel) {
      if (sel === '[name=to]') return fields.to;
      if (sel === '[name=subject]') return fields.subject;
      if (sel === '[name=body]') return fields.body;
      if (sel === '[data-draft-act="send"]') return sendBtn;
      return null;
    },
    addEventListener(type, fn) { listeners[type] = fn; },
    close() {},
    showModal() {},
  };
  const morning = { addEventListener() {}, querySelector() { return null; }, showModal() {} };
  const start = { addEventListener() {} };
  globalThis.document = {
    getElementById(id) {
      if (id === 'draftModal') return draft;
      if (id === 'morningModal') return morning;
      if (id === 'startMorning') return start;
      return null;
    },
  };
  globalThis.location = { hash: '#support' };
  bindModals({ say() {}, act: async () => {}, go: async () => {}, getData: () => ({}) });
  await listeners.click({ target: sendBtn });
  assert.equal(sendBtn.disabled, false);
  openDraft({ sendKind: 'support.send', uid: '2' });
  sendBtn.disabled = true;
  openDraft({ sendKind: 'support.send', uid: '2' });
  assert.equal(draft.querySelector('[data-draft-act="send"]').disabled, false);
});

test('High3 support send applies edited to, subject, and body', () => {
  const r = runPy(
    'import support_mail as sm\n'
    + 'class Box:\n'
    + '    def logout(self): pass\n'
    + 'sm._acct = lambda: ({"address":"a","smtp":"localhost"}, "pw")\n'
    + 'sm._box = lambda a, p: Box()\n'
    + 'sm._fetch_uid = lambda box, uid: {"uid": uid, "to": "imap@x.com", "subject": "Old", "body": "old"}\n'
    + 'sent = []\n'
    + 'sm.send_draft = lambda smtp, box, ticket, body=None: sent.append(dict(ticket, _body=body)) or (True, "Reply sent")\n'
    + 'ok, msg = sm.send_live({"uid":"1","to":"edit@x.com","subject":"Edited","body":"New body"})\n'
    + 'print(ok)\n'
    + 'print(sent[0]["to"])\n'
    + 'print(sent[0]["subject"])\n'
    + 'print(sent[0].get("_body") or sent[0]["body"])\n',
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'True');
  assert.equal(lines[1], 'edit@x.com');
  assert.equal(lines[2], 'Edited');
  assert.equal(lines[3], 'New body');
});

test('High3 sponsor send includes to with subject and body', () => {
  const r = runPy(
    'import sponsors\n'
    + 'got = []\n'
    + 'sponsors._req = lambda method, path, body=None, timeout=60: got.append((method, path, body)) or {}\n'
    + 'ok, msg = sponsors.handle("sponsor.send_draft", {"id":"c1","to":"a@b.c","subject":"Hi","body":"Hello"})\n'
    + 'print(ok)\n'
    + 'print(got[0][2].get("to"))\n'
    + 'print(got[0][2].get("subject"))\n'
    + 'print(got[0][2].get("body"))\n',
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'True');
  assert.equal(lines[1], 'a@b.c');
  assert.equal(lines[2], 'Hi');
  assert.equal(lines[3], 'Hello');
});

test('High4 stale support row is unverified', () => {
  const out = mergeSnapshot(structuredClone(snapshot), [{
    source: 'support',
    collected_at: '2026-09-18T16:00:00Z',
    data: JSON.stringify({ tickets: [{ uid: '1', subject: 'Hi', body: 'x', money: false }] }),
  }], now);
  assert.equal(out.pages.support.unverified, true);
});

test('High4 leftover GPU2 queue is not a live editor', () => {
  const page = structuredClone(snapshot.pages.video);
  overlayVideo(page, {
    queue: [{ id: 'e1', title: 'Old cut', status: 'queued', step: 1, steps: 5, progress: 10 }],
  });
  assert.equal(page.unverified, true);
  assert.match(page.sub, /not connected/i);
});

test('High5 health error clears after a successful pull', async () => {
  const env = { DB: memD1(), VIRALVIEW_SUMMARY_SECRET: 's' };
  let status = 502;
  const fetchFn = async () => {
    if (status === 502) return new Response('', { status: 502 });
    return new Response(JSON.stringify({ success: true, ok: true }), { status: 200 });
  };
  const first = await revalidateSources(env, { nowMs: 1_000_000, fetchFn });
  assert.equal(first.errors.viralview, 'HTTP 502');
  status = 200;
  const second = await revalidateSources(env, { nowMs: 1_000_000 + DEDUPE_MS + 1, fetchFn });
  assert.equal(second.errors.viralview, undefined);
});

test('High5 failed pull backoffs without pretending collected data is new', async () => {
  const env = { DB: memD1(), VIRALVIEW_SUMMARY_SECRET: 's' };
  const nowMs = Date.parse('2026-09-18T01:00:00Z');
  await upsertSnapshot(env.DB, 'viralview', JSON.stringify({ success: true }), '2026-09-18T00:00:00Z', '2026-09-18T00:00:00Z');
  const fetchFn = async () => new Response('', { status: 502 });
  const first = await revalidateSources(env, { nowMs, fetchFn });
  assert.equal(first.errors.viralview, 'HTTP 502');
  const row = [...env.DB.snapshots.values()].find((r) => r.source === 'viralview');
  assert.equal(row.collected_at, '2026-09-18T00:00:00Z');
  const mid = await revalidateSources(env, { nowMs: nowMs + 1000, fetchFn });
  assert.deepEqual(mid.pulled, []);
});

test('High6 origin fetch is aborted instead of hanging', async () => {
  const env = { DB: memD1(), VIRALVIEW_SUMMARY_SECRET: 's' };
  let sawSignal = false;
  const fetchFn = async (url, opts) => {
    sawSignal = Boolean(opts?.signal);
    if (!opts?.signal) return new Response(JSON.stringify({ success: true }), { status: 200 });
    await new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  const out = await revalidateSources(env, { nowMs: 1_000_000, fetchFn, timeoutMs: 20 });
  assert.equal(sawSignal, true);
  assert.ok(out.errors.viralview);
});

test('High7 CC video-projects PUT does not delete other app rows', async () => {
  const db = memD1();
  db.projects.set('yt2:keep', { id: 'yt2:keep', data: JSON.stringify({ id: 'yt2:keep', origin: 'yt2', titleOptions: ['Keep'] }), updated_at: 't0' });
  const env = envWith(db);
  const ck = await cookie();
  const put = await handleApi(req('/dashboard/api/video-projects', {
    method: 'PUT', cookie: ck, headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify([{ id: 'cc1', titleOptions: ['Dash'], selectedTitleIndex: 0, stage: 'plan' }]),
  }), env);
  assert.equal(put.status, 200);
  assert.ok(db.projects.get('yt2:keep'), 'yt2 row must survive');
  assert.ok(db.projects.get('cc1'));
});

test('GPU1 env URL does not mark upload done or start a fake job', async () => {
  const db = memD1();
  const store = new Map();
  const env = envWith(db, {
    LOOP_STUDIO_URL: 'https://studio.example',
    GPU1_VIDEO_URL: 'https://gpu1.example',
    UPLOADS: {
      async put(key, value) { store.set(key, value); },
      async get(key) { return store.has(key) ? { body: store.get(key) } : null; },
    },
  });
  const ck = await cookie();
  const created = await handleApi(req('/dashboard/api/uploads', {
    method: 'POST', cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ filename: 'take.mp4', title: 'New recording' }),
  }), env);
  const { putUrl } = await created.json();
  const put = await handleApi(req(new URL(putUrl).pathname + new URL(putUrl).search, {
    method: 'PUT', body: 'fake-bytes',
  }), env);
  const done = await put.json();
  assert.equal(done.ok, true);
  assert.equal(done.stored, true);
  assert.equal(done.editor, 'disconnected');
  assert.notEqual(done.editor, 'gpu1');
  assert.equal(db.actions.find((a) => a.kind === 'video.start_edit'), undefined);
  assert.ok(store.size > 0);
});

test('expenses omit CAD unless payload currency is present; markets keep USD quotes', () => {
  const money = overlayMoney(structuredClone(snapshot.pages.money), {
    expenses: { businessCategories: [{ name: 'Ads', total: 12.5, count: 1 }], business: {}, personal: {} },
    netWorth: { value: 10, series: [] },
  }, now, 'updated just now');
  assert.match(money.sub, /currency unspecified/);
  assert.doesNotMatch(money.sub, /\bCAD\b/);
  assert.doesNotMatch(money.sub, /bank reconcil/i);
  const cadMoney = overlayMoney(structuredClone(snapshot.pages.money), {
    currency: 'CAD',
    expenses: { businessCategories: [{ name: 'Ads', total: 12.5, count: 1 }], business: {}, personal: {} },
    netWorth: { value: 10, series: [] },
  }, now, 'updated just now');
  assert.match(cadMoney.sub, /\bCAD\b/);
  const markets = overlayMarkets(structuredClone(snapshot.pages.markets), {
    markets: { pulse: { mood: 'Calm', vix: { price: 14.9, changePct: -1 }, voo: { price: 701.89, changePct: 0.1 }, newsLevel: 'Pending' }, core: [{ label: 'VOO', price: 701.89, allTimeHigh: 710, pctOffHigh: 1, todayPct: 0.1 }] },
  }, now, 'updated just now');
  assert.match(markets.sub, /USD/);
  assert.doesNotMatch(markets.sub, /CAD/);
  assert.match(markets.sub, /quote time unavailable/);
  assert.doesNotMatch(markets.sub, /updated just now/);
  assert.doesNotMatch(markets.sub, /prior close/i);
  assert.equal(markets.tiles[3].value, 'Pending');
  assert.notEqual(markets.tiles[3].value, 'Quiet');
  assert.equal(usd(12.5, 2, 'CAD'), new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(12.5));
});

test('missing collections clears fixture sponsor money', () => {
  const page = overlaySponsors(structuredClone(snapshot.pages.sponsors), {});
  assert.equal(page.unverified, true);
  assert.notEqual(page.tiles[0].value, '$5,000');
  assert.notEqual(page.tiles[1].value, '$6,700');
});

test('bulk approve does not send without draft review', () => {
  const page = supportPage({
    tickets: [{ uid: '1', subject: 'Hi', body: 'draft', money: false }],
  });
  assert.notEqual(page.actions[0]?.kind, 'support.send_all_safe');
  const html = renderSupport(page);
  assert.doesNotMatch(html, /data-kind="support.send_all_safe"/);
});

test('ingest does not overwrite an edited draft with the same id', async () => {
  const db = memD1();
  await persistQueueDrafts(db, { queued: [{ id: 'a', platform: 'x', firstLine: 'one' }] }, '2026-09-19T17:00:00Z');
  await upsertDraft(db, {
    id: 'a', day: '2026-09-19', platform: 'X', slot: 1, body: 'edited by user',
    first_line: 'edited by user', status: 'draft',
  });
  await persistQueueDrafts(db, { queued: [{ id: 'a', platform: 'x', firstLine: 'one' }] }, '2026-09-19T17:00:00Z');
  const row = (await listDrafts(db, '2026-09-19')).find((r) => r.id === 'a');
  assert.equal(row.body, 'edited by user');
});

test('home and sponsor HTML escapes labels and titles', () => {
  const home = structuredClone(snapshot.pages.home);
  home.runThrough.steps[0].label = '<img src=x onerror=alert(1)>';
  home.runThrough.steps[0].item = 'x"><img';
  const homeHtml = renderHome(home);
  assert.doesNotMatch(homeHtml, /<img src=x onerror=alert\(1\)>/);
  assert.match(homeHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const html = renderSponsors({
    title: 'Sponsors', sub: '', actions: [], tiles: [],
    septemberBar: { title: '', meta: '', aria: '', goalAt: 0, parts: [], line: '' },
    board: { title: '', meta: '', columns: [] },
    collect: { title: '', meta: '', rows: [] },
    emails: { title: '', meta: '', rows: [{
      id: 'c1', title: '<img src=x onerror=alert(1)>', sub: '<b>Hi</b>', to: 'a@b.c', subject: 'Hi', body: 'Hello',
      saveKind: 'sponsor.save_draft', sendKind: 'sponsor.send_draft', discardKind: 'sponsor.discard_draft',
    }] },
    byMonth: { title: '', meta: '', rows: [] },
  });
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('draft send is idempotent across tabs; save is not', async () => {
  const env = envWith(memD1());
  const ck = await cookie();
  const post = (kind, idem) => handleApi(req('/dashboard/api/actions', {
    method: 'POST', cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ kind, payload: { uid: '99', id: '99' }, idemKey: idem }),
  }), env);
  assert.equal((await post('support.send', 'tab-a')).status, 200);
  assert.equal((await post('support.send', 'tab-b')).status, 200);
  assert.equal(env.DB.actions.filter((a) => a.kind === 'support.send').length, 1);
  assert.equal((await post('support.save_draft', 'save-1')).status, 200);
  assert.equal((await post('support.save_draft', 'save-2')).status, 200);
  assert.equal(env.DB.actions.filter((a) => a.kind === 'support.save_draft').length, 2);
});

test('not_sent send retries with latest body; concurrent retries stay one queued row', async () => {
  const env = envWith(memD1());
  const ck = await cookie();
  const post = (kind, payload) => handleApi(req('/dashboard/api/actions', {
    method: 'POST', cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ kind, payload }),
  }), env);
  for (const kind of ['support.send', 'sponsor.send_draft']) {
    const first = await (await post(kind, { uid: kind, id: kind, to: 'old@x.com', subject: 'Old', body: 'old' })).json();
    await completeAction(env.DB, first.id, 'failed', 'not_sent:SMTPAuthenticationError', new Date().toISOString());
    const edited = { uid: kind, id: kind, to: 'new@x.com', subject: 'Edited', body: 'New body' };
    const [a, b] = await Promise.all([post(kind, edited).then((r) => r.json()), post(kind, edited).then((r) => r.json())]);
    const rows = env.DB.actions.filter((x) => x.kind === kind);
    assert.equal(rows.length, 1);
    assert.equal(a.id, first.id);
    assert.equal(b.id, first.id);
    assert.equal(a.status, 'queued');
    assert.equal(b.status, 'queued');
    assert.equal(a.result, null);
    const payload = JSON.parse(rows[0].payload);
    assert.equal(payload.to, 'new@x.com');
    assert.equal(payload.subject, 'Edited');
    assert.equal(payload.body, 'New body');
    const third = await (await post(kind, { ...edited, body: 'should not replace while queued' })).json();
    assert.equal(third.id, first.id);
    assert.equal(third.status, 'queued');
    assert.equal(JSON.parse(rows[0].payload).body, 'New body');
  }
});

test('uncertain delivery does not retry and asks for reconcile', async () => {
  const env = envWith(memD1());
  const ck = await cookie();
  const post = (payload) => handleApi(req('/dashboard/api/actions', {
    method: 'POST', cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ kind: 'support.send', payload }),
  }), env);
  const first = await (await post({ uid: 'u1', to: 'a@b.c', subject: 'Hi', body: 'old' })).json();
  await completeAction(env.DB, first.id, 'failed', 'unknown:SMTPServerDisconnected', new Date().toISOString());
  const second = await (await post({ uid: 'u1', to: 'a@b.c', subject: 'Hi', body: 'retry' })).json();
  assert.equal(second.id, first.id);
  assert.equal(second.status, 'failed');
  assert.equal(second.needReconcile, true);
  assert.equal(env.DB.actions.filter((a) => a.kind === 'support.send').length, 1);
  assert.equal(JSON.parse(env.DB.actions[0].payload).body, 'old');
});

test('collector marks SMTP auth as not_sent and post-accept IMAP failure as unknown', () => {
  const r = runPy(
    'import smtplib\n'
    + 'import support_mail as sm\n'
    + 'class Box:\n'
    + '    def uid(self, *a, **k): raise RuntimeError("imap")\n'
    + '    def expunge(self): pass\n'
    + 'ok, msg = sm.send_draft(lambda m: (_ for _ in ()).throw(smtplib.SMTPAuthenticationError(535, b"no")), Box(), {"uid":"1"})\n'
    + 'print(ok)\n'
    + 'print(msg)\n'
    + 'ok2, msg2 = sm.send_draft(lambda m: None, Box(), {"uid":"1"})\n'
    + 'print(ok2)\n'
    + 'print(msg2)\n'
    + 'ok3, msg3 = sm.send_draft(lambda m: (_ for _ in ()).throw(smtplib.SMTPServerDisconnected("gone")), Box(), {"uid":"1"})\n'
    + 'print(ok3)\n'
    + 'print(msg3)\n',
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'False');
  assert.equal(lines[1], 'not_sent:SMTPAuthenticationError');
  assert.equal(lines[2], 'False');
  assert.equal(lines[3], 'unknown:RuntimeError');
  assert.equal(lines[4], 'False');
  assert.equal(lines[5], 'unknown:SMTPServerDisconnected');
});

test('sponsor send 4xx is not_sent and 5xx is unknown', () => {
  const r = runPy(
    'import sponsors, urllib.error\n'
    + 'from io import BytesIO\n'
    + 'def boom(code):\n'
    + '    raise urllib.error.HTTPError("http://x", code, "x", hdrs=None, fp=BytesIO())\n'
    + 'sponsors._req = lambda *a, **k: boom(404)\n'
    + 'ok, msg = sponsors.handle("sponsor.send_draft", {"id":"c1","to":"a@b.c","subject":"Hi","body":"Hello"})\n'
    + 'print(ok); print(msg)\n'
    + 'sponsors._req = lambda *a, **k: boom(500)\n'
    + 'ok, msg = sponsors.handle("sponsor.send_draft", {"id":"c1","to":"a@b.c","subject":"Hi","body":"Hello"})\n'
    + 'print(ok); print(msg)\n',
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'False');
  assert.equal(lines[1], 'not_sent:http 404');
  assert.equal(lines[2], 'False');
  assert.equal(lines[3], 'unknown:http 500');
});
