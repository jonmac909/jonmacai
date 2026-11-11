# Dashboard 3 (jonmac.ai/dash)

Card 1 of the Dashboard 3 build (brief: D:\AgentTeam\briefs\dashboard3-build-2026-11-10.md): the shell (rail, theme switch, routes) and the Goals page, laid out as the approved design (briefs\dashboard3\Home.dc.html, dark = HomeDark.dc.html). Card 2 adds the Team and Blockers pages (Team.dc.html, Blockers.dc.html; dark = the *Dark files). Review, Money, Bluesky and System are routes that say "This page is in the next build."

Hard limits: `/dashboard` and `/dashboard-2` do not change. View only, apart from "+ Log" on Workouts and Date nights. Real numbers only: a number with no source reads "No feed" (nothing reports it) or "No data" (the source had nothing), muted with a grey dot. Targets come from `src/d2-goals.json` through `/dashboard/api/d2`, never from the page.

## Serving

- Routes `jonmac.ai/dash` (308 to `/dash/`) and `jonmac.ai/dash/*`, same Worker (`src/worker.js`).
- `/dash/` and `/dash/index.html` serve `public/d3/index.html` with Jon's session, else `public/d3/login.html` (posts `/dashboard/api/login`, reloads `/dash/`). Otherwise only `/dash/login.html`, `/dash/css/*.css` and `/dash/js/**/*.js` (from `public/d3`); anything else is a 404, and so is `/dashboard/d3/...`.
- Theme: `localStorage['d3-theme']` (`light` default, `dark`), applied on `<html data-theme>` by an inline script before paint.
- Routes are hashes: `#goals` (default), `#team`, `#blockers`, `#review`, `#money`.
- Data loads on open and every 60 s while the tab is visible. Signed out (401), the page opens `/dash/` once (sessionStorage `d3-signin`), then shows a sign-in link; no reload loop.
- Files: `public/d3/js/app.js` (shell), `goals.js` (pure `renderGoals(d2, d3, ui)`), `team.js` (`renderTeam`), `blockers.js` (`blockerRows`, `renderBlockers`), `rail.js`, `util.js`; `css/d3.css` is the design's style block plus the Team/Blockers design rules plus "Build additions".
- Team roster: `src/d3-team.json`, a copy of `D:\AgentTeamules\BOTS.md` (slug = the bot's `areas/<slug>.md` and its card owner name). Retired bots (Mila, Ivy, Zendaya, the old Emma/Indy areas) are not in it. `test/d3.test.mjs` fails when it drifts from BOTS.md (on GPU1).

## `GET /dashboard/api/d3`

Jon's session, `Cache-Control: no-store`, read only (`src/d3.js`). Each part is `null` when its table can't be read.

```
{ ok, build, asOf, d3: {
  rail: { dispatcher, bots, tokens, youtube },   // { state: 'g'|'y'|'r'|'none', text, ... }; dispatcher and bots are 'No feed'
  review: { count, cards, approvals, questions, oldestAt, oldestLabel } | null,
  team: { bots: [{ slug, names, role, counts, card, tone, failedToday, running, tokens, finishedToday }], names, working, waiting, failedToday, cost } | null,
  blockers: [{ id, kind: 'p'|'f'|'s', you, review?, title, at, age, owner, blocks }] | null,
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

## Team page

| Number / row | Source |
|---|---|
| Header "N bots · M roles" | `src/d3-team.json` (names / rows) |
| Working | roster bots with a card in Doing (no heartbeat, so "working" = has a Doing card) |
| Waiting on you (+ oldest) | roster bots' cards in `waiting_on_jon`; oldest = longest since its last update |
| Failed today | QC-failed proofs on the bot's cards today + `bot_runs` with status failed today |
| Bot row: Working on | the bot's open card, Doing first, then waiting on you, QC, to do (newest update first); "No open card" if none |
| Bot row: dot | red = something failed today, green = a card in Doing, yellow = waiting on you, grey = idle |
| Stage | that card's status; Running = its `bot_runs` row still running (No feed for bots that post no runs) |
| Due | that card's `due` |
| Finished today | the bot's cards moved to Review or Done today (`bot_task_events`) |
| Work so far | that card's note (links and paths removed) and the bot's open card counts |
| Rail Blockers count | the Blockers page's row count (`blockerRows`) |

## Blockers page

| Row kind | Source |
|---|---|
| Waiting on a person, Needs you | cards in `waiting_on_jon` (Blocks = the note's "Your move"); open questions not on one of those cards (team-guard and `cw:` left out, as Review); pending approvals. Questions and approvals link to Review |
| Work that failed, Ana on it | Stuck: open cards (not done, cancelled or in Review) with 2+ failed proofs in `bot_proofs`, the dispatcher's rule read live; d2 daily checks missed today |
| Access and limits | rail YouTube line red = Needs you; rail Tokens at 100% = Ana on it |
| Slow or idle, Ana on it | cards in Doing (not Jon's) with no update for 2+ hours |
| System health | Daily jobs = d2 `checks` today; Logins and limits = rail YouTube and Tokens; Feed age = d2 sponsor money source, rail tokens source, each d2 check's source |

Stuck leaves out cards in Review on purpose: those passed QC on their newest version, so they are waiting on Jon, not stuck.

## Feed gaps (shown as "No feed")

- Rail Dispatcher and Bots lines: no dispatcher or per-bot heartbeat reaches the dashboard.
- Approved, not published: needs approve and go-live times per video from the review app.
- Dashboard 3 pages built: no feed.
- Cost per video measured: needs tokens saved per run, per card.
- Times you typed "continue": nothing counts it.
- Sponsor revenue forecast: no source, so the design's forecast line and pill are left out.
- Team: Running for bots that post no runs (needs every card run to post to `bot_runs` with start and end); Tokens per bot (needs `tokens` on each run); Cost tile and column (needs token cost per run or a billing feed); per-bot "working on" beyond its open cards (needs a dispatcher heartbeat naming the card in the current run).
- Blockers: what Ana did on each row (needs Ana to log an action per blocker); Dispatcher card (dispatcher, bots, watchdog, GPU2 job: needs heartbeats); HeyGen today (needs the HeyGen submit log as a feed); Sponsor inbox sign-in; Video board feed age.

## Tests

`test/d3.test.mjs` (routing, the endpoint, the Goals mapping). Run `node --test test/*.test.mjs`.

## Video board (card stage, 2026-11-10)

- Cards carry `stage` and `stageSince` (migration 0024). The dispatcher sets them on each stage hand-off (`dash.py task-update --stage`); `stageSince` moves only when the stage changes.
- The Team page's Video board shows every open card with a stage, by stage: count, oldest time in the stage, up to 3 cards (oldest first) and "+N more". A card in QC at script or edit shows under Script QC or Render QC, timed from its last update. A stage not in the design gets its own column with no limit. Late = past the column's proposed limit.
- Cards staged only in their progress file (no hand-off yet) are not on the board until the dispatcher moves them.
