import test from 'node:test';
import assert from 'node:assert/strict';
import { claimQueued } from '../src/db.js';

function staleSelectDb(row) {
  const data = [{ ...row }];
  return {
    data,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              return { results: data.map((r) => ({ ...r, status: 'queued' })) };
            },
            async run() {
              if (sql.includes("status = 'claimed'")) {
                const hit = data.find((r) => r.id === args[1] && r.status === 'queued');
                if (!hit) return { success: true, meta: { changes: 0 } };
                hit.status = 'claimed';
                hit.claimed_at = args[0];
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes('payload = ?')) {
                const hit = data.find((r) => r.id === args[1]);
                if (hit) hit.payload = args[0];
                return { success: true, meta: { changes: hit ? 1 : 0 } };
              }
              return { success: true, meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

test('claimQueued only returns rows its own UPDATE changed', async () => {
  const db = staleSelectDb({
    id: 'a1', kind: 'ping', target: 'gpu2', status: 'queued', payload: '{}',
  });
  const first = await claimQueued(db, 'gpu2', 't1');
  const second = await claimQueued(db, 'gpu2', 't2');
  assert.equal(first.length, 1);
  assert.equal(first[0].id, 'a1');
  assert.equal(second.length, 0);
  assert.equal(db.data[0].status, 'claimed');
});
