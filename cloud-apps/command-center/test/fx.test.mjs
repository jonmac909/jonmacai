// USD in CAD for Home's PnL card: parsed from the Bank of Canada, pulled at most every 6 hours, served by /home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FX_URL, parseFx, pullFx, readFx } from '../src/fx.js';
import { homeData } from '../src/home.js';
import { sqliteD1 } from './sqlited1.mjs';

const BOC = (v, d = '2026-11-12') => ({ observations: [{ d, FXUSDCAD: { v: String(v) } }] });

test('the rate is read from the Bank of Canada, kept, and not pulled again for 6 hours', async () => {
  assert.deepEqual(parseFx(BOC(1.3912)), { usdcad: 1.3912, day: '2026-11-12' });
  for (const bad of [null, {}, BOC('x'), BOC(0), BOC(40), BOC(1.39, 'today')]) assert.equal(parseFx(bad), null);
  const env = { DB: sqliteD1() };
  const urls = [];
  const fetchFn = async (u) => { urls.push(String(u)); return new Response(JSON.stringify(BOC(1.3912))); };
  const t0 = Date.parse('2026-11-12T12:00:00Z');
  await pullFx(env, fetchFn, t0);
  await pullFx(env, fetchFn, t0 + 3600000);
  assert.deepEqual(urls, [FX_URL]);
  assert.equal((await readFx(env)).usdcad, 1.3912);
  await pullFx(env, fetchFn, t0 + 7 * 3600000);
  assert.equal(urls.length, 2);
  await pullFx(env, async () => new Response('nope', { status: 500 }), t0 + 14 * 3600000); // a bad answer keeps the last rate
  assert.equal((await readFx(env)).usdcad, 1.3912);
  assert.deepEqual((await homeData(env, t0)).fx, { usdcad: 1.3912, day: '2026-11-12' });
  assert.equal((await homeData({ DB: sqliteD1() }, t0)).fx, null);
});
