import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartners } from '../src/partners.js';

const row = (date) => ({
  collected_at: '2026-10-23T22:00:00Z',
  data: JSON.stringify({
    report: {
      date, title: `partners@ report ${date} (Daniel Humm, 14:30 PT)`, note: 'UPDATE', fileUpdatedAt: '2026-10-23T21:30:00Z',
      sections: [{ title: 'Do now (Jon)', items: ['Send Holopix reply'] }],
    },
    pipeline: { total: 3, counts: { lead: 2, signed: 1 }, fileUpdatedAt: '2026-10-23T21:36:00Z', deals: [{ brand: 'Topview', stage: 'signed', value: '4000', next: 'Paul edits video 1', nextDate: '' }] },
  }),
});

test('today report is current and carries sections and deals', () => {
  const p = buildPartners(row('2026-10-23'), Date.parse('2026-10-23T23:00:00Z'));
  assert.equal(p.current, true);
  assert.equal(p.status, 'Today');
  assert.equal(p.sections[0].items[0], 'Send Holopix reply');
  assert.equal(p.pipeline.deals[0].stage, 'Signed');
  assert.match(p.updated, /2:30 PM PT/);
});

test('an older report is flagged old, a missing one is unavailable', () => {
  assert.equal(buildPartners(row('2026-10-22'), Date.parse('2026-10-23T23:00:00Z')).status, 'Old: 2026-10-22');
  assert.equal(buildPartners(null).available, false);
});
