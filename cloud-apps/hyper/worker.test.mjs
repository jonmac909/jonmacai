// The gate at hyper.jonmac.ai: who gets in, what the app is sent, and what comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { readPass } from './worker.js';

const HOST = 'https://hyper.jonmac.ai';
const GOOD = `${Math.floor(Date.now() / 1000) + 60}.${'a'.repeat(64)}`;

function setup({ studio } = {}) {
  const seen = { checks: [], app: [] };
  const env = {
    GATE_SECRET: 'gate-secret-for-tests-32-bytes-ok',
    DASH: { fetch: async (u) => { seen.checks.push(String(u)); const ok = String(u).endsWith(`t=${GOOD}`); return Response.json({ ok }, { status: ok ? 200 : 401 }); } },
    STUDIO: { fetch: studio || (async (r) => { seen.app.push(r); return new Response('app', { headers: { 'Content-Type': 'text/html' } }); }) },
  };
  const go = (path, init = {}) => worker.fetch(new Request(`${HOST}${path}`, init), env);
  const signIn = async () => (await go(`/__enter?t=${GOOD}`)).headers.get('Set-Cookie').split(';')[0];
  return { env, seen, go, signIn };
}

test('no cookie: nothing reaches the app; a page gets a link to the dashboard, anything else a bare 401', async () => {
  const { go, seen } = setup();
  const nav = await go('/', { headers: { Accept: 'text/html' } });
  assert.equal(nav.status, 401);
  assert.match(await nav.text(), /href="https:\/\/jonmac\.ai\/dash\/#hyper" target="_top"/);
  assert.match(nav.headers.get('Content-Security-Policy'), /frame-ancestors https:\/\/jonmac\.ai/);
  for (const [path, init] of [['/api/projects', {}], ['/shell-api/agent/run', { method: 'POST', body: '{}', headers: { Origin: HOST } }],
    ['/', { headers: { Upgrade: 'websocket', Origin: HOST } }], ['/', { headers: { Cookie: '__Host-hyper=1.2' } }],
    ['/', { headers: { Cookie: `__Host-hyper=${GOOD}` } }], ['/', { headers: { Cookie: `__Host-cc_session=${GOOD}` } }]]) {
    assert.equal((await go(path, init)).status, 401, path);
  }
  assert.equal(seen.app.length, 0);
});

test('/__enter: only a ticket the dashboard confirms sets the cookie; the ticket is asked about once, as given', async () => {
  const { go, seen, env } = setup();
  const res = await go(`/__enter?t=${GOOD}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `${HOST}/`);
  const cookie = res.headers.get('Set-Cookie');
  assert.match(cookie, /^__Host-hyper=\d+\.[0-9a-f]{64}; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict$/);
  assert.deepEqual(seen.checks, [`https://jonmac.ai/dashboard/api/hyper/check?t=${GOOD}`]);
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
  const bad = `${Math.floor(Date.now() / 1000) + 60}.${'b'.repeat(64)}`;
  for (const path of [`/__enter?t=${bad}`, '/__enter', '/__enter?t=x', `/__enter?t=${GOOD}%26x=1`, `/__enter?t=${GOOD}/../../v1/me`]) {
    const no = await go(path);
    assert.equal(no.status, 401, path);
    assert.equal(no.headers.get('Set-Cookie'), null, path);
  }
  assert.equal(seen.checks.length, 2); // the well-formed wrong ticket was asked about; the malformed ones never left
  assert.equal((await go(`/__enter?t=${GOOD}`, { method: 'POST' })).status, 405);
  assert.equal((await worker.fetch(new Request(`${HOST}/__enter?t=${GOOD}`), { ...env, GATE_SECRET: '' })).status, 503);
  env.DASH.fetch = async () => { throw new Error('down'); };
  assert.equal((await go(`/__enter?t=${GOOD}`)).status, 401);
});

test('cookie: valid until it expires, only under this secret', async () => {
  const { env, signIn } = setup();
  const cookie = await signIn();
  const req = new Request(HOST, { headers: { Cookie: `other=1; ${cookie}` } });
  assert.equal(await readPass(req, env), true);
  assert.equal(await readPass(req, env, Date.now() + 12 * 3600 * 1000 + 1000), false);
  assert.equal(await readPass(req, { ...env, GATE_SECRET: 'another-secret' }), false);
  assert.equal(await readPass(req, { ...env, GATE_SECRET: '' }), false);
  const [exp, sig] = cookie.split('=')[1].split('.');
  const later = new Request(HOST, { headers: { Cookie: `__Host-hyper=${Number(exp) + 9999}.${sig}` } });
  assert.equal(await readPass(later, env), false);
});

test('signed in: the app gets a plain local request, and the answer may only be framed by the dashboard', async () => {
  const { go, seen, signIn } = setup();
  const cookie = await signIn();
  const res = await go('/api/projects?x=1', {
    headers: { Cookie: `theme=dark; ${cookie}`, Origin: HOST, Referer: `${HOST}/p/demo?tab=1`, 'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-Host': 'evil.example', Accept: 'application/json' },
  });
  assert.equal(await res.text(), 'app');
  assert.equal(res.headers.get('Content-Security-Policy'), "frame-ancestors https://jonmac.ai 'self'");
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const sent = seen.app[0];
  assert.equal(sent.url, 'http://localhost:5191/api/projects?x=1');
  assert.equal(sent.headers.get('Cookie'), 'theme=dark');
  assert.equal(sent.headers.get('Origin'), null);
  assert.equal(sent.headers.get('CF-Connecting-IP'), null);
  assert.equal(sent.headers.get('X-Forwarded-Host'), null);
  assert.equal(sent.headers.get('Referer'), 'http://localhost:5191/p/demo?tab=1');
  assert.equal(sent.headers.get('Accept'), 'application/json');
  assert.equal(sent.redirect, 'manual');
});

test('signed in: a write or a socket must come from the app page itself; the body goes through', async () => {
  const { go, seen, signIn } = setup();
  const cookie = await signIn();
  for (const origin of [undefined, 'https://jonmac.ai', 'https://evil.example', 'http://hyper.jonmac.ai', 'null']) {
    const headers = { Cookie: cookie, ...(origin ? { Origin: origin } : {}) };
    assert.equal((await go('/shell-api/agent/run', { method: 'POST', body: '{}', headers })).status, 403, `POST ${origin}`);
    assert.equal((await go('/', { headers: { ...headers, Upgrade: 'websocket' } })).status, 403, `socket ${origin}`);
    assert.equal((await go('/api/projects/x', { method: 'DELETE', headers })).status, 403, `DELETE ${origin}`);
  }
  assert.equal(seen.app.length, 0);
  const ok = await go('/shell-api/agent/run', { method: 'POST', body: '{"prompt":"hi"}', headers: { Cookie: cookie, Origin: HOST, 'Content-Type': 'application/json' } });
  assert.equal(ok.status, 200);
  assert.equal(await seen.app[0].text(), '{"prompt":"hi"}');
  assert.equal(seen.app[0].method, 'POST');
});

test('signed in: redirects stay on this host, and a PC that cannot be reached reads as offline', async () => {
  const moved = setup({ studio: async () => new Response(null, { status: 302, headers: { Location: 'http://localhost:5191/p/demo' } }) });
  const res = await moved.go('/x', { headers: { Cookie: await moved.signIn() } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `${HOST}/p/demo`);
  const down = setup({ studio: async () => { throw new Error('tunnel down'); } });
  const cookie = await down.signIn();
  const nav = await down.go('/', { headers: { Cookie: cookie, Accept: 'text/html' } });
  assert.equal(nav.status, 502);
  assert.match(await nav.text(), /Hyper is not reachable/);
  assert.equal((await down.go('/api/projects', { headers: { Cookie: cookie } })).status, 502);
  const unset = setup();
  delete unset.env.STUDIO;
  assert.equal((await unset.go('/', { headers: { Cookie: await unset.signIn() } })).status, 502);
});
