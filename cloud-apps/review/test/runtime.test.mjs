// End-to-end Worker checks in workerd: access gate, publish (real script), Range media, comments API.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SECRETS, startRuntime } from "./harness.mjs";

const clipPath = fileURLToPath(new URL("./fixtures/clip.mp4", import.meta.url));
const clip = readFileSync(clipPath);
const script = fileURLToPath(new URL("../scripts/review_publish.mjs", import.meta.url));
const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}` };
let runtime, cookie;

const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });
const jsonInit = (method, body, headers = agent) => ({ method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });

function publish(args) {
  const result = spawnSync(process.execPath, [script, "--base", runtime.url, ...args], {
    encoding: "utf8",
    env: { ...process.env, REVIEW_API_TOKEN: SECRETS.REVIEW_API_TOKEN, NODE_TLS_REJECT_UNAUTHORIZED: "0", NODE_NO_WARNINGS: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

before(async () => { runtime = await startRuntime({ listen: true }); });
after(async () => { await runtime?.mf.dispose(); });

test("without the share key the portal looks absent", async () => {
  for (const path of ["/review", "/review/", "/review/anything", "/review/media/x/video.mp4"]) {
    const response = await fetchApp(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    await response.arrayBuffer();
  }
  const api = await fetchApp("/api/review/videos");
  assert.equal(api.status, 401);
  await api.arrayBuffer();
});

test("share key shows the passcode gate; wrong passcode is refused; right one signs in", async () => {
  const gate = await fetchApp(`/review?k=${SECRETS.REVIEW_SHARE_KEY}`);
  assert.equal(gate.status, 200);
  assert.match(await gate.text(), /name="passcode"/);
  const linkCookie = gate.headers.get("set-cookie").split(";")[0];

  const wrong = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: "nope", next: "/review", k: "" }), headers: { Cookie: linkCookie } });
  assert.equal(wrong.status, 401);
  await wrong.arrayBuffer();

  const noLink = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review" }) });
  assert.equal(noLink.status, 404, "passcode alone is not enough");
  await noLink.arrayBuffer();

  const ok = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "https://evil.example/", k: SECRETS.REVIEW_SHARE_KEY }) });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/review", "open redirect blocked");
  const setCookie = ok.headers.getSetCookie();
  assert.ok(setCookie.every((c) => /HttpOnly; Secure; SameSite=Lax/.test(c)));
  cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  await ok.arrayBuffer();

  const index = await fetchApp("/review", { headers: { Cookie: cookie } });
  assert.equal(index.status, 200);
  const body = await index.text();
  for (const name of ["Aria", "Max", "Mina", "Sienna", "Theo", "Viktor", "Zane"]) assert.match(body, new RegExp(`<h2>${name}</h2>`));
  assert.match(index.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(index.headers.get("cache-control"), "no-store, no-transform", "no edge script injection");
});

test("publish script uploads MP4 + source + compare; republish replaces media and keeps comments", async () => {
  const first = publish(["--slug", "mina-1-v9", "--channel", "mina", "--video", "mina-1", "--version", "v9",
    "--title", "Mina tutorial", "--file", clipPath, "--source", clipPath, "--compare", clipPath, "--notes", "First cut"]);
  assert.equal(first.ok, true);
  assert.equal(first.page_url, `${runtime.url}/review/mina-1-v9`);
  assert.equal(first.size, clip.length);

  const created = await fetchApp("/api/review/mina-1-v9/comments", jsonInit("POST", { author: "Agent", t: 1.5, text: "keep me" }));
  assert.equal(created.status, 201);
  await created.arrayBuffer();

  const again = publish(["--slug", "mina-1-v9", "--channel", "mina", "--video", "mina-1", "--version", "v9",
    "--title", "Mina tutorial", "--file", clipPath]);
  assert.notEqual(again.video_url, first.video_url, "new media tag busts caches");
  const objects = await runtime.bucket.list({ prefix: "review/mina-1-v9/" });
  assert.equal(objects.objects.length, 1, "old video, source and compare objects deleted");
  const comments = await (await fetchApp("/api/review/mina-1-v9/comments", { headers: agent })).json();
  assert.equal(comments.comments.length, 1);
  assert.equal(comments.video.source_url, null);
  assert.equal(comments.video.compare_url, null);
  await fetchApp("/api/review/mina-1-v9/comments/" + comments.comments[0].id, { method: "DELETE", headers: agent }).then((r) => r.arrayBuffer());

  publish(["--slug", "mina-1-v8", "--channel", "mina", "--video", "mina-1", "--version", "v8", "--title", "Mina tutorial", "--file", clipPath, "--source", clipPath, "--compare", clipPath]);
});

test("media streams with video/mp4, HEAD, byte ranges, 416 and ETag revalidation", async () => {
  const { video } = await (await fetchApp("/api/review/mina-1-v9", { headers: agent })).json();
  const path = new URL(video.video_url).pathname + new URL(video.video_url).search;

  const anonymous = await fetchApp(path);
  assert.equal(anonymous.status, 404);
  await anonymous.arrayBuffer();

  const head = await fetchApp(path, { method: "HEAD", headers: { Cookie: cookie } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "video/mp4");
  assert.equal(head.headers.get("accept-ranges"), "bytes");
  assert.equal(head.headers.get("content-length"), String(clip.length));

  const probe = await fetchApp(path, { headers: { Cookie: cookie, Range: "bytes=0-1" } });
  assert.equal(probe.status, 206);
  assert.equal(probe.headers.get("content-range"), `bytes 0-1/${clip.length}`);
  assert.deepEqual(Buffer.from(await probe.arrayBuffer()), clip.subarray(0, 2));

  const tail = await fetchApp(path, { headers: { Cookie: cookie, Range: "bytes=-100" } });
  assert.equal(tail.status, 206);
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), clip.subarray(clip.length - 100));

  const full = await fetchApp(path, { headers: agent });
  assert.equal(full.status, 200);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), clip);

  const bad = await fetchApp(path, { headers: { Cookie: cookie, Range: `bytes=${clip.length}-` } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("content-range"), `bytes */${clip.length}`);
  await bad.arrayBuffer();

  const etag = head.headers.get("etag");
  const cached = await fetchApp(path, { headers: { Cookie: cookie, "If-None-Match": etag } });
  assert.equal(cached.status, 304);
  await cached.arrayBuffer();
  const staleIfRange = await fetchApp(path, { headers: { Cookie: cookie, Range: "bytes=0-1", "If-Range": '"old"' } });
  assert.equal(staleIfRange.status, 200, "stale If-Range sends the whole file");
  await staleIfRange.arrayBuffer();
});

test("video page renders our player without autoplay, muted collapsed source/compare and version links", async () => {
  const page = await fetchApp("/review/mina-1-v8", { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  const body = await page.text();
  const player = /<video id="player"[^>]*>/.exec(body)[0];
  assert.match(player, /playsinline/);
  assert.doesNotMatch(player, /autoplay/);
  for (const id of ["source", "compare"]) {
    assert.match(body, new RegExp(`<details class="extra" id="${id}">`));
    const tag = new RegExp(`<video id="${id}-player"[^>]*>`).exec(body)[0];
    assert.match(tag, /muted[^>]*preload="none"/);
    assert.doesNotMatch(tag, /autoplay/);
  }
  const compare = await fetchApp(new URL(/id="compare-player"[^>]*src="([^"]+)"/.exec(body)[1], runtime.url).pathname, { headers: { Cookie: cookie, Range: "bytes=0-1" } });
  assert.equal(compare.status, 206);
  assert.equal(compare.headers.get("content-type"), "video/mp4");
  await compare.arrayBuffer();
  assert.match(body, /href="\/review\/mina-1-v9">v9</);

  const missing = await fetchApp("/review/nope", { headers: { Cookie: cookie } });
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
  const signedInWithKey = await fetchApp(`/review/mina-1-v8?k=${SECRETS.REVIEW_SHARE_KEY}`, { headers: { Cookie: cookie } });
  assert.equal(signedInWithKey.status, 303);
  assert.equal(signedInWithKey.headers.get("location"), "/review/mina-1-v8");
  await signedInWithKey.arrayBuffer();
});

test("comments: create, time order, open filter, resolve and reopen, via cookie and bearer", async () => {
  const reviewer = { Cookie: cookie, Origin: runtime.url };
  for (const [t, text] of [[5.25, "later note"], [1, "early note"]]) {
    const response = await fetchApp("/api/review/mina-1-v8/comments", jsonInit("POST", { author: "Editor", t, text }, reviewer));
    assert.equal(response.status, 201);
    await response.arrayBuffer();
  }
  const listed = await (await fetchApp("/api/review/mina-1-v8/comments?status=open", { headers: agent })).json();
  assert.deepEqual(listed.comments.map((c) => c.text), ["early note", "later note"]);
  const first = listed.comments[0];
  assert.deepEqual(Object.keys(first).sort(), ["author", "created_at", "id", "resolved", "resolved_at", "resolved_by", "slug", "t", "text"]);

  const resolved = await (await fetchApp(`/api/review/mina-1-v8/comments/${first.id}/resolve`, jsonInit("POST", { by: "video-agent" }))).json();
  assert.equal(resolved.comment.resolved, true);
  assert.equal(resolved.comment.resolved_by, "video-agent");
  const open = await (await fetchApp("/api/review/mina-1-v8/comments?status=open", { headers: agent })).json();
  assert.deepEqual(open.comments.map((c) => c.text), ["later note"]);

  const reopened = await (await fetchApp(`/api/review/mina-1-v8/comments/${first.id}/resolve`, jsonInit("POST", { resolved: false }, reviewer))).json();
  assert.equal(reopened.comment.resolved, false);
  assert.equal(reopened.comment.resolved_at, null);

  const status = await fetchApp("/api/review/mina-1-v8/status", jsonInit("POST", { status: "changes_requested" }, reviewer));
  assert.equal((await status.json()).status, "changes_requested");
  const videos = await (await fetchApp("/api/review/videos", { headers: { Cookie: cookie } })).json();
  const v8 = videos.videos.find((v) => v.slug === "mina-1-v8");
  assert.equal(v8.status, "changes_requested");
  assert.equal(v8.open_comments, 2);
});

test("API rejects bad input, foreign origins, reviewer publishing and wrong tokens", async () => {
  const reviewer = { Cookie: cookie };
  const cases = [
    [fetchApp("/api/review/mina-1-v8/comments", jsonInit("POST", { author: "", t: 1, text: "x" })), 400],
    [fetchApp("/api/review/mina-1-v8/comments", jsonInit("POST", { author: "a", t: 100000, text: "x" })), 400],
    [fetchApp("/api/review/mina-1-v8/comments", jsonInit("POST", { author: "a", t: 1, text: " " })), 400],
    [fetchApp("/api/review/mina-1-v8/comments", { method: "POST", headers: agent, body: "author=a" }), 400],
    [fetchApp("/api/review/mina-1-v8/comments", jsonInit("POST", { author: "a", t: 1, text: "x" }, { ...reviewer, Origin: "https://evil.example" })), 403],
    [fetchApp("/api/review/mina-1-v8/uploads", jsonInit("POST", { kind: "video" }, reviewer)), 403],
    [fetchApp("/api/review/mina-1-v8/comments/x", { method: "DELETE", headers: reviewer }), 403],
    [fetchApp("/api/review/mina-1-v8/comments/missing/resolve", jsonInit("POST", {})), 404],
    [fetchApp("/api/review/mina-1-v8/status", jsonInit("POST", { status: "done" })), 400],
    [fetchApp("/api/review/nope/comments", { headers: agent }), 404],
    [fetchApp("/api/review/videos", { headers: { Authorization: "Bearer wrong-token-value" } }), 401],
    [fetchApp("/api/review/mina-1-v8/publish", jsonInit("POST", { channel: "mina", video: "mina-1", version: "v1", title: "t", video_key: "review/other/video-x.mp4" })), 400],
  ];
  for (const [index, [promise, status]] of cases.entries()) {
    const response = await promise;
    assert.equal(response.status, status, `case ${index}`);
    await response.arrayBuffer();
  }
});

test("missing secrets fail closed", async () => {
  const bare = await startRuntime({ bindings: { REVIEW_SHARE_KEY: SECRETS.REVIEW_SHARE_KEY } });
  try {
    const page = await bare.mf.dispatchFetch(`${bare.url}/review?k=${SECRETS.REVIEW_SHARE_KEY}`);
    assert.equal(page.status, 503);
    await page.arrayBuffer();
    const api = await bare.mf.dispatchFetch(`${bare.url}/api/review/videos`, { headers: agent });
    assert.equal(api.status, 503);
    await api.arrayBuffer();
  } finally {
    await bare.mf.dispose();
  }
});
