# hook.py: wake a bot when something happens

`python -I D:\AgentTeam\tools\hook.py fire EVENT --data "{...}" [--key ID]` sends a signed event to the OpenBot webhook routine of each bot below. Each wake costs that bot a full session, so send only real events. `--key` (your own id for the event) makes a retry safe: it is delivered once.

| Event | Wakes | Sent by |
|---|---|---|
| `script_failure` | Developer, Ana | every team script, when it fails |
| `proof_posted` | QC: Jessica (route `qc`) for tasks owned by video-editor, Nina for the rest. Nina's go to her route `nina` once it has a url and a secret; until then they go to route `ana` with `data.forOwner: "nina"`, and Ana forwards them. A bot with an unread wake gets no second one: `proofs --status pending` reads it, and it expires after 30 minutes | `dash.py proof-add`, automatically |
| `raw_footage` | Video Editor | `watch_footage.ps1`, when files land in `D:\AgentTeam\footage` |
| `sponsor_email` | Sponsors, Ana | `watch_mail.py`, on new partners@ inbox mail |
| `accounting_email` | Accounting | `watch_mail.py`, on jon@ mail from gdbookkeeping.com or maxeisner.ca |
| `cancellation_spike` | Viral View, Ana | `vv_numbers.py`, on 3+ cancellations in 24 hours |
| `bot_stuck` | Ana (route `ana`) | `team_guard.py`, with `{"alerts": [...]}`: a frozen bot, a queue that isn't moving, or a capped account |

`hook.py test [ROUTE ...]` wakes each routine once with a "nothing to do" event, to check it works.

Exit codes: 0 delivered (202, or 200 for a repeat). 1 refused (401: wrong secret) or unreachable after 6 tries (about 30 s of back-off, so a short OpenBot app freeze doesn't lose a wake; a 503 means the app didn't answer in time). 2 local problem (bad JSON, no secrets file, no secret for that routine).

## Script failures
Every script reports its own failure, for example from PowerShell:
`'{"script":"upload","error":"YouTube 403 on Zane #4"}' | python -I D:\AgentTeam\tools\hook.py fire script_failure --data -`
Pipe the JSON on stdin in PowerShell 5.1; it breaks quotes in command-line arguments.

## Raw footage
Drop raw files for a video into `D:\AgentTeam\footage` (any subfolder; copying or moving a whole folder in works too). After 60 s with no changes and no file still copying, Video Editor gets one `raw_footage` event listing the new video and audio files. Files that were already there when the watcher started, or that were already announced (moved to a `done\` subfolder, say), are not announced again. Nothing under `footage\short-form\` is announced: that's the Short-form bot's working folder (generated clips, QC audio, downloads), not raw footage. If the event can't be delivered, the watcher sends `script_failure` once and retries for 10 minutes. If it stops (e.g. the folder was deleted), it sends `script_failure`; restart it with `Start-ScheduledTask AgentTeam-watch-footage`. Log: `D:\AgentTeam\logs\watch_footage.log`.

Start at logon (only after Jon approves `start_watchers`). It runs hidden with no console window, and has no 72-hour run limit:
```powershell
$run = New-ScheduledTaskAction -Execute conhost.exe -Argument '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\AgentTeam\tools\watch_footage.ps1'
Register-ScheduledTask AgentTeam-watch-footage -Action $run -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0)
```

## Mail
`watch_mail.py` checks Gmail's history log for partners@ and jon@ every 2 minutes (Ana's call; no bot, no Claude tokens) and sends one event per account per check, only on a match. It skips accounts not connected yet (GOOGLE.md), backs off on errors and sends one `script_failure` after 3 failures in a row. Log: `D:\AgentTeam\logs\watch_mail.log`. Start at logon (only after Jon approves `start_mail_watcher`):
```powershell
$run = New-ScheduledTaskAction -Execute 'C:\Users\jonst\AppData\Local\Programs\Python\Python310\pythonw.exe' -Argument '-I D:\AgentTeam\tools\watch_mail.py'
Register-ScheduledTask AgentTeam-watch-mail -Action $run -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0)
```

## Team guard
`team_guard.py` runs hidden every 10 minutes and needs no bot awake, so it still works when Ana is frozen. Each incident acts once; a failed send retries next run. Rules are in its docstring, and `--dry-run` shows what it would do without sending anything. State is `~\.team-guard\team-guard.json`, log `team-guard.log` beside it, both on C: so the guard still works when D: is full.

A pack counts as ready for Olivia when its folder in `aieditor\edits` (`hgp-*` or `*-<number>`) passes preflight, has no finished video in `final`, and no video-editor card naming it is doing, waiting on Jon, in QC, in review or done. A numbered folder needs its number in the card title (`theo-2`: `#2`); a title with no number counts as video 1.

GPU2's 60-second heartbeat (`collectors/lib/machine_stats.py`) counts its sockets. At 10000 UDP or TCP it adds a line to `~/.command-center/logs/ports.log` on GPU2 with who holds them; the guard reads that file over SSH and sends Ana one `bot_stuck` per incident.

GPU1's D: under 30 GB free also sends Ana one `bot_stuck`.

The schedule, installed only after Jon approves it:
```powershell
$run = New-ScheduledTaskAction -Execute 'C:\Users\jonst\AppData\Local\Programs\Python\Python310\pythonw.exe' -Argument '-I D:\AgentTeam\tools\team_guard.py'
$every = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask AgentTeam-team-guard -Action $run -Trigger $every -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30))
```

## Secrets
`D:\AgentTeam\secrets\webhooks.json` holds each routine's URL and signing secret: `{"qc": {"url": "...", "secret": "..."}, ...}`. Only Jon makes the secrets (OpenBot Routines settings). Never print, paste, commit or copy this file, its secrets or its URLs.
The dashboard Worker holds the only other copy, as the Cloudflare secret `WEBHOOKS` (it wakes a card's owner when Jon comments). Developer sets it from this file with `wrangler secret put WEBHOOKS`, piping the file in so it is never printed.

Tests: `python -I bots/test_hook.py` (a local receiver checks the signature format; the footage test runs the watcher for a few seconds).
