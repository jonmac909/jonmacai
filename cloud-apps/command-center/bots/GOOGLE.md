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
google_api.py draft partners --to a@b.com --subject "Rates" --body-file pitch.txt            (new email)
google_api.py draft partners --to a@b.com --thread-id THREAD --body-file reply.txt             (reply in the thread)
google_api.py events jon --date 2026-10-30        google_api.py events jon --calendar jonstagger@gmail.com
```
- Nothing here sends mail, deletes mail, marks it read or writes the calendar. Only the approval script sends, after Jon approves. Calendar writes will need Jon's approval each time.
- Replies to a sponsor go in their thread (Jon, 2026-10-29): take `thread` from `subjects`, pass it as `--thread-id`. The draft gets "Re: <their subject>" and the reply headers of the thread's last message, so it shows inside the conversation.
- Exit codes: 0 ok, 1 Google refused, 2 local problem or not allowed.
- All bots run as the same Windows user, so the limits record intent; they don't wall bots off. Never print, copy or commit the token files.

## Connecting accounts (Jon, once per account)
`google_connect.py serve` runs a page on `http://localhost:8765/` on GPU1 with one link per account. Jon opens a link in Chrome on GPU1, picks the account and presses Allow. The token is checked (right account, every permission ticked) and saved to `D:\AgentTeam\secrets\google\<account>.json`. `google_connect.py status` shows what's connected.

- The OAuth client is the old Hermes one (Google Cloud project `ana-assistant-510518`, app name "Historient"), copied to `D:\AgentTeam\secrets\google\client.json`.
- That app is internal to thejonmac.com. Google blocks personal Gmail accounts for it (Error 403 org_internal), so jonstagger@gmail.com and the Complete Histories account need another route.
- One consent per account covers the team. partners@ grants Gmail read and compose. jon@ grants Gmail modify and calendar events.

# YouTube uploads

`python -I D:\AgentTeam\tools\youtube_upload.py COMMAND ...` (stdlib only, prints JSON, same exit codes). Channel slugs: `youtube_upload.py channels`.

```
youtube_upload.py upload mina D:\renders\mina-1.mp4 --title "..." --synthetic yes --description-file desc.txt
                  [--tags "a,b"] [--category 28] [--playlist PLxxxx] [--thumbnail thumb.jpg] [--dry-run]
youtube_upload.py schedule a_0123abcd            (after Jon approves; see below)
youtube_upload.py delete mina VIDEO_ID           (test clips only)
```
- Upload is always **private**. Run the same command again after a crash: it resumes, and a finished upload returns the same video, never a second copy. A refused thumbnail or playlist add shows in `problems`; rerunning retries only those.
- `--synthetic yes` when realistic AI people, voices or scenes appear (HeyGen avatars, cloned voices). YouTube asks creators to say so.
- Publishing needs Jon. Ask: `dash.py approval-request publish_video "<video title> - <channel name>" --project <project> --payload-file p.json` with `{"channel": "mina", "video": "VIDEO_ID", "publishAt": "2026-11-02T17:00:00Z"}` (`"now"` = public at once). When it's approved, `schedule a_…` claims it, sets the time Jon saw and marks it done. Anything else (pending, rejected, used, another action, a past time) is refused before YouTube is touched.
- **Until Google audits the API project, real uploads are refused** (`AUDITED = False`): Google keeps every video uploaded through an unaudited project private for good. Use YouTube Studio until then; `--test-clip` allows a throwaway test. Flip `AUDITED` when the audit passes.
- Quota (checked 2026-10-30): uploads have their own bucket of 100 a day per project. Everything else shares 10,000 units: a thumbnail, playlist add or schedule costs 50 each, so about 150 units a video. No increase needed.
- Tokens: one per channel, `yt-<channel>.json`, because each brand channel is its own Google identity. Jon connects them on the `google_connect.py serve` page, which checks the channel id. YouTube uses Jon's External app (`youtube-client.json`, pasted on that page); the Gmail app is internal to thejonmac.com, which blocks brand channels and Jacqueline's Gmail.
- Custom thumbnails need each channel phone-verified (one number covers 2 channels a year).

# Short clips (Instagram, Facebook, TikTok, YouTube Shorts)

`python -I D:\AgentTeam\tools\short_post.py post a_… [--dry-run]` posts every clip of an approved `post_clips` approval to the platforms it lists. `short_post.py check` shows which account each platform posts as. Payload and rules: `short_post.py -h`.
- The approval pins each clip's `sha256`, so a re-rendered file is refused. One post per clip, platform and account, ever, and one run at a time per clip. When all are out it marks the approval done; otherwise it gives the approval back, and the same command later posts only what is missing.
- Before the audits: YouTube Shorts are refused (`AUDITED`), and TikTok clips land in Jon's TikTok inbox for him to post (`TIKTOK_AUDITED`).
- Tokens: `D:\AgentTeam\secrets\social\`, made on the connect page. Meta: Jon pastes a Graph API Explorer token, which becomes a Page token that doesn't expire. TikTok: a consent link; the refresh token lasts 365 days.

## YouTube API audit answers
For Jon to copy into the YouTube API Services audit form. Jon fills in his address and the project number (Google Cloud > project settings).
- Organization: Ecomm House Inc. (Jon Mac). Website: jonmac.ai. Contact: jon@thejonmac.com.
- API client: "Jon Mac Team", an internal tool. It is not offered to the public and has no outside users.
- What it does: uploads the channel owner's own finished videos to his own channels (Jon Mac, @JonMacAI, the Viral View and Home Guide Press channels, and Complete Histories), always as private first. It sets the title, description, tags, thumbnail and playlist, then schedules or publishes a video only after the owner approves that video in the team's private dashboard.
- YouTube data used: the owner's own channel id and his own videos' status. Nothing from other users is read, shown or stored. Only video ids are kept locally. OAuth tokens stay on one company machine.
- API methods: videos.insert, videos.list, videos.update, videos.delete (test clips only), thumbnails.set, playlistItems.insert, channels.list (mine).
- Quota: the default is enough (about 30 uploads a day across all channels).
