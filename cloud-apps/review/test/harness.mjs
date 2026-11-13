// Local Workers runtime (Miniflare/workerd) with D1, R2 and static assets for the review portal.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Response as MFResponse } from "miniflare";

export const SECRETS = {
  REVIEW_SHARE_KEY: "share-key-0123456789abcdef0123456789",
  REVIEW_PASSCODE: "test-passcode-42",
  REVIEW_SESSION_SECRET: "session-secret-0123456789abcdef0123",
  REVIEW_API_TOKEN: "agent-token-0123456789abcdef01234567",
};

const root = new URL("../", import.meta.url);
const TYPES = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", woff2: "font/woff2" };

export function migrationStatements() {
  const dir = new URL("migrations/", root);
  const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n")
    .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  return sql.split(/;\s*\n/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean);
}

// A dashboard where QC passed every published version, for the tests of everything but the QC gate.
export const allPassed = (runtime) => async (request) => {
  const reply = (body) => new MFResponse(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  if (new URL(request.url).pathname.endsWith("/qc-pass")) { // the Factory's own QC pass: recorded as sent
    const b = await request.json();
    return reply({ ok: true, pass: { slug: b.slug, by: b.by, note: b.note, video_key: b.video_key, at: b.at } });
  }
  if (!new URL(request.url).pathname.endsWith("/qc")) return reply({ ok: true, result: "no_card" });
  const { results } = await runtime().db.prepare("SELECT slug FROM videos").all();
  return reply({ ok: true, passes: Object.fromEntries(results.map((r) => [r.slug, "9999-12-31T00:00:00.000Z"])) });
};

// `dashboard`: the DASHBOARD service binding, a function (Request) => Response, or none (the binding is left out).
export async function startRuntime({ listen = false, https = true, bindings = SECRETS, dashboard } = {}) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("worker.js", root)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-08-01",
    ...(listen ? { host: "127.0.0.1", port: 0, https } : {}),
    bindings,
    d1Databases: ["DB"],
    r2Buckets: ["MEDIA"],
    serviceBindings: {
      ASSETS: async (request) => {
        const name = new URL(request.url).pathname.slice(1);
        if (!/^(app\.(js|css)|geist\.woff2)$/.test(name)) return new MFResponse("missing", { status: 404 });
        return new MFResponse(readFileSync(new URL(`public/${name}`, root)), { headers: { "Content-Type": TYPES[name.split(".").pop()] } });
      },
      ...(dashboard ? { DASHBOARD: dashboard } : {}),
    },
  });
  const url = await mf.ready;
  const db = await mf.getD1Database("DB");
  await db.batch(migrationStatements().map((statement) => db.prepare(statement)));
  return { mf, url: url.origin, db, bucket: await mf.getR2Bucket("MEDIA") };
}
