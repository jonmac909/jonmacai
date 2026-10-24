import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannels, STAGES } from '../src/channels.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { render } from '../public/js/pages/channels.js';

const NOW = Date.parse('2026-10-25T00:45:00Z');

const FILE = {
  updated: '2026-10-24T16:40:00-07:00',
  channels: [
    { name: 'Sienna Creates', group: 'viralview', studio_url: 'https://studio.youtube.com/channel/UCx/videos', cards: [
      { id: 's1', title: 'Sienna #1', version: 'v2', stage: 'draft', review_url: 'https://gpu2.tail01c962.ts.net/ad-review/sienna/compare.html',
        studio_url: 'https://studio.youtube.com/video/0UwIG7jQLGU/edit', blocker: 'no custom thumbnail: phone not verified', updated: '2026-10-24T15:58:00-07:00' },
    ] },
    { name: 'Rosa Cooks', group: 'affiliate', cards: [
      { id: 'r1', title: 'Beans', stage: 'bogus', review_url: 'javascript:alert(1)', studio_url: 'http://insecure.example/x', updated: 'not a date' },
    ] },
    { name: 'Theo', group: 'viralview', cards: [] },
  ],
};

test('buildChannels puts cards in stage columns and keeps unknown ones apart', () => {
  const b = buildChannels(FILE, NOW);
  assert.equal(b.channels.length, 3);
  const sienna = b.channels[0];
  assert.deepEqual(sienna.columns.map((c) => c.key), STAGES.map((s) => s.key));
  assert.equal(sienna.columns.find((c) => c.key === 'draft').cards[0].studioUrl, 'https://studio.youtube.com/video/0UwIG7jQLGU/edit');
  assert.equal(sienna.blocked, 1);
  const rosa = b.channels[1];
  assert.equal(rosa.columns.at(-1).key, 'unknown');
  assert.equal(rosa.columns.at(-1).cards[0].reviewUrl, '');
  assert.equal(rosa.columns.at(-1).cards[0].studioUrl, '');
  assert.equal(rosa.columns.at(-1).cards[0].updated, '');
  assert.equal(b.channels[2].total, 0);
  assert.equal(b.total, 2);
  assert.equal(b.updatedLabel, '1 hr ago');
});

test('buildChannels tolerates missing data', () => {
  assert.equal(buildChannels(null, NOW).available, false);
  assert.deepEqual(buildChannels({ channels: 'x' }, NOW).channels, []);
});

test('mergeSnapshot exposes the board built from the jon_tasks row', async () => {
  const snapshot = (await import('../fixtures/snapshot.json', { with: { type: 'json' } })).default;
  const rows = [{ source: 'jon_tasks', data: JSON.stringify({ updated: FILE.updated, tasks: [], youtube: FILE }), collected_at: '2026-10-24T23:40:00Z' }];
  const out = mergeSnapshot(snapshot, rows, NOW, {}, [], [], [], {});
  assert.equal(out.pages.channels.title, 'YouTube');
  assert.equal(out.pages.channels.board.channels[0].name, 'Sienna Creates');
});

test('page renders review and Studio links, a blocker, and escapes text', () => {
  const b = buildChannels({ channels: [{ name: 'A<b>', cards: [{ title: '<img src=x>', stage: 'review', review_url: 'https://x.test/r', blocker: 'b' }] }] }, NOW);
  const html = render({ title: 'YouTube', board: b });
  assert.match(html, /Review &amp; approve/);
  assert.match(html, /href="https:\/\/x\.test\/r"/);
  assert.match(html, /Blocked: b/);
  assert.ok(!html.includes('<img src=x>'));
  assert.match(render({ board: buildChannels(FILE, NOW) }), /Open in Studio/);
  assert.match(render({}), /No channel data yet/);
});
