// Runs the real app.js on a stand-in DOM, in its own file because it replaces browser globals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Any property or call gives back another stand-in; what a test sets stays readable.
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' || k === 'then' ? undefined : (t[k] = stub())),
  apply: () => stub(),
  construct: () => stub(),
});

test('a slow Track load does not overwrite the page Jon moved to', async () => {
  const page = stub();
  const snapshot = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
  const trackData = { title: 'Track', updated: '', switchedOn: true, channels: [{ slug: 'all', label: 'All', all: true, counts: {}, totals: {} }], videos: [] };
  let release;
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  Object.assign(globalThis, {
    window: globalThis, innerWidth: 1200, MutationObserver: class { observe() {} }, setInterval: () => 0, scrollTo() {},
    addEventListener() {}, matchMedia: () => stub(), localStorage: { getItem: () => null, setItem() {} },
    history: { replaceState() {} }, location: { hash: '#calendar', reload() {} },
    document: Object.assign(stub(), { getElementById: (id) => (id === 'page' ? page : stub()) }),
    fetch: async (url) => (String(url).includes('pages=track')
      ? new Promise((done) => { release = () => done(ok({ pages: { track: trackData } })); })
      : ok(snapshot)),
  });
  const { go } = await import('../public/js/app.js');
  await new Promise((done) => setTimeout(done));

  location.hash = '#track';
  const loading = go('track');
  await new Promise((done) => setTimeout(done));
  location.hash = '#calendar';
  page.innerHTML = 'the page Jon moved to';
  release();
  await loading;
  assert.equal(page.innerHTML, 'the page Jon moved to');

  location.hash = '#track';
  const staying = go('track');
  await new Promise((done) => setTimeout(done));
  release();
  await staying;
  assert.notEqual(page.innerHTML, 'the page Jon moved to', 'staying on Track still shows it');
});
