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

export async function startRuntime({ listen = false, https = true, bindings = SECRETS } = {}) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("worker.js", root)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-08-01",
    ...(listen ? { host: "127.0.0.1", port: 0, https } : {}),
    bindings,
    d1Databases: ["DB", "CC_DB"],
    r2Buckets: ["MEDIA"],
    serviceBindings: {
      ASSETS: async (request) => {
        const name = new URL(request.url).pathname.slice(1);
        if (!/^(app\.(js|css)|geist\.woff2)$/.test(name)) return new MFResponse("missing", { status: 404 });
        return new MFResponse(readFileSync(new URL(`public/${name}`, root)), { headers: { "Content-Type": TYPES[name.split(".").pop()] } });
      },
    },
  });
  const url = await mf.ready;
  const db = await mf.getD1Database("DB");
  await db.batch(migrationStatements().map((statement) => db.prepare(statement)));
  // The dashboard's proof tables, as much of them as the QC gate reads (command-center migrations).
  const cc = await mf.getD1Database("CC_DB");
  await cc.batch(["CREATE TABLE bot_tasks (id TEXT PRIMARY KEY, project TEXT, status TEXT NOT NULL DEFAULT 'doing')",
    "CREATE TABLE bot_proofs (id TEXT PRIMARY KEY, task_id TEXT, link TEXT, status TEXT, checked_at TEXT)"].map((s) => cc.prepare(s)));
  return { mf, url: url.origin, db, cc, bucket: await mf.getR2Bucket("MEDIA") };
}

// QC checks a proof on a dashboard card, now: `link` is the review page or media URL, or a bare slug for the page.
// Returns the proof id, so a test can re-check it later.
let checks = 0;
export async function qcCheck(cc, link, status = "passed", project = "youtube", taskStatus = "doing") {
  const n = ++checks;
  const url = link.startsWith("https://") ? link : `https://jonmac.ai/review/${link}`;
  await cc.batch([
    cc.prepare("INSERT INTO bot_tasks (id, project, status) VALUES (?, ?, ?)").bind(`t_${n}`, project, taskStatus),
    cc.prepare("INSERT INTO bot_proofs (id, task_id, link, status, checked_at) VALUES (?, ?, ?, ?, ?)")
      .bind(`p_${n}`, `t_${n}`, url, status, new Date(Date.now() + n).toISOString()),
  ]);
  return `p_${n}`;
}
