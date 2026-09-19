# Command Center

Live: [https://jonmac.ai/dashboard](https://jonmac.ai/dashboard)

Cloudflare Worker `jonmac-command-center`. Routes `jonmac.ai/dashboard` and `jonmac.ai/dashboard/*`. Pages render from `GET /dashboard/api/snapshot`, which serves `fixtures/snapshot.json` until T2.

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
| `agents` | `tiles, waiting, all` |

`GET /dashboard/api/snapshot?pages=home,sponsors` returns `{ pages, nav, goal, sources }` with only the asked-for page keys.

Regenerate compact JSON: `node scripts/build-snapshot.mjs`

## Auth

Cookie `__Host-cc_session` = `{unixExpiry}.{HMAC-SHA256(expiry)}` under `SESSION_SECRET`. HttpOnly, Secure, SameSite=Strict, Path=/, 30 days. Password compared in constant time. 10 failures / IP / 15 min locks that IP 15 min. 51 failures across IPs / hour locks everyone 1 hour.

## Tests

```
npm test
```

from this folder.
