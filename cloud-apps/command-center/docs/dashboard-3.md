# Dashboard 3 (jonmac.ai/dash)

Card 1 of the Dashboard 3 build (brief: D:\AgentTeam\briefs\dashboard3-build-2026-11-10.md): the shell (rail, theme switch, routes) and the Goals page, laid out as the approved design (briefs\dashboard3\Home.dc.html, dark = HomeDark.dc.html). Card 2 adds the Team and Blockers pages (Team.dc.html, Blockers.dc.html; dark = the *Dark files). Review, Money, Bluesky and System are routes that say "This page is in the next build."

Hard limits: `/dashboard` and `/dashboard-2` do not change. View only, apart from "+ Log" on Workouts and Date nights. Real numbers only: a number with no source reads "No feed" (nothing reports it) or "No data" (the source had nothing), muted with a grey dot. Targets come from `src/d2-goals.json` through `/dashboard/api/d2`, never from the page.

## Serving

- Routes `jonmac.ai/dash` (308 to `/dash/`) and `jonmac.ai/dash/*`, same Worker (`src/worker.js`).
- `/dash/` and `/dash/index.html` serve `public/d3/index.html` with Jon's session, else `public/d3/login.html` (posts `/dashboard/api/login`, reloads `/dash/`). Otherwise only `/dash/login.html`, `/dash/css/*.css` and `/dash/js/**/*.js` (from `public/d3`); anything else is a 404, and so is `/dashboard/d3/...`.
- Theme: `localStorage['d3-theme']` (`light` default, `dark`), applied on `<html data-theme>` by an inline script before paint.
- Routes are hashes: `#goals` (default), `#team`, `#factory`, `#track` (and `#track/<channel>`), `#blockers`, `#review`, `#scripts`, `#hyper`, `#money`.
- Data loads on open and every 60 s while the tab is visible (the Factory page also reads its own board, `/dashboard/api/d3/factory`, every 3 s while it is open). Signed out (401), the page opens `/dash/` once (sessionStorage `d3-signin`), then shows a sign-in link; no reload loop.
- Files: `public/d3/js/app.js` (shell), `goals.js` (pure `renderGoals(d2, d3, ui)`), `team.js` (`renderTeam`), `blockers.js` (`blockerRows`, `renderBlockers`), `rail.js`, `util.js`; `css/d3.css` is the design's style block plus the Team/Blockers design rules plus "Build additions".
- Team roster: `src/d3-team.json`, a copy of `D:\AgentTeam
ules\BOTS.md` (slug = the bot's `areas/<slug>.md` and its card owner name). Retired bots (Mila, Ivy, Zendaya, the old Emma/Indy areas) are not in it. `test/d3.test.mjs` fails when it drifts from BOTS.md (on GPU1).

## `GET /dashboard/api/d3`

Jon's session, `Cache-Control: no-store`, read only (`src/d3.js`). Each part is `null` when its table can't be read.

```
{ ok, build, asOf, d3: {
  rail: { dispatcher, bots, tokens, youtube },   // { state: 'g'|'y'|'r'|'none', text, ... }; dispatcher and bots are 'No feed'
  review: { count, cards, approvals, questions, oldestAt, oldestLabel } | null,
  team: { bots: [{ slug, names, role, counts, card, tone, failedToday, running, tokens, finishedToday }], names, working, waiting, failedToday, cost } | null,
  blockers: [{ id, kind: 'p'|'f'|'s', you, review?, title, at, age, owner, blocks }] | null,
  openCards: { <project>: n } | null,
  factory: { ...newest video_line entry, at, stale } | null,   // Factory page; stale = posted more than 3 minutes ago
  goals: { tokenWeeks, qcFirstTry, workouts, dateNights, charges }   // same metric shape as d2
} }
```

## `GET /dashboard/api/d3/factory`

The Factory page's light read: Jon's session (the same rule as `/dashboard/api/d3`), `Cache-Control: no-store`, read only, one D1 query (the newest `video_line` entry). Answer: `{ ok, asOf, factory }`, where `factory` is exactly `d3.factory` above (`null` when nothing was posted). When the table can't be read it answers 503, so the page keeps what it shows.

## Number map (Goals page)

| Number | Source |
|---|---|
| Header date, week and month position | d2 `period` |
| Key results summary | tones of the 13 rows below (d2 status: ok = on track, risk = at risk, crit = off track, else no data) |
| Sponsor Revenue card, KR Collected | d2 sponsors `month` (sponsor cash), weekly `trend` added up; pace = d2 `pace` |
| Deals signed / Sponsor videos delivered / Invoices waiting | d2 sponsors `week[0..2]` |
| Blockers tile | d2 `today.blockers` (need you = those with a card) |
| To review tile, Review badge | d3 `review` (Review cards + pending approvals + open questions) |
| Tokens tile, rail Tokens line | d3 `rail.tokens` (Ana's `claude_usage` feed) |
| Jon Mac, @JonMacAI, Home Guide Press (KR and Videos Scheduled) | d2 `jonmac` / `jonmacai` / `hgp` `week[0]` (channel calendars); HGP columns = its `rows` |
| QC-passed today | d2 hgp `day[0]` |
| Passed QC first try | d3 `goals.qcFirstTry` (first render verdict per card this month) |
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
- Sponsor revenue forecast: no source, so the design's forecast line and pill are left out.
- Team: Running for bots that post no runs (needs every card run to post to `bot_runs` with start and end); Tokens per bot (needs `tokens` on each run); Cost tile and column (needs token cost per run or a billing feed); per-bot "working on" beyond its open cards (needs a dispatcher heartbeat naming the card in the current run).
- Blockers: what Ana did on each row (needs Ana to log an action per blocker); Dispatcher card (dispatcher, bots, watchdog, GPU2 job: needs heartbeats); HeyGen today (needs the HeyGen submit log as a feed); Sponsor inbox sign-in; Video board feed age.

## Tests

`test/d3.test.mjs` (routing, the endpoint, the Goals mapping). Run `node --test test/*.test.mjs`.

## Video board (card stage, 2026-11-10)

- Cards carry `stage` and `stageSince` (migration 0024). The dispatcher sets them on each stage hand-off (`dash.py task-update --stage`); `stageSince` moves only when the stage changes.
- The Team page's Video board shows every open card with a stage, by stage: count, oldest time in the stage, up to 3 cards (oldest first) and "+N more". A card in QC at script or edit shows under Script QC or Render QC, timed from its last update. A stage not in the design gets its own column with no limit. Late = past the column's proposed limit.
- Cards staged only in their progress file (no hand-off yet) are not on the board until the dispatcher moves them.

## Bluesky and System pages (card 4, 2026-11-11)

- Routes `#bluesky` and `#system`. Both draw from the d2 answer only for the header; there are no live numbers, so they add no feed gaps.
- Text lives in `public/d3/js/bluesky-data.js` and `public/d3/js/system-data.js`, copied unchanged from the approved designs (`D:\AgentTeam\briefs\dashboard3\Bluesky.dc.html`, `System.dc.html`) by `scripts/d3-text-from-design.mjs <designDir> <outDir>`. A test re-runs it and fails if the files drift from the designs.
- Layout: `bluesky.js` (tabs Vision and plans, OKRs 2027, Quarters, Departments, 2026 reflection, Your call) and `system.js` (Map, How work moves, Team and your day, December goals). Styles are the designs' rules in `d3.css`.
- Ana keeps the System pills true: in `system-data.js` set a part's `b` to `'ready'` (In place) or `'fix'` (To fix); no `b` reads To build. Pills read as of Nov 10 until then. If the designs change, re-run the script instead of editing by hand.

## Factory page (2026-11-11)

- Route `#factory`, rail item "Factory", `public/d3/js/factory.js` (pure `renderFactory(d3, ui)`). Live progress of the video program, laid out as the older Factory page on `/dashboard`: one compact table, a row per video and a column per step, or per stage when the board sends stages (2026-11-12, below). The first look (one card per video) was dropped on 2026-11-11.
- Source: the feed `video_line` (`src/bots.js` `FEEDS`; writers developer and ana). A pusher on GPU1 posts the program's board as often as every 5 s: `dash.py feed-put video_line --data-file board.json`. Only the newest entry is ever read, so the feed keeps the last 30 minutes (`keepMinutes: 30`; `feedKeepMs(spec)` turns a feed's `keepMinutes` or `keepDays` into milliseconds and `putFeed` drops older entries of that feed on each post). The body is `{updated, scheduler_running, channels, counts: {jobs, done, running, needs_person}, jobs: [{id, channel, pipeline, created, state, step, minutes_in_state, note, steps_done, steps_total, needs_person: {step, why, look_at, since} | null, final, steps: [{name, label, status, tries, minutes, started, ended, note, fix, doing, done, total, parts}], stages: [the same shape as a step], started, ended, total_minutes, review_url}], events: [text, newest last], unreadable_jobs}`. A step's `done` and `total` are optional whole numbers. A wrong shape is a 400. Long input is cut, not refused: 60 videos, 20 steps and 20 stages a video, the newest 20 events, 300 characters a string. The program's steps are now six (source, script, pack, plan, render, gates); the page draws whatever steps and parts the board sends, in the board's order, and no name is written into the page.
- `d3.factory` is the newest entry plus `at` (when it was posted) and `stale` (true once it is more than 3 minutes old); `null` when nothing was posted or the table can't be read.
- Channels (2026-11-11, optional): `channels` is a list of at most 20 `{id (1 to 40 characters), label (1 to 60), note (at most 200, optional)}`, in the order the page shows them. Strict: a wrong type, an empty or too long `id` or `label`, a too long `note`, the same `id` twice, or more than 20 is a 400. `id` and `label` are trimmed; an empty `note` is left out. A board without `channels` is kept as before.
- Parts (2026-11-11): a step may carry `parts`, its own sub-steps in working order: at most 30 of `{name (1 to 40 characters), status (todo, running, done, failed or waiting), note (at most 300 characters, may be empty or left out)}`. `note` is a short result line for done, the reason for failed or waiting, or what is happening for running. A part may also carry its live progress, all optional and kept only when sent: `done` and `total` (whole numbers, 0 or more), `started` (an ISO time, or null) and `seconds` (a number, 0 or more, or null: how long the part took once it ended). Unlike the rest of the board nothing in `parts` is cut: a wrong type, an unknown status, a name or note that is too long, a `done`, `total`, `started` or `seconds` of the wrong kind, or more than 30 parts is a 400. A step without `parts` is kept as before.
- Stages, whole time and review page (2026-11-12, all optional): a step may carry `label` (text, cut at 40 characters), kept only when sent. A video may carry `stages`: the steps folded into the few columns the page shows (Outlier, Script, QC, ...), each shaped as a step with a `label`, at most 20 (more are cut); kept only when sent, beside the steps. A stage's `status` may also be `skip` (not a part of this video) or `waiting`. A video's `started` and `ended` are ISO times or null (`ended` is null while the video is still being made) and `total_minutes` is a number of 0 or more, or null; a video that sends none gets null for all three. `review_url` is the video's review page: it is kept only when it is `https://jonmac.ai/review/...` (letters, digits and `. _ ~ / -`, at most 200 characters after `/review/`); any other address is dropped, not refused. A wrong type (stages that are not a list of steps, a time that is not a time, a `total_minutes` or `review_url` of the wrong kind) is a 400.
- Head: "Factory" with one status pill on the right: green "Live · 12s ago" (counts up every second), red "Stale: last update 4m ago" (3 minutes without a post), red "Not publishing yet" (no entry), plus red "Scheduler stopped" when `scheduler_running` is false. Then one line: how many are live now, a count per step (a video counts at its first step that is not done), Done, and a pill "N need you" (red above zero). Under the title the page says "Every video in the new video program, stage by stage."
- Table with stages (2026-11-12): when any video carries `stages`, the page draws the stages and not the steps: one column per stage, in the board's order, and no part columns, even when the steps carry parts. A column's heading is the stage's `label`, else its name; several stages may share a label (three read "QC"), since columns are told apart by name. A video with no stages on such a board shows its steps, without their parts. Cells are those of the table with no parts, plus: `skip` is a grey dash (tooltip "Not a part of this video"); `waiting` reads "Waiting" with one short line (the stage's `doing`, else its `note`; the full text is the tooltip); a stage not running with `done` above zero and a `total` shows a bar and the count ("3/8"), without the Live dot. The line at the top has no count per column here: it reads "N live now, N In progress, N Done" and the "N need you" pill (In progress is every video that is not done and does not need you, so a failed one counts).
- Total time (2026-11-12): when any video sends `started`, the last column's heading is "Total time" (else it stays "Waiting"), in every table. Under the state pill it shows the whole time the video took, in whole minutes (`40m`, `2h 5m`): from `started` to `ended`; while there is no `ended`, from `started` to now, counted in the browser on a live board; on a stale board, or without usable times, the board's `total_minutes`. A video that sends none of these keeps its minutes in the current state.
- Review link (2026-11-12): when a done video sends `review_url`, its green "Done" pill is a link to that page (opens in a new tab) and the finished file is not shown; without one it is the plain pill whose tooltip is the file. The page checks the address again and links only to `https://jonmac.ai/review/...`.
- Table with no parts (an older board): first column the video (id bold, channel small), then one column per step in pipeline order (names from the videos' own steps, first letter capitalised), last column "Waiting". Cells: done is a green check with its minutes; running is a blue bar (`done`/`total` when sent, else a moving bar that reads "In progress") with a green "Live" dot and the step's `doing`; failed is a red X with a short reason (the full `note` and `fix` are the tooltip); the first step not started that has a reason (the step's `note`, else the video's `note`) reads "Waiting" with one short line; a later step is a grey circle; a step a video does not have is blank. The last column is the minutes in the current state (`59m`, `2h 15m`), a red "Needs you" pill, or a green "Done" pill whose tooltip is the finished file. File paths show nowhere else, except "Look at" in the Needs you list.
- Table with parts: when any step carries parts, the table has one narrow column per part (about 83 px), grouped under its step (a heading row of steps over a heading row of part names; the names come from the board, in order, with underscores shown as spaces; a part only some videos send still gets its column). Each video is two table rows that read as one: a short summary per step, then the part cells.
- A part's cell is a progress bar and one short line, never a made-up percentage. Not started: an empty grey track. Done: a full green track, a small check and the time it took when `seconds` is sent ("54s", "10m 14s", "1h 2m"). Running with a `total` above zero: a blue fill at `done`/`total`, the count ("61 / 198") and the clock. Running without a total: a blue striped track that moves (it says "working", not how far) and the clock. The clock is counted in the browser from `started` ("2:07", "1:02:07") and ticks every second; with no `started` there is no clock. Failed: a red track, an X and the reason. Waiting: an amber track, a clock icon and the reason. A part the video does not have is blank. The `note` is always the tooltip. On a stale board the stripe stands still and no clock counts.
- A step's summary (the upper row, across the step's parts): a thin bar of parts done out of that video's parts, the count ("8/12") and the step's minutes; what a running step is `doing` is the tooltip. A failed step adds "Failed, try N" in red (the `note` and `fix` are the tooltip); the first step not started that has a reason adds "Waiting" and the reason. It is plain text on the card: the green band of the first parts table (bar, LIVE, text, pinned while scrolling) was dropped on 2026-11-11. A step that sends no parts (one video among newer ones) keeps its single cell, spanning that step's columns, without the green Live fill.
- Channels on the page: when the board sends `channels`, the table is grouped by channel in the board's order: a heading row (the label, and "N videos"), then that channel's videos (those whose `channel` equals the channel's `id`, in the usual row order). A channel with no video still shows, with one quiet row: its `note`, or "No video in the program yet". Videos whose channel is not listed go last, under a heading of their own channel id ("No channel" when it is empty). Under a heading the video cell shows only the id. A board without `channels` has no headings.
- Wide table: only the Video column stays put on the left and the Waiting column on the right while the part columns scroll sideways inside the card; nothing else is sticky (a channel's heading sits in the Video column's cell, so it stays in view). On a phone the Waiting column scrolls with the rest, to leave room.
- Plain table, sticky Video column and many stages (2026-11-12): the Video column (and each channel heading, which sits in it and runs on over an empty cell) stays put at every width while the stages scroll. With more than 8 stage columns (a staged board has 15) the table is narrow (`.fyt`): 4.6rem per stage, 11rem for a stage that shows text (the title), Video 10rem (6.5rem on a phone), about 1480 px in all instead of about 2490.
- Row order: needs you, failed, running, waiting, done; oldest `created` first inside a group (inside each channel when there are channels). A stale board shows nothing as live.
- Under the table: "Needs you" (video, step, why, where to look) only when a video needs a person; "Latest events", newest first, Kelowna time, at most 12.
- Live: while the page is open and the tab is visible the shell reads `/dashboard/api/d3/factory` every 3 s and redraws every second in between on the server's clock, so the clocks and "Live · Ns ago" count up; the full 60 s load stays. `syncFactory(main, html)` rewrites only what changed: rows are matched by id (a video's two rows are `id` and `id~parts`, a channel's heading `~ch:id`), and inside a row only the texts, bar widths and cells that differ are touched, so the table does not jump, keeps its sideways scroll and the moving bars keep moving. It draws the page whole only on the first draw or when the columns change. On a phone the table scrolls sideways inside its box.
- Styles: the `fy*` rules at the end of `css/d3.css`, the old page's sizes on Dashboard 3's theme variables (light and dark).
- The name: this is Dashboard 3's Factory page. The older Factory page on `/dashboard` (one overwritten row, `tools/factory_publish.py`) is a different source and is unchanged.
- The System page's Sources list shows the feed as "Video program board", stale after 3 minutes.

## Track page (2026-11-11)

- Route `#track` (all channels) and `#track/<channel>` (one channel), rail item "Track" next to Factory. It is the old `/dashboard/#track` page: same numbers, same tables, same controls. View only.
- Nothing is rewritten. The shell loads the old page's own module `/dashboard/js/pages/track.js` the first time Track opens (`track(page, null, channel)` and `setSort`), and reads the same data the old page reads: `GET /dashboard/api/snapshot?pages=track` -> `pages.track`, on each open. `public/d3/js/track.js` only wraps that markup in `.tkpage` (`renderTrack(page, channel, draw)`, `trackSub(hash)`) and covers "Loading Track" and "Could not load Track".
- Controls, handled in `app.js`: a column heading sorts (`data-tsort`), a channel tab or row opens `#track/<channel>` (`data-page`), "Copy" copies a video's tracked link (`data-copy`), and a "Connect" link opens as on the old page.
- Styles: the old stylesheet is not loaded, because its page-wide rules (`.card`, `.chip`, `table`) would restyle the rest of Dashboard 3. The rules Track needs are copied from `public/css/components.css` into `css/d3.css` under `.d3 .tkpage`, on Dashboard 3's theme variables. If the old Track page gains new markup, add its rule there.

## Hyper page (2026-11-11)

- Route `#hyper`, rail item "Hyper" after Scripts. It shows the HyperFrames app (the video editor that runs on GPU1, `D:\AgentTeam\hyperframes-fork`) in a frame that fills the window under the header, with an "Open in its own tab" link.
- The app is not part of this Worker. It is served at `https://hyper.jonmac.ai` by its own Worker, `cloud-apps/hyper` (see its README), which passes requests to the app on GPU1 over a private tunnel. The app has no sign-in of its own, so that Worker lets in only a browser that came from this page.
- Sign-in hand-off (`src/hyper.js`): the dashboard cookie is host-only and never leaves `jonmac.ai`, so the page asks `GET /dashboard/api/hyper/ticket` (session cookie) for `{ origin, url, seconds }`. `url` is `https://hyper.jonmac.ai/__enter?t=<ticket>`; the ticket is `<expiry>.<HMAC-SHA256("hyper.<expiry>")>` under `SESSION_SECRET` and lasts 60 seconds. The gate Worker asks `GET /dashboard/api/hyper/check?t=<ticket>` over a service binding (200 `{ok:true}` or 401 `{ok:false}`; no session, the ticket is the proof) and then sets its own 12-hour cookie. A session cookie value or a Google sign-in state never passes as a ticket (different signed text), and a ticket dated more than 60 seconds ahead is refused.
- `public/d3/js/hyper.js`: `renderHyper(d2)` (header, a status line, a hidden frame) and `openHyper(main, getJson)` (gets the ticket, points the frame at `url`; only an https address is ever used). `app.js` draws the page once per visit: the 60 s data reload does not redraw it, because a redraw would restart the app. Signed out, the page shows the sign-in link and no frame.
- When GPU1 is off, or the app or its tunnel is not running there, the frame shows the gate Worker's "Hyper is not reachable" page.
- Styles: `.d3 .card.hy` and the full-width shell rule at the end of `css/d3.css`.
- Tests: `test/d3-hyper.test.mjs` (ticket and check endpoints, page and menu), and `cloud-apps/hyper/worker.test.mjs` for the gate.

## Home page: saved schedule and goals (2026-11-12)
Built to match the handover mockup (home-mockup.html). Before this, Home was read-only.
- Tables (migration `0026_home_tasks.sql`): `home_tasks` (one row per task or repeating series), `home_task_days` (one row per day touched: ticked, moved "just this one", or removed for that day), `home_goals` and `home_goal_logs` (goals added with "+ Add goal"). The migration seeds the standing rules (from Mon 9 Nov 2026) and the Book trip checklist. Deleting only sets `deleted = 1`.
- `GET /dashboard/api/home` (src/home.js `homeData`): tasks, day overrides, goals, logs, workout and date-night habit logs, and the Google Calendar week (timed events, 21 days each side) when connected.
- Writes (session + `X-CC: 1`): `POST /home/tasks`, `PATCH /home/tasks/:id` (add `scope: 'once', occ` for one day), `DELETE /home/tasks/:id` (`?scope=once&occ=` for one day), `POST /home/tasks/:id/day` `{ day, done, on }`, `POST /home/goals`, `DELETE /home/goals/:id`, `POST /home/goals/:id/log` (`{ step, done }`, `{ done }`, `{ add }` or `{ value }`). A tick on a workout or date-night task also writes the habit log.
- Carry-over rules live in `public/d3/js/sched.js` `dayItems`: retry slot the same day, then carried to today as Late (only within the week for repeating tasks, 14 days for one-offs, never next to the task's own slot today); a moved day shows "make-up" on the new day and a faded "Moved" on the usual day.
- Google Calendar: connect once at `/dashboard/api/google/start`. The sign-in uses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` when set, else the YouTube client (`YT_CLIENT_ID` / `YT_CLIENT_SECRET`, Google project jon-mac-track-513718, which has the Calendar API on, this callback allowed and jon@thejonmac.com as a test user); `SESSION_SECRET` signs the state (redirect URI `https://jonmac.ai/dashboard/api/google/callback`). After connecting, the callback pulls the calendar at once and goes back to `/dash/`.
- Not built yet: sending reminders or texts (saved only), the 8am text and Friday review message, writing tasks into Google Calendar, drag on touch screens (a tap opens the pop-up).
- Tests: `test/home.test.mjs` (server, real SQLite) and `test/d3-home.test.mjs` (page).
