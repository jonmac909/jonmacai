# dash.py — write to the dashboard as your bot

`python D:\AgentTeam\tools\dash.py COMMAND ...` (Python stdlib only). It prints JSON.
Exit codes: 0 = ok. 1 = the dashboard refused (the reason is on stderr). 2 = a local problem (usage, unknown bot, no token, bad payload). 3 = the dashboard can't be reached or failed.

**Who you are:** run it from your own OpenBot workspace (BOTS.md maps the folder to your bot). Scripts that run outside every workspace set `DASH_BOT=<your slug>`. Inside a workspace, the folder wins, and a different `DASH_BOT` is refused.
Slugs are your rules file names: `ana`, `sponsors`, `viral-view`, `video-editor`, `jon-mac-youtube`, `home-guide-press`, `short-form`, `developer`, `qc`, `accounting`, `inbox`, `spotify`, `moneyclaw`, `historient`.
Your token is `D:\AgentTeam\secrets\bot-tokens\<slug>.token`. Never print, paste, commit or copy it. Never use another bot's slug or token. Every row records the bot whose token wrote it, and QC's checks count only from QC's token.
`dash.py whoami` checks your token.

Every row records which bot wrote it. Rows change one at a time; nothing replaces a whole list.

## Projects
Every task, question and approval sets `--project`. Jon sees each project on its own board (Projects page).
- `sponsors`: Florence.
- `jon-mac` = YT-JM, Jon's main YouTube channel. `jonmacai` = YT-AI UGC, the `@JonMacAI` channel. Sydney and Olivia use whichever channel the work is for.
- `viral-view` (includes the webinar funnel): Scarlett.
- `home-guide-press`: Elle.
- `short-form`: Samantha.
- `accounting`: Elizabeth.
- Developer: `coding` for dashboard/script work that serves no single project, otherwise the project it serves.

`unsorted` (or leaving it out) puts it in Unsorted. Filter lists with `--project`.

## Tasks
```
dash.py task-add "Edit ep 4" --project jon-mac [--owner video-editor] [--status todo|doing|waiting_on_jon] [--note ..] [--key ..]
dash.py task-add "Sign the Acme contract" --project sponsors --owner jon --due 2026-10-30 --minutes 10
dash.py task-update t_… --status doing|waiting_on_jon|qc|done|cancelled [--owner ..] [--note ..] [--title ..] [--project ..] [--minutes N] [--due YYYY-MM-DD]
dash.py tasks [--owner me|jon|<slug>] [--status todo,doing] [--project ..]      dash.py task t_…   (shows its proof)
```
- One owner per task. It defaults to you.
- Something only Jon can do: `--owner jon`. It shows on the project's board, and he ticks it done there himself (no proof).
- Done means proof:
  - `qc` needs at least one proof that QC hasn't failed.
  - `done` needs a proof QC passed.
  - If QC fails the last proof that supported a `qc` or `done` task, the task goes back to `doing`.
- `cancelled` needs a `--note` saying why.
- `--key` is your own unique id for the task. Repeating it returns the first task, so a retry never makes a copy.

## Daily checklist
Each project tab has the same daily items every day, reset at midnight PT. No one-off tasks here; those go on the board.
Tick each daily item when it's done for the day with `dash.py daily-done <project> "<item>" --link <proof>`.
```
dash.py daily-done sponsors "Chase overdue payments (drafts)" --link "https://…" or "D:\path\file" [--note ..]
dash.py daily-done sponsors 5 --link ..          (or the item's number, 1 = first; scripts use the text, numbers change when the list is edited)
dash.py feed daily_checklists                    (every project's items, in order)
```
- Who ticks which tab (anyone else is refused):
  - `sponsors`: sponsors.
  - `jon-mac` (YT-JM) and `jonmacai` (YT-AI UGC): jon-mac-youtube or video-editor.
  - `viral-view`: viral-view. `home-guide-press`: home-guide-press. `short-form`: short-form.
  - `accounting`: accounting. `coding`: developer.
- The link is proof, as in `proof-add`. Ticking the same item again that day replaces its link and note.
- Ana runs `dash.py daily-sync` after editing `D:\AgentTeam\rules\facts\daily-checklists.md` (`--file` reads another copy).

## Proof
```
dash.py proof-add t_… --kind render|url|pdf|test --link "https://…" or "D:\path\file.mp4" [--note ..]
dash.py proofs --status pending                      (QC's queue)
dash.py proof-check p_… passed|failed [--note ..]     (QC only)
```
`proof-add` also wakes QC (HOOKS.md). If that fails, the proof is still saved and QC finds it in its queue.

## Comments
```
dash.py task t_…                      (the task with its history and comment thread)
dash.py comment t_… "Fixed, new proof is up"   or   dash.py comment t_… --text-file reply.txt
```
- Jon may comment on your card from the Projects page. You are woken with type `card_comment` (`data.task`, `data.comment`).
- Read the thread with `dash.py task t_…`, then answer with `dash.py comment`. Your comment wakes no one.
- Keep replies short, and do the work the comment asks for.
- Ana: a `card_comment` with `data.forOwner` is for a bot without its own routine. Pass it to that bot in one message (task id and the comment), or handle it yourself. That bot answers with `dash.py comment`.

## Questions for Jon
```
dash.py ask "Send the 20 pitches today?" --project sponsors --option Yes --option No [--minutes 2] [--context ..] [--task t_…] [--key ..]
dash.py question q_…                                  (status open → answered; read "answer")
dash.py questions --asked-by me --status answered [--project ..]
dash.py question-close q_…                            (after you've used the answer, or to withdraw it)
```
Only Jon answers, from the dashboard. Set your task to `waiting_on_jon` while you wait.

## Approvals
```
dash.py approval-request send_pitches "Send 20 pitches" --project sponsors --payload-file pitches.json [--minutes 5] [--task t_…] [--key ..]
                                                         (or --payload '{"count": 20}' from bash)
dash.py approvals --status approved --requested-by me [--action send_pitches] [--project ..]
dash.py approval-claim a_…        (approved → running; only one claim wins, so check the exit code)
dash.py approval-done a_… [--note "sent 20"]      (running → done)
dash.py approval-release a_… [--note "SMTP down"] (running → approved, try again later)
dash.py approval-cancel a_…       (withdraw your own pending or approved request)
```
- Actions are snake_case. The known ones are `send_pitches`, `publish_draft`, `post_clips` and `spotify_batch`.
- Jon sees the whole payload before approving, so it is capped at 4000 characters as formatted JSON. Put long lists in a file and send its path.
- Status flow: `pending` → Jon makes it `approved` or `rejected` → the bot that asked claims it (`running`) → `done`.
- Only Jon approves or rejects.
- Only the bot that asked can claim, finish, release or cancel its request.
- Claim before you act. Never act on a request you didn't claim successfully.
- At the start of each session, run `dash.py approvals --status running --requested-by me`. A claim left `running` by a session that stopped part way must be finished (`approval-done`) or given back (`approval-release`). Check what was already sent before you try again.
- Use `--key` so a retry can't ask twice.

## Runs
```
dash.py run-report --status ok|failed|running [--started ISO] [--ended ISO] [--tokens N] [--error ..] [--task t_…]
dash.py runs --of me [--since 2026-10-29T00:00:00Z]
```
Report each session once, at the end. `--started` defaults to now.

## Feeds for the Today and Projects pages
```
dash.py feed-put morning_summary --text-file summary.txt [--data '{"date": "2026-10-29"}']   (Ana, each morning)
dash.py feed-put calendar_today --data-file calendar.json                                     (Ana, each morning)
dash.py feed-put claude_usage --data '{"weekPct": 62, "resetsAt": "2026-10-31T17:00:00Z"}'    (Ana)
dash.py feed-put ebook_sales --data '{"month": "2026-10", "usd": 1234.5, "orders": 31}'       (Home Guide Press or Accounting)
dash.py feed claude_usage                                                                     (read the newest)
```
Each post adds a new entry, and the Today page shows the newest one. A card turns stale after 24 hours without a post.
`ebook_sales` is the month-to-date total for that month. Post the whole figure each time, not just the new sales.
`calendar_today` is `{"date": "2026-10-29", "events": [{"start": "09:30", "end": "10:00", "title": "..", "calendar": ".."}]}`: today's events in PT, at most 60. `calendar` is optional. Projects shows it only on that date.

## Notes
- Jon sees questions and approval requests in the "Needs you" list on the Today page (jonmac.ai/dashboard) and on each project's board. He answers or approves them there.
- API: `https://jonmac.ai/dashboard/api/v1` (`DASH_BASE` overrides it, https only). Endpoints and rules are in `cloud-apps/command-center/README.md` in jonmac909/jonmacai.
- This tool's source is `cloud-apps/command-center/bots/dash.py` in that repo. Developer installs it to `D:\AgentTeam\tools\`.
- All bots run as the same Windows user, so a bot could read another bot's token file. Tokens record who did what. They don't wall bots off from each other. Only Jon's own sign-in can answer or approve.
- Lost or leaked token: tell Developer through the dashboard. Developer rotates it with `scripts/bot-tokens.mjs --rotate <slug>`.
