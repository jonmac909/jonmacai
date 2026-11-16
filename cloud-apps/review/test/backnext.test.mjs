// Back / Next on single pages in a review group (Jon, 2026-11-16): links follow the group's stored order, Back is left
// out on the first, Next on the last, and a slug in no group gets no nav. Dummy slugs only.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { SECRETS, allPassed, startRuntime } from "./harness.mjs";

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}`, "Content-Type": "application/json" };
const SLUGS = ["bn-lesson-c-v1", "bn-lesson-a-v1", "bn-lesson-b-v1"]; // group order is not alphabetical
const LONE = "bn-lone-v1";
let runtime, cookie;

const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });
const page = async (slug) => {
  const res = await fetchApp(`/review/${slug}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return res.text();
};
const href = (text, id) => new RegExp(`id="${id}"[^>]*href="([^"]+)"`).exec(text)?.[1] ?? null;

before(async () => {
  runtime = await startRuntime({ dashboard: allPassed(() => runtime) });
  for (const slug of [...SLUGS, LONE]) {
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

test("a slug in no group has no Back / Next", async () => {
  const text = await page(LONE);
  assert.doesNotMatch(text, /group-nav|nav-prev|nav-next/);
});
