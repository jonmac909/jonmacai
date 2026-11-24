# Guide site (jonmac.ai/lab, /guides, /go/skool)

Code: src/guides.js (routes wired in src/worker.js), migration 0038_guides.sql, tests test/guides.test.mjs.

## Pages
- `/lab` home page that sells AI Video Lab. `[JON: ...]` marks text Jon still has to supply.
- `/guides` index of listed guides. `/guides/<slug>` one guide (unlisted = live, noindex, not on the index).
- `/go/skool?from=<slug>&pos=rail|end|top|home|bar` counts a GET (not HEAD, not `?qc`), then 302 to https://www.skool.com/ai-ugc/about.
- `/s/<slug>` and root `/<slug>`: shows the guide (or `/lab` when none) only when var `GUIDES_S_SWITCH=on`. Unset/off = unchanged redirect.

## Data contract (MacFrames hand-off)
One folder per video: `guide.json` + `resource/` + `img/`. guide.json fields: slug, title, summary[], read_minutes, topic[],
youtube_id (11 chars or null), sections[{id, heading, body_md, image: "img/..."}], resource{type, title, what_it_does, how_to_use,
files: ["resource/<name>"]}, checklist[], faq[{q, a}], closing{headline, line}, state (unlisted|listed), updated (YYYY-MM-DD).

## Endpoints (Bearer GUIDES_PUBLISH_TOKEN, 32+ chars)
- `PUT /guides/api/<slug>` JSON `{guide, files: {"resource/x.md": "<base64>", "img/s1.png": "<base64>"}}`. Files go to R2 UPLOADS `guides/<slug>/`. 400 if a referenced file is missing.
- `GET /guides/api/<slug>/stats` visits, skool clicks by pos, downloads, emails.
- `POST /guides/<slug>/download` `file=<index>`: with the token returns the file and stores nothing (publish check). Without it needs email + terms=1 (newsletter=1 optional); email joins skool_leads.

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
