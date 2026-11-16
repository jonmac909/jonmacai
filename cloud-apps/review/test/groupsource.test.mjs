// Review group pages show the original beside ours, like the single pages (Jon, 2026-11-16: "missing side by side with
// original" on the reels page): a video with an original video gets a muted source player with its own shape, a text-only
// lesson gets its original text, and a slot shows its newest version with that version's original. Dummy slugs only.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SECRETS, allPassed, startRuntime } from "./harness.mjs";

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}`, "Content-Type": "application/json" };
let runtime, cookie;
const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });
const ROUTES = {
  passcode: () => ({ prefix: "", headers: { Cookie: cookie } }),
  dashboard: () => ({ prefix: "/dashboard", headers: { ...agent, "X-Review-Via": "dashboard" } }),
};

async function publish(slug, extra = {}) {
  const key = `review/${slug}/video-test.mp4`;
  await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
  const [, video, version] = /^(.*)-(v\d+)$/.exec(slug);
  const res = await fetchApp(`/api/review/${slug}/publish`, { method: "POST", headers: agent,
    body: JSON.stringify({ channel: "test", video, version, title: `Title ${slug}`, video_key: key, video_w: 1080, video_h: 1920, ...extra }) });
  const body = await res.text();
  assert.ok(res.status === 200 || res.status === 201, body);
}
const addSource = async (slug, size) => {
  const up = await (await fetchApp(`/api/review/${slug}/uploads`, { method: "POST", headers: agent, body: JSON.stringify({ kind: "source" }) })).json();
  await runtime.bucket.put(up.key, new Uint8Array([0, 0, 0, 24]));
  const res = await fetchApp(`/api/review/${slug}/source`, { method: "POST", headers: agent, body: JSON.stringify({ source_key: up.key }) });
  assert.equal(res.status, 200, await res.text());
  if (size) assert.equal((await fetchApp(`/api/review/${slug}/meta`, { method: "POST", headers: agent, body: JSON.stringify({ source_w: size[0], source_h: size[1] }) })).status, 200);
};
const putGroup = async (name, slugs) => {
  const res = await fetchApp(`/api/review/groups/${name}`, { method: "PUT", headers: agent, body: JSON.stringify({ slugs }) });
  assert.equal(res.status, 200, await res.text());
};
const groupHtml = async (route, name) => {
  const { prefix, headers } = ROUTES[route]();
  const res = await fetchApp(`/review/g/${name}`, { headers });
  assert.equal(res.status, 200, `${route} ${name}`);
  return { prefix, text: await res.text() };
};
const blocks = (text) => Object.fromEntries([...text.matchAll(/<section class="group-item" data-slug="([^"]+)"[\s\S]*?<\/section>/g)].map((m) => [m[1], m[0]]));
const count = (text, re) => (text.match(re) || []).length;

before(async () => {
  runtime = await startRuntime({ dashboard: allPassed(() => runtime) });
  const login = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  await login.arrayBuffer();
  // Reels: gs-reel-1 has v1 (no original) and a newer v2 with one; gs-reel-2 has a landscape original; gs-reel-3 only text; gs-reel-4 nothing.
  await publish("gs-reel-1-v1");
  await publish("gs-reel-1-v2", { sync: [[0, 5, 0, 8], [5, 10, 8, 20]] });
  await addSource("gs-reel-1-v2", [1080, 1920]);
  await publish("gs-reel-2-v1", { sync: [[0, 10, 0, 30]] });
  await addSource("gs-reel-2-v1", [1920, 1080]);
  await publish("gs-reel-3-v1", { source_text: "<p>The original lesson text</p>" });
  await publish("gs-reel-4-v1");
});
after(async () => runtime?.mf.dispose());

for (const route of Object.keys(ROUTES)) {
  test(`${route} route: group page shows the original beside ours for every video that has one`, async () => {
    await putGroup(`gs-${route}`, ["gs-reel-1-v1", "gs-reel-2-v1", "gs-reel-3-v1", "gs-reel-4-v1"]); // the list names v1; v2 is newer
    try {
      const { prefix, text } = await groupHtml(route, `gs-${route}`);
      const b = blocks(text);
      assert.deepEqual(Object.keys(b), ["gs-reel-1-v2", "gs-reel-2-v1", "gs-reel-3-v1", "gs-reel-4-v1"]); // newest version of the slot
      // reel 1: v2's original, muted, next to ours; reel 2: its own landscape original next to our portrait video
      assert.match(b["gs-reel-1-v2"], new RegExp(`class="group-source" controls playsinline webkit-playsinline muted preload="none" src="${prefix}/review/media/gs-reel-1-v2/source\.mp4`));
      assert.match(b["gs-reel-1-v2"], /<div class="frame" style="--ar:0\.5625" data-known="1"><video class="group-source"/);
      assert.match(b["gs-reel-2-v1"], /<div class="frame" style="--ar:1\.77778" data-known="1"><video class="group-source"/);
      assert.match(b["gs-reel-2-v1"], /<div class="frame" style="--ar:0\.5625" data-known="1"><video class="group-player"/);
      assert.match(b["gs-reel-1-v2"], /<figcaption>Source/);
      assert.match(b["gs-reel-1-v2"], /data-both="play"[\s\S]*data-both="pause"/);
      assert.match(b["gs-reel-1-v2"], /data-sync="\[\[0,5,0,8\],\[5,10,8,20\]\]"/);
      // text-only lesson: its original text is the left pane
      assert.match(b["gs-reel-3-v1"], /<article class="source-text"[^>]*>[\s\S]*The original lesson text/);
      assert.doesNotMatch(b["gs-reel-3-v1"], /group-source/);
      // no original attached: ours alone, no empty source pane
      assert.doesNotMatch(b["gs-reel-4-v1"], /group-source|source-text|class="duo/);
      // numbers: one source player per video with an original video, ours for every video
      assert.equal(count(text, /class="group-source"/g), 2);
      assert.equal(count(text, /class="group-player"/g), 4);
      for (const slug of ["gs-reel-1-v2", "gs-reel-2-v1"]) assert.equal(count(b[slug], /class="group-source"/g), count(b[slug], /class="group-player"/g));
      assert.ok(!/gs-reel-1-v1\//.test(text), "the older version of the slot is not shown");
    } finally { await putGroup(`gs-${route}`, []); }
  });
}

test("group.js plays the original with ours and pauses every other video", () => {
  const js = readFileSync(new URL("../public/group.js", import.meta.url), "utf8");
  assert.match(js, /\.group-player, \.group-source/);
  assert.match(js, /toSource/);
  assert.match(js, /data-both="play"/);
  assert.match(js, /block\.querySelector\("\.group-player"\)/, "Submit changes takes the time from ours, not the original");
});
