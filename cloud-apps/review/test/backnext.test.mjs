// Back / Next on single pages in a review group (Jon, 2026-11-16): links follow the group's stored order, Back is left
// out on the first, Next on the last, and a slug in no group gets no nav. Dummy slugs only.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Response as MFResponse } from "miniflare";
import { SECRETS, startRuntime } from "./harness.mjs";

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}`, "Content-Type": "application/json" };
const SLUGS = ["bn-lesson-c-v1", "bn-lesson-a-v1", "bn-lesson-b-v1"]; // group order is not alphabetical
const LONE = "bn-lone-v1";
let down = false; // the dashboard QC read fails
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
  runtime = await startRuntime({ dashboard: async () => down ? new MFResponse("down", { status: 503 }) : new MFResponse(JSON.stringify({ ok: true,
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
  // Group = [x, held, missing, y, z]; only "held" is QC-only, "missing" is not published.
  const hold = await fetchApp(`/api/review/groups/gate-bn`, { method: "PUT", headers: agent,
    body: JSON.stringify({ slugs: [SLUGS[0], "bn-held-v1", "bn-missing-v1", SLUGS[1], SLUGS[2]] }) });
  assert.equal(hold.status, 200, await hold.text());
  passes.delete("bn-held-v1");
  try {
    let text = await page(SLUGS[0]); // newest group is gate-bn
    assert.equal(href(text, "nav-next"), `/review/${SLUGS[1]}`); // skips the QC-only and unpublished ones
    text = await page(SLUGS[1]);
    assert.equal(href(text, "nav-prev"), `/review/${SLUGS[0]}`);
    assert.equal(href(text, "nav-next"), `/review/${SLUGS[2]}`);
    text = await page("bn-held-v1"); // QC-only: published neighbours, QC-only or not
    assert.match(text, /QC only/);
    assert.equal(href(text, "nav-prev"), `/review/${SLUGS[0]}`);
    assert.equal(href(text, "nav-next"), `/review/${SLUGS[1]}`); // skips the unpublished one (it would 404)
    assert.match(text, /2 of 5/);
  } finally {
    await fetchApp(`/api/review/groups/gate-bn`, { method: "PUT", headers: agent, body: JSON.stringify({ slugs: [] }) });
  }
});

test("a slug in no group has no Back / Next", async () => {
  const text = await page(LONE);
  assert.doesNotMatch(text, /group-nav|nav-prev|nav-next/);
});

test("dashboard QC read down: position and greyed Back / Next, nothing linked", async () => {
  down = true;
  try {
    const text = await page(SLUGS[1]);
    assert.match(text, /class="nav-pos">Lesson 2 of 3</);
    assert.equal(href(text, "nav-prev"), null);
    assert.equal(href(text, "nav-next"), null);
    assert.match(text, /id="nav-prev-wait"/);
    assert.match(text, /id="nav-next-wait"/);
  } finally { down = false; }
});

test("a malformed group row does not break pages", async () => {
  await runtime.db.prepare("INSERT INTO review_groups (name, title, slugs, created_at, updated_at) VALUES ('bad-bn', NULL, 'not json', '9999', '9999')").run();
  try {
    const text = await page(SLUGS[0]); // page() asserts 200
    assert.match(text, /class="nav-pos">Lesson 1 of 3</); // nav from the valid group, none from the bad row
  } finally { await runtime.db.prepare("DELETE FROM review_groups WHERE name = 'bad-bn'").run(); }
});

test("reel groups say Reel N of M", async () => {
  const put = await fetchApp("/api/review/groups/ig-reels-bn", { method: "PUT", headers: agent, body: JSON.stringify({ slugs: [LONE, SLUGS[0]] }) });
  assert.equal(put.status, 200, await put.text());
  const text = await page(LONE);
  assert.match(text, /class="nav-pos">Reel 1 of 2</);
  assert.equal(href(text, "nav-next"), `/review/${SLUGS[0]}`);
});

// Both routes Jon opens: the passcode page (/review/<slug>, signed in with his cookie) and the dashboard page
// (/dashboard/review/<slug>: the dashboard Worker forwards with the agent token and X-Review-Via: dashboard).
const ROUTES = {
  passcode: { prefix: "", headers: () => ({ Cookie: cookie }) },
  dashboard: { prefix: "/dashboard", headers: () => ({ Authorization: agent.Authorization, "X-Review-Via": "dashboard" }) },
};
const pageOn = async (route, slug) => {
  const res = await fetchApp(`/review/${slug}`, { headers: ROUTES[route].headers() });
  assert.equal(res.status, 200, `${route} ${slug}`);
  return res.text();
};
const publish = async (slug) => {
  const key = `review/${slug}/video-test.mp4`;
  await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
  const [, video, version] = /^(.*)-(v\d+)$/.exec(slug);
  const res = await fetchApp(`/api/review/${slug}/publish`, { method: "POST", headers: agent,
    body: JSON.stringify({ channel: "test", video, version, title: `Title ${slug}`, video_key: key }) });
  assert.ok([200, 201].includes(res.status), await res.text()); // 200: published before by the other route
};
const putGroup = async (name, slugs, title) => {
  const res = await fetchApp(`/api/review/groups/${name}`, { method: "PUT", headers: agent, body: JSON.stringify({ title, slugs }) });
  assert.equal(res.status, 200, await res.text());
};

for (const route of Object.keys(ROUTES)) {
  const { prefix } = ROUTES[route];
  test(`${route} route: walk 1 -> 2 -> 3 and back; first has no Back, last has no Next`, async () => {
    const order = ["wk-a-v1", "wk-b-v1", "wk-c-v1"];
    for (const s of order) { passes.add(s); await publish(s); }
    await putGroup(`walk-${route}`, order, "Course walk");
    try {
      let text = await pageOn(route, order[0]);
      assert.equal(href(text, "nav-prev"), null);
      assert.doesNotMatch(text, /nav-prev-wait/);
      const seen = [order[0]];
      for (let i = 1; i < 3; i++) { // Next, Next
        const next = href(text, "nav-next");
        assert.equal(next, `${prefix}/review/${order[i]}`);
        text = await pageOn(route, next.split("/review/")[1]);
        seen.push(order[i]);
        assert.match(text, new RegExp(`class="nav-pos">Lesson ${i + 1} of 3<`));
      }
      assert.equal(href(text, "nav-next"), null); // last
      assert.doesNotMatch(text, /nav-next-wait/);
      for (let i = 1; i >= 0; i--) { // Back, Back
        const back = href(text, "nav-prev");
        assert.equal(back, `${prefix}/review/${order[i]}`);
        text = await pageOn(route, back.split("/review/")[1]);
      }
      assert.equal(href(text, "nav-prev"), null); // first again
      assert.deepEqual(seen, order);
      assert.match(text, /class="group-nav"/);
    } finally { await putGroup(`walk-${route}`, []); }
  });

  test(`${route} route: a neighbour not through QC shows a greyed button, never a link`, async () => {
    const order = ["gw-a-v1", "gw-b-v1", "gw-c-v1"];
    for (const s of order) await publish(s);
    passes.add("gw-a-v1"); // only the first is QC-passed, like the live course
    await putGroup(`grey-${route}`, order, "Course grey");
    try {
      const text = await pageOn(route, order[0]);
      assert.match(text, /class="nav-pos">Lesson 1 of 3</);
      assert.equal(href(text, "nav-next"), null);
      assert.match(text, /id="nav-next-wait"[^>]*aria-disabled="true"/);
      assert.doesNotMatch(text, /gw-b-v1|gw-c-v1/); // not even linked
      assert.doesNotMatch(text, /nav-prev/);
    } finally { await putGroup(`grey-${route}`, []); }
  });

  test(`${route} route: the group follows the newest version, with no edit to the group`, async () => {
    const fw = `fw${route}`;
    const order = [`${fw}-a-v1`, `${fw}-b-v1`, `${fw}-c-v1`];
    for (const s of order) { passes.add(s); await publish(s); }
    await putGroup(`follow-${route}`, order, "Course follow");
    try {
      // v2 of the middle video exists but QC has not passed it: Jon is still sent to v1, and v2's page has the nav too.
      await publish(`${fw}-b-v2`);
      let text = await pageOn(route, `${fw}-a-v1`);
      assert.equal(href(text, "nav-next"), `${prefix}/review/${fw}-b-v1`);
      text = await pageOn(route, `${fw}-b-v2`);
      assert.equal(href(text, "nav-prev"), `${prefix}/review/${fw}-a-v1`);
      assert.equal(href(text, "nav-next"), `${prefix}/review/${fw}-c-v1`);
      assert.match(text, /Lesson 2 of 3/);
      // QC passes v2: the group follows it from the neighbours, and from the old v1 page.
      passes.add(`${fw}-b-v2`);
      assert.equal(href(await pageOn(route, `${fw}-a-v1`), "nav-next"), `${prefix}/review/${fw}-b-v2`);
      assert.equal(href(await pageOn(route, `${fw}-c-v1`), "nav-prev"), `${prefix}/review/${fw}-b-v2`);
      assert.match(await pageOn(route, `${fw}-b-v1`), /id="nav-next"/); // the old version's page is still in the group
      // v3 of the first video (the list names v1): newest wins, the group still says v1.
      await publish(`${fw}-a-v3`);
      passes.add(`${fw}-a-v3`);
      assert.equal(href(await pageOn(route, `${fw}-b-v2`), "nav-prev"), `${prefix}/review/${fw}-a-v3`);
      assert.equal(href(await pageOn(route, `${fw}-a-v3`), "nav-next"), `${prefix}/review/${fw}-b-v2`);
      const stored = await (await fetchApp("/api/review/groups/follow-" + route, { headers: agent })).json();
      assert.deepEqual(stored.group.slugs, order); // never edited
    } finally { await putGroup(`follow-${route}`, []); }
  });
}

test("publishing --group append puts a newer version in the old version's place", async () => {
  await putGroup("append-bn", ["ap-a-v1", "ap-b-v2", "ap-c-v1"]);
  try {
    const res = await fetchApp("/api/review/groups/append-bn/append", { method: "POST", headers: agent, body: JSON.stringify({ slugs: ["ap-b-v3", "ap-d-v1"] }) });
    assert.deepEqual((await res.json()).group.slugs, ["ap-a-v1", "ap-b-v3", "ap-c-v1", "ap-d-v1"]);
  } finally { await putGroup("append-bn", []); }
});

test("group page shows the newest version of each video", async () => {
  const order = ["gp-a-v1", "gp-b-v1"];
  for (const s of [...order, "gp-b-v2"]) { passes.add(s); await publish(s); }
  await putGroup("pageview-bn", order);
  try {
    const res = await fetchApp("/review/g/pageview-bn", { headers: { Cookie: cookie } });
    const body = await res.text();
    assert.deepEqual([...body.matchAll(/<section class="group-item" data-slug="([^"]+)"/g)].map((m) => m[1]), ["gp-a-v1", "gp-b-v2"]);
  } finally { await putGroup("pageview-bn", []); }
});
