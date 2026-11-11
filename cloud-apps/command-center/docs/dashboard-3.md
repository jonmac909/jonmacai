# Dashboard 3 (jonmac.ai/dash)

Card 1 of the Dashboard 3 build (brief: D:\AgentTeam\briefs\dashboard3-build-2026-11-10.md): the shell (rail, theme switch, routes) and the Goals page, laid out as the approved design (briefs\dashboard3\Home.dc.html, dark = HomeDark.dc.html). Team, Blockers, Review and Money are routes that say "This page is in the next build."

Hard limits: `/dashboard` and `/dashboard-2` do not change. View only, apart from "+ Log" on Workouts and Date nights. Real numbers only: a number with no source reads "No feed" (nothing reports it) or "No data" (the source had nothing), muted with a grey dot. Targets come from `src/d2-goals.json` through `/dashboard/api/d2`, never from the page.

## Serving

- Routes `jonmac.ai/dash` (308 to `/dash/`) and `jonmac.ai/dash/*`, same Worker (`src/worker.js`).
- `/dash/` and `/dash/index.html` serve `public/d3/index.html` with Jon's session, else `public/d3/login.html` (posts `/dashboard/api/login`, reloads `/dash/`). Otherwise only `/dash/login.html`, `/dash/css/*.css` and `/dash/js/**/*.js` (from `public/d3`); anything else is a 404, and so is `/dashboard/d3/...`.
- Theme: `localStorage['d3-theme']` (`light` default, `dark`), applied on `<html data-theme>` by an inline script before paint.
- Routes are hashes: `#goals` (default), `#team`, `#blockers`, `#review`, `#money`.
- Data loads on open and every 60 s while the tab is visible. Signed out (401), the page opens `/dash/` once (sessionStorage `d3-signin`), then shows a sign-in link; no reload loop.
- Files: `public/d3/js/app.js` (shell), `goals.js` (pure `renderGoals(d2, d3, ui)`), `rail.js`, `util.js`; `css/d3.css` is the design's style block plus "Build additions".

## `GET /dashboard/api/d3`

Jon's session, `Cache-Control: no-store`, read only (`src/d3.js`). Each part is `null` when its table can't be read.

```
{ ok, build, asOf, d3: {
  rail: { dispatcher, bots, tokens, youtube },   // { state: 'g'|'y'|'r'|'none', text, ... }; dispatcher and bots are 'No feed'
  review: { count, cards, approvals, questions, oldestAt, oldestLabel } | null,
  openCards: { <project>: n } | null,
  goals: { tokenWeeks, qcFirstTry, workouts, dateNights, charges }   // same metric shape as d2
} }
```

## Number map (Goals page)

| Number | Source |
|---|---|
| Header date, week and month position | d2 `period` |
| Key results summary | tones of the 17 rows below (d2 status: ok = on track, risk = at risk, crit = off track, else no data) |
| Sponsor Revenue card, KR Collected | d2 sponsors `month` (sponsor cash), weekly `trend` added up; pace = d2 `pace` |
| Deals signed / Sponsor videos delivered / Invoices waiting | d2 sponsors `week[0..2]` |
| Blockers tile | d2 `today.blockers` (need you = those with a card) |
| To review tile, Review badge | d3 `review` (Review cards + pending approvals + open questions) |
| Tokens tile, rail Tokens line | d3 `rail.tokens` (Ana's `claude_usage` feed) |
| Jon Mac, @JonMacAI, Home Guide Press (KR and Videos Scheduled) | d2 `jonmac` / `jonmacai` / `hgp` `week[0]` (channel calendars); HGP columns = its `rows` |
| QC-passed today | d2 hgp `day[0]` |
| Passed QC first try | d3 `goals.qcFirstTry` (first render verdict per card this month) |
| Weeks token limit hit | d3 `goals.tokenWeeks` |
| Workouts, Date nights (+ Log) | d3 `goals.workouts` / `dateNights` (habits table; date nights also count calendar events named "date night") |
| Charges confirmed | d3 `goals.charges` (MoneyClaw `cw:` charge questions) |
| Open cards notes | d3 `openCards` |
| Sponsor videos due | d2 sponsors `week[1].behind` ("due Mon D" in each reason) |
| Rail YouTube line | d3 `rail.youtube` (yt_api sync errors) |

## Feed gaps (shown as "No feed")

- Rail Dispatcher and Bots lines: no dispatcher or per-bot heartbeat reaches the dashboard.
- Approved, not published: needs approve and go-live times per video from the review app.
- Dashboard 3 pages built: no feed.
- Cost per video measured: needs tokens saved per run, per card.
- Times you typed "continue": nothing counts it.
- Sponsor revenue forecast: no source, so the design's forecast line and pill are left out.

## Tests

`test/d3.test.mjs` (routing, the endpoint, the Goals mapping). Run `node --test test/*.test.mjs`.
