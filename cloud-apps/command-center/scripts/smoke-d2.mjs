// Dashboard 2 smoke check: node scripts/smoke-d2.mjs <origin> [session-secret-file]
// Without a secret file it checks only what needs no session (redirect, login page, 401s).
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [origin, secretFile] = process.argv.slice(2);
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` (got ${got})`}`); if (!ok) failed++; };
const get = (path, headers = {}) => fetch(origin + path, { headers, redirect: 'manual' });

let r = await get('/dashboard-2');
check('/dashboard-2 redirects to /dashboard-2/', r.status === 308 && r.headers.get('location')?.endsWith('/dashboard-2/'), r.status);
r = await get('/dashboard-2/');
check('/dashboard-2/ without session shows sign-in', r.status === 200 && /password/i.test(await r.text()), r.status);
r = await get('/dashboard/api/d2');
check('/dashboard/api/d2 without session is 401', r.status === 401, r.status);
r = await get('/dashboard-2/js/app.js');
check('page script is served', r.status === 200 && /javascript/.test(r.headers.get('content-type') || ''), r.status);

if (secretFile) {
  const exp = String(Math.floor(Date.now() / 1000) + 600);
  const cookie = { Cookie: `__Host-cc_session=${exp}.${createHmac('sha256', readFileSync(secretFile, 'utf8').trim()).update(exp).digest('hex')}` };
  r = await get('/dashboard-2/', cookie);
  check('/dashboard-2/ with session is the app', r.status === 200 && /js\/app\.js/.test(await r.text()), r.status);
  r = await get('/dashboard/api/d2', cookie);
  const j = r.ok ? await r.json() : null;
  check('/dashboard/api/d2 answers ok', j?.ok === true, r.status);
  const d2 = j?.d2 || {};
  check('six goals', d2.goals?.length === 6, d2.goals?.length);
  check('today has at most 3 things for Jon', Array.isArray(d2.today?.jon) && d2.today.jon.length <= 3, d2.today?.jon?.length);
  check('two daily checks', d2.checks?.length === 2, d2.checks?.length);
  check('pipeline boards', d2.pipeline?.boards?.length === 6, d2.pipeline?.boards?.length);
  check('money tiles', d2.money?.tiles?.length > 0, d2.money?.tiles?.length);
  if (j) console.log(JSON.stringify({ needs: d2.today.needs.count, jon: d2.today.jon.length, health: d2.today.needs.healthToAna, folded: d2.today.needs.chargesFolded, blockers: d2.today.blockers.length, stale: d2.stale.length }));
  r = await get('/dashboard/', cookie);
  check('/dashboard/ still serves its app', r.status === 200 && /Command Center/.test(await r.text()), r.status);
}
process.exit(failed ? 1 : 0);
