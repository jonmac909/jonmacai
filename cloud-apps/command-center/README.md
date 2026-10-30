# Command Center

Live: [https://jonmac.ai/dashboard](https://jonmac.ai/dashboard)

Cloudflare Worker `jonmac-command-center`. Routes `jonmac.ai/dashboard` and `jonmac.ai/dashboard/*`. Pages render from `GET /dashboard/api/snapshot`, which starts from `fixtures/snapshot.json` and overlays live D1 snapshots. Twelve pages: Today, Todo, Projects, Feed, Calendar, Content and Journal (below), Sponsors (`sponsors` from the Mac collector, `sponsors_cash` deposits), Viral View (`viralview` cron every 10 min), Webinar (clone funnel D1), Money (`moneyclaw` cron every 10 min, `bank_scan`) and Life (Google Calendar + habits). Critical alerts (bank code needed, payment over 7 days late) go to Today and, once each, to Telegram from the cron. Any other `#page` opens Today.

## Snapshot shape (`fixtures/snapshot.json`)

This file is the mockup data contract. The API serves only the dashboard pages' slices of it (`PAGES` in `src/api.js`); the other mockup pages in it, including its old `content` mockup, are never served. Do not hard-code numbers in HTML.

```
{
  generatedFrom: "mockup.html",
  asOf: "2026-09-18",
  nav: {
    brand, startMorning, startMorningMsg,
    groups: [{ title, items: [{ id, label, icon }] }],
    badges: { sponsors, content, support, video, money, markets, mastermind, agents }
  },
  goal: { label, sub, pct, see },
  sources: { [name]: { updatedAt } },
  pages: {
    home, sponsors, viral, youtube, content, outreach,
    support, video, money, markets, life, mastermind, agents
  }
}
```

Every page object is render-ready copy from the mockup: tiles (`icon, label, value, goal?, pct?, pg?, sub?`), jobs, tables, pills, button labels and `msg` strings. Progress percents are 0–100. Money strings keep `$` and commas as shown.

| Page | Main fields |
|---|---|
| `sponsors` | `tiles, septemberBar, board.columns[], collect, emails, byMonth` |
| `viral` | `tiles, pieces, byMonthChart, check, plans, keeping, customersByMonth, cohort, monthTable, traffic, dropoff, ads` |
| `money` | `personal, business, categories, fix, bankScan, netWorth, charges` |
| `life` | `tiles, workouts, dateNight, today` |

`GET /dashboard/api/snapshot?pages=today,sponsors` returns `{ pages, nav, sources }` with only the asked-for page keys; the nav lists exactly the twelve pages.

Regenerate compact JSON: `node scripts/build-snapshot.mjs`

## Auth

Cookie `__Host-cc_session` = `{unixExpiry}.{HMAC-SHA256(expiry)}` under `SESSION_SECRET`. HttpOnly, Secure, SameSite=Strict, Path=/, 30 days. Password compared in constant time. 10 failures / IP / 15 min locks that IP 15 min. 51 failures across IPs / hour locks everyone 1 hour.

## Call Ana (`/dashboard/call`, `src/call.js`)

Jon calls Ana by voice from any phone or browser. The page needs the dashboard session (no session: the login page, which returns him to the call). GPU1's Grok Voice bridge keeps one outbound WebSocket to the `CallRelay` Durable Object (`/dashboard/api/call/gpu1`, `Authorization: Bearer CALL_RELAY_SECRET`, at least 32 chars; GPU1 copy in `D:\AgentTeam\secrets\call-relay.secret`), so GPU1 has no inbound port and no DNS. The phone opens `/dashboard/api/call/phone` (session + same Origin) and sends mic audio as 16-bit mono PCM at 24 kHz; Grok's audio and caption events come back the same way. One call at a time (a new call replaces the old one), 10 starts an hour, 30 minutes per call. The idle GPU1 link pings every 30 s and is answered without waking the object (hibernation). GPU1 side: `D:\AgentTeam\grok-voice\relay_client.py`.

Machine ingest is `POST /dashboard/api/ingest` with `Authorization: Bearer` (`MACHINE_TOKEN_MAC` / `MACHINE_TOKEN_GPU2`) and `{source, collectedAt, data}`. Sources retired on 2026-10-29 with the old MausBot team (`RETIRED_SOURCES` in `src/api.js`: `team`, `agents_gpu2`, `agents_mac`, `jon_tasks`, `needs_jon`, `partners_report`, `content_queue`, `support`, `video`, `videos`, `mastermind`, `youtube`, `cc_review_drafts`, `health`, `probe`, `webinar`, `post`) get `200 {ok: true, ignored: true}` and nothing is stored. Runners poll `POST /dashboard/api/actions/claim` every 15s. A source older than 3× its schedule (collectors: 5 min → stale after 15 min) gets a grey Stale pill. Collectors live in `collectors/mac` and `collectors/gpu2`; add a source as one `sources/*.py` module with `source(machine)` and `collect(machine)`.

## Bot API (`/dashboard/api/v1`)

Each of the 14 bots (D:\AgentTeam\rules\BOTS.md) writes one row at a time with its own token: `Authorization: Bearer ccb_…`. D1 keeps only the SHA-256 of each token (`bot_tokens`); raw tokens live in `D:\AgentTeam\secrets\bot-tokens\<slug>.token` on GPU1. `node scripts/bot-tokens.mjs [--env preview] [--rotate <slug>]` issues missing tokens, registers their hashes and revokes any other hash for that bot; it reuses existing token files. After a rotate, run it again with `--env preview`. Machine tokens and `/api/ingest` are separate and unchanged. Tables (migration `0007_bot_access.sql`, additive): `bot_tasks`, `bot_proofs`, `bot_questions`, `bot_approvals`, `bot_runs`; every row names the bot that wrote it. Client: `bots/dash.py` (installed to `D:\AgentTeam\tools\dash.py`, usage in `bots/DASH.md`).

| Method and path | Who | What |
|---|---|---|
| `GET /v1/me` | bot or Jon | who the token or session belongs to |
| `POST /v1/tasks` | bot | `{title, owner?, status?, note?, project?, minutes?, due?, key?}`; owner defaults to the caller; `owner: jon` for what only Jon can do |
| `GET /v1/tasks?owner=me\|slug\|jon&status=a,b&project=&limit=` | bot or Jon | newest change first |
| `GET /v1/tasks/:id` | bot or Jon | task with its `deliverable` (`{link, kind, web}`: the newest QC-passed proof, else the newest proof; null without proof), `proofs`, `comments` (oldest first) and `history` (`{at, by, kind, detail}`; tasks from before `0010_comments.sql` start with a synthetic "created") |
| `POST /v1/tasks/:id/comments` | bot, or Jon (session + `X-CC: 1`) | `{body}` (1 to 4000 chars) → the comment. Jon's comment wakes the owner's OpenBot routine with `card_comment`, signed like `bots/hook.py`, from the optional `WEBHOOKS` secret (same JSON as `webhooks.json`); an owner without a complete route (url and secret) goes to `ana` with `forOwner`. A 503 or unreachable routine is retried after 2 s and 4 s with the same delivery id; the final result is the comment's `wakeStatus`. A bot's comment, or Jon's on a `jon` task, wakes no one |
| `PATCH /v1/tasks/:id` | bot | `{status?, owner?, note?, title?, project?, minutes?, due?}`; statuses `todo`, `doing`, `waiting_on_jon`, `qc` (needs a proof not failed), `review` (needs a proof QC passed), `cancelled` (needs a note). `done` is 403: only Jon approves |
| `PATCH /v1/tasks/:id` | Jon (session + `X-CC: 1`) | `{status: done}`: ticks an open task owned by `jon` (no proof), or approves a task in `review`. `{status: doing, comment}` (1 to 4000 chars) sends a `review` task back: the comment is saved and wakes the owner like Jon's comments, with `data.sentBack: true`. Anything else is 400 or 409 |
| `POST /v1/tasks/:id/proofs` | bot | `{kind: render\|url\|pdf\|test, link, note?}`; link is http(s) or a file path |
| `GET /v1/proofs?status=pending&task=` | bot or Jon | QC's queue |
| `POST /v1/proofs/:id/check` | `qc` only | `{result: passed\|failed, note?}`; passing moves a `qc` task to `review`; failing the last supporting proof sends a `qc`/`review`/`done` task back to `doing` |
| `POST /v1/questions` | bot | `{question, options?[≤10], context?, task?, project?, minutes?, key?}` |
| `GET /v1/questions[/:id]?status=&asked_by=&project=` | bot or Jon | read the answer |
| `POST /v1/questions/:id/close` | the asking bot | after reading the answer, or to withdraw |
| `POST /v1/questions/:id/answer` | Jon (session + `X-CC: 1`) | `{answer}`; first answer wins |
| `POST /v1/approvals` | bot | `{action (snake_case), title, payload?{} (max 4000 chars as formatted JSON, all shown to Jon), task?, project?, minutes?, key?}` |
| `GET /v1/approvals[/:id]?status=approved&action=&requested_by=&project=` | bot or Jon | approved = approved, not yet claimed |
| `POST /v1/approvals/:id/decide` | Jon (session + `X-CC: 1`) | `{decision: approve\|reject, note?}`; pending only |
| `POST /v1/approvals/:id/claim` | the requesting bot | approved → running; one claimer wins (409 for the rest) |
| `POST /v1/approvals/:id/done` | the requesting bot | running → done |
| `POST /v1/approvals/:id/release` | the requesting bot | running → approved, to retry later |
| `POST /v1/approvals/:id/cancel` | the requesting bot | pending or approved → cancelled |
| `POST /v1/runs` | bot | `{status: running\|ok\|failed, started?, ended?, tokens?, error?, task?, note?}`; own runs only |
| `GET /v1/runs?bot=&status=&since=` | bot or Jon | newest first |
| `PUT /v1/feeds/:name` | named bots | append one entry: `morning_summary {text, date?}`, `calendar_today {date, events[≤60]: {start, end, title, calendar?}}` and `claude_usage {weekPct, resetsAt?, note?}` (ana); `ebook_sales {month, usd, orders?, note?}` (home-guide-press, accounting); `daily_checklists {projects: {slug: [item ≤200 chars, no repeats] ≤12}}` (ana, developer; `dash.py daily-sync`) |
| `GET /v1/feeds/:name` | bot or Jon | newest entry |
| `POST /v1/daily` | the project's bot (`DAILY_TICKERS` in `src/bots.js`) | `{project, item, link, note?}`: ticks a daily item for today (PT). `item` is its text (any case) or 1-based number in the newest `daily_checklists`; link as for proofs. Again the same day updates link, note, bot and time |
| `GET /v1/daily?day=YYYY-MM-DD` | bot or Jon | that day's ticks (default today, PT) |
| `GET /v1/activity?bot=&before=&limit=` | bot or Jon | the Feed, newest first: task history, comments, proofs, questions and answers, approvals and decisions. `bot` keeps rows by that bot or on its work (`jon` too); `limit` up to 300 (default 100); `next` is the `before` of the next page |
| `GET /v1/journal`, `POST /v1/journal`, `PATCH` and `DELETE /v1/journal/:id` | Jon only (bots get 403) | Jon's journal (`0013_journal.sql`). `{title?, link?, note?, tags?}`: title 1 to 300 characters (default: the link's site), link http(s) only, note up to 4000, tags a list or one string of up to 10 words |
| `GET /v1/channels` | bot or Jon | the channels (`CHANNELS` in `src/channels.js`) with their `schedule` (null = not set) |
| `PUT /v1/channels/:slug` | `CHANNEL_WRITERS` | `{schedule}` (≤200 chars; `""` clears it) |
| `POST /v1/calendar` | `CHANNEL_WRITERS` | `{channel, title, date (YYYY-MM-DD), status: planned\|scheduled\|published (default planned), link?, key?}` |
| `PATCH /v1/calendar/:id` | `CHANNEL_WRITERS` | `{title?, date?, status?, link?}` |
| `GET /v1/calendar?channel=&from=&to=&limit=` | bot or Jon | by date |
| `POST /v1/outliers` | `CHANNEL_WRITERS` | `{channel, title, link, views, avg (≥1), published (YYYY-MM-DD), thumb?, key?}` |
| `POST /v1/outliers/:id/select` | `CHANNEL_WRITERS`, or Jon (session + `X-CC: 1`) | `{selected: true\|false}`; the same value again changes nothing |
| `GET /v1/outliers?channel=&selected=1\|0&limit=` | bot or Jon | best first: `views / avg`, then views |

### Today page

Default page (`#today`). Built by `src/today.js` from the snapshot. Each card shows its source and its age, and anything older than 24 h is marked stale.
- Four $10k goals, $40k in total:
  - Sponsors: the sponsor cash ledger or bank feed.
  - Viral View MRR: the `viralview` snapshot.
  - Webinar funnel: the live clone D1 `clone_session_events`, verified payments minus refunds this month.
  - Ebooks: the `ebook_sales` feed.
- One "Needs you" list:
  - Critical alerts.
  - Bot approvals (Approve / Reject call `/v1/approvals/:id/decide`).
  - Bot questions, answered in place, oldest first.
- The morning summary and Claude usage come from the feeds.

`project` is one of the slugs in `PROJECTS` (`src/projects.js`); `unsorted` or empty means none, and `?project=unsorted` lists those. `minutes` is 1 to 480, `due` is YYYY-MM-DD (migration `0009_projects.sql`, additive).

### Projects page

`#projects/<slug>` (`#projects` and unknown slugs open the first). Built by `src/projects.js` from the same bot data as Today.
- Left: the projects in order, plus Unsorted when it has items. The red count is what waits on Jon: open questions, pending approvals, tasks in `review`, and open tasks that are `waiting_on_jon` or owned by `jon`.
- Main: the project's Today goal cards (Sponsors; Viral View and Webinar; Ebooks), then a board: To do, Doing, Waiting on Jon (plus its questions and approvals, answered in place), QC, Review, Done (last 7 days). Review and Done cards lead with their deliverable (web links open; a file path is text). A Review card has Approve (asks first) and Send back (opens the card; its Send back sends the comment box). Any card opens in a modal (full screen on phones): a task with its proof, history and comment thread; a question or approval with the same Reply or Approve/Reject.
- Right: the project's daily checklist (the newest `daily_checklists` feed; today's ticks from `bot_daily_ticks`, migration `0011_daily_ticks.sql`), the morning summary and the `calendar_today` feed. The checklist is read-only: ticked items show who and when, and open their proof when it is a web link. Unsorted has none.

### Todo, Feed and Journal pages (2026-10-30)

- Todo (`#todo`, `src/todo.js`): only Jon's things for today, from the same bot data as Today. His open tasks due today, overdue or with no due date (Done), open questions (Answer), pending approvals (Approve/Reject) and tasks in Review (deliverable, Approve, Send back). Overdue first, then by `minutes`. Every row opens its card.
- Feed (`#feed`, `#feed/<bot>`): `/v1/activity`, 100 rows per page, bots by first name (`BOT_NAMES` in `public/js/ui.js`). A row on a task opens its card, even one off the board.
- Journal (`#journal`, `#journal/<tag>`): one box takes a pasted link or text, tags optional; edit and delete in place. Links show as their title and site, never as a raw URL.

### Calendar and Content pages

`#calendar/<channel>` and `#content/<channel>`: one tab per channel in `CHANNELS` (`src/channels.js`, from `D:\AgentTeam\rules\facts\channels.md`), a row of tabs per group that scrolls sideways on phones. Tables `yt_channels`, `yt_calendar`, `yt_outliers` (migration `0014_calendar_content.sql`, additive). Only `CHANNEL_WRITERS` (`src/bots.js`: jon-mac-youtube, viral-view, home-guide-press, developer, ana) write; Jon only toggles an outlier's "Selected for production".
- Calendar: the channel's posting schedule (or "not set"), then its videos by date: Coming up, then the last 60 days. Each has its status and, when it has one, a labelled link button.
- Content: the channel's outliers, best first by views over their channel's average ("4.2× avg"), with thumbnail, views, age, a link button and the Select toggle.
- Links and thumbnails are http(s) only, on the way in and again on the page.

`key` makes a create safe to retry: the same bot and key return the first row (`duplicate: true`). Errors are `{ok: false, error}` with 400/401/403/404/409/413.

### Preview

`wrangler deploy --env preview` deploys `jonmac-command-center-preview` on workers.dev with its own D1 (`command_center_preview`), no routes, no cron, no review/funnel D1s, no R2 and no production secrets. Its only secret is a preview-only `SESSION_SECRET` (kept in `D:\AgentTeam\secrets\preview-session-secret`) so `scripts/smoke-v1.sh preview` can test Jon's answer/approve endpoints. Only that Worker (`PREVIEW=1`) answers on workers.dev. Set it up once with `wrangler d1 migrations apply command_center_preview --env preview --remote` and `node scripts/bot-tokens.mjs --env preview`. `scripts/smoke-v1.sh live https://jonmac.ai` runs the read-only checks against production.

## Runners

Each machine runs exactly one action runner. A lock makes a second copy exit at once. `claimQueued` only returns rows its own `UPDATE` changed, so two pollers cannot both execute the same action.

- GPU2: Startup `CommandCenterRun.cmd` at logon; `run.cmd` restarts on failure; Task Scheduler `\CommandCenterCollect` kickstarts it every 5 min.
- Mac mini: launchd `com.jonmac.cc.run` with KeepAlive.

Restart a runner only through that service. Do not start `run.py` by hand.

## Tests

```
npm test
```

from this folder.
