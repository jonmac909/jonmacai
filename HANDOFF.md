# HANDOFF: jonmac.ai/review video review portal

Paused on 2026-10-14 because GPU2 was shutting down for a hardware install. Work so far is in a WIP commit on branch `jonmac909/review-portal`. Nothing has been pushed, merged or deployed.

## What's done (written, NOT yet tested)

All files are in `cloud-apps/review/`:

- `wrangler.toml`: Worker `jonmac-review`. Routes: `jonmac.ai/review`, `/review/*` and `/api/review/*`. Bindings: D1 `DB`, R2 `MEDIA`, assets `ASSETS`, and version metadata `REVIEW_VERSION`.
- **Created in Cloudflare (live, empty):**
  - D1 database `jonmac-review` (id `aaf91d9f-48f9-458a-aa6d-24354266a39b`)
  - R2 bucket `jonmac-review-media`
  - The migration has NOT been applied remotely yet.
- `migrations/0001_review_portal.sql`: tables for channels, videos and comments. It seeds 7 channels (Aria, Max, Mina, Sienna, Theo, Viktor, Zane). I guessed those names from the GPU1 folders `C:/tmp/fi04-review/remake/*`, so ask Jon to confirm them.
- `worker.js`:
  - Access gate: share key `?k=` plus a passcode form. The sign-in cookie is signed and lasts 90 days. Without the key the portal returns 404.
  - Bearer-token API for the video agents.
  - MP4 streaming from R2 with Range, HEAD, 416 and ETag support.
  - Comments API: GET with `?status=open|resolved|all`, POST create, `POST .../comments/<id>/resolve`, DELETE (agents only), and `POST .../status`.
  - Chunked multipart publish API (agents only).
  - Fails closed with 503 if any secret is missing.
- `pages.js`: server-rendered pages: passcode gate, index (channel → video → versions with status chips) and the video page.
- `public/app.js` and `public/app.css`: the video page script and styles.
  - Pausing fills in the timestamp.
  - Comments are listed in time order; clicking one seeks the video.
  - Resolve / reopen buttons.
  - The author name is asked once and kept in `localStorage`.
  - Status buttons.
  - No autoplay. The source video sits in a collapsed `<details>` and is muted.
- `scripts/review_publish.mjs`: the publish script for the agents.
  - Takes a local path or URL.
  - Checks fast-start, codec and sha256, then uploads in 50 MiB chunks through the Worker.
  - Sends the metadata, then checks HEAD and Range on the result.
  - Reads the token from `REVIEW_API_TOKEN` or `~/.jonmac-review.env`.
- Tests:
  - `test/worker.test.mjs` (unit tests)
  - `test/runtime.test.mjs` (Miniflare end-to-end, including the real publish script)
  - `test/harness.mjs`
  - `test/fixtures/clip.mp4` (8 s H.264/AAC clip)
- The old VSL page (`public/index.html`, `poster.jpg`) was removed. The new portal replaces the withdrawn 410 Worker.

## Where it stopped

`npm install` in `cloud-apps/review` printed an `allow-scripts` warning: the `workerd` postinstall was blocked. I stopped `npm test` before it finished, so **no test has run yet**.

## Next steps, in order

1. `cd cloud-apps/review`, then `npm approve-scripts workerd` (or `npm rebuild workerd`), then `npm test`. Fix any failures.
2. Write `test/browser.mjs`: Playwright **WebKit** with iPhone emulation, against Miniflare locally or the live site with `--live`.
   - Log in with the share link and passcode.
   - Check there is no autoplay and no play event before a click.
   - Play past 3 s.
   - Pause, check the timestamp, then create and resolve a comment in the UI.
   - Create and resolve a comment through the API.
   - Fail on any console error or page error.
3. Write `Dockerfile.checks` and `scripts/docker-checks.mjs`, following the `cloud-apps/clone` pattern:
   - Base image `node:22-bookworm`.
   - `npm ci`, `playwright install --with-deps webkit`, `wrangler@4.145.0`.
   - Run `npm test`, `test:browser` and `wrangler deploy --dry-run`.
   - Docker build and run. No GitHub Actions.
4. Update the README: replace the "VSL review" section with the portal docs (API, publish, secrets, deploy).
5. Generate the 4 secrets with random values and save them outside the repo in `C:\Users\partn\.jonmac-review.env`. Put a copy holding only `REVIEW_API_TOKEN` and the share URL on GPU1 for the agents.
   - Set each one with `wrangler secret put` (config `cloud-apps/review/wrangler.toml`): REVIEW_SHARE_KEY, REVIEW_PASSCODE, REVIEW_SESSION_SECRET, REVIEW_API_TOKEN.
6. Ship:
   - Open a PR, get the Docker gate green, then squash-merge.
   - `wrangler d1 migrations apply jonmac-review --remote`, then `wrangler deploy --tag <merged-sha>`.
7. Publish Mina v9. Local copies (sha `c04f50b6…fe08` matches GPU1 `qc.json`) are already in `%TEMP%\rp\media\`; if they're gone, use scp or the GPU1 URL.

   ```
   node scripts/review_publish.mjs --slug mina-1-v9 --channel mina --video mina-1 --version v9 --title "Mina: AI shorts tutorial" --file mina01_v9.mp4 --source source_h264.mp4 --chapters versions.json
   ```

   Chapters come from `C:/tmp/fi04-review/remake/mina-1/versions.json`.
8. Live proof: run `node test/browser.mjs --live --slug mina-1-v9` in headless WebKit with iPhone emulation.
   - Then delete the proof comments through the API and reset the status to `needs_review`.
   - Copy the script to GPU1 at `C:/tmp/fi04-review/scripts/review_publish.mjs`.
9. Final report line: `STATUS: PASS|ISSUES|BLOCKED, <URL, passcode location>`.
