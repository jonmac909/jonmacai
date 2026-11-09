# Dashboard 2 (jonmac.ai/dashboard-2)

Jon approved 2026-11-08 (card "Jon's ask: Dashboard 2 at jonmac.ai/dashboard-2"). A top-down view next to `/dashboard`: month goals, then this week's targets, then today. Five pages: Month, Week, Today, Pipeline, Money. Feed, Life, Journal, Review and the old dashboard are links in a menu (they open the existing `/dashboard` pages).

Hard limits: `/dashboard` (its pages, its API answers, its data) does not change. Views only: nothing is deleted or rewritten. No new feeds, collectors or automations. Every number names its source and age; a stale feed is flagged on the number and in a banner. Plain words for Jon: video titles as "<title> - <channel>", no raw IDs or file paths.

## Serving

- Worker routes `jonmac.ai/dashboard-2` (308 to `/dashboard-2/`) and `jonmac.ai/dashboard-2/*`, same Worker (`src/worker.js`).
- `/dashboard-2/` and `/dashboard-2/index.html` serve `public/d2/index.html` with Jon's session, else `public/d2/login.html` (posts to `/dashboard/api/login`, then reloads `/dashboard-2/`). Besides those only `/dashboard-2/login.html`, `/dashboard-2/css/*.css` and `/dashboard-2/js/**/*.js` are served (from `public/d2`); any other path is a 404. `/dashboard/d2/...` is a 404, as before Dashboard 2. Same headers as `/dashboard` assets (noindex, `no-cache` for html/js/css).
- Signed out (the data answers 401), the page opens `/dashboard-2/` once for sign-in; it never reloads in a loop.
- The page reuses `/dashboard/css/*` and the existing ES modules under `/dashboard/js/` by absolute URL (renderers, `ui.js`, `modals.js`). It never imports `/dashboard/js/app.js` (side effects on import); `public/d2/js/app.js` is its own shell with the click handlers it needs.
- Data: `GET /dashboard/api/d2` (Jon's session, `Cache-Control: no-store`). Writes go to the existing endpoints (`/v1/questions/:id/answer`, `/v1/approvals/:id/decide`, `/v1/tasks/:id`, with `X-CC: 1`).

## `GET /dashboard/api/d2`

```
{
  ok: true,
  build,                      // CF_VERSION_METADATA id, as /snapshot
  asOf,                       // ISO, server time
  pages: { today, projects, sponsors, viral, money, calendar, content },
                              // the exact page objects /dashboard/api/snapshot builds (mergeSnapshot), so reused
                              // renderers show the same numbers. Track is not included: the page loads it with
                              // GET /dashboard/api/snapshot?pages=track each time a channel's Track tab opens,
                              // and keeps it across the 60 s refresh only while that Track view stays open.
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
    checks: [Check],          // daily checks, a tick per day on Today and Week (Ana, 2026-11-08)
    today: Today,
    pipeline: Pipeline,
    money: Money,
    summary: Summary           // the Daily Summary at the top of Today (below)
  }
}
```

Missing bindings (preview has no HGP_DB, CLONE_DB, REVIEW_DB) or an unreadable table that d2 adds give `actual: null` with a plain `note`, never a 500. An unreadable core table that `/snapshot` also reads (snapshots, habits, deal stage overrides) gives the same error `/snapshot` gives.

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
  status: { text: 'On pace' | 'Behind' | 'Off pace' | 'Done' | 'No data' | 'Not tracked yet' | 'None due yet', cls: 'ok' | 'risk' | 'crit' | 'idle' },
  owner: 'Florence',
  source: { label, at, ageLabel, stale },          // as sourceOf() in src/today.js
  note: '',                   // plain words, optional
  behind: [{ title, owner, why, open?: taskId, href?, linkLabel?, page? }],   // week metrics: what is behind and who owns it;
                              // page = a Dashboard 2 route, e.g. 'pipeline/hgp/<slug>/calendar' (the channel's Calendar tab)
  rows: [{ label, target, actual, display, status, owner, note }],   // per-channel breakdown (hgp, jonmac videos)
  days: [{ ymd, target, actual }]                 // week metrics countable per day (videos, shorts)
  facts: [{ label, value, links?: [{ label, href }] }]   // week: HGP videos (Published today, Waiting for your review), checkout (Last check, Missed)
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

`needs.items` leaves out the items already in `jon`; `needs.count` counts `needs.items`. The Expenses item has `id` and `kind` `'expenses'`. Every `from` and owner in `d2` is a first name.

### Check

```
{
  key: 'histories' | 'rbc', title, owner: 'Daisy' | 'Elizabeth',
  today: { ok: true | false | null, status, links: [{ label, href }], facts: [{ label, value }], source },
  days: [{ ymd, ok, cls, note }] x7 Mon-Sun   // ok null = future or not due yet
}
```

- Complete Histories (Daisy): a day is ok when Daisy's ok run reports (`bot_runs`, bot `spotify`) that day say the Spotify episode and the community post are live; links come from those notes. Her notes are free text and the Spotify link is the show page, so this trusts her report; reading the show's episode list is the v2 fallback.
- RBC expenses (Elizabeth): a day is ok when the Accounting checklist has both "08:00 RBC import run" and "Receipts matched" ticked; today also needs the bank scan not failed. Facts: accounts read (bank scan), last import tick, bank data through (MoneyClaw), receipts matched. Never reads RBC.
- Deadlines (`checks` in `src/d2-goals.json`): after it, a day not ok is red and joins Today's blockers.

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

### Summary (Daily Summary, top of the Today page)

Built by `buildSummary` in `src/summary.js` from rows the endpoint already loads. The one new network call is the weather (Open-Meteo, no key), fetched in the Worker with a 10 minute cache (a failure is remembered for 1 minute). No collector, no schedule, nothing stored. Every number comes from a real feed; a section or row with no data says why in one line and names its owner.

```
{ asOf, tz, today: 'YYYY-MM-DD',
  sections: [{ key, title, owner,         // weather, calendar, markets, expenses, sponsors, jonmac, jonmacai, hgp (this order)
               sources: [{ label, ageLabel, stale }],   // the one-line footer
               line: '',                  // when set, the only content: why there is no data, with the owner
               rows: [{ label, value, sub?, cls? }],    // cls: crit | risk | muted (muted = no source)
               notes: [string],           // one-line caveats (partial window, check skipped)
               strange?, currency? }]     // expenses only: the flagged charges, the feed's currency (CAD unless it says otherwise)
}
```

| Section | Source | Shows | When there is nothing |
|---|---|---|---|
| Weather, West Kelowna | Open-Meteo, 49.86 / -119.58, Vancouver time | now (temp, WMO code in words), high, low, rain chance | `Weather unavailable (Open-Meteo), owner Mila` |
| Calendar | the `calendar_today` bot feed (Ana only, `PUT /v1/feeds/calendar_today`, `{ date, events: [{ start, end, title, calendar? }] }`) | today's events | no feed: `Calendar feed not connected. Owner: Ana.`; feed dated another day: says so |
| Markets | MoneyClaw snapshot, `markets.core` VOO and QQQ | last price, % below all-time high, today's move | `Market feed not connected (MoneyClaw). Owner: Mila.`; stale after 24 hours |
| RBC expenses | MoneyClaw snapshot, `expenses.{business,personal}`; read only | yesterday (the feed's total), last 7 and last 30 days (summed from `lastMonth.charges` + `month.charges`, counted back from today, Kelowna time, pending in, refunds netted); strange purchases; open charge-watch flags (`cw:` questions) | `Expenses feed not connected (MoneyClaw). Owner: Mila.`; stale after 2 days or when `asOf` is older; a window the lists do not cover is labelled partial |
| Sponsors | cash (`buildCash`), collections feed, deal board, sponsor video cards | income this month, who owes, collections due (feed due dates; overdue in red), deals negotiating, videos still to make | a piece with no feed: `No source, owner Florence` |
| Jon Mac, @JonMacAI, Home Guide Press (the 16 focus channels) | channel calendars (this week, Mon to Sun) and open dashboard cards (todo, doing, waiting, QC, review) | per channel `N of M scheduled or live` (M = calendar rows dated this week) and open cards; Home Guide Press cards are matched to a channel by the channel name in the card title | `Nothing planned this week`, `No calendar yet`, or the section note names the owner |

Strange purchases (`strangePurchases`, pure, tested in `test/daily-summary.test.mjs`), over charges dated in the last 7 days and judged against every charge in the two lists: **duplicate** (same merchant and amount twice one day); **high** (over 3x the merchant's median, at least 3 earlier charges); **newMerchant** (first charge from a merchant, over $100, only when the lists reach back 14 days before it, else a note says the check is limited); **currency** (a per-charge currency other than CAD or USD; with no currency in the feed the note reads `currency not in feed`). Merchant = the description's first three words, digits and symbols dropped. Charge watch flags are the open questions MoneyClaw's charge watch already files (`src/chargewatch.js`, idempotency key `cw:`).

The page opens every section on a desktop and folds them on a phone (under 700 px); the open state survives the 60 second refresh like other folds.

## Goals config (`src/d2-goals.json`)

All targets, labels, owners and the focus channel list live in this one file. A `metric` names the function in `src/d2.js` that counts it; changing a target or owner is a JSON edit, not code. Month target for a video goal = weekly target x `weeksInMonth`, rounded.

| Goal | Owner | Month | Week | Day |
|---|---|---|---|---|
| Sponsors | Florence | $10K collected (about 5 deals) | 2 deals signed; 1 to 2 sponsor videos delivered; invoice sent the day a video goes live | partners@ replies cleared; Jon's price decisions answered |
| Home Guide Press | Elle (Scarlett, Olivia) | videos published (3 a week per focus channel) | 3 videos per focus channel; every landing page checkout working | one video edited and QC-passed every 3 hours ("None due yet" before 3 AM) |
| Jon Mac | Sydney | 3 x weeks | 3 videos | |
| @JonMacAI | Sydney | 3 x weeks | 3 videos | |
| Viral View and webinar | Scarlett | webinar date set and run once | funnel live; leads counted | ads and posts that drive leads |
| Short-form | Samantha | 3 x days in the month (90 in Nov, 93 in Dec, 84 in Feb) | 21 | 3 (`perDay`) |

Focus channels: Jon's 16 (2026-11-08), the `focus` list in `src/d2-goals.json`, a copy of `D:\AgentTeam\rules\facts\focus-channels.txt` (the Worker can't read GPU1 files; `test/d2.test.mjs` fails on GPU1 when the two differ, so a change to the file needs the same edit here and a deploy). In that list's order; a slug the dashboard has no channel for yet still counts (label from the slug, "No calendar yet" on its row and a behind line for Elle). 3 videos a week each, 48 in all. Every other Home Guide Press channel is parked: no target, its finished videos still show on its Calendar tab.

## Week page rules (Jon, 2026-11-09)

- No daily checks block on Week (they stay on Today).
- Behind never lists a video that is live on YouTube. A sponsor's video N is live when at least N published calendar rows name the sponsor; Lucy's YouTube sync keeps those rows current and moves live cards to Done.
- A Behind line for a card that waits on Jon shows its "Your move" line (plain words) and the card's labeled link, not just the status.
- "Invoice sent the day a video goes live" counts only deals in "Live · send invoice" whose sponsor has a live video (at least one published calendar row naming it). The rest of that column is named in the note and not counted.
- HGP "Videos published" also shows how many went out today and how many wait for Jon's review, with links.
- "Every landing page checkout working" shows the last check date and who missed which days.
