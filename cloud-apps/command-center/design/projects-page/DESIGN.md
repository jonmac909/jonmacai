# Projects page (Jon, 2026-10-24)

Live at jonmac.ai/dashboard/#projects, nav item "Projects" under Today, after Tasks.
Read only: it shows tasks.json and deliverables-today.json as pushed by push.py (hourly), never writes to them.

## Layout
- Project picker: a scrolling row of buttons, one per project in tasks.json (same order as the Tasks page), each with "done / total" and a small progress bar.
- Board: the selected project's Kanban, five columns, newest asked first. Card = task, note (2 lines), owner tag, age since asked, and a Review or Proof link when tasks.json has one.
- Right sidebar (below the board on phones): follows the selected project, so clicking a project tab swaps the checklist. Each sidebar has "Today N of M" with a bar, then "Open tasks" (the project's tasks that are not done, 8 shown, rest on the board).
- Done column shows the 6 newest, the rest sit under "Show N more".

## Column mapping (tasks.json status to column)
| tasks.json | Column |
|---|---|
| todo | Up next |
| doing | In progress |
| blocked | Waiting / Blocked |
| waiting_on_jon, no link | Waiting / Blocked (waiting on Jon for an answer) |
| waiting_on_jon, with link | Review (a proof or review link is ready for Jon) |
| done | Done |

Cards waiting on Jon keep a green left edge. No em dashes.

## Sidebar mapping (per project)
- Daily slots from deliverables-today.json are claimed by project name: Paul videos (6) and Heston X posts (3) go to YouTube & Video; the partners@ report (1) goes to Sponsors. A slot is ticked when something was delivered for it, with its review link.
- Delivered today: any deliverable finished today (Vancouver) whose `task` id matches one of the project's tasks in tasks.json. It shows ticked, with its link, and counts in "N of M".
- Open tasks: every task of the project that is not done, unticked, with its Review or Proof link.
- A project with no slots or deliveries shows "Nothing due today for this project." and just its open tasks. Nothing is written back.

## Removed deliverables
push.py sends the full deliverables.json for source jon_tasks; /api/ingest now deletes jon_tasks rows missing from that list, with their approvals (removeMissingDeliverables in src/db.js). Other sources are never touched. Daily checklist approvals are kept.
