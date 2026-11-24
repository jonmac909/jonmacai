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
  assert.match(lab, /Premium: \$39 \/ month/);
  assert.equal((await go(e, '/guides/nope-none')).status, 404);
});

test('download: stores the email with its consent flags, joins skool_leads, returns the file', async () => {
  const e = mkenv();
  await publish(e, 'my-vid', guide());
  const no = await go(e, '/guides/my-vid/download', { method: 'POST', form: { email: 'sam@gmail.com', file: '0' } });
  assert.equal(no.status, 400); // no Privacy tick
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

test('CASL: guide-page emails (download with or without the newsletter tick) never enter the sequence; /s/ email-box leads do', async () => {
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
  assert.deepEqual(to.sort(), ['capture@gmail.com']);
});

test('CASL: the footer newsletter box stores newsletter consent only and never enters the sequence; an older /s/ lead still does', async () => {
  const e = mkenv({ RESEND_API_KEY: 're_test_key', SKOOL_ADDRESS: '1 Test Street, Kelowna BC' });
  await e.DB.prepare("INSERT INTO skool_settings (key, value, updated_at) VALUES ('skool_sequence_on', '1', ?)").bind(iso(T0)).run();
  await publish(e, 'my-vid', guide());
  const r = await go(e, '/guides/newsletter', { method: 'POST', headers: { 'X-Guide-JS': '1' }, form: { email: 'reader@gmail.com', from: 'my-vid' } });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await rows(e, 'SELECT slug, email, newsletter, terms FROM guide_emails'), [{ slug: 'my-vid', email: 'reader@gmail.com', newsletter: 1, terms: 0 }]);
  await go(e, '/guides/my-vid/download', { method: 'POST', form: { email: 'both@gmail.com', terms: '1', newsletter: '1', file: '0' } });
  // An /s/ email-box lead made before the same person downloaded from that guide keeps its sequence.
  await e.DB.prepare('INSERT INTO skool_leads (slug, email, at, last_at, email_check) VALUES (?, ?, ?, ?, ?)').bind('my-vid', 'early@gmail.com', iso(Date.now() - 3600e3), iso(Date.now() - 3600e3), 'valid').run();
  await go(e, '/guides/my-vid/download', { method: 'POST', form: { email: 'early@gmail.com', terms: '1', file: '0' } });
  await e.DB.prepare("UPDATE skool_leads SET email_check = 'valid'").run();
  const to = [];
  const fx = async (url, init) => { to.push(...JSON.parse(init.body).to); return new Response(JSON.stringify({ id: `re-${to.length}` }), { status: 200 }); };
  await runSequence(e, Date.now() + 60e3, fx);
  assert.deepEqual(to, ['early@gmail.com']);
  assert.match(await (await go(e, '/guides/my-vid')).text(), /New guides by email[\s\S]*One email when a new guide is out/);
});

test('one-click remembered download: works only for an email that already ticked the Privacy box, and never adds newsletter consent', async () => {
  const e = mkenv();
  await publish(e, 'my-vid', guide());
  const cold = await go(e, '/guides/my-vid/download', { method: 'POST', headers: { 'X-Guide-JS': '1', Cookie: 'jm_email=new%40gmail.com' }, form: { remembered: '1', file: '0' } });
  assert.equal(cold.status, 400);
  assert.equal((await cold.json()).need, 'terms');
  await go(e, '/guides/my-vid/download', { method: 'POST', form: { email: 'sam@gmail.com', terms: '1', file: '0' } });
  const one = await go(e, '/guides/my-vid/download', { method: 'POST', headers: { 'X-Guide-JS': '1', Cookie: 'jm_email=sam%40gmail.com' }, form: { remembered: '1', newsletter: '1', file: '0' } });
  assert.equal(one.status, 200);
  assert.equal(await one.text(), FILE_TEXT);
  assert.deepEqual(await rows(e, 'SELECT email, newsletter, terms FROM guide_emails ORDER BY id'), [
    { email: 'sam@gmail.com', newsletter: 0, terms: 1 }, { email: 'sam@gmail.com', newsletter: 0, terms: 1 }]);
});

test('publish: caps body, file count and file size, and a rejected publish writes nothing to R2', async () => {
  const e = mkenv();
  const put = (files, g = guide()) => go(e, '/guides/api/my-vid', { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}` }, body: { guide: g, files } });
  const pack = Buffer.from(FILE_TEXT).toString('base64');
  // the referenced resource is missing: nothing uploaded, not even the image that was sent
  const miss = await put({ 'img/a.png': 'eA==' }, guide({ sections: [{ heading: 'H', body_md: 'b', image: 'img/a.png' }] }));
  assert.equal(miss.status, 400);
  assert.deepEqual((await miss.json()).missing, ['resource/pack.txt']);
  assert.equal(e.UPLOADS.m.size, 0);
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`img/f${i}.png`, 'eA==']));
  assert.equal((await put({ ...many, 'resource/pack.txt': pack })).status, 400);
  assert.equal((await put({ 'resource/pack.txt': Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') })).status, 413);
  assert.equal((await put({ 'resource/pack.txt': Buffer.alloc(20 * 1024 * 1024).toString('base64') })).status, 413); // body over 25 MB
  assert.equal(e.UPLOADS.m.size, 0);
  assert.deepEqual(await rows(e, 'SELECT slug FROM guides'), []);
  assert.equal((await put({ 'resource/pack.txt': pack })).status, 200);
  assert.equal((await put({}, guide({ title: 'Again' }))).status, 200); // files already in R2 from the last publish still count
});

test('markdown links: protocol-relative and backslash hosts are refused; http(s), mailto, /path and #anchor work', () => {
  const h = md('[a](//evil.com/x) [b](/\\evil.com) [c](https://ok.com) [d](mailto:a@b.co) [e](/guides/x) [f](#top)');
  assert.doesNotMatch(h, /href="\/\/|href="\/\\/);
  for (const x of ['https://ok.com', 'mailto:a@b.co', '/guides/x', '#top']) assert.ok(h.includes(`href="${x}"`), x);
});

test('download button says "Unlock the resource"; stats without a database is a clean 503', async () => {
  const e = mkenv();
  await publish(e, 'my-vid', guide());
  assert.match(await (await go(e, '/guides/my-vid')).text(), /<summary class="btn dark">Unlock the resource<\/summary>/);
  const r = await go({ ...e, DB: undefined }, '/guides/api/my-vid/stats', { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 503);
  assert.match(r.headers.get('Content-Type'), /application\/json/);
  assert.ok((await r.json()).error);
});

test('channel: optional, only jonmacai or jon-mac; label on the guide and index cards, index filter, stats', async () => {
  const e = mkenv();
  assert.equal((await publish(e, 'bad-ch', guide({ channel: 'viral-view' }))).status, 400);
  assert.equal(e.UPLOADS.m.size, 0);
  assert.equal((await publish(e, 'ai-one', guide({ title: 'AI one', state: 'listed', channel: 'jonmacai' }))).status, 200);
  assert.equal((await publish(e, 'main-one', guide({ title: 'Main one', state: 'listed', channel: 'jon-mac' }))).status, 200);
  assert.equal((await publish(e, 'no-ch', guide({ title: 'No channel', state: 'listed' }))).status, 200);
  assert.match(await (await go(e, '/guides/ai-one')).text(), /<span class="ch">Jon Mac AI<\/span>/);
  assert.doesNotMatch(await (await go(e, '/guides/no-ch')).text(), /class="ch"/);
  const idx = await (await go(e, '/guides')).text();
  assert.match(idx, /data-channel="jonmacai"[\s\S]*<span class="ch">Jon Mac AI<\/span>/);
  assert.match(idx, /data-channel="jon-mac"/);
  assert.match(idx, /<button type="button" class="tag" data-channel="jonmacai" aria-pressed="false">Jon Mac AI<\/button>/);
  assert.match(idx, /<button type="button" class="tag" data-channel="jon-mac" aria-pressed="false">Jon Mac<\/button>/);
  const s = await (await go(e, '/guides/api/main-one/stats', { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  assert.equal(s.channel, 'jon-mac');
});

test('no [JON: ...] text on any live page; footer and checkbox point at the privacy page; terms draft is gone', async () => {
  const e = mkenv();
  await publish(e, 'open-one', guide({ title: 'Open guide', state: 'listed' }));
  for (const path of ['/lab', '/guides', '/guides/open-one']) {
    const t = await (await go(e, path)).text();
    assert.doesNotMatch(t, /\[JON:/, path);
    assert.doesNotMatch(t, /class="ph"/, path);
    assert.doesNotMatch(t, /\/guides\/terms/, path);
    assert.match(t, /href="\/dashboard\/privacy"/, path);
  }
  assert.match(await (await go(e, '/guides/open-one')).text(), /I agree to the <a href="\/dashboard\/privacy"/);
  const terms = await go(e, '/guides/terms');
  assert.equal(terms.status, 301);
  assert.equal(terms.headers.get('Location'), '/dashboard/privacy');
});

test('/lab: approved text, no Your teacher, guide count only from 5 real guides', async () => {
  const e = mkenv();
  const lab0 = await (await go(e, '/lab')).text();
  for (const t of ['Start Here:', 'Edit Lab:', 'Pipeline Lab:', 'Resource Library:', 'Premium: $39 / month', '1.1k']) assert.ok(lab0.includes(t), t);
  assert.doesNotMatch(lab0, /Your teacher/);
  assert.doesNotMatch(lab0, /free guides<\/small>/);
  for (let i = 1; i <= 4; i++) await publish(e, `g-${i}`, guide({ title: `Guide ${i}`, state: 'listed' }));
  assert.doesNotMatch(await (await go(e, '/lab')).text(), /free guides<\/small>/);
  await publish(e, 'g-5', guide({ title: 'Guide 5', state: 'listed' }));
  assert.match(await (await go(e, '/lab')).text(), /<b>5<\/b><small>free guides<\/small>/);
});
