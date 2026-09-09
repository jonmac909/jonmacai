import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

test('watch routes map to assets, preserve range requests and response headers', async () => {
  for (const [pathname, target] of [['/watch','/index.html'],['/watch/','/index.html'],['/watch/poster.png','/poster.png']]) {
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

test('MP4 byte ranges support browser probes and seeks without buffering', async () => {
  let readRange;
  const env={VIDEO_KEY:'watch/film.mp4',MEDIA:{head:async()=>({size:100,httpEtag:'"film"'}),get:async(key,options)=>{assert.equal(key,'watch/film.mp4');readRange=options?.range;return {body:'ok'};}}};
  for(const [range,expected] of [['bytes=0-1',{offset:0,length:2}],['bytes=90-',{offset:90,length:10}],['bytes=-10',{offset:90,length:10}]]) {
    const response=await worker.fetch(new Request('https://jonmac.ai/watch/viralview-launch.mp4',{headers:{Range:range}}),env);
    assert.equal(response.status,206);
    assert.deepEqual(readRange,expected);
    assert.equal(response.headers.get('Accept-Ranges'),'bytes');
    assert.equal(response.headers.get('Content-Length'),String(expected.length));
  }
  assert.equal((await worker.fetch(new Request('https://jonmac.ai/watch/viralview-launch.mp4',{headers:{Range:'bytes=100-'}}),env)).status,416);
});
