// Local Workers runtime (Miniflare/workerd) with D1, R2 and static assets for the review portal.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Response as MFResponse } from "miniflare";

export const SECRETS = {
  REVIEW_SHARE_KEY: "share-key-0123456789abcdef0123456789",
  REVIEW_PASSCODE: "test-passcode-42",
  REVIEW_SESSION_SECRET: "session-secret-0123456789abcdef0123",
  REVIEW_API_TOKEN: "agent-token-0123456789abcdef01234567",
};

const root = new URL("../", import.meta.url);
const TYPES = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8" };

export function migrationStatements() {
  const sql = readFileSync(new URL("migrations/0001_review_portal.sql", root), "utf8")
    .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  return sql.split(/;\s*\n/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean);
}

export async function startRuntime({ listen = false, bindings = SECRETS } = {}) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("worker.js", root)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-09-07",
    ...(listen ? { host: "127.0.0.1", port: 0, https: true } : {}),
    bindings,
    d1Databases: ["DB"],
    r2Buckets: ["MEDIA"],
    serviceBindings: {
      ASSETS: async (request) => {
        const name = new URL(request.url).pathname.slice(1);
        if (!/^app\.(js|css)$/.test(name)) return new MFResponse("missing", { status: 404 });
        return new MFResponse(readFileSync(new URL(`public/${name}`, root)), { headers: { "Content-Type": TYPES[name.split(".").pop()] } });
      },
    },
  });
  const url = await mf.ready;
  const db = await mf.getD1Database("DB");
  await db.batch(migrationStatements().map((statement) => db.prepare(statement)));
  return { mf, url: url.origin, db, bucket: await mf.getR2Bucket("MEDIA") };
}
