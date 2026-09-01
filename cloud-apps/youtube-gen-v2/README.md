# YouTube Gen V2 prototype

This is an isolated front-end prototype for the simplified Jon Mac YouTube production pipeline. It does not modify the existing `cloud-apps/youtube-gen` application.

## Preview

Serve the repository root with any static server and open:

```text
/cloud-apps/youtube-gen-v2/
```

For example, from the repository root:

```powershell
npx --yes http-server . -p 4177 -c-1
```

Then visit `http://127.0.0.1:4177/cloud-apps/youtube-gen-v2/`.

## Production route

The V2 prototype is deployed as an isolated Cloudflare Worker at `https://jonmac.ai/yt2`. Run `./build-deploy.ps1`, then `npx wrangler deploy` from this directory to publish updated assets. The existing `/yt` worker is not changed.

The prototype reuses `youtube-gen/rows_data.js` for outlier discovery and stores V2 projects under the browser-local `jonmac_youtube_gen_v2_projects_v1` key.

## Prototype boundaries

- Six versioned 2,500-word template configurations are real.
- Outlier selection, project creation, approvals, demo footage, edit progress, review, and private-upload simulation are interactive.
- Script narration is a scaffold showing section budgets and edit markers; production AI generation still needs the cloud generation route.
- File selection is local-only in V2. Production should replace it with signed object-storage uploads.
- Auto-edit and YouTube publishing are simulated jobs. Their UI and state contracts are ready for real background workers and YouTube OAuth.
