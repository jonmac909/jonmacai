# Command Center

Live: [https://jonmac.ai/dashboard](https://jonmac.ai/dashboard)

Cloudflare Worker `jonmac-command-center`. Routes `jonmac.ai/dashboard` and `jonmac.ai/dashboard/*`. Pages render from `GET /dashboard/api/snapshot`, which starts from `fixtures/snapshot.json` and overlays live D1 snapshots. Seven pages: Today (below), Projects (below), Sponsors (`sponsors` from the Mac collector, `sponsors_cash` deposits), Viral View (`viralview` cron every 10 min), Webinar (clone funnel D1), Money (`moneyclaw` cron every 10 min, `bank_scan`) and Life (Google Calendar + habits). Critical alerts (bank code needed, payment over 7 days late) go to Today and, once each, to Telegram from the cron. Any other `#page` opens Today.

## Snapshot shape (`fixtures/snapshot.json`)

This file is the mockup data contract. The API serves only the seven pages' slices of it (`PAGES` in `src/api.js`); the other mockup pages in it are never served. Do not hard-code numbers in HTML.

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

`GET /dashboard/api/snapshot?pages=today,sponsors` returns `{ pages, nav, sources }` with only the asked-for page keys; the nav lists exactly the seven pages.

Regenerate compact JSON: `node scripts/build-snapshot.mjs`

## Auth

Cookie `__Host-cc_session` = `{unixExpiry}.{HMAC-SHA256(expiry)}` under `SESSION_SECRET`. HttpOnly, Secure, SameSite=Strict, Path=/, 30 days. Password compared in constant time. 10 failures / IP / 15 min locks that IP 15 min. 51 failures across IPs / hour locks everyone 1 hour.

Machine ingest is `POST /dashboard/api/ingest` with `Authorization: Bearer` (`MACHINE_TOKEN_MAC` / `MACHINE_TOKEN_GPU2`) and `{source, collectedAt, data}`. Sources retired on 2026-10-29 with the old MausBot team (`RETIRED_SOURCES` in `src/api.js`: `team`, `agents_gpu2`, `agents_mac`, `jon_tasks`, `needs_jon`, `partners_report`, `content_queue`, `support`, `video`, `videos`, `mastermind`, `youtube`, `cc_review_drafts`, `health`, `probe`, `webinar`, `post`) get `200 {ok: true, ignored: true}` and nothing is stored. Runners poll `POST /dashboard/api/actions/claim` every 15s. A source older than 3× its schedule (collectors: 5 min → stale after 15 min) gets a grey Stale pill. Collectors live in `collectors/mac` and `collectors/gpu2`; add a source as one `sources/*.py` module with `source(machine)` and `collect(machine)`.

## Bot API (`/dashboard/api/v1`)

Each of the 14 bots (D:\AgentTeam\rules\BOTS.md) writes one row at a time with its own token: `Authorization: Bearer ccb_…`. D1 keeps only the SHA-256 of each token (`bot_tokens`); raw tokens live in `D:\AgentTeam\secrets\bot-tokens\<slug>.token` on GPU1. `node scripts/bot-tokens.mjs [--env preview] [--rotate <slug>]` issues missing tokens, registers their hashes and revokes any other hash for that bot; it reuses existing token files. After a rotate, run it again with `--env preview`. Machine tokens and `/api/ingest` are separate and unchanged. Tables (migration `0007_bot_access.sql`, additive): `bot_tasks`, `bot_proofs`, `bot_questions`, `bot_approvals`, `bot_runs`; every row names the bot that wrote it. Client: `bots/dash.py` (installed to `D:\AgentTeam\tools\dash.py`, usage in `bots/DASH.md`).

| Method and path | Who | What |
|---|---|---|
| `GET /v1/me` | bot or Jon | who the token or session belongs to |
| `POST /v1/tasks` | bot | `{title, owner?, status?, note?, project?, minutes?, due?, key?}`; owner defaults to the caller; `owner: jon` for what only Jon can do |
| `GET /v1/tasks?owner=me\|slug\|jon&status=a,b&project=&limit=` | bot or Jon | newest change first |
| `GET /v1/tasks/:id` | bot or Jon | task with its proof |
| `PATCH /v1/tasks/:id` | bot | `{status?, owner?, note?, title?, project?, minutes?, due?}`; `qc` needs a proof not failed, `done` a proof QC passed, `cancelled` a note |
| `PATCH /v1/tasks/:id` | Jon (session + `X-CC: 1`) | `{status: done}` on an open task owned by `jon` only: the tick, no proof |
| `POST /v1/tasks/:id/proofs` | bot | `{kind: render\|url\|pdf\|test, link, note?}`; link is http(s) or a file path |
| `GET /v1/proofs?status=pending&task=` | bot or Jon | QC's queue |
| `POST /v1/proofs/:id/check` | `qc` only | `{result: passed\|failed, note?}`; failing the last supporting proof sends a `qc`/`done` task back to `doing` |
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
- Left: the projects in order, plus Unsorted when it has items. The red count is what waits on Jon: open questions, pending approvals, and open tasks that are `waiting_on_jon` or owned by `jon`.
- Main: the project's Today goal cards (Sponsors; Viral View and Webinar; Ebooks), then a board: To do, Doing, Waiting on Jon (plus its questions and approvals, answered in place), QC, Done (last 7 days).
- Right: the project's daily checklist (the newest `daily_checklists` feed; today's ticks from `bot_daily_ticks`, migration `0011_daily_ticks.sql`), the morning summary and the `calendar_today` feed. The checklist is read-only: ticked items show who and when, and open their proof when it is a web link. Unsorted has none.

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
