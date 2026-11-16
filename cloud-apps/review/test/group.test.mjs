// Review groups (/review/g/<name>, Jon 2026-11-16): one player per video in the group's order, behind the same sign-in,
// with the single page's QC gate per video. Dummy slugs only.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Response as MFResponse } from "miniflare";
import { SECRETS, startRuntime } from "./harness.mjs";

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}` };
const SLUGS = ["grp-lesson-c-v1", "grp-lesson-a-v1", "grp-lesson-b-v1"]; // group order is not alphabetical
const HIDDEN = "grp-lesson-a-v1"; // QC has not passed it
let runtime, cookie;

const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });
const jsonInit = (method, body, headers = agent) => ({ method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const call = async (path, init) => {
  const res = await fetchApp(path, init);
  return { status: res.status, body: await res.json() };
};
const page = async (path) => {
  const res = await fetchApp(path, { headers: { Cookie: cookie } });
  return { status: res.status, text: await res.text() };
};

before(async () => {
  const passes = Object.fromEntries(SLUGS.filter((s) => s !== HIDDEN).map((s) => [s, "9999-12-31T00:00:00.000Z"]));
  runtime = await startRuntime({ dashboard: async () => new MFResponse(JSON.stringify({ ok: true, passes }), { headers: { "Content-Type": "application/json" } }) });
  for (const slug of SLUGS) {
    const key = `review/${slug}/video-test.mp4`;
    await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
    const [, video, version] = /^(.*)-(v\d+)$/.exec(slug);
    const res = await call(`/api/review/${slug}/publish`, jsonInit("POST", { channel: "test", video, version, title: `Title ${slug}`, video_key: key }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  const login = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review/g/course" }) });
  assert.equal(login.headers.get("location"), "/review/g/course");
  cookie = login.headers.get("set-cookie").split(";")[0];
  await login.arrayBuffer();
});
after(async () => runtime?.mf.dispose());

test("unsigned GET /review/g/<name> goes to the sign-in page", async () => {
  const res = await fetchApp("/review/g/x");
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), `/review/login?${new URLSearchParams({ next: "/review/g/x" })}`);
  await res.arrayBuffer();
  const withDashboardCookie = await fetchApp("/review/g/x", { headers: { Cookie: "cc_session=x" } });
  assert.match(withDashboardCookie.headers.get("location"), /^\/review\/login\?/);
  await withDashboardCookie.arrayBuffer();
});

test("group API: writes need the agent token, append is idempotent and keeps order", async () => {
  assert.equal((await call("/api/review/groups/course", jsonInit("PUT", { slugs: SLUGS }, { Cookie: cookie }))).status, 403);
  assert.equal((await call("/api/review/groups/course", jsonInit("PUT", { slugs: ["Bad Slug"] }))).status, 400);
  let res = await call("/api/review/groups/course/append", jsonInit("POST", { title: "Course 1", slugs: SLUGS.slice(0, 2) }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  res = await call("/api/review/groups/course/append", jsonInit("POST", { slugs: [SLUGS[1], SLUGS[2]] }));
  assert.deepEqual(res.body.group.slugs, SLUGS);
  assert.equal(res.body.group.title, "Course 1");
  res = await call("/api/review/groups/course", { headers: { Cookie: cookie } });
  assert.deepEqual(res.body.group.slugs, SLUGS);
  res = await call("/api/review/groups/other", jsonInit("PUT", { slugs: [SLUGS[2], SLUGS[0]] }));
  assert.deepEqual(res.body.group.slugs, [SLUGS[2], SLUGS[0]]);
  assert.equal((await call("/api/review/groups/nope", { headers: agent })).status, 404);
});

test("3-slug group shows 3 players in group order, preload none, QC-hidden one has no Approve", async () => {
  const { status, text } = await page("/review/g/course");
  assert.equal(status, 200);
  const players = [...text.matchAll(/<video class="group-player"[^>]*src="\/review\/media\/([a-z0-9-]+)\/video\.mp4/g)].map((m) => m[1]);
  assert.deepEqual(players, SLUGS);
  assert.equal((text.match(/preload="none"/g) || []).length, 3);
  assert.match(text, /src="\/review\/_\/group\.js"/);
  const blocks = Object.fromEntries([...text.matchAll(/<section class="group-item" data-slug="([^"]+)"[\s\S]*?<\/section>/g)].map((m) => [m[1], m[0]]));
  assert.deepEqual(Object.keys(blocks), SLUGS);
  for (const slug of SLUGS) {
    assert.match(blocks[slug], /data-act="changes"/);
    if (slug === HIDDEN) {
      assert.doesNotMatch(blocks[slug], /data-act="approve"|>Approve</);
      assert.match(blocks[slug], /QC only/);
    } else {
      assert.match(blocks[slug], /data-act="approve"/);
    }
  }
  // The same gate as the single page, and the server refuses an approve of the hidden one either way.
  assert.doesNotMatch((await page(`/review/${HIDDEN}`)).text, /id="approve"/);
  assert.equal((await call(`/api/review/${HIDDEN}/submit`, jsonInit("POST", { kind: "approve" }, { Cookie: cookie }))).status, 409);
});

test("missing slug and unknown group", async () => {
  await call("/api/review/groups/gaps", jsonInit("PUT", { slugs: [SLUGS[0], "not-published-v1"] }));
  const { text } = await page("/review/g/gaps");
  assert.match(text, /data-missing="not-published-v1"[\s\S]*Not published yet/);
  assert.equal((await page("/review/g/unknown-group")).status, 404);
  assert.equal((await fetchApp("/review/_/group.js")).status, 200);
});
