# QA pass 1 — Command Center

Live: https://jonmac.ai/dashboard  
Date: 2026-09-18 (America/Vancouver; collector timestamps 2026-09-19 UTC)  
Checked in Chromium at 1440×900 and 400×844, Light and Dark. Login used `DASHBOARD_PASSWORD`.  
Did not click: Approve & send, Send invoice, Remind, Nudge, Launch, Book it, Enter code, Scan banks now, Connect calendar, Mark paid, or any bank/money send.

Orca embedded browser snapshot crashed the runtime (`runtime_unavailable`); visual pass used managed Chromium against the same live URL.

## Login

| Check | Result |
|---|---|
| `/dashboard` shows sign-in | pass |
| Light / Dark on login at 1440 and 400 | pass |
| Correct password opens Home | pass |
| Session cookie `__Host-cc_session` | pass |

## Pages · layout Light+Dark · 1440 and 400

| Page | 1440 L | 1440 D | 400 L | 400 D | Notes |
|---|---|---|---|---|---|
| Home | pass | pass | pass | pass | Chip was still “Mockup…” (fail, fixed this PR). Greeting stays “Good morning” from fixture. |
| Sponsors | pass | pass | pass | pass | Kanban overflow-x at 1440 is the board scroll, not a broken page. |
| Viral View | pass | pass | pass | pass | |
| YouTube | fail→fix | pass* | pass | pass | Sponsor-due tile listed 88 board cards (fail, fixed this PR). |
| Content | pass | pass | pass | pass | |
| Cold outreach | pass | pass | pass | pass | Still fixture setup (Instantly not live). |
| Support | pass | pass | pass | pass | Answered today `5 / 2` (pct 250, bar clamped in UI; overlay clamped this PR). |
| Video editor | pass | pass | pass | pass | Live overlay: 0 editing · 0 ready. Source stale ~2h. |
| Finances | pass | pass | pass | pass | Numbers match MoneyClaw. Fixture “Enter code” without `bank_scan` (fail, fixed this PR). Did not click Scan banks / Enter code. |
| Markets | pass | pass | pass | pass | Matches MoneyClaw pulse. `newsLevel: Pending` → Quiet (intentional). |
| Life | pass | pass | pass | pass | “Connect calendar” shown; workout/date/today still fixture examples. |
| Mastermind | pass | pass | pass | pass | Live digest (771 read · 1 pick). |
| Agents | pass | pass | pass | pass | Live: 13 pinned, Mac `unifi.lan` heartbeat. Plan said 11. |

Sidebar under 820px is a horizontal strip (navs `overflow-x: auto`). Labels like “Vir” clip until you scroll — matches `phone-sidebar` CSS.

## Numbers vs source

Sources pulled the same session: `collections.viralview.io/api/collections` + `/api/board`, `app.viralview.io/api/internal/dashboard-summary`, `moneyclaw.jonmac.ai/api/internal/dashboard-summary`, `jonmac.ai/yt2/api/outliers`.

| Number | Dashboard | Source | Result |
|---|---|---|---|
| Sep collected | $5,000 | collections `incomeTotals.September` 5000 | pass |
| Owed | $6,700 · 3 | TopView 1500 + InVideo 4200 + Viktor 1000 | pass |
| Avg month | $8,802.33 | (June+July+August)/3 = 8802.33 | pass |
| Sponsor emails waiting | 74 | board `drafts` 74 | pass (board, not collections) |
| VV week cash | $0 | `cashThisWeek.netCents` 0 | pass |
| VV last payment | Sep 8 | `lastEventAt` 2026-09-08 | pass |
| VV MRR | $245 | `current.mrrCents` 24500 | pass |
| Paying customers | 5 | `activeCustomers` 5 | pass |
| ARPU | $49.00 | `arpuCents` 4900 | pass |
| Personal week/month/last | $751.38 / $7,850.02 / $9,125.61 | MoneyClaw expenses.personal | pass |
| Business week/month/last | $2,235 / $8,227.48 / $6,502.20 | MoneyClaw expenses.business | pass |
| VIX / VOO | 14.9 / $701.90 | pulse 14.9 / 701.895 | pass |
| Net worth (Show) | $3,422,847.43 | 3422847.43 | pass |
| YT channels / ranked / best | 22 / 516 / 133× | outliers API | pass |
| Sponsor videos due | 88 | should be collection deals (~3) | fail → fixed |
| Home sponsor tiles | $5,000 / $6,700 | same as Sponsors page | pass |
| Home VV week | $0 since Sep 8 | same as Viral View | pass |
| Board `updatedAt` | 2026-09-19T00:04:33Z | live | pass |
| Video queue | 0 editing | GPU2 `video` snapshot stale ~2h | pass (live empty) / follow-up stale |

## Buttons exercised (safe)

| Button | Result |
|---|---|
| Light / Dark | pass — `data-theme` flips |
| Nav every page | pass |
| View all (Needs you) | pass — control found, list has 78 |
| Start my morning | pass — opened Sponsors (first undone step) |
| Scan inbox now | pass — clicked; queues Mac `sponsor.scan_inbox` (no email send) |
| Open tracker | pass — toast |
| Check now / Build list / Draft them | pass — toasts (fixture outreach) |
| Show net worth | pass — revealed $3,422,847.43 |
| See all (charges) | pass — toast |
| Add a rule | pass — toast “New rule box opened” |
| Ping (Agents) | pass — clicked |
| Scan now (Mastermind) | pass — clicked |
| See all 516 / Remake with a template | pass — toasts |
| Remix it | pass — toast |
| Add a habit | pass — toast |
| Open collections / Open revenue / Open YouTube Gen / Open MoneyClaw | hrefs present; not followed off-dashboard |

Skipped on purpose: Approve & send, Approve reply, Approve all, Nudge, Send invoice, Mark paid, Launch, Book Saturday 6:30, Enter code, Scan banks now, Connect calendar, Send to Planner, Log a post (prompts).

## Failures fixed in this PR

1. Home chip still said “Mockup…” after live overlays.
2. YouTube “Sponsor videos due” counted every ACTIVE board card (88) instead of collection deals.
3. Finances kept fixture “Enter code / Needs code” when no `bank_scan` snapshot.
4. Support “Answered today” pct went to 250 when answered > inbound (bar already CSS-clamped; overlay now caps 100).

## Still example data / follow-ups

| Item | Steps |
|---|---|
| Life page | Calendar not connected. Click **Connect calendar** (Jon, Google consent) so overlay replaces fixture workouts / date night / Today. |
| Cold outreach | Instantly snapshot missing. Add `INSTANTLY_API_KEY`, confirm cron pull, then setup steps should tick from accounts. |
| Home greeting | Still fixture “Good morning” even at night. Set greeting from America/Vancouver hour in `applyHome`. |
| Home date | `home.js` uses `new Date()` local, not Vancouver. |
| Video editor stale | GPU2 `video` snapshot ~2h old. Check Task Scheduler `\CommandCenterCollect` / `run.cmd` (do not start `run.py` by hand). |
| Viral traffic / ads “No sales” | Summary `traffic`/`ads` empty or zero. Confirm Viral View tracker, not dashboard. |
| Viral MRR $245 vs older $993 mockup | Dashboard matches current summary API. Revenue admin page is the source of truth if those still disagree (B1). |
| Agents “13 pinned” vs plan 11 | Live Orca list. Update plan or pin list in `collectors/agents.json`. |
| Goal donut “12 days left in September” | Fixture calendar copy; recompute from today. |
| Content “2 queued for this afternoon” / heat grid | Partial live posts; queue overlay may still mix fixture copy. |
| Open tracker | Toast only, no href. |

## Tests run

```
node --test test/youtube.test.mjs test/life-home.test.mjs test/support.test.mjs test/money-viral.test.mjs
```

37 pass (failing tests authored first for the four fixes).
