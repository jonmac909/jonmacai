// /track links grouped by platform (Jon 2026-11-26, card t_b5f61b3767414d44): YouTube, Instagram, TikTok, X, LinkedIn, Facebook, then Other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformOf, PLATFORMS, trackerPage } from '../src/skool.js';
import { variantsOf } from '../src/skoolroutes.js';

const V = variantsOf({ neon: { title: 'Neon' }, levels: { title: 'Levels' }, reanimate: { title: 'Reanimate' } }); // registered words
const ORDER = ['YouTube', 'Instagram', 'TikTok', 'X', 'LinkedIn', 'Facebook', 'Other'];

test('platformOf: bio slugs, one-word variants, plain video links, unknown', () => {
  const cases = [
    [{ slug: 'ig' }, 'instagram'], [{ slug: 'tt' }, 'tiktok'], [{ slug: 'x' }, 'x'], [{ slug: 'li' }, 'linkedin'], [{ slug: 'fb' }, 'facebook'], [{ slug: 'youtube' }, 'youtube'],
    [{ slug: 'levelsx' }, 'x'], [{ slug: 'reanimateig' }, 'instagram'], [{ slug: 'neonli' }, 'linkedin'], [{ slug: 'levelsfb' }, 'facebook'],
    [{ slug: 'reanimatett' }, 'tiktok'], [{ slug: 'levels' }, 'youtube'],
    [{ slug: 'yt-seedance-ugc', created_at: '2026-11-20T10:00:00Z', youtube_url: null }, 'youtube'], // a skool_links row: utm_source=youtube
    [{ slug: 'odd', created_at: '', youtube_url: 'https://youtu.be/abcdefghijk' }, 'youtube'],
    [{ slug: 'mystery', created_at: '', youtube_url: null }, 'other'],
    [{ slug: 'pin', platform: 'pinterest', created_at: '2026-11-20' }, 'other'],
  ];
  for (const [row, want] of cases) assert.equal(platformOf(row, V), want, row.slug);
  assert.equal(platformOf({ slug: 'levelsx', platform: 'x' }), 'x'); // trackerData sets row.platform, so no variants map is needed
  assert.equal(platformOf({ slug: 'netflix', created_at: '2026-11-01' }), 'youtube'); // a slug ending in x is not an X link
});

const r = (slug, title, extra = {}) => ({ slug, title, youtube_url: null, created_at: '', capture: true, emails: 0, clicks: { d7: 0, d30: 0, all: 0 }, sales: 0, estimated: 0, conversion: null, ...extra });
const ROWS = [ // shuffled on purpose
  r('fb', 'facebook bio link', { platform: 'facebook' }), r('levelsx', 'Levels - X', { platform: 'x' }), r('mystery', 'Mystery link'),
  r('yt-a', 'Sample video A', { created_at: '2026-11-20T10:00:00Z' }), r('reanimateig', 'Reanimate - Instagram', { platform: 'instagram' }),
  r('neonli', 'Neon - LinkedIn', { platform: 'linkedin' }), r('tt', 'tiktok bio link', { platform: 'tiktok' }), r('neon', 'Neon - YouTube', { platform: 'youtube' }),
];
const WANT = { 'yt-a': 'YouTube', neon: 'YouTube', reanimateig: 'Instagram', tt: 'TikTok', levelsx: 'X', neonli: 'LinkedIn', fb: 'Facebook', mystery: 'Other' };

// Headings in page order, and which heading each slug sits under.
function groups(html) {
  const heads = [...html.matchAll(/<h2 class="plat" id="p-[a-z]+">([A-Za-z]+) /g)].map((m) => [m[1], m.index]);
  const under = {};
  for (const m of html.matchAll(/<td>([a-z0-9-]+)<\/td><td><button class="copy"/g)) under[m[1]] = heads.filter(([, i]) => i < m.index).at(-1)?.[0];
  return { order: heads.map(([h]) => h), under };
}
const check = (html) => { const g = groups(html); assert.deepEqual(g.order, ORDER); assert.deepEqual(g.under, WANT); };

test('/track page: groups in the exact order, each row under its platform, one sortable table per group', () => {
  const html = trackerPage({ rows: ROWS, sales: [], unattributed: 0, since: null }, 'https://jonmac.ai');
  check(html);
  assert.match(html, /YouTube <span class="cnt">\(2\)<\/span>/);
  assert.equal((html.match(/<table class="sortable" id="links-[a-z]+" data-col="1" data-dir="-1">/g) || []).length, 7); // default: Added, newest first
  assert.equal((html.match(/class="wrap"/g) || []).length, 8); // every table scrolls sideways on a phone (7 groups + sales)
});

test('empty groups are hidden, Other only when needed, no links shows the empty table', () => {
  const html = trackerPage({ rows: [r('x', 'x bio link', { platform: 'x' }), r('yt-a', 'Sample video A', { created_at: '2026-11-20' })], sales: [], unattributed: 0, since: null }, 'https://jonmac.ai');
  assert.deepEqual(groups(html).order, ['YouTube', 'X']);
  const none = trackerPage({ rows: [], sales: [], unattributed: 0, since: null }, 'https://jonmac.ai');
  assert.match(none, /No links yet/);
  assert.doesNotMatch(none, /class="plat"/);
});

test('planted fault: wrong order or wrong mapping fails the render check', () => {
  const html = trackerPage({ rows: ROWS, sales: [], unattributed: 0, since: null }, 'https://jonmac.ai');
  // Swap the Instagram and TikTok sections: order breaks.
  const ig = html.indexOf('<h2 class="plat" id="p-instagram">'), tt = html.indexOf('<h2 class="plat" id="p-tiktok">'), x = html.indexOf('<h2 class="plat" id="p-x">');
  const swapped = html.slice(0, ig) + html.slice(tt, x) + html.slice(ig, tt) + html.slice(x);
  assert.throws(() => check(swapped));
  // A mapping that sends X rows to YouTube: levelsx lands under the wrong heading and the X group vanishes.
  const moved = html.replace(/<tr>(?:(?!<tr>)[\s\S])*?<td>levelsx<\/td>[\s\S]*?<\/tr>/, '').replace('<h2 class="plat" id="p-instagram">', '<table><tr><td>levelsx</td><td><button class="copy"></button></td></tr></table><h2 class="plat" id="p-instagram">');
  assert.throws(() => check(moved));
  assert.equal(PLATFORMS.map(([, n]) => n).join(), ORDER.slice(0, 6).join());
});
