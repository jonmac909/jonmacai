# hyper.jonmac.ai (the gate in front of HyperFrames on GPU1)

Jon's own HyperFrames app (the video editor in `D:\AgentTeam\hyperframes-fork`) runs on GPU1 as a local server on `127.0.0.1:5191`. This Worker makes it reachable from the dashboard's Hyper page, `https://jonmac.ai/dash/#hyper`, and from nowhere else.

The app has no sign-in of its own and it can run an agent on GPU1, so the rules are strict:

- GPU1 has no public address. The app is reached only through this Worker, over a Cloudflare tunnel (`hyper-studio`) that is bound to the Worker as a Workers VPC service (`STUDIO`).
- Nothing is passed to the app without this host's cookie, `__Host-hyper` (12 hours, HttpOnly, Secure, SameSite=Strict, signed with the secret `GATE_SECRET`).
- The cookie is set only at `/__enter?t=<ticket>`, and only when the dashboard Worker confirms the ticket (`GET /dashboard/api/hyper/check`, over the service binding `DASH`). The dashboard gives tickets only to Jon's signed-in session and they last 60 seconds (`cloud-apps/command-center/src/hyper.js`).
- A write (anything but GET or HEAD) or a WebSocket must carry `Origin: https://hyper.jonmac.ai`, so no other site and no other jonmac.ai app can drive the app through Jon's browser.
- Answers may be framed only by `https://jonmac.ai` and by the app itself, which frames pages of its own (`Content-Security-Policy: frame-ancestors`).
- The app is sent a plain local request (`http://localhost:5191/...`): the gate cookie, the visitor headers and `Origin` are removed, which is what the app's own same-site checks expect.

Without the cookie a page request gets a short page with a link to the dashboard (401). When GPU1 is off, or the app or the tunnel is not running, it gets "Hyper is not reachable" (502).

## Files

- `worker.js`: the gate. `worker.test.mjs`: its tests (`node --test cloud-apps/hyper/worker.test.mjs`).
- `wrangler.jsonc`: custom domain `hyper.jonmac.ai`, bindings `DASH` and `STUDIO`.

## One-time setup (run on GPU1, signed in to wrangler)

1. Tunnel: `wrangler tunnel create hyper-studio`. Note its id.
2. Private service: `wrangler vpc service create hyper-studio --type http --tunnel-id <tunnel id> --ipv4 127.0.0.1 --http-port 5191`. Put the service id it prints into `vpc_services[0].service_id` in `wrangler.jsonc`.
3. Deploy: `wrangler deploy --config cloud-apps/hyper/wrangler.jsonc`. The custom domain makes the DNS record and certificate for `hyper.jonmac.ai`.
4. Secret: pipe 32 random bytes into `wrangler secret put GATE_SECRET --config cloud-apps/hyper/wrangler.jsonc`. It is never printed or saved: setting a new one only signs everyone out of the app.
5. On GPU1, keep two things running: the app's server and the tunnel (`D:\AgentTeam\hyperframes-fork\app\Serve-HyperFrames.ps1` starts both).

The dashboard side (the Hyper page and the two `/dashboard/api/hyper/*` routes) ships with `cloud-apps/command-center`.

## Not checked yet

Whether a Workers VPC service carries WebSockets. The app works without them (its live updates use server-sent events), but Vite's hot-reload socket would not connect. If that turns out to matter, the fallback is a public tunnel hostname behind this same Worker.
