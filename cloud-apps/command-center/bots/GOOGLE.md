# Gmail and Calendar for the bots

`python -I D:\AgentTeam\tools\google_api.py COMMAND ACCOUNT ...` (stdlib only, prints JSON). Who you are comes from dash.py (your workspace, or `DASH_BOT` outside every workspace).

| Bot | Account | Commands |
|---|---|---|
| Inbox | jon, jonstagger | `subjects`, `label`, `archive` |
| Sponsors | partners | `subjects`, `draft`, `draft-delete` (only drafts it made) |
| Accounting | jon, jonstagger | `subjects` |
| Ana | jon | `events` (calendar read; jon@'s own, or `--calendar jonstagger@gmail.com`, which is shared to jon@) |

```
google_api.py subjects jon -n 5 --query "from:jennifer@gdbookkeeping.com"
google_api.py label jon MSG_ID "Receipts"        google_api.py archive jon MSG_ID
google_api.py draft partners --to a@b.com --subject "Re: rates" --body-file reply.txt
google_api.py events jon --date 2026-10-30        google_api.py events jon --calendar jonstagger@gmail.com
```
- Nothing here sends mail, deletes mail, marks it read or writes the calendar. Only the approval script sends, after Jon approves. Calendar writes will need Jon's approval each time.
- Exit codes: 0 ok, 1 Google refused, 2 local problem or not allowed.
- All bots run as the same Windows user, so the limits record intent; they don't wall bots off. Never print, copy or commit the token files.

## Connecting accounts (Jon, once per account)
`google_connect.py serve` runs a page on `http://localhost:8765/` on GPU1 with one link per account. Jon opens a link in Chrome on GPU1, picks the account and presses Allow. The token is checked (right account, every permission ticked) and saved to `D:\AgentTeam\secrets\google\<account>.json`. `google_connect.py status` shows what's connected.

- The OAuth client is the old Hermes one (Google Cloud project `ana-assistant-510518`, app name "Historient"), copied to `D:\AgentTeam\secrets\google\client.json`.
- That app is internal to thejonmac.com. Google blocks personal Gmail accounts for it (Error 403 org_internal), so jonstagger@gmail.com and the Complete Histories account need another route.
- One consent per account covers the team. partners@ grants Gmail read and compose. jon@ grants Gmail modify and calendar events.
