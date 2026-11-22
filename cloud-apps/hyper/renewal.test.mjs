// Planted checks for the gate changes (t_288b66001bb749d2): node --test renewal.test.mjs
// WORKER=<abs path> runs the same checks against another build (the old live source) to prove they catch the fault.
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mod = await import(
  process.env.WORKER ? pathToFileURL(process.env.WORKER).href : "./worker.js"
);
const worker = mod.default;
const HOST = "https://hyper.jonmac.ai";
const SECRET = "test-secret";
const enc = new TextEncoder();
async function cookie(expS) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`hyper-gate.${expS}`));
  return `__Host-hyper=${expS}.${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
const now = () => Math.floor(Date.now() / 1000);
const env = (seen = []) => ({
  GATE_SECRET: SECRET,
  DASH: { fetch: async () => Response.json({ ok: true }) },
  STUDIO: {
    fetch: async (r) => {
      seen.push(r.url);
      return new Response("app", { headers: { "Content-Type": "text/plain" } });
    },
  },
});
const get = (path, headers = {}) => new Request(`${HOST}${path}`, { headers });
const ticket = () => `${now() + 30}.${"a".repeat(64)}`;

test("renewal: under half life left gets a new 12 h cookie; a fresh cookie gets none", async () => {
  const old = await worker.fetch(
    get("/api/projects", { Cookie: await cookie(now() + 3 * 3600) }),
    env(),
  );
  assert.equal(old.status, 200);
  const sc = old.headers.get("Set-Cookie") || "";
  const exp = Number((/__Host-hyper=(\d+)\./.exec(sc) || [])[1]);
  assert.ok(exp >= now() + 12 * 3600 - 5, `renewed cookie, got "${sc}"`);
  const fresh = await worker.fetch(
    get("/api/projects", { Cookie: await cookie(now() + 11 * 3600) }),
    env(),
  );
  assert.equal(fresh.headers.get("Set-Cookie"), null);
});

test("expired cookie, page navigation: 302 to the dashboard ticket flow, return path kept, no open redirect", async () => {
  const res = await worker.fetch(
    get("/projects/a?x=1", { Accept: "text/html", Cookie: await cookie(now() - 10) }),
    env(),
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "https://jonmac.ai/dash/#hyper");
  assert.match(res.headers.get("Set-Cookie") || "", /__Host-hyper-back=%2Fprojects%2Fa%3Fx%3D1/);
  const back = await worker.fetch(
    get(`/__enter?t=${ticket()}`, {
      Accept: "text/html",
      Cookie: "__Host-hyper-back=%2Fprojects%2Fa%3Fx%3D1",
    }),
    env(),
  );
  assert.equal(back.headers.get("Location"), `${HOST}/projects/a?x=1`);
  const evil = await worker.fetch(
    get(`/__enter?t=${ticket()}`, { Cookie: "__Host-hyper-back=%2F%2Fevil.com" }),
    env(),
  );
  assert.equal(evil.headers.get("Location"), `${HOST}/`);
  const framed = await worker.fetch(
    get("/", { Accept: "text/html", "Sec-Fetch-Dest": "iframe" }),
    env(),
  );
  assert.equal(framed.status, 401); // inside the dashboard frame: link page, never the dashboard nested in itself
});

test("expired cookie, API call: 401 JSON signin_expired with the sign-in url; the app is never reached", async () => {
  const seen = [];
  const res = await worker.fetch(
    get("/api/projects", { Accept: "application/json", Cookie: await cookie(now() - 10) }),
    env(seen),
  );
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), {
    code: "signin_expired",
    signin: "https://jonmac.ai/dash/#hyper",
  });
  assert.equal(seen.length, 0);
});

test("hashed assets: immutable, second load from the edge cache, renewal still added", async () => {
  const store = new Map();
  globalThis.caches = {
    default: {
      match: async (k) => store.get(k.url)?.clone(),
      put: async (k, r) => {
        store.set(k.url, r);
      },
    },
  };
  try {
    const seen = [];
    const c = await cookie(now() + 2 * 3600);
    const a = await worker.fetch(get("/assets/index-AbCd1234.js", { Cookie: c }), env(seen));
    assert.equal(a.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    const b = await worker.fetch(get("/assets/index-AbCd1234.js", { Cookie: c }), env(seen));
    assert.equal(b.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(seen.length, 1);
    assert.match(b.headers.get("Set-Cookie") || "", /__Host-hyper=\d+\./);
  } finally {
    delete globalThis.caches;
  }
});
