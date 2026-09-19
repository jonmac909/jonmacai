import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

const dump = JSON.stringify(snapshot);

const MOCKUP_NUMBERS = [
  '$5,000', '$10K', '$6,700', '$8,802', '$1,198', '$11,700', '$1,500', '$4,200',
  '$2,000', '$2,500', '$5,600', '$10,400', '$8,606', '$7,401', '$6,000',
  '$993', '$198.60', '$11,916', '$245', '$748', '$39', '$117', '$588', '$228',
  '$99', '$78', '$167', '$89', '$210', '−$171', '$701.89', '$701.90', '$716.39',
  '$721.35', '$748.65', '$515.93', '$546.75', '$4,421.00', '$5,586.20', '$46.02',
  '$71.82', '$66.97', '$121.30', '14.9', '133×', '51×', '39×', '$8,227.48',
  '$4,263.36', '$1,693.85', '$1,381.16', '$284.69', '$250.91', '$182.97',
  '$164.29', '$6.25', '$7,850', '$9,126', '$2,235', '$8,227', '$6,502', '$751',
  '$23.29', '$152.30', '$80.62', '$73.81', '$31.41', '$37.78', '$1,304', '$300',
  '48,200', '21,900', '9,400', '3,375', '1,240', '5M', '4,562', '233K',
  '$0.49', '$0.00', '405%', '541%', '531%', '42.7', '12.8', '8.5', '35.9',
  '59.2', '7.9', '24.7', '75.3', '11.8', '3.9', '1.2%', '24.5', '39.7', '32.4',
  '7.2', '11.2', '41.8', '71.8', '89.6', '20.9', '26.4', '56.1', '81.1', '44.8',
];

test('snapshot.json holds mockup numbers', () => {
  const missing = MOCKUP_NUMBERS.filter((n) => !dump.includes(n));
  assert.equal(missing.join(', '), '');
});

test('snapshot is grouped by page with sources.updatedAt', () => {
  const pages = [
    'home', 'sponsors', 'viral', 'youtube', 'content', 'outreach',
    'support', 'video', 'money', 'markets', 'life', 'mastermind', 'agents',
  ];
  for (const id of pages) assert.ok(snapshot.pages[id], id);
  assert.equal(snapshot.nav.badges.sponsors, 3);
  assert.equal(snapshot.goal.pct, 50);
  assert.ok(snapshot.sources.sponsors.updatedAt);
  assert.equal(snapshot.pages.home.tiles[0].value, '$5,000');
});
