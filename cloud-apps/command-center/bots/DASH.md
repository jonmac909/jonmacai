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
dash.py task-update t_… --status doing|waiting_on_jon|qc|review|cancelled [--owner ..] [--note ..] [--title ..] [--project ..] [--minutes N] [--due YYYY-MM-DD]
dash.py tasks [--owner me|jon|<slug>] [--status todo,doing] [--project ..]      dash.py task t_…   (shows its proof)
```
- One owner per task. It defaults to you.
- Something only Jon can do: `--owner jon`. It shows on the project's board, and he ticks it done there himself (no proof).
- The flow: `todo`/`doing` → `qc` (add proof first) → QC passes it → `review` (automatic) → Jon approves → `done`. Or Jon sends it back to `doing` with a comment.
  - `qc` needs at least one proof that QC hasn't failed.
  - QC passing a proof on a `qc` task moves it to `review` by itself. You may set `review` yourself only when QC has passed one of its proofs.
  - Only Jon sets `done`, by approving on the dashboard. `--status done` is refused.
  - Jon's send-back wakes you with `card_comment` and `data.sentBack: true`; `data.comment` says what to change. Do it, add new proof, move to `qc` again.
  - If QC fails the last proof that supported a `qc`, `review` or `done` task, the task goes back to `doing`.
- Make the proof link the deliverable itself whenever you can: an https link Jon can open (the review page, the live page, the render). Jon sees it on the Review card. A file path shows only as text.
- Videos: publish each version to jonmac.ai/review, then add its page as proof: `dash.py proof-add t_… --kind render --link https://jonmac.ai/review/<slug>`. That link is what ties the task to the video. Its Review card then opens the dashboard's Review page, Jon's comments there wake you, and his Send back or Approve there moves the card.
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

## Calendar and Content (YouTube channels)
Jon's Calendar and Content pages have one tab per channel: Jon Mac, @JonMacAI, Complete Histories, the 7 Viral View channels and the 13 Home Guide Press channels. `dash.py channels` lists their slugs and schedules.
Who writes: jon-mac-youtube (Sydney), viral-view (Scarlett), home-guide-press (Elle), plus developer and ana. Anyone else is refused. Any bot can read.
```
dash.py channel-set mina-creates --schedule "Tue and Fri 9 am PT"          ("" clears it; the page shows "not set")
dash.py calendar-add mina-creates "<title>" --date 2026-11-03 --status planned|scheduled|published [--link https://…] [--key mina-2]
dash.py calendar-update v_… [--status published] [--date ..] [--title ..] [--link https://… or ""]
dash.py calendar [--channel ..] [--from 2026-11-01] [--to ..]
dash.py outlier-add mina-creates "<title>" --link https://… --views 42000 --avg 10000 --published 2026-10-27 [--thumb https://…] [--key <video id>]
dash.py outlier-select o_… on|off
dash.py outliers [--channel ..] [--selected]                                (best first; --selected = what Jon picked for production)
```
- The date is the day it posts, in PT. Keep each video's status current: `planned` → `scheduled` → `published`, with the YouTube link once it has one.
- `--avg` is the outlier's own channel's average views. The page shows "4.2× avg" and sorts by it.
- Links and thumbnails must be https:// (or http://). The page shows links as buttons.
- Use `--key` (for outliers, the video id) so a retry or a second scan never adds a copy. Repeating a key returns the first row; change a calendar video with `calendar-update`.
- Jon can also select or unselect an outlier on the page. Check `dash.py outliers --selected` before you start production.

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
- Jon may comment on your card from the Projects page. You are woken with type `card_comment` (`data.task`, `data.comment`; `data.sentBack: true` when he sent it back from review to `doing`).
- Read the thread with `dash.py task t_…`, then answer with `dash.py comment`. Your comment wakes no one.
- Keep replies short, and do the work the comment asks for.
- Review comments: each comment Jon leaves on a video in the dashboard's Review page arrives as `card_comment` with `data.review` = `{slug, commentId, t, time, text, audio, drawing}` (`time` like `1:05`). It goes to the owner of the task linked to that video, or to `video-editor` with `data.task: null` when no task links to it yet. Read the open comments with the review API (`GET https://jonmac.ai/api/review/<slug>/comments?status=open`); a drawing is vector JSON in `drawing`.
- Voice notes (`data.review.audio: true`): run `node D:\AgentTeam\tools\review_voice.mjs --slug <slug>` once (source: `cloud-apps/review/scripts/review_voice.mjs`). It transcribes every voice note on that video with no transcript yet, with Parakeet on GPU1 through the render queue (`gpuq.py run --model parakeet`), posts the text back to the comment, and prints it. It doesn't loop or wait: run it again only when another voice-note wake arrives. No cloud speech-to-text.
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
- Actions are snake_case. The known ones are `send_pitches`, `publish_draft`, `post_clips` (short clips; `short_post.py -h` has the payload), `spotify_batch` and `publish_video` (YouTube; GOOGLE.md).
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
