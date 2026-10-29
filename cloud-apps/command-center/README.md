# Command Center

Live: [https://jonmac.ai/dashboard](https://jonmac.ai/dashboard)

Cloudflare Worker `jonmac-command-center`. Routes `jonmac.ai/dashboard` and `jonmac.ai/dashboard/*`. Pages render from `GET /dashboard/api/snapshot`, which starts from `fixtures/snapshot.json` and overlays live D1 snapshots. Live slices: Agents (`agents_mac`, `agents_gpu2` pinned Orca status), Sponsors (`sponsors` from the Mac collector), Mastermind (`mastermind` digest picks), Support (`support` Gmail drafts from the GPU2 collector), Content (`posts` table + `content_queue`; best posts from `viralview`), YouTube (`video_projects` in D1 plus `youtube` outliers from yt2), Video editor (`video` queue from the GPU2 collector), Finances and Markets (`moneyclaw` cron every 10 min), Viral View (`viralview` cron every 10 min), Cold outreach (`instantly` cron every 10 min), Review pages (`videos` and open comment counts from the review D1, shown on Video), Life (Google Calendar + habits), and Home (run-through, Needs you, glance, Telegram critical-only).

## Snapshot shape (`fixtures/snapshot.json`)

This file is the data contract. Later tasks replace a page's slice with live data. Do not hard-code numbers in HTML.

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
| `home` | `greeting, chip, tiles, runThrough, needsYou, glance, mastermindPick, life` |
| `sponsors` | `tiles, septemberBar, board.columns[], collect, emails, byMonth` |
| `viral` | `tiles, pieces, byMonthChart, check, plans, keeping, customersByMonth, cohort, monthTable, traffic, dropoff, ads` |
| `youtube` | `tiles, pipeline, remake` |
| `content` | `tiles, todayPlatforms, heat, queue, ytWeek, bestPosts` |
| `outreach` | `setup, inboxes, live` |
| `support` | `tiles, drafts, money, topics` |
| `video` | `editing, ready, finished, upload, target` |
| `money` | `personal, business, categories, fix, bankScan, netWorth, charges` |
| `markets` | `tiles, discount, read, rules` |
| `life` | `tiles, workouts, dateNight, today` |
| `mastermind` | `tiles, picks, building, parked` |
| `agents` | `tiles, waiting, all, machines[], staleSources[]` |

`GET /dashboard/api/snapshot?pages=home,sponsors` returns `{ pages, nav, goal, sources }` with only the asked-for page keys.

Regenerate compact JSON: `node scripts/build-snapshot.mjs`

## Auth

Cookie `__Host-cc_session` = `{unixExpiry}.{HMAC-SHA256(expiry)}` under `SESSION_SECRET`. HttpOnly, Secure, SameSite=Strict, Path=/, 30 days. Password compared in constant time. 10 failures / IP / 15 min locks that IP 15 min. 51 failures across IPs / hour locks everyone 1 hour.

Machine ingest is `POST /dashboard/api/ingest` with `Authorization: Bearer` (`MACHINE_TOKEN_MAC` / `MACHINE_TOKEN_GPU2`) and `{source, collectedAt, data}`. Source `post` inserts into the `posts` table (one publish at a time). Source `content_queue` is the Content Marketing agent's scheduled posts (`~/.command-center/content-queue.json` on GPU2). Approve writes `~/.command-center/content-approvals.jsonl` and pings that agent's Orca terminal. Log a post is `POST /dashboard/api/posts`. Runners poll `POST /dashboard/api/actions/claim` every 15s. A source older than 3× its schedule (collectors: 5 min → stale after 15 min) gets a grey Stale pill. Collectors live in `collectors/mac` and `collectors/gpu2`; add a source as one `sources/*.py` module with `source(machine)` and `collect(machine)`.

## Bot API (`/dashboard/api/v1`)

Each of the 14 bots (D:\AgentTeam\rules\BOTS.md) writes one row at a time with its own token: `Authorization: Bearer ccb_…`. D1 keeps only the SHA-256 of each token (`bot_tokens`); raw tokens live in `D:\AgentTeam\secrets\bot-tokens\<slug>.token` on GPU1. `node scripts/bot-tokens.mjs [--env preview] [--rotate <slug>]` issues missing tokens, registers their hashes and revokes any other hash for that bot; it reuses existing token files. After a rotate, run it again with `--env preview`. Machine tokens and `/api/ingest` are separate and unchanged. Tables (migration `0007_bot_access.sql`, additive): `bot_tasks`, `bot_proofs`, `bot_questions`, `bot_approvals`, `bot_runs`; every row names the bot that wrote it. Client: `bots/dash.py` (installed to `D:\AgentTeam\tools\dash.py`, usage in `bots/DASH.md`).

| Method and path | Who | What |
|---|---|---|
| `GET /v1/me` | bot or Jon | who the token or session belongs to |
| `POST /v1/tasks` | bot | `{title, owner?, status?, note?, key?}`; owner defaults to the caller |
| `GET /v1/tasks?owner=me\|slug&status=a,b&limit=` | bot or Jon | newest change first |
| `GET /v1/tasks/:id` | bot or Jon | task with its proof |
| `PATCH /v1/tasks/:id` | bot | `{status?, owner?, note?, title?}`; `qc` needs a proof not failed, `done` a proof QC passed, `cancelled` a note |
| `POST /v1/tasks/:id/proofs` | bot | `{kind: render\|url\|pdf\|test, link, note?}`; link is http(s) or a file path |
| `GET /v1/proofs?status=pending&task=` | bot or Jon | QC's queue |
| `POST /v1/proofs/:id/check` | `qc` only | `{result: passed\|failed, note?}`; failing the last supporting proof sends a `qc`/`done` task back to `doing` |
| `POST /v1/questions` | bot | `{question, options?[≤10], context?, task?, key?}` |
| `GET /v1/questions[/:id]?status=&asked_by=` | bot or Jon | read the answer |
| `POST /v1/questions/:id/close` | the asking bot | after reading the answer, or to withdraw |
| `POST /v1/questions/:id/answer` | Jon (session + `X-CC: 1`) | `{answer}`; first answer wins |
| `POST /v1/approvals` | bot | `{action (snake_case), title, payload?{}, task?, key?}` |
| `GET /v1/approvals[/:id]?status=approved&action=&requested_by=` | bot or Jon | approved = approved, not yet claimed |
| `POST /v1/approvals/:id/decide` | Jon (session + `X-CC: 1`) | `{decision: approve\|reject, note?}`; pending only |
| `POST /v1/approvals/:id/claim` | the requesting bot | approved → running; one claimer wins (409 for the rest) |
| `POST /v1/approvals/:id/done` | the requesting bot | running → done |
| `POST /v1/approvals/:id/release` | the requesting bot | running → approved, to retry later |
| `POST /v1/approvals/:id/cancel` | the requesting bot | pending or approved → cancelled |
| `POST /v1/runs` | bot | `{status: running\|ok\|failed, started?, ended?, tokens?, error?, task?, note?}`; own runs only |
| `GET /v1/runs?bot=&status=&since=` | bot or Jon | newest first |
| `PUT /v1/feeds/:name` | named bots | append one entry: `morning_summary {text, date?}` and `claude_usage {weekPct, resetsAt?, note?}` (ana); `ebook_sales {month, usd, orders?, note?}` (home-guide-press, accounting) |
| `GET /v1/feeds/:name` | bot or Jon | newest entry |

### Today page

Default page (`#today`; the old Home is under Archive). Built by `src/today.js` from the snapshot. Each card shows its source and its age, and anything older than 24 h is marked stale.
- Four $10k goals, $40k in total:
  - Sponsors: the sponsor cash ledger or bank feed.
  - Viral View MRR: the `viralview` snapshot.
  - Webinar funnel: the live clone D1 `clone_session_events`, verified payments minus refunds this month.
  - Ebooks: the `ebook_sales` feed.
- One "Needs you" list:
  - Critical alerts.
  - Bot approvals (Approve / Reject call `/v1/approvals/:id/decide`) and Ana's pending deliverables.
  - Bot questions and Ana's open questions, answered in place, oldest first.
  - Videos ready for review, and Ana's Waiting On You.
- The morning summary and Claude usage come from the feeds.

`key` makes a create safe to retry: the same bot and key return the first row (`duplicate: true`). Errors are `{ok: false, error}` with 400/401/403/404/409/413.

### Preview

`wrangler deploy --env preview` deploys `jonmac-command-center-preview` on workers.dev with its own D1 (`command_center_preview`), no routes, no cron, no review/funnel D1s, no R2 and no production secrets. Its only secret is a preview-only `SESSION_SECRET` (kept in `D:\AgentTeam\secrets\preview-session-secret`) so `scripts/smoke-v1.sh preview` can test Jon's answer/approve endpoints. Only that Worker (`PREVIEW=1`) answers on workers.dev. Set it up once with `wrangler d1 migrations apply command_center_preview --env preview --remote` and `node scripts/bot-tokens.mjs --env preview`. `scripts/smoke-v1.sh live https://jonmac.ai` runs the read-only checks against production.

## Review pages

The Video page lists each review-ready cut with its review status and open comment count. Rows come from the review portal's D1 (`REVIEW_DB`, the `videos` and `comments` tables) and link to `https://jonmac.ai/review/<slug>`. The portal is private: a signed-out visitor lands on the passcode page and then continues to the page they opened, so a passcode prompt there is expected on first open.

## Daily drafts

Three slots per configured platform per America/Vancouver day, stored in `content_drafts` and keyed by tenant (`CONTENT_TENANT`, default `jon`). `CONTENT_PLATFORMS` overrides the grid. Cron and **Fill today's drafts** insert missing slots only. A human edit or approval is never overwritten. No connected product fact means status `failed`, not invented copy. Unconfigured grid platforms show as unavailable. Approve stays on the worker and does not publish.


## Instantly (Cold outreach)

Worker cron (every 10 min) pulls Instantly API v2 with `INSTANTLY_API_KEY` as `Authorization: Bearer`. Endpoints used:

- `GET https://api.instantly.ai/api/v2/accounts` — `email`, `status` (1 = Active), `daily_limit`, `warmup_status` (1 = Active)
- `POST https://api.instantly.ai/api/v2/accounts/warmup-analytics` — `aggregate_data[email].health_score`
- `GET https://api.instantly.ai/api/v2/campaigns` — `id`, `name`, `status` (0 Draft, 1 Active, 2 Paused, 3 Completed, 4 Running Subsequences), `sequences[0].steps`
- `GET https://api.instantly.ai/api/v2/campaigns/analytics` — `leads_count`, `emails_sent_count`, `open_count`, `reply_count` (today via `start_date` / `end_date`)
- `GET https://api.instantly.ai/api/v2/campaigns/analytics/overview` — `total_interested`
- `POST https://api.instantly.ai/api/v2/campaigns/{id}/activate` — Launch, only after confirm

Daily max = sum of `daily_limit` on accounts with `status === 1`. Setup steps tick from that snapshot. Test-sent is manual.

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
