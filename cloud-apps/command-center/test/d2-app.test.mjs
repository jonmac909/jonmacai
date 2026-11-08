import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// public/d2/js/app.js (the Dashboard 2 shell) in a stub tab: just enough DOM to load it, a fake fetch that logs
// each URL, and the 60 s refresh timer handed back to the test. /dashboard/js/* maps to public/js/*, as in d2-ui.
const pub = new URL('../public/', import.meta.url);
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith('/dashboard/js/') ? new URL(spec.slice('/dashboard/'.length), pub).href : spec, ctx) });
const sample = readFileSync(new URL('./fixtures/d2-ui.json', import.meta.url), 'utf8');
const TRACK = JSON.stringify({ pages: { track: { title: 'Track', available: true,
  channels: [{ slug: 'jon-mac', label: 'Jon Mac', group: "Jon's own", count: 1, counts: { created: 1, posted: 1, scheduled: 0, live: 1 }, totals: null, book: null }],
  videos: [{ channel: 'jon-mac', channelLabel: 'Jon Mac', title: 'How I Price Sponsor Videos', status: 'live', views: 18400, updatedAt: '2026-11-05T19:00:00Z' }] } } });

const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
let tabs = 0;

async function openTab({ hash = '', d2Status = 200, session = store() } = {}) {
  const urls = [];
  const on = {};
  const nodes = new Map();
  const node = () => ({ innerHTML: '', textContent: '', title: '', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {},
    getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} });
  const location = { hash, pathname: '/dashboard-2/', reloads: 0, replaced: [], reload() { this.reloads++; }, replace(u) { this.replaced.push(u); } };
  Object.assign(globalThis, {
    document: { documentElement: node(), body: node(), hidden: false, activeElement: null, querySelector: () => null, querySelectorAll: () => [],
      getElementById: (k) => nodes.get(k) || nodes.set(k, node()).get(k), addEventListener: (t, f) => { on[t] = f; } },
    window: { addEventListener: (t, f) => { on[t] = f; }, scrollTo() {}, scrollY: 0, open() {} },
    location, localStorage: store(), sessionStorage: session, innerWidth: 1200,
    MutationObserver: class { observe() {} },
    fetch: async (u) => {
      urls.push(u);
      if (u === '/dashboard/api/d2') return d2Status === 200 ? new Response(sample) : new Response('{"error":"Unauthorized"}', { status: d2Status });
      if (u === '/dashboard/api/snapshot?pages=track') return new Response(TRACK);
      return new Response('{}', { status: 404 });
    },
  });
  let refresh;
  const real = globalThis.setInterval;
  globalThis.setInterval = (f) => { refresh = f; return 0; };
  try { await import(`../public/d2/js/app.js?tab=${++tabs}`); } finally { globalThis.setInterval = real; }
  await settle();
  return {
    urls, location, session,
    async goTo(h) { location.hash = h; on.hashchange(); await settle(); },
    async tick() { refresh(); await settle(); }, // the 60 s refresh
    page: () => nodes.get('page').innerHTML,
  };
}
const trackPulls = (t) => t.urls.filter((u) => u.includes('pages=track')).length;

test('signed out: the tab opens /dashboard-2/ once for sign-in, and never reloads in a loop', async () => {
  const t = await openTab({ hash: '#today', d2Status: 401 });
  assert.deepEqual(t.location.replaced, ['/dashboard-2/']);
  // Still signed out on the next page load in this tab (same session storage), and on every refresh after.
  const again = await openTab({ hash: '#today', d2Status: 401, session: t.session });
  await again.tick();
  await again.tick();
  assert.deepEqual([again.location.replaced, again.location.reloads, t.location.reloads], [[], 0, 0]);
  // Signed in again: a good load clears the mark, so a later sign-out opens sign-in once more.
  await openTab({ hash: '#today', session: t.session });
  assert.deepEqual((await openTab({ hash: '#today', d2Status: 401, session: t.session })).location.replaced, ['/dashboard-2/']);
});

test('Track pulls from YouTube on each open of a Track tab, and keeps it across refreshes only while it stays open', async () => {
  const t = await openTab({ hash: '#pipeline/jonmac/jon-mac/track' });
  assert.equal(trackPulls(t), 1);
  assert.match(t.page(), /How I Price Sponsor Videos/);
  await t.tick();
  await t.tick();
  assert.equal(trackPulls(t), 1, 'the 60 s refresh keeps the open Track');
  assert.equal(t.urls.filter((u) => u === '/dashboard/api/d2').length, 3);
  await t.goTo('#today');
  await t.tick();
  await t.goTo('#pipeline/jonmac/jon-mac/track');
  assert.equal(trackPulls(t), 2, 'reopening Track pulls again');
  await t.goTo('#pipeline/jonmac/jon-mac/calendar');
  await t.goTo('#pipeline/jonmac/jon-mac/track');
  assert.equal(trackPulls(t), 3);
});
