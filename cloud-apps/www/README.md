# www.jonmac.ai

Hosting: Cloudflare only. Never Vercel or Netlify.

The www hostname serves the same ElevateOS app as the apex. This Worker returns
HTTP 308 to `https://jonmac.ai`, preserving paths, queries and request methods.
It needs no application secrets or upstream connections. `Cache-Control: no-store`
keeps the migration reversible. Cloudflare version metadata supplies the release
commit and version in `X-Site-Commit` and `X-Site-Version`.

Run the Docker gate with this directory copied into a clean directory in the
existing `jonmacai-jon6-checks` image; link its installed `node_modules` and run
`node --test worker.test.mjs runtime.test.mjs`. The runtime check uses Miniflare
and workerd. Do not use GitHub Actions.

Deploy and verify the separate `preview` environment first:

```powershell
wrangler deploy --config cloud-apps/www/wrangler.jsonc --env preview --tag <tested-commit>
```

After the green Docker gate and PR merge, deploy the exact merged tree:

```powershell
wrangler deploy --config cloud-apps/www/wrangler.jsonc --tag <merged-commit>
```

The production custom domain replaces the old www Vercel DNS record through
Wrangler. Verify TLS, the 308 destination and release headers on www, then follow
the redirect in a browser. Leave the old host running until these checks pass;
Ana handles its removal. Deployment of this Worker does not redeploy the apex
or any of the other Cloudflare apps.
