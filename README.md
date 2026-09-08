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
```

## VSL review

[jonmac.ai/review](https://jonmac.ai/review) is **withdrawn**. The read-only
`jonmac-review` Cloudflare Worker returns HTTP 410 with `Cache-Control: no-store`
while `REVIEW_WITHDRAWN = "true"`. Keep that guard enabled until the native master
passes editorial, native-render, audio and AAA Sabri parity QA. Do not restore the
rejected edit or deploy the historical `main` configuration, which lacks the guard.

The prepared release targets only `jonmac.ai/review` and `jonmac.ai/review/*`;
`workers_dev` remains disabled. Media belongs in the existing `frame-media`
R2 bucket at `reviews/jon-main-vsl/native-master-v1-web.mp4`. The Worker streams
R2 bodies without buffering and preserves HEAD, byte ranges, suffix/open-ended
seeks, ETags and If-Range. The review is public when released, not password-protected;
HTML and response headers exclude indexing. HTML revalidates; media caches for
one hour. All player/download URLs now carry `?v=native-master-v1`.

### Final media gate

Main owns final media approval and publication. No final media has been uploaded
by this preparation. Historical duration, resolution and graphic-count claims were
removed rather than carried forward as native-master facts.

- Inspect the approved native master and its approved fast-start web MP4, not an
  older export. The editorial contract is 13,073 keeper frames at 24000/1001 fps on
  a 3840×2160 working canvas; those are acceptance targets, not measured web metadata.
  Record actual web duration, dimensions, frame count, fps and audio channel mapping.
- Replace `#release-metadata` in `cloud-apps/review/public/index.html` with those
  measured release values. Add only claims supported by the approved render.
- Replace `cloud-apps/review/public/poster.jpg` with a frame from the approved web
  MP4. The historical poster is deliberately not referenced by the prepared page.
  Then add `poster="/review/poster.jpg?v=native-master-v1"` to `<video>`.
- Add visible music attribution on the review page for the track Main actually
  selects. If using Chris Zabriskie's Cylinder Seven or Cylinder Eight, credit the
  chosen title and artist, link the [official source](https://chriszabriskie.com/cylinders/)
  and [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/), and disclose:
  "Edited, crossfaded, level-adjusted and ducked. No endorsement implied."
  Use the final audio manifest's attribution and hashes; do not guess the selected title.
- Keep the R2 key and every video/poster URL version aligned. Do not overwrite a
  released object with different bytes; use a new key and version for later edits.
  Keep source footage, rejected-project archives and large exports outside Git.

Main can gather release metadata and extract the approved poster in PowerShell
(set both values to the actual approved file and editorially selected timestamp):

```powershell
$ApprovedMp4 = 'C:\path\to\approved\native-master-v1-web.mp4'
$PosterTime = '00:00:00.000'
ffprobe -v error -count_frames -show_entries "format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,sample_rate,channels,channel_layout" -of json "$ApprovedMp4"
ffmpeg -n -ss "$PosterTime" -i "$ApprovedMp4" -frames:v 1 "$env:TEMP\native-master-v1-poster.jpg"
Copy-Item "$env:TEMP\native-master-v1-poster.jpg" cloud-apps/review/public/poster.jpg
```

### Upload and release commands — Main only, after QA

Run from `C:/Users/partn/orca/workspaces/jonmacai/Feature-VSL-Review`.
Wrangler uploads at most **315 MB per file**, one object at a time; the R2 service's
larger limits do not remove that CLI cap. Use multipart S3/rclone for a larger web
copy rather than compressing away approved quality just to fit Wrangler.

For a file within the Wrangler cap, upload while withdrawal is still enabled:

```powershell
npx --no-install wrangler r2 object put frame-media/reviews/jon-main-vsl/native-master-v1-web.mp4 --file "$ApprovedMp4" --content-type video/mp4 --remote --config cloud-apps/review/wrangler.toml
```

For larger files, configure a private `r2` rclone remote using securely supplied R2
S3 credentials scoped to `frame-media` (Object Read & Write). Use the account's
`https://<account-id>.r2.cloudflarestorage.com` endpoint and `no_check_bucket = true`
for object-level credentials. Do not put keys in Git, command arguments or logs.
Wrangler OAuth is not an S3 access-key pair. With that remote available:

```powershell
rclone copyto "$ApprovedMp4" r2:frame-media/reviews/jon-main-vsl/native-master-v1-web.mp4 --s3-no-check-bucket --s3-upload-cutoff 100M --s3-chunk-size 100M
```

R2 allows approximately 5 GiB single-part and 4.995 TiB multipart objects, up to
10,000 parts; non-final parts must be at least 5 MiB. See the current provider
[upload guidance](https://developers.cloudflare.com/r2/objects/upload-objects/),
[limits](https://developers.cloudflare.com/r2/platform/limits/) and
[rclone configuration](https://developers.cloudflare.com/r2/examples/rclone/).

Before clearing withdrawal, download the new object and compare its SHA-256 with
the approved local copy. Both hashes must match:

```powershell
npx --no-install wrangler r2 object get frame-media/reviews/jon-main-vsl/native-master-v1-web.mp4 --file "$env:TEMP\native-master-v1-upload-check.mp4" --remote --config cloud-apps/review/wrangler.toml
Get-FileHash "$ApprovedMp4", "$env:TEMP\native-master-v1-upload-check.mp4" -Algorithm SHA256
```

Only after the upload is verified against the approved bytes, the poster and
measured metadata are in place, and Main approves QA, set
`REVIEW_WITHDRAWN = "false"`. The existing tests and deployment check are Main's
single post-integration gate; no tests/build/lint were run during preparation:

```powershell
node --test cloud-apps/review/worker.test.mjs
npx --no-install wrangler deploy --dry-run --config cloud-apps/review/wrangler.toml
```

Use the existing PR rather than opening another publication route. At preparation,
[PR #2](https://github.com/jonmac909/jonmacai/pull/2) targets `main` from
`jonmac909/Feature-VSL-Review`, is conflicting, and has failed Netlify Header rules,
Pages changed and Redirect rules checks. Preserve other work and resolve the
upstream merge without dropping the Worker withdrawal guard:

```powershell
git add README.md cloud-apps/review
git commit -m "Prepare approved native VSL master release"
git fetch origin main
git merge origin/main
```

If the merge conflicts, resolve the listed conflicts, preserving unrelated
upstream content and this review release, then stage those resolved files and
finish with `git commit`. Do not auto-select the historical review from `main`.
Main must review the resulting diff and failed checks before merging; there is no
repository GitHub Actions deployment workflow. The existing Netlify checks are
not the Cloudflare Worker deployment.

```powershell
git push origin HEAD:jonmac909/Feature-VSL-Review
gh pr edit 2 --title "Release approved native VSL master review" --body "Replace the withdrawn edit with the QA-approved native master at jonmac.ai/review. Final metadata and poster come from the approved media. R2 upload verified; native-render, audio and AAA Sabri parity QA approved. Cloudflare deployment remains a manual release gate."
gh pr merge 2 --squash
```

Do not use that approval wording or merge command before those conditions are
true. Deploy only the reviewed, merged release tree (not an older `main` checkout):

```powershell
npx --no-install wrangler deploy --config cloud-apps/review/wrangler.toml
```

After deployment, Main must exercise `https://jonmac.ai/review` in a browser:
poster, sound, seeking, fullscreen and download; confirm measured media metadata,
noindex/cache headers, HEAD and `Range: bytes=0-1` returning 206 with correct
Content-Range. If the release fails, restore `REVIEW_WITHDRAWN = "true"` and deploy
that guarded version; do not roll back to a historical unguarded edit.

### Readiness observed during preparation

- Live `/review` returns HTTP 410. R2 `frame-media` reports zero objects.
- Cached Wrangler 4.129.1 is available, authenticated by stored OAuth; account,
  Worker/route write permissions and R2 bucket read access are available.
- GitHub CLI access works with repository ADMIN permission. `main` has no branch
  protection; that does not waive Main's QA or failed-check review gate.
- `rclone` is installed. No rclone configuration, AWS credentials file, or
  Cloudflare/AWS/R2 credential environment variables were found in this process.
  A multipart upload still needs a securely provisioned R2 S3 access-key pair.
- No upload, deployment, merge, push, withdrawal change, or validation command
  was performed during preparation. Worker range-serving code and tests are unchanged.
