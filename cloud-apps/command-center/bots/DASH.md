# dash.py — write to the dashboard as your bot

`python D:\AgentTeam\tools\dash.py COMMAND ...` (Python stdlib only). It prints JSON. Exit 0 = ok, 1 = the dashboard refused (reason on stderr), 2 = can't reach it, or no token.

**Who you are:** `--bot <slug>`, or `DASH_BOT`, or the bot whose OpenBot workspace you run it from (BOTS.md). Slug = your rules file name: `ana`, `sponsors`, `viral-view`, `video-editor`, `jon-mac-youtube`, `home-guide-press`, `short-form`, `developer`, `qc`, `accounting`, `inbox`, `spotify`, `moneyclaw`, `historient`. Your token is `D:\AgentTeam\secrets\bot-tokens\<slug>.token`. Never print, paste or commit it. `dash.py whoami` checks it.

Every row records which bot wrote it. Rows are changed one at a time. Nothing replaces a whole list.

## Tasks
```
dash.py task-add "Edit ep 4" [--owner video-editor] [--status todo|doing|waiting_on_jon] [--note ..] [--key ..]
dash.py task-update t_… --status doing|waiting_on_jon|qc|done [--owner ..] [--note ..] [--title ..]
dash.py tasks [--owner me|<slug>] [--status todo,doing]      dash.py task t_…   (shows its proof)
```
Statuses: `todo`, `doing`, `waiting_on_jon`, `qc`, `done`. One owner per task (default: you). Moving to `qc` or `done` needs at least one proof that QC hasn't failed. `--key` is your own unique id for the task: repeating it returns the first task, so a retry makes no copy.

## Proof
```
dash.py proof-add t_… --kind render|url|pdf|test --link "https://…" or "D:\path\file.mp4" [--note ..]
dash.py proofs --status pending                      (QC's queue)
dash.py proof-check p_… passed|failed [--note ..]     (QC only)
```

## Questions for Jon
```
dash.py ask "Send the 20 pitches today?" --option Yes --option No [--context ..] [--task t_…] [--key ..]
dash.py question q_…                                  (status open → answered; read "answer")
dash.py questions --asked-by me --status answered
dash.py question-close q_…                            (after you've used the answer, or to withdraw it)
```
Only Jon answers, from the dashboard. Set your task to `waiting_on_jon` while you wait.

## Approvals
```
dash.py approval-request send_pitches "Send 20 pitches" --payload-file pitches.json [--task t_…] [--key ..]
                                                         (or --payload '{"count": 20}' from bash)
dash.py approvals --status approved [--action send_pitches]    (approved, not yet carried out)
dash.py approval-done a_… [--note "sent 20"]                     (only after Jon approved)
dash.py approval-cancel a_…                                      (withdraw your own request)
```
Actions are snake_case. Known ones: `send_pitches`, `publish_draft`, `post_clips`, `spotify_batch`. Status: `pending` → Jon makes it `approved` or `rejected` → the bot that carries it out marks it `done`. Only Jon approves or rejects. A request can't be marked done before it is approved. Use `--key` so a retry can't ask twice.

## Runs
```
dash.py run-report --status ok|failed|running [--started ISO] [--ended ISO] [--tokens N] [--error ..] [--task t_…]
dash.py runs --of me [--since 2026-10-29T00:00:00Z]
```
Report each session once at the end. `--started` defaults to now.

## Notes
- API: `https://jonmac.ai/dashboard/api/v1` (`DASH_BASE` overrides). Endpoints and rules: `cloud-apps/command-center/README.md` in jonmac909/jonmacai.
- Source of this tool: `cloud-apps/command-center/bots/dash.py` in that repo. Developer installs it to `D:\AgentTeam\tools\`.
- Lost or leaked token: tell Developer through the dashboard. It revokes the old one and issues a new one.
