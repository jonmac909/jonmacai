import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalItem } from '../src/today.js';
import { needItem } from '../public/js/pages/today.js';

test('an approval card shows plain words and labelled links, never the payload (Jon, 2026-11-04)', () => {
  const it = approvalItem({ id: 'a9', action: 'post_clips', title: 'AI car selfie, did you think I was real', requestedBy: 'short-form', payload: {
    review_link: 'https://jonmac.ai/review/carselfie-real-v1', source_link: 'https://x.com/someone/status/1', platforms: ['instagram_reels', 'facebook_reels', 'tiktok'], x: 'save as draft',
    note: 'QC passed. Car selfie remake, 15 s. Third sentence stays out.', clips: [{ file: 'D:/AgentTeam/footage/c.mp4', sha256: 'd54f71' }] } });
  assert.equal(it.detail, 'Posts to Instagram, Facebook and TikTok; saves an X draft for you to post.');
  assert.deepEqual(it.notes, ['QC passed.', 'Car selfie remake, 15 s.']);
  assert.deepEqual(it.links.map((l) => l.label), ['Watch video', 'Source']);
  assert.equal('payload' in it || 'payloadPreview' in it, false);
  const html = needItem(it);
  assert.doesNotMatch(html, /sha256|footage|What it will run|<pre>|platforms/);
  assert.match(html, /Watch video.*Source.*data-decision="approve".*data-decision="reject"/s);
});

test('steps show as bullets with local paths cut to the last folder or file name', () => {
  const it = approvalItem({ id: 'a8', action: 'gpu1_driver_updates', title: 'GPU1 drivers', payload: { steps: ['Open D:\\AgentTeam\\handoff and double-click it', 'Restart GPU1'], script: 'D:\\x\\install.ps1' } });
  assert.equal(it.detail, 'Runs gpu1 driver updates.');
  assert.deepEqual(it.notes, ['Open handoff and double-click it', 'Restart GPU1']);
  assert.deepEqual(it.links, []);
});

test('links inside notes stay whole; odd step and platform values are dropped', () => {
  const it = approvalItem({ id: 'a7', action: 'x', title: 't', payload: { platforms: [null, 'tiktok'], note: 'Review at https://jonmac.ai/review/x first.', steps: [null, { a: 1 }, 'Then post'] } });
  assert.equal(it.detail, 'Posts to TikTok.');
  assert.deepEqual(it.notes, ['Review at https://jonmac.ai/review/x first.', 'Then post']);
});
