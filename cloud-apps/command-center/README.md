# Command Center

Live: [https://jonmac.ai/dashboard](https://jonmac.ai/dashboard)

Cloudflare Worker `jonmac-command-center`. Routes `jonmac.ai/dashboard` and `jonmac.ai/dashboard/*`. Pages render from `GET /dashboard/api/snapshot`, which starts from `fixtures/snapshot.json` and overlays live D1 snapshots. Live slices: Agents (`agents_mac`, `agents_gpu2` pinned Orca status), Sponsors (`sponsors` from the Mac collector), Mastermind (`mastermind` digest picks), Support (`support` Gmail drafts from the GPU2 collector), Content (`posts` table + `content_queue`; best posts from `viralview`), YouTube (`video_projects` in D1 plus `youtube` outliers from yt2), Video editor (`video` queue from the GPU2 collector), Finances and Markets (`moneyclaw` cron every 10 min), Viral View (`viralview` cron every 10 min), Cold outreach (`instantly` cron every 10 min), Life (Google Calendar + habits), and Home (run-through, Needs you, glance, Telegram critical-only).

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
