// A card link, /dashboard/#t_<id> (card t_96212b1966cd4970): runs the real app.js on a stand-in DOM, in its
// own file because it replaces browser globals. Planted links: a real card opens its modal; an unknown one says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' || k === 'then' ? undefined : (t[k] = stub())),
  apply: () => stub(),
  construct: () => stub(),
});

const CARD = 't_96212b1966cd4970';
const snapshot = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));
const task = { id: CARD, title: 'Card links open their card', owner: 'developer', status: 'doing', project: 'dashboard', proofs: [], history: [], comments: [] };
const fetched = [];
const on = {};
const body = { innerHTML: '', querySelector: (s) => (s === '.cmtext' ? { value: '', dispatchEvent() {}, focus() {} } : s === '.cmload' ? {} : null), querySelectorAll: () => [] };
const dlg = {
  open: false, on: {},
  showModal() { this.open = true; },
  close() { if (!this.open) return; this.open = false; this.on.close?.(); },
  addEventListener(t, f) { this.on[t] = f; },
  setAttribute() {},
  querySelector: (s) => (s === '.cmbody' ? body : null),
};
const toast = { textContent: '', classList: { add() {}, remove() {} } };
const ok = (b) => ({ ok: true, status: 200, json: async () => b });
Object.assign(globalThis, {
  window: globalThis, innerWidth: 1200, MutationObserver: class { observe() {} }, setInterval: () => 0, scrollTo() {},
  addEventListener: (t, f) => { on[t] = f; }, matchMedia: () => stub(), localStorage: { getItem: () => null, setItem() {} },
  location: { hash: `#${CARD.toUpperCase().replace('T_', 't_')}`, search: '', reload() {} },
  history: { replaceState(_, __, url) { location.hash = new URL(url, 'https://x').hash; } },
  document: Object.assign(stub(), { getElementById: (id) => (id === 'cardModal' ? dlg : id === 'toast' ? toast : stub()) }),
  fetch: async (url) => {
    fetched.push(String(url));
    if (String(url).includes('/api/v1/tasks/')) return String(url).endsWith(CARD) ? ok({ task }) : { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    return ok(snapshot);
  },
});
const settle = () => new Promise((done) => setTimeout(done, 20));

test('a #t_ link opens that card over the page after the data loads, keeps the hash, and closing drops it', async () => {
  const { go } = await import('../public/js/app.js');
  await settle();
  assert.equal(dlg.open, true, 'the card modal is open');
  assert.match(body.innerHTML, /<h2>Card links open their card<\/h2>/);
  const taskAt = fetched.findIndex((u) => u.includes(`/api/v1/tasks/${CARD}`));
  assert.ok(taskAt > fetched.findIndex((u) => u.includes('/api/snapshot')), 'card loads after the snapshot');
  assert.equal(location.hash.toLowerCase(), `#${CARD}`, 'the default route did not rewrite it to #today');
  await go('today', { refetch: true }); // the 60 s refresh under the open card
  assert.equal(location.hash.toLowerCase(), `#${CARD}`);
  dlg.close();
  assert.equal(location.hash, '#today', 'closing goes back to the page underneath');
  assert.equal(toast.textContent, '');
});

test('an unknown #t_ link says the card was not found and shows the page', async () => {
  location.hash = '#t_0000000000000000';
  on.hashchange();
  await settle();
  assert.equal(dlg.open, false);
  assert.equal(toast.textContent, 'Card not found');
  assert.equal(location.hash, '#today');
  // A plain page hash still routes as before.
  location.hash = '#nopage';
  on.hashchange();
  await settle();
  assert.equal(location.hash, '#today');
});
