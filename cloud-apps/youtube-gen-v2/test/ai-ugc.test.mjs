import test from 'node:test';
import assert from 'node:assert/strict';
import { isAiUgc, topOutliers } from '../api.js';

test('yt2 AI UGC filter is word-boundary', () => {
  assert.equal(isAiUgc('AI UGC ads that sell'), true);
  assert.equal(isAiUgc('Best AI video generation tools'), true);
  assert.equal(isAiUgc('Talking head talking'), false);
  assert.equal(isAiUgc('side hustles with email'), false);
  assert.equal(isAiUgc('How I got 1000 VIRAL UGC videos for my ECOM brand (NOT using AI)'), false);
});

test('yt2 outliers drop non-AI-UGC titles', () => {
  const hits = topOutliers([
    { id: 'a', title: 'AI UGC for TikTok Shop', outlier_score: 10 },
    { id: 'b', title: 'Talking about email', outlier_score: 99 },
  ], 3);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'a');
});
