# Dashboard 2 (jonmac.ai/dashboard-2)

Jon approved 2026-11-08 (card "Jon's ask: Dashboard 2 at jonmac.ai/dashboard-2"). A top-down view next to `/dashboard`: month goals, then this week's targets, then today. Five pages: Month, Week, Today, Pipeline, Money. Feed, Life, Journal, Review and the old dashboard are links in a menu (they open the existing `/dashboard` pages).

Hard limits: `/dashboard` (its pages, its API answers, its data) does not change. Views only: nothing is deleted or rewritten. No new feeds, collectors or automations. Every number names its source and age; a stale feed is flagged on the number and in a banner. Plain words for Jon: video titles as "<title> - <channel>", no raw IDs or file paths.

## Serving

- Worker routes `jonmac.ai/dashboard-2` (308 to `/dashboard-2/`) and `jonmac.ai/dashboard-2/*`, same Worker (`src/worker.js`).
- `/dashboard-2/` serves `public/d2/index.html` with Jon's session, else `public/d2/login.html` (posts to `/dashboard/api/login`, then reloads `/dashboard-2/`). `/dashboard-2/<path>` serves `public/d2/<path>`. Same headers as `/dashboard` assets (noindex, `no-cache` for html/js/css).
- The page reuses `/dashboard/css/*` and the existing ES modules under `/dashboard/js/` by absolute URL (renderers, `ui.js`, `modals.js`). It never imports `/dashboard/js/app.js` (side effects on import); `public/d2/js/app.js` is its own shell with the click handlers it needs.
- Data: `GET /dashboard/api/d2` (Jon's session, `Cache-Control: no-store`). Writes go to the existing endpoints (`/v1/questions/:id/answer`, `/v1/approvals/:id/decide`, `/v1/tasks/:id`, with `X-CC: 1`).

## `GET /dashboard/api/d2`

```
{
  ok: true,
  build,                      // CF_VERSION_METADATA id, as /snapshot
  asOf,                       // ISO, server time
  pages: { today, projects, todo, sponsors, viral, webinar, money, calendar, content },
                              // the exact page objects /dashboard/api/snapshot builds (mergeSnapshot), so reused
                              // renderers show the same numbers. Track is not included: the page loads it with
                              // GET /dashboard/api/snapshot?pages=track when a channel's Track tab opens.
  d2: {
    period: {
      tz: 'America/Vancouver',
      today: { ymd, label: 'Sunday, November 8', clock: '2:05 PM', weekday: 0..6 (Mon=0) },
      week:  { start: 'YYYY-MM-DD' (Monday), end (Sunday), label: 'Nov 2 to 8',
               days: [{ ymd, label: 'Mon 2', isToday, isPast }] x7 },
      month: { key: '2026-11', label: 'November 2026', daysInMonth, elapsed: 0..1, daysLeft, weeksInMonth: daysInMonth/7,
               weeks: [{ start, end, label: 'Nov 2 to 8', current }] }   // every Mon-Sun week touching the month
    },
    goals: [Goal],            // config order (src/d2-goals.json)
    stale: [{ label, ageLabel, goal? }],   // every stale or missing source used by any number, for the banner
    today: Today,
    pipeline: Pipeline,
    money: Money
  }
}
```

Missing bindings (preview has no HGP_DB, CLONE_DB, REVIEW_DB) or an unreadable table give `actual: null` with a plain `note`, never a 500.

### Goal

```
{
  key: 'sponsors' | 'hgp' | 'jonmac' | 'jonmacai' | 'viral' | 'shortform',
  title, owner: 'Florence', team: ['Florence'],   // names, never slugs
  project: 'sponsors',        // PROJECTS slug of its work board (src/projects.js)
  channels: [{ slug, label, focus: true }],       // video goals only; hgp lists focus channels only
  parked: [{ slug, label }],  // hgp only: channels with no target, shown greyed
  month: Metric,
  week: [Metric],
  day: [Metric],
  trend: [{ start, label: 'Nov 2', target, actual, current }]   // one per month week, for month.unit
}
```

### Metric

```
{
  key, label, unit: 'usd' | 'count' | 'yesno' | 'text',
  target: number | null,      // null = no target (text or "not set")
  actual: number | null,      // null = not tracked yet or no data; `note` says which and why
  display: '$4,200' | '7 of 13' | 'Yes' | 'Not set',   // ready to show
  pace: number | null,        // where actual should be by now (month: target x elapsed; week: target x days elapsed / 7)
  status: { text: 'On pace' | 'Behind' | 'Off pace' | 'Done' | 'No data' | 'Not tracked yet', cls: 'ok' | 'risk' | 'crit' | 'idle' },
  owner: 'Florence',
  source: { label, at, ageLabel, stale },          // as sourceOf() in src/today.js
  note: '',                   // plain words, optional
  behind: [{ title, owner, why, open?: taskId, href? }],   // week metrics: what is behind and who owns it
  rows: [{ label, target, actual, display, status, owner, note }],   // per-channel breakdown (hgp, jonmac videos)
  days: [{ ymd, target, actual }]                 // week metrics countable per day (videos, shorts)
}
```

### Today

```
{
  jon: [Item] (at most 3),    // the approvals or decisions that unblock the most: goal priority (sponsors, hgp,
                              // jonmac/jonmacai, viral, shortform), then a task waiting on it, then oldest
  needs: { count, items: [Item], healthToAna: n, chargesFolded: n },
  expenses: { count, items: [Item], label: 'Expenses review (Friday)' },   // the folded known charges
  targets: [{ goal, goalTitle, label, display, target, actual, status, owner, source }],   // every goal's day metrics
  blockers: [{ title, owner, goal, ageLabel, why, open?: taskId }]
}
```

`Item` is exactly the shape of `pages.today.needs.items` (`approvalItem` / `questionItem` / alerts in `src/today.js`), plus `goal`, `minutes` (the row's `minutes`, else 2 for an approval and 5 for a question) and `link: { label, href } | null` (its task's deliverable or first web link).

Needs-you cleanup (view only): a question whose idempotency key starts `team-guard` is bot health and is counted in `healthToAna`, not shown. A question whose key starts `cw:` (MoneyClaw charge watch: "New charge", "Big one-off charge") is a known charge: it moves into `expenses` and counts in `chargesFolded`; `needs.items` gets one `Expenses review (Friday)` item for them instead. Everything else stays.

### Pipeline

```
{
  boards: [{
    goal, title, project,                       // project = the Projects board slug for this goal
    channels: [{ slug, label, focus }],          // video goals: Calendar, Content and Track tabs per channel
    sponsors: SponsorsPage | undefined           // sponsors goal only: a cleaned copy of pages.sponsors
  }]
}
```

`SponsorsPage` keeps the shape of `pages.sponsors` (so the existing sponsor renderer draws it) with: receipts, refunds and newsletters removed (`hidden: { receipts, refunds, newsletters }` counts them); cards quiet 60 days or more moved to a last column `{ title: 'Archived', archived: true, cards }`, hidden by default; pipeline value counting priced leads only (`value: { usd, priced, unpriced }`).

### Money

```
{ tiles: [{ label, value, sub, source }] }    // sponsor cash this month, owed, Viral View MRR, webinar net, ebook sales, bank feed
```

The Money page shows these tiles, then the existing Money page (`pages.money`), the sponsor collections (`pages.sponsors` collect / by month / cash) and Viral View revenue (`pages.viral`).

## Goals config (`src/d2-goals.json`)

All targets, labels, owners and the focus channel list live in this one file. A `metric` names the function in `src/d2.js` that counts it; changing a target or owner is a JSON edit, not code. Month target for a video goal = weekly target x `weeksInMonth`, rounded.

| Goal | Owner | Month | Week | Day |
|---|---|---|---|---|
| Sponsors | Florence | $10K collected (about 5 deals) | 2 deals signed; 1 to 2 sponsor videos delivered; invoice sent the day a video goes live | partners@ replies cleared; Jon's price decisions answered |
| Home Guide Press | Elle (Scarlett, Olivia) | first sales on the focus channels | 3 videos per focus channel; every landing page checkout working | one video edited and QC-passed every 3 hours |
| Jon Mac | Sydney | 3 x weeks | 3 videos | |
| @JonMacAI | Sydney | 3 x weeks | 3 videos | |
| Viral View and webinar | Scarlett | webinar date set and run once | funnel live; leads counted | ads and posts that drive leads |
| Short-form | Samantha | 90 | 21 | 3 |

Focus channels: every Home Guide Press channel with no video yet, plus giovanni-moretti, naomi-takeda-japan, jack-mercer, dale-whitaker-pitbulls, peter-collins, rosas-clean-home, rosas-house-hacks, ruth-calder. Parked channels show no target.
