// Long slugs (card t_bf7ad30cba464f25, 2026-11-19): every upload of a 51+ character slug got a 500, because D1 refuses a
// LIKE/GLOB pattern over 50 bytes and the worker matched versions with `slug LIKE '<stem>-v%'`. Miniflare's local D1 has
// the same limit, so these run the real SQL against it. Slugs up to the 80 characters the client and server allow work.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { SECRETS, allPassed, startRuntime } from "./harness.mjs";

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}` };
const MAX = 80;
const slugOf = (len, version = "v1") => { const s = `long-slug-${"x".repeat(len)}`.slice(0, len - version.length - 1); return `${s}-${version}`; };
const S51 = slugOf(51), S80 = slugOf(MAX), S80V2 = slugOf(MAX, "v2");
let runtime, cookie;

const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });
const jsonInit = (method, body, headers = agent) => ({ method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const call = async (path, init) => {
  const res = await fetchApp(path, init);
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
};
const publish = async (slug) => {
  const key = `review/${slug}/video-test.mp4`;
  await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
  const [, video, version] = /^(.*)-(v\d+)$/.exec(slug);
  const res = await call(`/api/review/${slug}/publish`, jsonInit("POST", { channel: "test", video, version, title: `Title ${slug}`, video_key: key }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
};

before(async () => {
  runtime = await startRuntime({ dashboard: allPassed(() => runtime) });
  const login = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  await login.arrayBuffer();
});
after(async () => runtime?.mf.dispose());

test("the test slugs are the lengths named", () => {
  assert.deepEqual([S51.length, S80.length, S80V2.length], [51, 80, 80]);
});

test("upload init works for a 51 and an 80 character slug (was a 500 from D1's 50-byte LIKE limit)", async () => {
  for (const slug of [S51, S80]) {
    const started = await call(`/api/review/${slug}/uploads`, jsonInit("POST", { kind: "video" }));
    assert.equal(started.status, 201, `${slug.length} chars: ${JSON.stringify(started.body)}`);
    assert.ok(started.body.key.startsWith(`review/${slug}/`));
    const aborted = await call(`/api/review/${slug}/uploads/${encodeURIComponent(started.body.uploadId)}?key=${encodeURIComponent(started.body.key)}`, { method: "DELETE", headers: agent });
    assert.equal(aborted.status, 200, JSON.stringify(aborted.body));
  }
});

test("Jon's approval still locks every version of a long-slug video", async () => {
  await publish(S80);
  await runtime.db.prepare(`INSERT INTO submissions (id, slug, kind, created_at, comment_ids, dedupe_key) VALUES ('s-long', ?, 'approve', ?, '[]', 'd-long')`)
    .bind(S80, new Date().toISOString()).run();
  const next = await call(`/api/review/${S80V2}/uploads`, jsonInit("POST", { kind: "video" }));
  assert.equal(next.status, 409, JSON.stringify(next.body));
  assert.match(next.body.error || JSON.stringify(next.body), new RegExp(S80));
});

test("a review group of long slugs: group page, single page and its Back / Next", async () => {
  await publish(S51);
  const put = await call("/api/review/groups/long-slugs", jsonInit("PUT", { slugs: [S51, S80] }));
  assert.equal(put.status < 300, true, JSON.stringify(put.body));
  const group = await call("/review/g/long-slugs", { headers: { Cookie: cookie } });
  assert.equal(group.status, 200);
  for (const slug of [S51, S80]) assert.ok(group.body.includes(slug), `group page shows ${slug}`);
  const single = await call(`/review/${S51}`, { headers: { Cookie: cookie } });
  assert.equal(single.status, 200);
  assert.match(single.body, new RegExp(`id="nav-next"[^>]*href="/review/${S80}"`));
});

// The client (review_publish.mjs slugOk) and the server (worker.js SLUG) must allow the same slugs, 80 characters at most.
const slugRegex = (file, pattern) => {
  const m = pattern.exec(readFileSync(file, "utf8"));
  assert.ok(m, `slug regex found in ${file}`);
  return new RegExp(m[1]);
};
test("client and server slug limits agree: 80 characters", () => {
  const server = slugRegex(new URL("../worker.js", import.meta.url), /const SLUG = \/(.+)\/;/);
  const clients = [new URL("../scripts/review_publish.mjs", import.meta.url), "D:\\AgentTeam\\tools\\review_publish.mjs"].filter((f) => existsSync(f));
  for (const file of clients) {
    const client = slugRegex(file, /const slugOk = \(s\) => \/(.+)\/\.test\(s\);/);
    assert.equal(client.source, server.source, `${file} slugOk matches worker.js SLUG`);
  }
  assert.ok(server.test("a".repeat(MAX)), "80 characters allowed");
  assert.ok(!server.test("a".repeat(MAX + 1)), "81 characters refused");
});
