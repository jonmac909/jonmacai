// Guide site (src/guides.js): /guides, /lab, /go/skool, download, publish, the flagged /s/ switch and the CASL guard on the sequence.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { SKOOL_ABOUT, md } from '../src/guides.js';
import { runSequence } from '../src/skoolseq.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const TOKEN = 'guides-publish-token-for-tests-0123456789';
const T0 = Date.parse('2026-11-20T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

function fakeR2() {
  const m = new Map();
  return {
    m,
    async put(k, v) { m.set(k, new Uint8Array(v)); },
    async get(k) { return m.has(k) ? { body: m.get(k) } : null; },
    async head(k) { return m.has(k) ? { key: k } : null; },
  };
}
const mkenv = (extra = {}) => ({ DB: sqliteD1(), UPLOADS: fakeR2(), SESSION_SECRET: 'test-session-secret-32-bytes-ok!', GUIDES_PUBLISH_TOKEN: TOKEN, ...extra });

async function go(e, path, { method = 'GET', headers = {}, body, form } = {}) {
  const h = new Headers(headers);
  let b;
  if (form) b = new URLSearchParams(form), h.set('Content-Type', 'application/x-www-form-urlencoded');
  else if (body !== undefined) b = JSON.stringify(body), h.set('Content-Type', 'application/json');
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: b, redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const FILE_TEXT = 'the prompt pack\n';
const guide = (over = {}) => ({
  title: 'Stop chatting with Claude', state: 'unlisted', updated: '2026-11-23', youtube_id: null,
  summary: ['Three prompts that work'], topic: ['claude'],
  sections: [{ heading: 'Step one', body_md: 'Do **this** first.' }],
  resource: { title: 'Prompt pack', type: 'file', files: ['resource/pack.txt'] },
  ...over,
});
const publish = (e, slug, g, auth = `Bearer ${TOKEN}`) => go(e, `/guides/api/${slug}`, {
  method: 'PUT', headers: auth ? { Authorization: auth } : {},
  body: { guide: g, files: { 'resource/pack.txt': Buffer.from(FILE_TEXT).toString('base64') } },
});
const rows = async (e, sql, ...a) => (await e.DB.prepare(sql).bind(...a).all()).results;

test('/go/skool counts the click with its button and 302s to the Skool about page; ?qc counts nothing', async () => {
  const e = mkenv();
  const r = await go(e, '/go/skool?from=my-vid&pos=rail');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Location'), SKOOL_ABOUT);
  assert.equal(SKOOL_ABOUT, 'https://www.skool.com/ai-ugc/about');
  assert.deepEqual(await rows(e, 'SELECT slug, kind, pos FROM guide_events'), [{ slug: 'my-vid', kind: 'skool', pos: 'rail' }]);
  await go(e, '/go/skool?from=my-vid&pos=rail&qc=1');
  await go(e, '/go/skool?pos=evil');
  assert.deepEqual(await rows(e, 'SELECT slug, kind, pos FROM guide_events ORDER BY id'), [
    { slug: 'my-vid', kind: 'skool', pos: 'rail' }, { slug: null, kind: 'skool', pos: 'other' }]);
});

test('publish needs the right token: none or a wrong one is 401 and stores nothing', async () => {
  const e = mkenv();
  assert.equal((await publish(e, 'my-vid', guide(), null)).status, 401);
  assert.equal((await publish(e, 'my-vid', guide(), `Bearer ${TOKEN}x`)).status, 401);
  assert.equal((await publish(e, 'my-vid', guide(), 'Bearer short')).status, 401);
  assert.equal((await publish(mkenv({ GUIDES_PUBLISH_TOKEN: 'short' }), 'my-vid', guide(), 'Bearer short')).status, 401);
  assert.deepEqual(await rows(e, 'SELECT slug FROM guides'), []);
  assert.equal(e.UPLOADS.m.size, 0);
  const ok = await publish(e, 'my-vid', guide());
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.deepEqual(await rows(e, 'SELECT slug, state FROM guides'), [{ slug: 'my-vid', state: 'unlisted' }]);
  assert.equal((await publish(e, 'my-vid', guide(), null)).status, 401);
});

test('publish refuses traversal paths', async () => {
  const e = mkenv();
  const r = await go(e, '/guides/api/my-vid', { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` },
    body: { guide: guide(), files: { 'resource/../../x.txt': 'eA==' } } });
  assert.equal(r.status, 400);
  const r2 = await publish(e, 'my-vid', guide({ resource: { files: ['resource/../secret.txt'] } }));
  assert.equal(r2.status, 400);
  assert.equal(e.UPLOADS.m.size, 0);
});

test('an unlisted guide is live but noindex and absent from /guides; a listed one is indexed and listed', async () => {
  const e = mkenv();
  await publish(e, 'hidden-one', guide({ title: 'Hidden guide' }));
  await publish(e, 'open-one', guide({ title: 'Open guide', state: 'listed' }));
  const h = await go(e, '/guides/hidden-one');
  assert.equal(h.status, 200);
  const hb = await h.text();
  assert.match(hb, /<meta name="robots" content="noindex">/);
  assert.equal(h.headers.get('X-Robots-Tag'), 'noindex');
  const o = await go(e, '/guides/open-one');
  assert.doesNotMatch(await o.text(), /name="robots"/);
  assert.equal(o.headers.get('X-Robots-Tag'), null);
  const idx = await (await go(e, '/guides')).text();
  assert.match(idx, /Open guide/);
  assert.doesNotMatch(idx, /Hidden guide|hidden-one/);
  const lab = await (await go(e, '/lab')).text();
  assert.doesNotMatch(lab, /Hidden guide/);
  assert.match(lab, /<h1>Master AI video with Claude \+ all my skills, prompts and files\. Only \$9\. 👉 skool\.com\/ai-ugc<\/h1>/);
  assert.doesNotMatch(lab, /one line, same on/);
  assert.match(lab, /\[JON: higher tier name and price\]/);
  assert.equal((await go(e, '/guides/nope-none')).status, 404);
});

test('download: stores the email with its consent flags, joins skool_leads, returns the file', async () => {
  const e = mkenv();
  await publish(e, 'my-vid', guide());
  const no = await go(e, '/guides/my-vid/download', { method: 'POST', form: { email: 'sam@gmail.com', file: '0' } });
  assert.equal(no.status, 400); // no Terms tick
  const r = await go(e, '/guides/my-vid/download', { method: 'POST', form: { email: 'Sam@Gmail.com', terms: '1', file: '0' } });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), FILE_TEXT);
  assert.match(r.headers.get('Content-Disposition'), /filename="pack.txt"/);
  assert.match(r.headers.get('Set-Cookie'), /jm_email=sam%40gmail.com/);
  assert.deepEqual(await rows(e, 'SELECT slug, email, newsletter, terms, file FROM guide_emails'),
    [{ slug: 'my-vid', email: 'sam@gmail.com', newsletter: 0, terms: 1, file: 'resource/pack.txt' }]);
  assert.deepEqual((await rows(e, 'SELECT slug, email FROM skool_leads')), [{ slug: 'my-vid', email: 'sam@gmail.com' }]);
  assert.deepEqual(await rows(e, "SELECT kind FROM guide_events WHERE kind = 'download'"), [{ kind: 'download' }]);
});

test('guide data is escaped everywhere; markdown escapes first; images cannot leave the guide folder', async () => {
  const e = mkenv();
  const bad = '<script>alert(1)</script>';
  await publish(e, 'xss-one', guide({ state: 'listed', title: `T ${bad}`, summary: [`S ${bad}`], topic: ['claude'],
    sections: [{ heading: `H ${bad}`, body_md: `B ${bad} [x](javascript:alert(1)) [y](/ok"onmouseover="z) ![a](img/../../etc)` }],
    faq: [{ q: `Q ${bad}`, a: `A ${bad}` }], checklist: [`C ${bad}`], closing: { headline: `CH ${bad}`, line: `CL ${bad}` } }));
  for (const p of ['/guides/xss-one', '/guides', '/lab']) {
    const b = await (await go(e, p)).text();
    assert.doesNotMatch(b, /<script>alert/, p);
  }
  const b = await (await go(e, '/guides/xss-one')).text();
  assert.doesNotMatch(b, /href="javascript:/);
  assert.doesNotMatch(b, /"onmouseover="/);
  assert.doesNotMatch(b, /src="\/guides\/xss-one\/img\/\.\./);
  assert.equal(md('<b>x</b>'), '<p>&lt;b&gt;x&lt;/b&gt;</p>');
  assert.equal((await go(e, '/guides/xss-one/img/..%2f..%2fx.png')).status, 404);
});

test('/s/ with the switch off or unset is exactly what it was; on, it shows the guide (or /lab when none)', async () => {
  const seed = async (e) => {
    await e.DB.prepare('INSERT INTO skool_links (slug, title, created_at, capture) VALUES (?, ?, ?, ?)').bind('my-vid', 'My video', iso(T0), 0).run();
    await e.DB.prepare('INSERT INTO skool_links (slug, title, created_at, capture) VALUES (?, ?, ?, ?)').bind('box-vid', 'Box video', iso(T0), 1).run();
    await e.DB.prepare('INSERT INTO skool_links (slug, title, created_at, capture) VALUES (?, ?, ?, ?)').bind('bare-vid', 'Bare', iso(T0), 0).run();
    await publish(e, 'my-vid', guide({ title: 'The my-vid guide' }));
  };
  const snap = async (e, p) => { const r = await go(e, p); return { s: r.status, loc: r.headers.get('Location'), body: await r.text() }; };
  for (const p of ['/s/my-vid', '/s/box-vid', '/my-vid']) {
    const a = mkenv(); await seed(a);
    const b = mkenv({ GUIDES_S_SWITCH: 'off' }); await seed(b);
    const x = await snap(a, p), y = await snap(b, p);
    assert.deepEqual(y, x, p);
    assert.doesNotMatch(x.body, /The my-vid guide/);
  }
  const plain = mkenv(); await seed(plain);
  assert.equal((await go(plain, '/s/my-vid')).status, 302);
  const on = mkenv({ GUIDES_S_SWITCH: 'on' }); await seed(on);
  const g = await go(on, '/s/my-vid');
  assert.equal(g.status, 200);
  assert.match(await g.text(), /The my-vid guide/);
  assert.equal((await rows(on, "SELECT COUNT(*) AS n FROM skool_clicks WHERE slug = 'my-vid'"))[0].n, 1);
  const lab = await go(on, '/s/bare-vid');
  assert.equal(lab.status, 200);
  assert.match(await lab.text(), /Curriculum/);
});

test('CASL: a download-only lead without the newsletter tick never enters the sequence; with the tick it does', async () => {
  const e = mkenv({ RESEND_API_KEY: 're_test_key', SKOOL_ADDRESS: '1 Test Street, Kelowna BC' });
  await e.DB.prepare("INSERT INTO skool_settings (key, value, updated_at) VALUES ('skool_sequence_on', '1', ?)").bind(iso(T0)).run();
  const lead = async (email, slug, newsletter) => {
    await e.DB.prepare('INSERT INTO skool_leads (slug, email, at, last_at, email_check) VALUES (?, ?, ?, ?, ?)').bind(slug, email, iso(T0), iso(T0), 'valid').run();
    if (newsletter != null) await e.DB.prepare('INSERT INTO guide_emails (slug, email, newsletter, terms, file, at) VALUES (?, ?, ?, 1, ?, ?)').bind(slug, email, newsletter, 'resource/pack.txt', iso(T0)).run();
  };
  await lead('quiet@gmail.com', 'my-vid', 0);
  await lead('yes@gmail.com', 'my-vid', 1);
  await lead('capture@gmail.com', 'other-vid', null); // the /s/ email box, as today
  const to = [];
  const fx = async (url, init) => { to.push(...JSON.parse(init.body).to); return new Response(JSON.stringify({ id: `re-${to.length}` }), { status: 200 }); };
  await runSequence(e, T0 + 60e3, fx);
  assert.deepEqual(to.sort(), ['capture@gmail.com', 'yes@gmail.com']);
});
