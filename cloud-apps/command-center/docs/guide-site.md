# Guide site (jonmac.ai/lab, /guides, /go/skool)

Code: src/guides.js (routes wired in src/worker.js), migration 0038_guides.sql, tests test/guides.test.mjs.

## Pages
- `/lab` home page that sells AI Video Lab. No placeholder text ships (a test fails on `[JON:`). Guide count shows only from 5 real guides; "Your teacher" stays hidden until Jon has real credentials.
- `/guides` index of listed guides. `/guides/<slug>` one guide (unlisted = live, noindex, not on the index).
- `/go/skool?from=<slug>&pos=rail|end|top|home|bar` counts a GET (not HEAD, not `?qc`), then 302 to https://www.skool.com/ai-ugc/about.
- `/s/<slug>` and root `/<slug>`: shows the guide (or `/lab` when none) only when var `GUIDES_S_SWITCH=on`. Unset/off = unchanged redirect.

## Data contract (MacFrames hand-off)
One folder per video: `guide.json` + `resource/` + `img/`. guide.json fields: slug, title, summary[], read_minutes, topic[],
youtube_id (11 chars or null), sections[{id, heading, body_md, image: "img/..."}], resource{type, title, what_it_does, how_to_use,
files: ["resource/<name>"]}, checklist[], faq[{q, a}], closing{headline, line}, state (unlisted|listed), updated (YYYY-MM-DD),
channel (optional: "jonmacai" = Jon Mac AI, "jon-mac" = Jon Mac main; any other value is a 400). The channel name shows as a small
label on the guide and its index card, and the index filters by channel and topic. Markdown links: http(s), mailto, /path, #anchor only.

## Endpoints (Bearer GUIDES_PUBLISH_TOKEN, 32+ chars)
- `PUT /guides/api/<slug>` JSON `{guide, files: {"resource/x.md": "<base64>", "img/s1.png": "<base64>"}}`. Files go to R2 UPLOADS `guides/<slug>/`. Limits: body 25 MB, 20 files, 10 MB per file (413/400). Every referenced file must be in the request or already in R2, checked before any upload: a rejected publish writes nothing.
- `GET /guides/api/<slug>/stats` channel, visits, skool clicks by pos, downloads, emails. 503 JSON if the database is not bound.
- `POST /guides/<slug>/download` `file=<index>`: with the token returns the file and stores nothing (publish check). Without it needs email + terms=1 (the Privacy box; jonmac.ai has no terms page, /guides/terms redirects to /dashboard/privacy) (newsletter=1 optional, new guides only); email joins skool_leads but never the 7-day Skool sequence (only /s/ email-box leads do).

## publish_guide.py
`python -I tools/publish_guide.py <folder> [--base URL] [--token-file F] [--state listed|unlisted]`
Defaults: base = preview worker, token = D:\AgentTeam\secrets\guides-publish-preview.token.
Uploads the folder, then checks page 200, title present, each download returns the exact bytes, each image 200,
noindex and index listing match the state. Exit 0 only if every check passes.

## Preview
Worker `jonmac-cc-preview-guides` (env preview-guides, routeless, workers.dev), DB command_center_preview, R2 command-center-uploads-preview,
vars PREVIEW=1 GUIDES_S_SWITCH=on. Deploy: `wrangler deploy --env preview-guides`.

## Go-live (needs Jon's go; not done)
1. Apply 0038 to the production DB.
2. Set GUIDES_PUBLISH_TOKEN on jonmac-command-center (new token file).
3. Add routes on jonmac.ai to jonmac-command-center: `jonmac.ai/guides`, `jonmac.ai/guides/*`, `jonmac.ai/go/*`, `jonmac.ai/lab`.
4. Deploy production from main. GUIDES_S_SWITCH stays unset until Jon says to switch /s/ links to guides.

## Before go-live
- Remove the sample guide (claude-stop-chatting) from production if present: it exists on the preview only; /s/<slug> with no guide shows /lab.
