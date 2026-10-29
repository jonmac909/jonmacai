# hook.py: wake a bot when something happens

`python -I D:\AgentTeam\tools\hook.py fire EVENT --data "{...}" [--key ID]` sends a signed event to the OpenBot webhook routine of each bot below. Each wake costs that bot a full session, so send only real events. `--key` (your own id for the event) makes a retry safe: it is delivered once.

| Event | Wakes | Sent by |
|---|---|---|
| `script_failure` | Developer, Ana | every team script, when it fails |
| `proof_posted` | QC | `dash.py proof-add`, automatically |
| `raw_footage` | Video Editor | `watch_footage.ps1`, when files land in `D:\AgentTeam\footage` |
| `sponsor_email` | Sponsors, Ana | `watch_mail.py`, on new partners@ inbox mail |
| `accounting_email` | Accounting | `watch_mail.py`, on jon@ mail from gdbookkeeping.com or maxeisner.ca |
| `cancellation_spike` | Viral View, Ana | Viral View numbers (not built: needs the Commas API key) |

`hook.py test [ROUTE ...]` wakes each routine once with a "nothing to do" event, to check it works.

Exit codes: 0 delivered (202, or 200 for a repeat). 1 refused (401: wrong secret) or unreachable after 3 tries. 2 local problem (bad JSON, no secrets file, no secret for that routine).

## Script failures
Every script reports its own failure, for example from PowerShell:
`'{"script":"upload","error":"YouTube 403 on Zane #4"}' | python -I D:\AgentTeam\tools\hook.py fire script_failure --data -`
Pipe the JSON on stdin in PowerShell 5.1; it breaks quotes in command-line arguments.

## Raw footage
Drop raw files for a video into `D:\AgentTeam\footage` (any subfolder; copying or moving a whole folder in works too). After 60 s with no changes and no file still copying, Video Editor gets one `raw_footage` event listing the new video and audio files. Files that were already there when the watcher started, or that were already announced (moved to a `done\` subfolder, say), are not announced again. If the event can't be delivered, the watcher sends `script_failure` once and retries for 10 minutes. If it stops (e.g. the folder was deleted), it sends `script_failure`; restart it with `Start-ScheduledTask AgentTeam-watch-footage`. Log: `D:\AgentTeam\logs\watch_footage.log`.

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

## Secrets
`D:\AgentTeam\secrets\webhooks.json` holds each routine's URL and signing secret: `{"qc": {"url": "...", "secret": "..."}, ...}`. Only Jon makes the secrets (OpenBot Routines settings). Never print, paste, commit or copy this file, its secrets or its URLs.

Tests: `python -I bots/test_hook.py` (a local receiver checks the signature format; the footage test runs the watcher for a few seconds).
