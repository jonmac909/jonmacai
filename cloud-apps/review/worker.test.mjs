import test from 'node:test';
import assert from 'node:assert/strict';
import { byteRange } from './worker.js';

test('browser byte probes, open-ended and suffix seeks', () => {
  assert.equal(byteRange(null, 100), null);
  assert.deepEqual(byteRange('bytes=0-1', 100), { offset: 0, length: 2 });
  assert.deepEqual(byteRange('bytes=90-', 100), { offset: 90, length: 10 });
  assert.deepEqual(byteRange('bytes=-10', 100), { offset: 90, length: 10 });
  assert.deepEqual(byteRange('bytes=90-999', 100), { offset: 90, length: 10 });
});

test('invalid or unsatisfiable ranges never read outside the object', () => {
  for (const range of ['bytes=100-', 'bytes=9-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'bytes=999999999999999999999-']) {
    assert.throws(() => byteRange(range, 100), RangeError);
  }
});
