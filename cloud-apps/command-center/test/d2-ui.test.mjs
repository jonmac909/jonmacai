import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// Dashboard 2 pages (public/d2) against a hand-made /dashboard/api/d2 answer. The pages import /dashboard/js/*
// by absolute URL, as the browser does; here that maps to public/js/*.
const pub = new URL('../public/', import.meta.url);
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith('/dashboard/js/') ? new URL(spec.slice('/dashboard/'.length), pub).href : spec, ctx) });
const { stageOf, STAGES } = await import('../public/d2/js/pages/stages.js');
const [month, week, today, pipeline, money] = await Promise.all(['month', 'week', 'today', 'pipeline', 'money']
  .map((p) => import(`../public/d2/js/pages/${p}.js`).then((m) => m.render)));

const fixture = JSON.parse(readFileSync(new URL('./fixtures/d2-ui.json', import.meta.url), 'utf8'));
const data = () => structuredClone(fixture);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '); // what Jon reads: no tags or attributes
const count = (html, re) => (html.match(re) || []).length;
const track = { title: 'Track', available: true, channels: [{ slug: 'all', label: 'All channels', group: 'All', all: true, count: 1 },
  { slug: 'jon-mac', label: 'Jon Mac', group: "Jon's own", count: 1, counts: { created: 1, posted: 1, scheduled: 0, live: 1 }, totals: null, book: null }],
videos: [{ channel: 'jon-mac', channelLabel: 'Jon Mac', title: 'How I Price Sponsor Videos', status: 'live', views: 18400, impressions: 210000, ctr: 6.1, avd: 312, updated: 'today 11:05', updatedAt: '2026-11-05T19:00:00Z' }] };

// Every page and every Pipeline view, as Jon can open them.
function everyView(d) {
  const views = [['month', month(d)], ['week', week(d)], ['today', today(d)], ['money', money(d)]];
  for (const b of d.d2.pipeline.boards) {
    views.push([`pipeline/${b.goal}`, pipeline(d, b.goal)]);
    for (const c of b.channels) for (const v of ['calendar', 'content', 'track']) views.push([`pipeline/${b.goal}/${c.slug}/${v}`, pipeline({ ...d, pages: { ...d.pages, track } }, `${b.goal}/${c.slug}/${v}`)]);
  }
  return views;
}

test('all five pages and every Pipeline view render, with data and without', () => {
  const views = everyView(data());
  assert.ok(views.length > 30);
  for (const [id, html] of views) assert.match(html, /^<div class="wrap/, id);
  for (const render of [month, week, today, pipeline, money]) {
    for (const d of [undefined, {}, { d2: {} }, { pages: {}, d2: { goals: [], pipeline: { boards: [] } } }]) assert.equal(typeof render(d), 'string');
  }
  assert.match(pipeline({ d2: {} }), /Pipeline has no data yet/);
});

// The server's own answer (test/d2.test.mjs writes it): the two halves of the contract fit.
test('every page renders the server sample without throwing, with no raw IDs or paths', () => {
  const server = JSON.parse(readFileSync(new URL('./fixtures/d2-sample.json', import.meta.url), 'utf8'));
  const views = everyView(server);
  assert.ok(views.length >= 5);
  for (const [id, html] of views) {
    assert.match(html, /^<div class="wrap/, id);
    assert.doesNotMatch(text(html), /\bt_[0-9a-f]{8,}\b|[A-Za-z]:\\|undefined|NaN|\[object Object\]/, id);
  }
  assert.ok(server.d2.today.jon.length <= 3);
  assert.equal(server.d2.checks.length, 2);
});

test('every page starts with the stale banner, and a stale number carries a red Stale pill', () => {
  const d = data();
  for (const [id, html] of everyView(d)) {
    assert.match(html, /^<div class="wrap[^>]*>\s*<div class="head">[\s\S]*?<\/div><p class="d2stale" role="status"><b>These numbers are old:<\/b> Deposit ledger \(updated 3 days ago\) · Short-form post log/, id);
  }
  assert.match(month(d), /Deposit ledger · updated 3 days ago <span class="pill crit">Stale<\/span>/);
  assert.match(month(d), /YouTube Data API · updated 3 hr ago<\/span>/, 'a fresh source has no pill');
  d.d2.stale = [];
  assert.doesNotMatch(today(d), /d2stale/, 'no banner when nothing is old');
});

test('Month: a row per goal with target, pace, status and trend; no data says why, never 0', () => {
  const html = month(data());
  assert.equal(count(html, /class="d2row"/g), 6);
  assert.match(text(html), /Sponsors Florence On pace \$10K collected \$4,250 of \$10,000 Pace for today: \$1,533/);
  assert.match(text(html), /Home Guide Press Elle .*Videos published \(3 a week per focus channel\) 4 of 208/, 'the Home Guide Press goal counts videos published over the 16 focus channels');
  assert.doesNotMatch(text(html), /First sales on the focus channels/);
  assert.equal(count(html, /<figure class="d2trend">/g), 5, 'a goal with no weekly numbers draws no empty chart');
  assert.match(text(html), /Jon Mac Sydney On pace Videos published 2 of 13 Pace for today: 2 /);
  assert.match(html, /<rect class="now"/, 'this week stands out');
});

test('Week: done vs target, Mon to Sun with today outlined, channel rows, parked channels with no target, behind lines', () => {
  const html = week(data());
  assert.match(text(html), /3 videos per focus channel Behind Elle 11 of 30 Mon 2/, 'no repeated target after "11 of 30"');
  assert.match(html, /<li class="ok"[^>]*><small>Tue 3<\/small><b>4\/4<\/b>/);
  assert.match(html, /<li class="miss"[^>]*><small>Wed 4<\/small><b>2\/4<\/b>/, 'a past day short of target is red');
  assert.match(html, /<li class=" today"[^>]*><small>Thu 5<\/small><b>2\/4<\/b>/, 'today is outlined, not judged yet');
  assert.match(text(html), /Ruth Calder 0 of 3 Off pace Elle · Waiting on the book PDF/);
  for (const c of data().d2.goals[1].parked) {
    const li = html.match(new RegExp(`<li><span>${c.label}</span>(.*?)</li>`))?.[1];
    assert.equal(li, '<span class="muted">parked, no target</span>', c.label);
  }
  assert.match(html, /<li tabindex="0" data-open="t_[0-9a-f]{16}"><b>Behind:<\/b> Creatify integration - Jon Mac <span class="muted">· Olivia · In QC since Wednesday/);
  assert.match(html, /Rosa&#39;s House Hacks book page <span class="muted">· Lucy · The buy button opens an error page<\/span> <a href="https:\/\/homeguidepress\.com\/rosas-house-hacks"/);
  const d = data();
  d.d2.goals[1].week[0].behind = [{ title: 'Jack Mercer', owner: 'Elle', why: '1 of 3 published', page: 'pipeline/hgp/jack-mercer/calendar' }];
  assert.match(week(d), /Jack Mercer <span class="muted">· Elle · 1 of 3 published<\/span> <a href="#pipeline\/hgp\/jack-mercer\/calendar" data-page="pipeline\/hgp\/jack-mercer\/calendar">Open<\/a>/, 'a channel opens its Calendar tab here');
});

test('daily checks: Today shows tick, cross or not yet with links and facts; Week has none', () => {
  const d = data();
  const t = today(d);
  assert.match(text(t), /✓ Complete Histories Daisy Done Episode: The Fall of Constantinople/);
  assert.match(t, /<a class="btn line sm" href="https:\/\/open\.spotify\.com\/episode\/4xYzq" target="_blank" rel="noopener">Spotify episode<\/a><a class="btn line sm" [^>]*>Community post<\/a>/);
  assert.match(text(t), /not yet RBC expenses Elizabeth Not run yet Accounts read: 0 of 7 Bank data through: Nov 2 Receipts matched: no MoneyClaw RBC import · updated 3 days ago Stale/);
  assert.doesNotMatch(week(d), /Daily checks/, 'Week no longer has the checks block');
  assert.match(text(t), /Blockers 4 .*Complete Histories missed Tuesday Daisy · 2 days No episode was published on Tuesday/, 'missed days arrive as blockers');
});

test('Today: at most 3 things for Jon, each with what it unblocks, minutes, link and its own answer controls', () => {
  const d = data();
  const html = today(d);
  assert.equal(count(html, /<li class="d2jon">/g), 3);
  assert.match(text(html), /Unblocks Sponsors · 2 min Open draft in Gmail/);
  assert.match(html, /data-tdecide="\/dashboard\/api\/v1\/approvals\/a_51c0e2\/decide" data-decision="approve"/);
  assert.match(html, /data-tsend="\/dashboard\/api\/v1\/questions\/q_8e2a41\/answer"/);
  assert.equal(count(text(html), /Notion AI offers \$4,000 for 2 videos/g), 1, 'not repeated under Also needs you');
  assert.match(html, /<span class="jttag">Florence<\/span>/, 'names, never bot slugs');
  d.d2.today.jon = [...d.d2.today.jon, ...d.d2.today.needs.items.slice(3, 5)];
  assert.equal(count(today(d), /<li class="d2jon">/g), 3, 'never more than 3, whatever the server sends');
});

test('Today: one muted health line, and Expenses review folds its charges, answerable in place', () => {
  const html = today(data());
  assert.match(html, /<p class="muted d2health">3 team health alerts went to Ana<\/p>/);
  const fold = html.match(/<details data-keep="expenses">([\s\S]*?)<\/details>/)?.[1] || '';
  assert.match(fold, /^<summary><b>Expenses review \(Friday\)<\/b> <span class="muted">4 charges<\/span><\/summary>/);
  assert.equal(count(fold, /data-tsend="\/dashboard\/api\/v1\/questions\/q_cw000\d\/answer"/g), 4);
  assert.doesNotMatch(html.replace(fold, ''), /New charge: Adobe/, 'known charges only inside the fold');
  const one = data();
  one.d2.today.needs.healthToAna = 1;
  assert.match(today(one), /1 team health alert went to Ana/);
});

test('Pipeline: goal tabs, the Projects board, the deal board with Archived hidden, channel tabs', () => {
  const d = data();
  const s = pipeline(d, 'sponsors');
  assert.equal(count(s, /class="chip[^"]*" data-page="pipeline\/[a-z]+"/g), 7, 'six goals and This week');
  assert.match(s, /<section class="pjcol pjcol-todo">/, 'the /dashboard Projects board');
  assert.match(s, /Pipeline \$12,500 from 4 priced leads \(5 not priced\) · Hidden: 6 receipts, 1 refund, 9 newsletters/);
  const [active, archived] = s.split('<details class="d2arch" data-keep="archived">');
  assert.doesNotMatch(active, /data-stage="Archived"/);
  assert.match(archived, /^<summary>Show archived \(2\)<\/summary><div class="kan"><div class="kcol" data-stage="Archived"/);
  assert.doesNotMatch(s, /draggable|data-kind="sponsor\.|data-draft/, 'view only: no drag, no sponsor actions');
  const h = pipeline(d, 'hgp');
  assert.match(h, /data-page="pipeline\/hgp\/giovanni-moretti\/calendar"/);
  assert.match(text(h), /How to Train a Pitbull Puppy - Dale Whitaker Pitbulls/);
  const c = pipeline(d, 'hgp/giovanni-moretti/content');
  assert.match(c, /class="chip on" data-page="pipeline\/hgp\/giovanni-moretti\/content"/);
  assert.match(text(c), /Outliers for Giovanni Moretti .*Nonna Reacts to American Pasta/);
  assert.match(pipeline(d, 'jonmac/jon-mac/track'), /Loading Track/, 'Track loads when its tab opens');
  assert.match(text(pipeline({ ...d, pages: { ...d.pages, track } }, 'jonmac/jon-mac/track')), /How I Price Sponsor Videos Live/);
  assert.match(pipeline(d, 'nope'), /class="chip on" data-page="pipeline\/sponsors"/, 'an unknown goal opens the first');
});

test('Money: d2 tiles with their source age first, then the Money page, sponsor collections and Viral View', () => {
  const html = money(data());
  const order = ['Sponsor cash this month', 'Personal', 'Cash received', 'Money to collect', 'Collected by month', 'Viral View revenue'].map((s) => html.indexOf(s));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), String(order));
  assert.match(html, /2 deposits<br><span class="d2age">Deposit ledger · updated 3 days ago <span class="pill crit">Stale<\/span>/);
  assert.match(money({ ...data(), pages: { ...data().pages, money: { title: 'broken' } } }), /Money could not be drawn/);
});

test('nothing Jon reads looks like a raw task ID or a Windows path', () => {
  for (const [id, html] of everyView(data())) {
    const t = text(html);
    assert.doesNotMatch(t, /\bt_[0-9a-f]{6,}/i, id);
    assert.doesNotMatch(t, /\b[A-Za-z]:\\/, id);
  }
});

test('Today starts with the Daily Summary: every section folded on a phone, with its source line', () => {
  const server = JSON.parse(readFileSync(new URL('./fixtures/d2-sample.json', import.meta.url), 'utf8'));
  const html = today(server);
  assert.ok(html.indexOf('Daily Summary') < html.indexOf('For you'), 'summary sits above everything else');
  const keys = [...html.matchAll(/<details class="d2sec d2sec-(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['weather', 'calendar', 'markets', 'expenses', 'sponsors', 'jonmac', 'jonmacai', 'hgp']);
  assert.equal(count(html, /<details class="d2sec[^>]* open>/g), keys.length, 'no matchMedia here: the desktop layout, all open');
  const t = text(html);
  assert.match(t, /Weather · West Kelowna Mila Now 6°C, light rain/);
  assert.match(t, /VOO \$701\.89 2% below all-time high/);
  assert.match(t, /Open-Meteo · updated just now/);
  assert.equal(today({ d2: { today: {} } }).includes('Daily Summary'), false, 'an old answer without a summary still renders');
  globalThis.matchMedia = () => ({ matches: false });
  try { assert.equal(count(today(server), /<details class="d2sec[^>]* open>/g), 0, 'phone: folded'); } finally { delete globalThis.matchMedia; }
});

test('Pipeline (Jon, 2026-11-09): no Morning summary, video stages, week calendar, Factory/Track/Content tabs', () => {
  const d = data();
  for (const [id, html] of everyView(d)) if (id.startsWith('pipeline')) assert.doesNotMatch(html, /Morning summary/, id);
  assert.deepEqual(STAGES, ['Outlier', 'Script', 'HeyGen', 'Edit', 'QC', 'Review', 'Schedule', 'Published']);
  const cells = (...s) => s.map((x) => ({ s: x }));
  assert.equal(stageOf({ cells: cells('done', 'done', 'done', 'run') }), 'HeyGen'); // A-roll
  assert.equal(stageOf({ cells: cells('done', 'done', 'done', 'done', 'done', 'new') }), 'Edit'); // Clips
  assert.equal(stageOf({ cells: cells('done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'run') }), 'QC');
  assert.equal(stageOf({ cells: cells(...Array(9).fill('done'), 'new') }), 'Review'); // Thumbnail
  assert.equal(stageOf({ stage: 'scheduled' }), 'Schedule');
  assert.equal(stageOf({ stage: 'published' }), 'Published');
  const feed = { factory: { tiles: [
    { id: 'a', title: 'Pasta Mistakes - Giovanni Moretti', channel: 'Giovanni Moretti', owner: 'Elle', waitMin: 90, cells: cells('done', 'run') },
    { id: 'b', title: 'Other Show - Some Other Channel', channel: 'Some Other Channel', cells: cells('new') },
    { id: 'cal-1', title: 'Live One', channel: 'Jack Mercer', stage: 'published', note: 'Live 2026-11-04', link: 'https://youtu.be/abcdefghijk' }] } };
  const h = pipeline({ ...d, factory: feed }, 'hgp');
  const t = text(h);
  assert.match(t, /Videos by stage Every open video/);
  assert.match(h, /<h3>Script <span class="kn">1<\/span>/);
  assert.match(h, /<h3>Published <span class="kn">1<\/span>/);
  assert.doesNotMatch(t, /Some Other Channel/, 'only the goal channels');
  assert.match(pipeline(d, 'hgp'), /Factory feed on GPU1 has not posted/);
  // Tabs: HGP Factory table + Track, Jon Mac Content, @JonMacAI neither.
  assert.match(h, /data-page="pipeline\/hgp\/factory"/);
  assert.match(h, /data-page="pipeline\/hgp\/track"/);
  assert.match(pipeline(d, 'hgp/factory'), /class="fyview"/, 'the old Factory table');
  assert.match(pipeline(d, 'hgp/track'), /Loading Track/);
  assert.match(pipeline(d, 'jonmac'), /data-page="pipeline\/jonmac\/content"/);
  assert.match(text(pipeline(d, 'jonmac/content')), /Outliers for Jon Mac/);
  assert.doesNotMatch(pipeline(d, 'jonmacai'), /pipeline\/jonmacai\/(content|track|factory)"/);
  // This week: every channel's videos on their day.
  const w = pipeline(d, 'week');
  assert.match(w, /class="chip on" data-page="pipeline\/week"/);
  assert.equal(count(w, /class="d2wkday/g), 7);
  assert.match(text(w), /This week .*all channels/);
});

test('Sponsors board uses the ten stages Jon set, in order', () => {
  const s = pipeline(data(), 'sponsors');
  const names = [...s.matchAll(/<div class="kcol" data-stage="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.deepEqual(names, ['Leads', 'Negotiations', 'Deals', 'Deposit Invoice', 'Deposit Paid', 'Video Production', 'Video Approved', 'Video Live', 'Balance Invoice', 'Paid & Done', 'Archived']);
});
