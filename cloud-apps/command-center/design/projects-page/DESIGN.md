# Projects page (Jon, 2026-10-24)

Live at jonmac.ai/dashboard/#projects, nav item "Projects" under Today, after Tasks.
Read only: it shows tasks.json and deliverables-today.json as pushed by push.py (hourly), never writes to them.

## Layout
- Project picker: a scrolling row of buttons, one per project in tasks.json (same order as the Tasks page), each with "done / total" and a small progress bar.
- Board: the selected project's Kanban, five columns, newest asked first. Card = task, note (2 lines), owner tag, age since asked, and a Review or Proof link when tasks.json has one.
- Right sidebar (above the board on phones): Today's checklist, 10 slots (6 Paul videos, 3 Heston X clips, the partners@ report). A slot is ticked when deliverables-today.json lists something for it, and links to its review page. Progress shows "N of 10".
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
