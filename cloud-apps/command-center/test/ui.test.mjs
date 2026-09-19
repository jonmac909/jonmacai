import test from 'node:test';
import assert from 'node:assert/strict';
import { barWidth } from '../public/js/ui.js';

test('progress bar width clamps to 0–100%', () => {
  assert.equal(barWidth(-10), '0');
  assert.equal(barWidth(0), '0');
  assert.equal(barWidth(50), 'max(2px, 50%)');
  assert.equal(barWidth(100), 'max(2px, 100%)');
  assert.equal(barWidth(150), 'max(2px, 100%)');
});

test('progress bar is at least 2px when value is above zero', () => {
  assert.equal(barWidth(0.1), 'max(2px, 0.1%)');
  assert.equal(barWidth(1), 'max(2px, 1%)');
});
