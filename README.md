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
- The page credits “Cylinder Seven” by Chris Zabriskie, links the
  [official source](https://chriszabriskie.com/cylinders/) and
  [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/), and discloses:
  "Edited, crossfaded, level-adjusted and ducked. No endorsement implied."
  Confirm the final audio manifest still matches this selected track.
- Keep the R2 key and every video/poster URL version aligned. Do not overwrite a
  released object with different bytes; use a new key and version for later edits.
  Keep source footage, rejected-project archives and large exports outside Git.

Main can gather release metadata and extract the approved poster in PowerShell
(set both values to the actual approved file and editorially selected timestamp):

```powershell
$ApprovedMp4 = Read-Host 'Absolute path to the QA-approved web MP4'
$PosterTime = Read-Host 'Editorially selected poster timestamp (HH:MM:SS.mmm)'
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
S3 credentials scoped to `frame-media` (Object Read & Write). Use the S3 API endpoint
shown in the Cloudflare R2 dashboard and `no_check_bucket = true`
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

Use the existing [PR #2](https://github.com/jonmac909/jonmacai/pull/2), targeting
`main` from `jonmac909/Feature-VSL-Review`. The prepared three-file change was
committed as `e6607e5`; `origin/main` (`077d2f1`) was integrated in merge commit
`3110cba`. The four conflicts were confined to this review's README, page, Worker
and Wrangler configuration. The withdrawal guard and versioned native-master
target were retained instead of the historical rejected release; unrelated
upstream content was unchanged.

The [failed Netlify deploy log](https://app.netlify.com/projects/jonmacai/deploys/6a9f367be90dd30008465a7d)
shows a site-level build configuration mismatch, not invalid header or redirect
rules: Netlify's UI runs `npm run build` from `/opt/build/repo`, but the repository
has no root `package.json` (`ENOENT`, exit 254). Its UI publish directory is `dist`.
Header rules, Pages changed and Redirect rules all report that same failed deploy.
No existing repository Netlify configuration is available to correct. The site
owner must reconcile the connected site's build/base/publish settings with the
intended main-site source before rerunning its checks. Do not add a dummy build,
publish this Cloudflare-only review directory to Netlify, or bypass failed checks.

Main must review the integrated diff and resolve that CI prerequisite before
merging. There is no repository GitHub Actions deployment workflow; Netlify is
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
