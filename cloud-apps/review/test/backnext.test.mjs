// Back / Next on single pages in a review group (Jon, 2026-11-16): links follow the group's stored order, Back is left
// out on the first, Next on the last, and a slug in no group gets no nav. Dummy slugs only.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Response as MFResponse } from "miniflare";
import { SECRETS, startRuntime } from "./harness.mjs";

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}`, "Content-Type": "application/json" };
const SLUGS = ["bn-lesson-c-v1", "bn-lesson-a-v1", "bn-lesson-b-v1"]; // group order is not alphabetical
const LONE = "bn-lone-v1";
const passes = new Set([...SLUGS, LONE, "bn-held-v1"]); // QC-passed slugs; a test drops one
let runtime, cookie;

const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });
const page = async (slug) => {
  const res = await fetchApp(`/review/${slug}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return res.text();
};
const href = (text, id) => new RegExp(`id="${id}"[^>]*href="([^"]+)"`).exec(text)?.[1] ?? null;

before(async () => {
  runtime = await startRuntime({ dashboard: async () => new MFResponse(JSON.stringify({ ok: true,
    passes: Object.fromEntries([...passes].map((s) => [s, "9999-12-31T00:00:00.000Z"])) }), { headers: { "Content-Type": "application/json" } }) });
  for (const slug of [...SLUGS, LONE, "bn-held-v1"]) {
    const key = `review/${slug}/video-test.mp4`;
    await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
    const [, video, version] = /^(.*)-(v\d+)$/.exec(slug);
    const res = await fetchApp(`/api/review/${slug}/publish`, { method: "POST", headers: agent,
      body: JSON.stringify({ channel: "test", video, version, title: `Title ${slug}`, video_key: key }) });
    assert.equal(res.status, 201, await res.text());
  }
  const put = await fetchApp("/api/review/groups/course-bn", { method: "PUT", headers: agent, body: JSON.stringify({ title: "Course", slugs: SLUGS }) });
  assert.equal(put.status, 200, await put.text());
  const login = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  await login.arrayBuffer();
});
after(async () => runtime?.mf.dispose());

test("first page: Next to the second, no Back", async () => {
  const text = await page(SLUGS[0]);
  assert.equal(href(text, "nav-next"), `/review/${SLUGS[1]}`);
  assert.equal(href(text, "nav-prev"), null);
  assert.match(text, /class="nav-pos">Lesson 1 of 3</);
});

test("middle page: Back to the first, Next to the third", async () => {
  const text = await page(SLUGS[1]);
  assert.equal(href(text, "nav-prev"), `/review/${SLUGS[0]}`);
  assert.equal(href(text, "nav-next"), `/review/${SLUGS[2]}`);
  assert.match(text, /Lesson 2 of 3/);
});

test("last page: Back to the second, no Next", async () => {
  const text = await page(SLUGS[2]);
  assert.equal(href(text, "nav-prev"), `/review/${SLUGS[1]}`);
  assert.equal(href(text, "nav-next"), null);
  assert.match(text, /Lesson 3 of 3/);
});

test("QC gate: a page Jon sees skips QC-only and unpublished neighbours; a QC-only page links the plain neighbours", async () => {
  // Group g = [x, held, y, missing, z]; only "held" is QC-only, "missing" is not published.
  const hold = await fetchApp(`/api/review/groups/gate-bn`, { method: "PUT", headers: agent,
    body: JSON.stringify({ slugs: [SLUGS[0], "bn-held-v1", SLUGS[1], "bn-missing-v1", SLUGS[2]] }) });
  assert.equal(hold.status, 200, await hold.text());
  passes.delete("bn-held-v1");
  try {
    let text = await page(SLUGS[0]); // newest group is gate-bn
    assert.equal(href(text, "nav-next"), `/review/${SLUGS[1]}`); // skips the QC-only one
    text = await page(SLUGS[1]);
    assert.equal(href(text, "nav-prev"), `/review/${SLUGS[0]}`);
    assert.equal(href(text, "nav-next"), `/review/${SLUGS[2]}`); // skips the unpublished one
    text = await page("bn-held-v1"); // QC-only: plain neighbours
    assert.match(text, /QC only/);
    assert.equal(href(text, "nav-prev"), `/review/${SLUGS[0]}`);
    assert.equal(href(text, "nav-next"), `/review/${SLUGS[1]}`);
    assert.match(text, /2 of 5/);
  } finally {
    await fetchApp(`/api/review/groups/gate-bn`, { method: "PUT", headers: agent, body: JSON.stringify({ slugs: [] }) });
  }
});

test("a slug in no group has no Back / Next", async () => {
  const text = await page(LONE);
  assert.doesNotMatch(text, /group-nav|nav-prev|nav-next/);
});
