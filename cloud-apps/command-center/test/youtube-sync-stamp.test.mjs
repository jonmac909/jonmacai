import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceCollectedAt } from '../src/cron.js';

test('youtube snapshot time stays on the sync stamp', () => {
  const stamp = sourceCollectedAt('youtube', { generatedAt: '2026-09-22T23:27:51.354Z' }, '2026-09-23T00:00:00.000Z');
  assert.equal(stamp, '2026-09-22T23:27:51.354Z');
});
