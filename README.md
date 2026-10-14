# YouTube Gen

Live app: [jonmac.ai/yt](https://jonmac.ai/yt) (AIOS Hub → YouTube Gen).

This repo is the YouTube Gen cloud app, including the Create-from-scratch intake path.

## Intake

`fetchYouTubeMetadata()` tries `/api/cloud/youtube-gen/youtube-metadata` first.

If that route is missing, redirects to login, or fails, it falls back to:

- YouTube oEmbed: `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={id}&format=json`
- Thumbnail: `https://i.ytimg.com/vi/{id}/maxresdefault.jpg` (hqdefault as backup)

## Files

```
cloud-apps/base-path.js
cloud-apps/youtube-gen/app.js
cloud-apps/youtube-gen/index.html
cloud-apps/review/          (jonmac.ai/review portal)
```

## Video review portal

[jonmac.ai/review](https://jonmac.ai/review) is a private review site for the AI
channels. Jon shares it with his editor. Code: `cloud-apps/review/` (Cloudflare Worker
`jonmac-review`, D1 database `jonmac-review` for comments, R2 bucket `jonmac-review-media`
for MP4s). It replaces the withdrawn VSL page. The VSL native master can be published
here as a normal video; its old release notes are in git history (`67b55b0`).

- `/review` lists each channel → video → version, with status (needs review / changes
  requested / approved) and the open comment count.
- `/review/<slug>` plays our video only. The source video and a first-60 side-by-side, if
  published, are collapsed, muted extras. Nothing autoplays, pausing ours pauses everything,
  and the player plays inline on phones.
- Pausing fills the comment timestamp. Comments are listed in time order, clicking one
  seeks there, and each can be resolved or reopened. The name is asked once and kept in
  the browser. The status buttons set the video's status.

### Access

Send plain links (`https://jonmac.ai/review/<slug>`). A signed-out visitor, with or without
a share key, always lands on the passcode page and then goes on to the page they opened;
a missing or wrong key never returns 404. Sign-in lasts 30 days. A valid share key
(`?k=<REVIEW_SHARE_KEY>`) is remembered in a cookie for 30 days after sign-in. Changing the
passcode or share key signs everyone out. Signed-out media requests get 401. Plain http is sent to https. All pages and
media are `noindex`. The values live outside the repo in `C:\Users\partn\.jonmac-review.env`
(Worker secrets: `REVIEW_SHARE_KEY`, `REVIEW_PASSCODE`, `REVIEW_SESSION_SECRET`,
`REVIEW_API_TOKEN`). GPU1 holds only the API token and share link, in
`C:\Users\<user>\.jonmac-review.env`.

### Agent API

Send `Authorization: Bearer $REVIEW_API_TOKEN` with every call. Base: `https://jonmac.ai/api/review`.

| Call | Purpose |
|---|---|
| `GET /videos` | all channels and videos with status and open counts |
| `GET /<slug>` | one video (URLs, duration, chapters, status) |
| `GET /<slug>/comments?status=open` | open comments in time order (`all`, `resolved` also work) |
| `POST /<slug>/comments/<id>/resolve` | mark resolved; body `{"by": "agent name"}`, or `{"resolved": false}` to reopen |
| `POST /<slug>/comments` | add a comment `{"author", "t", "text"}` |
| `DELETE /<slug>/comments/<id>` | delete (agents only) |
| `POST /<slug>/status` | `{"status": "needs_review" \| "changes_requested" \| "approved"}` |

Each comment has `id, slug, author, t` (seconds), `text, created_at, resolved, resolved_at, resolved_by`.

### Publishing a video

```sh
node cloud-apps/review/scripts/review_publish.mjs --slug mina-1-v10 --channel mina \
  --video mina-1 --version v10 --title "Mina: AI shorts tutorial" --file mina01_v10.mp4 \
  [--source source_h264.mp4] [--compare first60_side_by_side.mp4] [--chapters versions.json]   [--notes "QC verdict / what changed"]
```

- `--file`, `--source` and `--compare` take a local path or an https URL. Send H.264/AAC web
  copies; convert AV1 sources first.
- The script checks the file is H.264/AAC and fast-start, records the sha256, uploads in
  50 MiB chunks through the Worker, saves the metadata and checks that HEAD and byte
  ranges work.
- The token comes from `REVIEW_API_TOKEN` or `~/.jonmac-review.env`.
- Use one slug per version (`<video>-v<n>`). Publishing the same slug again replaces its
  media, resets the status to needs review and keeps its comments.
- GPU1 copy: `C:/tmp/fi04-review/scripts/review_publish.mjs`.

### Checks and deploy (Docker gate; no GitHub Actions)

```sh
docker build -f cloud-apps/review/Dockerfile.checks -t jonmac-review-checks cloud-apps/review
docker run --rm --ipc=host jonmac-review-checks
```

The gate runs:
- unit tests;
- Workers-runtime tests (gate, publish script, Range/416/ETag media, comments API, fail-closed secrets);
- headless desktop Google Chrome (Jon's review gate): a click plays ours with sound past 3 s,
  nothing autoplays, the extras stay muted and pause when ours pauses, zero console errors,
  and a comment is created and resolved through both the UI and the API;
- the Worker bundle dry run.

After the gate passes and the PR is merged, release the merged commit:

```powershell
npx --yes wrangler@4.145.0 d1 migrations apply jonmac-review --remote --config cloud-apps/review/wrangler.toml
npx --yes wrangler@4.145.0 deploy --config cloud-apps/review/wrangler.toml --tag <merged-sha>
```

Live proof (secrets from the env file; it deletes its own test comments and leaves the status alone):

```powershell
docker run --rm --ipc=host --env-file C:\Users\partn\.jonmac-review.env jonmac-review-checks node test/browser.mjs --live --slug mina-1-v9
```

Responses carry `X-Review-Version` (the deploy tag).

Run the browser checks in Docker. Playwright's own Chromium has no H.264, so the gate installs
Google Chrome inside the container.
