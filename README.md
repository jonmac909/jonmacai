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

[jonmac.ai/review](https://jonmac.ai/review) serves the final 9:05 VSL through a
small read-only Worker in `cloud-apps/review/`. The MP4 lives in the existing
`frame-media` R2 bucket, so playback does not depend on a desktop or tunnel.
The page is public and excluded from indexing; it is not password-protected.

The streaming copy retains 1920×1080, 24000/1001 fps and all 13,073 video frames;
audio is copied from the approved render. Its fast-start MP4 supports byte-range
requests, including suffix/open-ended seeks and HEAD.

Run `node --test cloud-apps/review/worker.test.mjs` before deploying with
`npx wrangler deploy --config cloud-apps/review/wrangler.toml`.
Upload a versioned R2 object and update `VIDEO_KEY` for a new edit; never commit
video files, credentials, or unrelated site routes.
