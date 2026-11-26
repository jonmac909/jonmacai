// jonmac.ai/samples: public page with the 8 style samples, noindex, no prices; videos from R2 with byte ranges.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { SAMPLES } from '../src/samples.js';

const NAMES = ['jay', 'nick', 'duncan', 'jack', 'chase', 'joseph', 'zane', 'robo'];

function fakeR2(files) {
  const store = new Map(Object.entries(files));
  return {
    async get(key, opts = {}) {
      const bytes = store.get(key);
      if (!bytes) return null;
      const size = bytes.byteLength;
      const r = opts.range;
      if (!r) return { body: new Response(bytes).body, size };
      if (r.offset >= size) throw new Error('InvalidRange');
      const from = 'suffix' in r ? Math.max(0, size - r.suffix) : r.offset;
      const to = 'suffix' in r ? size : r.length ? Math.min(size, from + r.length) : size;
      return { body: new Response(bytes.slice(from, to)).body, size };
    },
    async head(key) { const b = store.get(key); return b ? { size: b.byteLength } : null; },
  };
}

const ctx = { waitUntil() {} };
const env = () => ({ UPLOADS: fakeR2({ 'samples/sample-zane-v2.mp4': new Uint8Array(100).map((_, i) => i) }) });
const get = (path, init) => worker.fetch(new Request(`https://jonmac.ai${path}`, init), env(), ctx);

test('samples page returns 200 with the 8 videos in order, noindex and no prices', async () => {
  assert.deepEqual(SAMPLES, NAMES);
  const res = await get('/samples');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /text\/html/);
  assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
  const html = await res.text();
  assert.match(html, /<meta name="robots" content="noindex/);
  const sources = [...html.matchAll(/<source src="([^"]+)" type="video\/mp4">/g)].map((m) => m[1]);
  assert.deepEqual(sources, NAMES.map((n) => `/samples/sample-${n}-v2.mp4`));
  const labels = [...html.matchAll(/<figcaption>([^<]+)<\/figcaption>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Style: Jay', 'Style: Nick', 'Style: Duncan', 'Style: Jack', 'Style: Chase', 'Style: Joseph', 'Style: Zane', 'Style: Robo']);
  assert.equal((html.match(/<video controls preload="metadata"/g) || []).length, 8);
  assert.doesNotMatch(html, /autoplay/i);
  assert.doesNotMatch(html, /[$€£]\s?\d|\b\d+\s?(usd|dollars?)\b|\bprice|\bpricing|\/mo\b|per month/i);
  assert.equal((await get('/samples/')).status, 200);
});

test('samples videos come from R2 with byte ranges; other files are 404', async () => {
  const full = await get('/samples/sample-zane-v2.mp4');
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('Content-Type'), 'video/mp4');
  assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
  assert.equal((await full.arrayBuffer()).byteLength, 100);
  const part = await get('/samples/sample-zane-v2.mp4', { headers: { Range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('Content-Range'), 'bytes 10-19/100');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.equal((await get('/samples/sample-zane-v2.mp4', { headers: { Range: 'bytes=200-' } })).status, 416);
  assert.equal((await get('/samples/sample-nick-v2.mp4')).status, 404); // not in this fake bucket
  assert.equal((await get('/samples/sample-zane-compare.jpg')).status, 404);
  assert.equal((await get('/samples/../proofs/x.mp4')).status, 404);
  assert.equal((await get('/samples', { method: 'POST' })).status, 405);
});
