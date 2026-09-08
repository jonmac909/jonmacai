import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

test('watch routes map to assets, preserve range requests and response headers', async () => {
  for (const [pathname, target] of [['/watch','/index.html'],['/watch/','/index.html'],['/watch/viralview-launch.mp4','/viralview-launch.mp4'],['/watch/poster.png','/poster.png']]) {
    const response = await worker.fetch(new Request('https://jonmac.ai' + pathname, {headers:{Range:'bytes=0-1'}}), {ASSETS:{fetch:async request => {
      assert.equal(new URL(request.url).pathname,target);
      assert.equal(request.headers.get('Range'),'bytes=0-1');
      return new Response('ok',{status:206,headers:{'Content-Range':'bytes 0-1/100','Accept-Ranges':'bytes'}});
    }}});
    assert.equal(response.status,206);
    assert.equal(response.headers.get('Content-Range'),'bytes 0-1/100');
    assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
  }
});

test('HEAD stays HEAD and unrelated routes and writes are rejected', async () => {
  const env={ASSETS:{fetch:async request => {assert.equal(request.method,'HEAD');return new Response(null);}}};
  assert.equal((await worker.fetch(new Request('https://jonmac.ai/watch',{method:'HEAD'}),env)).status,200);
  for (const pathname of ['/review','/','/watch/secrets','/watching']) assert.equal((await worker.fetch(new Request('https://jonmac.ai'+pathname),env)).status,404);
  assert.equal((await worker.fetch(new Request('https://jonmac.ai/watch',{method:'POST'}),env)).status,405);
});
