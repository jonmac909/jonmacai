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

test("signed out, any review link (no key, wrong key, unknown slug) goes to the passcode page, never 404", async () => {
  const cases = [
    ["/review", "/review/login?next=%2Freview"],
    ["/review/", "/review/login?next=%2Freview"],
    ["/review/theo-1-v4", "/review/login?next=%2Freview%2Ftheo-1-v4"],
    ["/review/theo-1-v4?k=wrong-key", "/review/login?next=%2Freview%2Ftheo-1-v4&k=wrong-key"],
    ["/review/Not_A_Slug", "/review/login?next=%2Freview"],
  ];
  for (const [path, location] of cases) {
    const response = await fetchApp(path);
    assert.equal(response.status, 303, path);
    assert.equal(response.headers.get("location"), location, path);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    await response.arrayBuffer();
  }
  const page = await fetchApp("/review/login?next=%2Freview%2Ftheo-1-v4&k=wrong-key");
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.match(body, /name="passcode"/);
  assert.match(body, /name="next" value="\/review\/theo-1-v4"/);
  const media = await fetchApp("/review/media/x/video.mp4");
  assert.equal(media.status, 401);
  await media.arrayBuffer();
  const api = await fetchApp("/api/review/videos");
  assert.equal(api.status, 401);
  await api.arrayBuffer();
});

test("wrong passcode is refused; the passcode alone signs in; a valid key is remembered 30 days", async () => {
  const wrong = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: "nope", next: "/review", k: "" }) });
  assert.equal(wrong.status, 401);
  assert.match(await wrong.text(), /That passcode is not right/);

  const bare = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review/theo-1-v4", k: "wrong-key" }) });
  assert.equal(bare.status, 303, "passcode without (or with a wrong) key signs in");
  assert.equal(bare.headers.get("location"), "/review/theo-1-v4");
  const bareCookies = bare.headers.getSetCookie();
  assert.equal(bareCookies.length, 1, "wrong key is not remembered");
  assert.match(bareCookies[0], /^review_session=.*Max-Age=2592000;/);
  await bare.arrayBuffer();
  const signedInLogin = await fetchApp("/review/login?next=%2Freview", { headers: { Cookie: bareCookies[0].split(";")[0] } });
  assert.equal(signedInLogin.status, 303, "already signed in skips the passcode page");
  await signedInLogin.arrayBuffer();

  const ok = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "https://evil.example/", k: SECRETS.REVIEW_SHARE_KEY }) });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/review", "open redirect blocked");
  const setCookie = ok.headers.getSetCookie();
  assert.ok(setCookie.every((c) => /Max-Age=2592000; HttpOnly; Secure; SameSite=Lax/.test(c)), setCookie.join(" | "));
  assert.ok(setCookie.some((c) => c.startsWith("review_link=")), "valid key remembered");
  cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  await ok.arrayBuffer();

  const index = await fetchApp("/review", { headers: { Cookie: cookie } });
  assert.equal(index.status, 200);
  const body = await index.text();
  for (const name of ["Aria", "Max", "Mina", "Sienna", "Theo", "Viktor", "Zane"]) assert.match(body, new RegExp(`<h2>${name}</h2>`));
  assert.match(index.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(index.headers.get("cache-control"), "no-store, no-transform", "no edge script injection");
});

test("publish script uploads MP4 + source + compare; republish replaces media, keeps comments and the original", async () => {
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
  assert.equal(objects.objects.length, 2, "old video and compare objects deleted, the original stays");
  const comments = await (await fetchApp("/api/review/mina-1-v9/comments", { headers: agent })).json();
  assert.equal(comments.comments.length, 1);
  assert.ok(comments.video.source_url, "a recut of the same video keeps its original");
  assert.equal(comments.video.compare_url, null);
  await fetchApp("/api/review/mina-1-v9/comments/" + comments.comments[0].id, { method: "DELETE", headers: agent }).then((r) => r.arrayBuffer());

  const corrected = publish(["--slug", "mina-1-v9", "--channel", "mina", "--video", "mina-1", "--version", "v9",
    "--title", "Mina tutorial", "--file", clipPath, "--source", clipPath]);
  assert.notEqual(corrected.source_url, comments.video.source_url, "naming a source replaces the old one");
  assert.equal((await runtime.bucket.list({ prefix: "review/mina-1-v9/" })).objects.length, 2, "the old original is gone");

  publish(["--slug", "mina-1-v8", "--channel", "mina", "--video", "mina-1", "--version", "v8", "--title", "Mina tutorial", "--file", clipPath,
    "--source", clipPath, "--compare", clipPath, "--chapters", fileURLToPath(new URL("./fixtures/versions.json", import.meta.url))]);
  const v8 = (await (await fetchApp("/api/review/mina-1-v8", { headers: agent })).json()).video;
  assert.deepEqual(v8.sync, [[0, 4, 0.5, 4.5], [4, 7.5, 1, 4.5]], "timemap stored as ours-to-source segments");
  assert.deepEqual(v8.chapters, [[0, "Intro"], [4, "Middle"]]);
});

test("adding a source: page goes side by side, status, comments and media kept, an existing source is never replaced", async () => {
  publish(["--slug", "mina-3-v1", "--channel", "mina", "--video", "mina-3", "--version", "v1", "--title", "No source yet", "--file", clipPath]);
  const addSource = async (slug) => {
    const started = await (await fetchApp(`/api/review/${slug}/uploads`, jsonInit("POST", { kind: "source" }))).json();
    const id = encodeURIComponent(started.uploadId), key = encodeURIComponent(started.key);
    const part = await (await fetchApp(`/api/review/${slug}/uploads/${id}/1?key=${key}`, {
      method: "PUT", headers: { ...agent, "Content-Length": String(clip.length) }, body: clip })).json();
    const done = await fetchApp(`/api/review/${slug}/uploads/${id}/complete`, jsonInit("POST", { key: started.key, parts: [part] }));
    assert.equal(done.status, 200);
    await done.arrayBuffer();
    return started.key;
  };
  const video = async () => (await (await fetchApp("/api/review/mina-3-v1", { headers: agent })).json()).video;
  await fetchApp("/api/review/mina-3-v1/status", jsonInit("POST", { status: "changes_requested" })).then((r) => r.arrayBuffer());
  await fetchApp("/api/review/mina-3-v1/comments", jsonInit("POST", { author: "Agent", t: 1, text: "keep me" })).then((r) => r.arrayBuffer());
  const dash = { ...agent, "X-Review-Via": "dashboard" };
  const page = async () => (await fetchApp("/review/mina-3-v1", { headers: dash })).text();
  const before = await video();
  assert.equal(before.source_url, null);
  assert.doesNotMatch(await page(), /id="source-player"/);

  const first = await addSource("mina-3-v1");
  const added = await fetchApp("/api/review/mina-3-v1/source", jsonInit("POST", { source_key: first }));
  assert.equal(added.status, 200);
  await added.arrayBuffer();
  const after = await video();
  assert.ok(after.source_url);
  assert.equal(after.video_url, before.video_url);
  assert.equal(after.status, "changes_requested");
  const comments = await (await fetchApp("/api/review/mina-3-v1/comments", { headers: agent })).json();
  assert.equal(comments.comments.length, 1);
  const stream = await fetchApp(new URL(after.source_url).pathname + new URL(after.source_url).search, { headers: { ...agent, Range: "bytes=0-9" } });
  assert.equal(stream.status, 206);
  await stream.arrayBuffer();
  const sideBySide = /<div class="duo" id="duo">[\s\S]*?<\/div>/.exec(await page())[0];
  assert.match(sideBySide, /<video id="source-player"[^>]*src="\/dashboard\/review\/media\/mina-3-v1\/source\.mp4\?v=/);
  assert.match(sideBySide, /<video id="player"/);

  const second = await addSource("mina-3-v1");
  const replaced = await fetchApp("/api/review/mina-3-v1/source", jsonInit("POST", { source_key: second }));
  assert.equal(replaced.status, 409);
  await replaced.arrayBuffer();
  assert.ok(await runtime.bucket.head(first), "the first source stays");
  assert.equal((await video()).source_url, after.source_url);
  assert.equal(await runtime.bucket.head(second), null, "the refused upload is removed");
  const again = await fetchApp("/api/review/mina-3-v1/source", jsonInit("POST", { source_key: first }));
  assert.equal(again.status, 409);
  await again.arrayBuffer();
  assert.ok(await runtime.bucket.head(first), "repeating the attached key keeps it");

  const elsewhere = await addSource("mina-1-v8");
  const bad = [
    [elsewhere, 400],
    [(await fetchApp("/api/review/mina-3-v1/uploads", jsonInit("POST", { kind: "video" })).then((r) => r.json())).key, 400],
    ["review/mina-3-v1/source-never-uploaded.mp4", 400],
  ];
  for (const [source_key, status] of bad) {
    const response = await fetchApp("/api/review/mina-3-v1/source", jsonInit("POST", { source_key }));
    assert.equal(response.status, status, source_key);
    await response.arrayBuffer();
  }
  assert.ok(await runtime.bucket.head(elsewhere), "another video's upload is untouched");
  await runtime.bucket.delete(elsewhere);
  const orphan = await addSource("mina-9-v1");
  const nobody = await fetchApp("/api/review/mina-9-v1/source", jsonInit("POST", { source_key: orphan }));
  assert.equal(nobody.status, 409, "no such video");
  await nobody.arrayBuffer();
  assert.equal(await runtime.bucket.head(orphan), null);
  const reviewer = await fetchApp("/api/review/mina-3-v1/source", jsonInit("POST", { source_key: first }, dash));
  assert.equal(reviewer.status, 403);
  await reviewer.arrayBuffer();
  await fetchApp("/api/review/mina-3-v1", { method: "DELETE", headers: agent }).then((r) => r.arrayBuffer());
});

test("media streams with video/mp4, HEAD, byte ranges, 416 and ETag revalidation", async () => {
  const { video } = await (await fetchApp("/api/review/mina-1-v9", { headers: agent })).json();
  const path = new URL(video.video_url).pathname + new URL(video.video_url).search;

  const anonymous = await fetchApp(path);
  assert.equal(anonymous.status, 401);
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

test("video page: source left and ours right with transport controls, muted collapsed first-60, no autoplay", async () => {
  const page = await fetchApp("/review/mina-1-v8", { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  const body = await page.text();
  const player = /<video id="player"[^>]*>/.exec(body)[0];
  assert.match(player, /playsinline/);
  assert.doesNotMatch(player, /autoplay/);
  const duo = /<div class="duo" id="duo">[\s\S]*?<\/div>/.exec(body)[0];
  assert.ok(duo.indexOf('id="source-player"') < duo.indexOf('id="player"'), "source left, ours right");
  const sourceTag = /<video id="source-player"[^>]*>/.exec(body)[0];
  assert.match(sourceTag, /muted[^>]*preload="metadata"/);
  assert.doesNotMatch(sourceTag, /autoplay/);
  for (const id of ["play-both", "pause-both", "source-only", "ours-only", "sync"]) assert.match(body, new RegExp(`id="${id}"`));
  assert.match(body, /name="audio" value="ours" checked/);
  assert.match(body, /\(cut map\)/);
  assert.match(body, /<details class="extra" id="compare">/);
  const compareTag = /<video id="compare-player"[^>]*>/.exec(body)[0];
  assert.match(compareTag, /muted[^>]*preload="none"/);
  assert.doesNotMatch(compareTag, /autoplay/);
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
  assert.deepEqual(Object.keys(first).sort(), ["audio_url", "author", "created_at", "drawing", "id", "resolved", "resolved_at", "resolved_by", "sent", "slug", "submission_id", "t", "text", "transcript"]);
  assert.deepEqual([first.audio_url, first.drawing, first.transcript], [null, null, null]);

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

test("Submit changes: blocked when empty, locks sent comments, double tap makes one submission", async () => {
  const reviewer = { Cookie: cookie, Origin: runtime.url };
  const page = await (await fetchApp("/review/mina-1-v9", { headers: { Cookie: cookie } })).text();
  assert.match(page, /id="send-changes"[^>]*>Submit changes</);
  assert.match(page, /id="approve"[^>]*>Approve</);

  const empty = await fetchApp("/api/review/mina-1-v9/submit", jsonInit("POST", { kind: "changes" }, reviewer));
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, "Add a comment first");

  for (const [t, text] of [[2.5, "cut the pause"], [0.5, "louder intro"]]) {
    const response = await fetchApp("/api/review/mina-1-v9/comments", jsonInit("POST", { author: "Jon", t, text }, reviewer));
    assert.equal(response.status, 201);
    await response.arrayBuffer();
  }
  // Double tap: two presses at once still make exactly one submission.
  const taps = await Promise.all([1, 2].map(() => fetchApp("/api/review/mina-1-v9/submit", jsonInit("POST", { kind: "changes" }, reviewer))));
  const bodies = await Promise.all(taps.map((r) => r.json()));
  assert.deepEqual(taps.map((r) => r.status).filter((s) => s === 201), [201], JSON.stringify(bodies));
  const made = bodies.find((b) => b.submission && !b.duplicate);
  assert.equal(made.status, "changes_requested");
  assert.equal(made.submission.comment_count, 2);
  for (const b of bodies) if (b.submission) assert.equal(b.submission.id, made.submission.id);
  const again = await fetchApp("/api/review/mina-1-v9/submit", jsonInit("POST", {}, reviewer));
  assert.equal(again.status, 400, "a later tap with nothing new is blocked");
  await again.arrayBuffer();
  const listed = await (await fetchApp("/api/review/mina-1-v9/submissions", { headers: { Cookie: cookie } })).json();
  assert.equal(listed.submissions.length, 1);

  const comments = (await (await fetchApp("/api/review/mina-1-v9/comments", { headers: agent })).json()).comments;
  assert.ok(comments.every((c) => c.sent && c.submission_id === made.submission.id));
  const locked = await fetchApp(`/api/review/mina-1-v9/comments/${comments[0].id}/resolve`, jsonInit("POST", {}, reviewer));
  assert.equal(locked.status, 409, "sent comments are locked for the reviewer");
  await locked.arrayBuffer();
  const video = (await (await fetchApp("/api/review/mina-1-v9", { headers: agent })).json()).video;
  assert.equal(video.status, "changes_requested");

  // A comment added after submitting goes in the next submission only.
  await fetchApp("/api/review/mina-1-v9/comments", jsonInit("POST", { author: "Jon", t: 3, text: "one more" }, reviewer)).then((r) => r.arrayBuffer());
  const second = await (await fetchApp("/api/review/mina-1-v9/submit", jsonInit("POST", { kind: "changes" }, reviewer))).json();
  assert.equal(second.submission.comment_count, 1);
  assert.notEqual(second.submission.id, made.submission.id);
});

test("router API: token only, undelivered list with comment text, delivered, next version link", async () => {
  for (const [headers, status] of [[{}, 401], [{ Cookie: cookie }, 403], [{ Authorization: "Bearer wrong-token-value" }, 401]]) {
    const response = await fetchApp("/api/review/submissions?undelivered=1", { headers });
    assert.equal(response.status, status, JSON.stringify(headers));
    await response.arrayBuffer();
  }
  const noTokenDelivered = await fetchApp("/api/review/submissions/x/delivered", jsonInit("POST", { to: "x" }, {}));
  assert.equal(noTokenDelivered.status, 401);
  await noTokenDelivered.arrayBuffer();

  const queue = (await (await fetchApp("/api/review/submissions?undelivered=1", { headers: agent })).json()).submissions;
  assert.equal(queue.length, 2);
  const [first] = queue;
  assert.equal(first.slug, "mina-1-v9");
  assert.equal(first.page_url, `${runtime.url}/review/mina-1-v9`);
  assert.deepEqual(first.comments.map((c) => [c.t, c.text]), [[0.5, "louder intro"], [2.5, "cut the pause"]], "time order");

  const delivered = await (await fetchApp(`/api/review/submissions/${first.id}/delivered`, jsonInit("POST", { to: "Davinci", at: "2026-10-15T21:52:00Z" }))).json();
  assert.equal(delivered.submission.delivered_to, "Davinci");
  assert.equal(delivered.submission.delivered_at, "2026-10-15T21:52:00.000Z");
  const left = (await (await fetchApp("/api/review/submissions?undelivered=1", { headers: agent })).json()).submissions;
  assert.deepEqual(left.map((s) => s.id), [queue[1].id]);
  const missing = await fetchApp("/api/review/submissions/nope/delivered", jsonInit("POST", { to: "x" }));
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();

  const reviewerNext = await fetchApp("/api/review/mina-1-v9/next", jsonInit("POST", { result_slug: "mina-1-v8" }, { Cookie: cookie }));
  assert.equal(reviewerNext.status, 403);
  await reviewerNext.arrayBuffer();
  const unpublished = await fetchApp("/api/review/mina-1-v9/next", jsonInit("POST", { result_slug: "mina-1-v10" }));
  assert.equal(unpublished.status, 400);
  await unpublished.arrayBuffer();
  const next = await (await fetchApp("/api/review/mina-1-v9/next", jsonInit("POST", { result_slug: "mina-1-v8", submission_id: first.id }))).json();
  assert.equal(next.submission.result_url, `${runtime.url}/review/mina-1-v8`);
  const page = await (await fetchApp("/review/mina-1-v9", { headers: { Cookie: cookie } })).text();
  const data = JSON.parse(/<script type="application\/json" id="review-data">([^<]+)<\/script>/.exec(page)[1]);
  assert.equal(data.submissions.find((s) => s.id === first.id).result_slug, "mina-1-v8");
});

test("Approve: works with no open comments, sets approved, a second tap is the same submission", async () => {
  const reviewer = { Cookie: cookie, Origin: runtime.url };
  const byBot = await fetchApp("/api/review/mina-1-v9/submit", jsonInit("POST", { kind: "approve" }, agent));
  assert.equal(byBot.status, 403, "a bot cannot approve: it would finish its own card");
  const first = await fetchApp("/api/review/mina-1-v9/submit", jsonInit("POST", { kind: "approve" }, reviewer));
  assert.equal(first.status, 201);
  const made = await first.json();
  assert.equal(made.status, "approved");
  assert.equal(made.submission.kind, "approve");
  const twice = await fetchApp("/api/review/mina-1-v9/submit", jsonInit("POST", { kind: "approve" }, reviewer));
  assert.equal(twice.status, 200);
  const dup = await twice.json();
  assert.equal(dup.duplicate, true);
  assert.equal(dup.submission.id, made.submission.id);
  const bad = await fetchApp("/api/review/mina-1-v9/submit", jsonInit("POST", { kind: "ship" }, reviewer));
  assert.equal(bad.status, 400);
  await bad.arrayBuffer();
  const video = (await (await fetchApp("/api/review/mina-1-v9", { headers: agent })).json()).video;
  assert.equal(video.status, "approved");
});

test("dashboard: the agent token plus X-Review-Via is a signed-in reviewer under /dashboard, never an agent", async () => {
  const dash = { ...agent, "X-Review-Via": "dashboard" };
  const index = await fetchApp("/review", { headers: dash });
  assert.equal(index.status, 200);
  const list = await index.text();
  assert.match(list, /href="\/dashboard\/review\/mina-1-v8"/);
  assert.match(list, /href="\/dashboard\/review\/_\/app\.css"/);
  assert.match(list, /<a href="\/dashboard\/">Dashboard<\/a>/);
  const page = await (await fetchApp("/review/mina-1-v8", { headers: dash })).text();
  assert.match(page, /<video id="player"[^>]*src="\/dashboard\/review\/media\/mina-1-v8\/video\.mp4\?v=/);
  assert.match(page, /<script src="\/dashboard\/review\/_\/app\.js" defer>/);
  assert.match(page, /id="send-changes"[^>]*>Send back</);
  assert.match(page, /<canvas id="ink" class="ink"/);
  const data = JSON.parse(/<script type="application\/json" id="review-data">([^<]+)<\/script>/.exec(page)[1]);
  assert.deepEqual([data.api, data.base, data.dashboard], ["/dashboard/api/review", "/dashboard/review", true]);
  const keyed = await fetchApp("/review/mina-1-v8?k=x", { headers: dash });
  assert.equal(keyed.headers.get("location"), "/dashboard/review/mina-1-v8");
  await keyed.arrayBuffer();
  const video = (await (await fetchApp("/api/review/mina-1-v8", { headers: dash })).json()).video;
  assert.equal(video.page_url, `${runtime.url}/dashboard/review/mina-1-v8`);
  const media = await fetchApp(new URL(video.video_url).pathname.replace("/dashboard", ""), { headers: { ...dash, Range: "bytes=0-1" } });
  assert.equal(media.status, 206);
  await media.arrayBuffer();

  // The header without the token is nothing; the token with the header is never an agent.
  const bare = await fetchApp("/review", { headers: { "X-Review-Via": "dashboard" } });
  assert.equal(bare.status, 303);
  await bare.arrayBuffer();
  const comment = (await (await fetchApp("/api/review/mina-1-v8/comments", { headers: agent })).json()).comments[0];
  for (const [path, init] of [
    ["/api/review/mina-1-v8/uploads", jsonInit("POST", { kind: "video" }, dash)],
    [`/api/review/mina-1-v8/comments/${comment.id}`, { method: "DELETE", headers: dash }],
    ["/api/review/mina-1-v8", { method: "DELETE", headers: dash }],
    ["/api/review/submissions?undelivered=1", { headers: dash }],
    [`/api/review/mina-1-v8/comments/${comment.id}/transcript`, jsonInit("POST", { text: "x" }, dash)],
  ]) {
    const response = await fetchApp(path, init);
    assert.equal(response.status, 403, path);
    await response.arrayBuffer();
  }

  // A Send back the dashboard tells the owner about itself is stored as delivered, so the GPU2 router skips it.
  // Only the dashboard can say so: the header from a signed-in browser changes nothing.
  const claim = { "X-Review-Delivered-To": "dashboard" };
  const sendBack = async (headers) => {
    await fetchApp("/api/review/mina-1-v8/comments", jsonInit("POST", { author: "Jon", t: 1, text: "tighter" }, headers)).then((r) => r.arrayBuffer());
    return (await (await fetchApp("/api/review/mina-1-v8/submit", jsonInit("POST", { kind: "changes" }, { ...headers, ...claim }))).json()).submission;
  };
  const told = await sendBack(dash);
  const browser = await sendBack({ Cookie: cookie, Origin: runtime.url });
  assert.deepEqual([told.delivered_to, browser.delivered_to], ["dashboard", null]);
  const queue = (await (await fetchApp("/api/review/submissions?undelivered=1", { headers: agent })).json()).submissions.map((x) => x.id);
  assert.deepEqual([queue.includes(told.id), queue.includes(browser.id)], [false, true]);
  // The dashboard couldn't wake the owner after all: requeue hands it back to the router (agent token only).
  const denied = await fetchApp(`/api/review/submissions/${told.id}/requeue`, jsonInit("POST", {}, dash));
  assert.equal(denied.status, 403);
  await denied.arrayBuffer();
  await fetchApp(`/api/review/submissions/${told.id}/requeue`, jsonInit("POST", {}, agent)).then((r) => r.arrayBuffer());
  const again = (await (await fetchApp("/api/review/submissions?undelivered=1", { headers: agent })).json()).submissions.map((x) => x.id);
  assert.ok(again.includes(told.id));
});

test("drawings: stored as checked vector JSON; bad tools, colours, points and extra keys never stored", async () => {
  const reviewer = { Cookie: cookie, Origin: runtime.url };
  const drawing = { v: 1, evil: "<script>", shapes: [
    { tool: "arrow", color: "#ff3b30", points: [[0.1, 0.2], [0.123456, 0.9]], onclick: "x" },
    { tool: "pen", color: "#ffffff", points: [[0, 0], [0.5, 0.5], [1, 1]] },
  ] };
  const made = await fetchApp("/api/review/mina-1-v8/comments", jsonInit("POST", { author: "Jon", t: 2, text: "", drawing }, reviewer));
  assert.equal(made.status, 201, "a drawing needs no text");
  const { comment } = await made.json();
  const want = { v: 1, shapes: [
    { tool: "arrow", color: "#ff3b30", points: [[0.1, 0.2], [0.1235, 0.9]] },
    { tool: "pen", color: "#ffffff", points: [[0, 0], [0.5, 0.5], [1, 1]] },
  ] };
  assert.deepEqual(comment.drawing, want);
  const row = await runtime.db.prepare("SELECT drawing, text FROM comments WHERE id = ?").bind(comment.id).first();
  assert.deepEqual(row, { drawing: JSON.stringify(want), text: "" });
  const listed = (await (await fetchApp("/api/review/mina-1-v8/comments", { headers: { Cookie: cookie } })).json()).comments;
  assert.deepEqual(listed.find((c) => c.id === comment.id).drawing, want);

  const shape = (s) => ({ v: 1, shapes: [{ tool: "box", color: "#0a84ff", points: [[0, 0], [1, 1]], ...s }] });
  for (const bad of [shape({ color: "red" }), shape({ color: "#ff3b30;background:url(x)" }), shape({ tool: "circle" }), shape({ points: [[2, 0], [0, 0]] }),
    shape({ points: [["0.1", 0], [0, 0]] }), shape({ points: [[0, 0], [0.5, 0.5], [1, 1]] }), shape({ points: [[0, 0]] }),
    shape({ tool: "pen", points: Array.from({ length: 1001 }, () => [0.5, 0.5]) }), { v: 1, shapes: [] },
    { v: 1, shapes: Array.from({ length: 51 }, () => shape({}).shapes[0]) }, "not json", 7]) {
    const response = await fetchApp("/api/review/mina-1-v8/comments", jsonInit("POST", { author: "Jon", t: 2, text: "x", drawing: bad }, reviewer));
    assert.equal(response.status, 400, JSON.stringify(bad).slice(0, 80));
    await response.arrayBuffer();
  }
});

test("voice notes: webm, mp4 or ogg up to 5 MB, checked by first bytes; ranged playback; GPU1 transcript; gone with the comment", async () => {
  const reviewer = { Cookie: cookie, Origin: runtime.url };
  // Encoded here: Miniflare's fetch doesn't take Node's FormData. No Content-Length reaches the Worker either.
  const note = async (bytes, type, extra = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ author: "Jon", t: "4.5", text: "", ...extra })) form.append(k, v);
    if (bytes) form.append("audio", new Blob([bytes], { type }), "voice");
    const encoded = new Response(form);
    return fetchApp("/api/review/mina-1-v8/comments", {
      method: "POST", headers: { ...reviewer, "Content-Type": encoded.headers.get("content-type") }, body: new Uint8Array(await encoded.arrayBuffer()),
    });
  };
  const webm = new Uint8Array(2000).fill(7);
  webm.set([0x1a, 0x45, 0xdf, 0xa3]);
  const mp4 = new Uint8Array(3000).fill(1);
  mp4.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]); // ....ftyp
  const ogg = new TextEncoder().encode("OggS-and-then-some-opus");

  const first = await note(webm, "audio/webm;codecs=opus", { drawing: JSON.stringify({ v: 1, shapes: [{ tool: "box", color: "#34c759", points: [[0.2, 0.2], [0.4, 0.4]] }] }) });
  assert.equal(first.status, 201);
  const { comment } = await first.json();
  assert.equal(comment.audio_url, `${runtime.url}/api/review/mina-1-v8/comments/${comment.id}/audio`);
  assert.deepEqual([comment.text, comment.t, comment.drawing.shapes[0].tool, comment.transcript], ["", 4.5, "box", null]);
  const ranged = await fetchApp(new URL(comment.audio_url).pathname, { headers: { Cookie: cookie, Range: "bytes=0-3" } });
  assert.deepEqual([ranged.status, ranged.headers.get("content-type"), ranged.headers.get("content-range")], [206, "audio/webm", "bytes 0-3/2000"]);
  assert.deepEqual([...new Uint8Array(await ranged.arrayBuffer())], [0x1a, 0x45, 0xdf, 0xa3]);
  const iphone = await (await note(mp4, "audio/mp4", { text: "said it" })).json();
  const firefox = await note(ogg, "audio/ogg;codecs=opus");
  assert.equal(firefox.status, 201);
  await firefox.arrayBuffer();
  const keys = (await runtime.bucket.list({ prefix: "review/mina-1-v8/voice/" })).objects.map((o) => o.key).sort();
  assert.deepEqual(keys.map((k) => k.split(".").pop()).sort(), ["m4a", "ogg", "webm"]);

  for (const [bytes, type, status, why] of [
    [webm, "text/html", 415, "not an audio type"], [webm, "audio/mpeg", 415, "mp3 is not what MediaRecorder makes"],
    [new TextEncoder().encode("<html><script>alert(1)</script>"), "audio/webm", 415, "HTML claiming to be webm"],
    [mp4, "audio/webm", 415, "mp4 bytes claiming webm"], [new Uint8Array(5 * 1024 * 1024 + 1).fill(0x1a), "audio/webm", 413, "over 5 MB"],
    [null, null, 400, "no text, drawing or audio"],
  ]) {
    const response = await note(bytes, type);
    assert.equal(response.status, status, why);
    await response.arrayBuffer();
  }
  const huge = await fetchApp("/api/review/mina-1-v8/comments", {
    method: "POST", headers: { ...reviewer, "Content-Type": "multipart/form-data; boundary=x" }, body: new Uint8Array(6 * 1024 * 1024),
  });
  assert.equal(huge.status, 413, "reading stops past the limit");
  await huge.arrayBuffer();
  const garbled = await fetchApp("/api/review/mina-1-v8/comments", { method: "POST", headers: { ...reviewer, "Content-Type": "multipart/form-data; boundary=x" }, body: "x" });
  assert.equal(garbled.status, 400);
  await garbled.arrayBuffer();

  // GPU1: review_voice.mjs (with a stand-in for gpuq + Parakeet) transcribes every untranscribed note once.
  const voiceScript = fileURLToPath(new URL("../scripts/review_voice.mjs", import.meta.url));
  const run = (args) => spawnSync(process.execPath, [voiceScript, "--base", runtime.url, ...args], {
    encoding: "utf8",
    env: { ...process.env, REVIEW_API_TOKEN: SECRETS.REVIEW_API_TOKEN, NODE_TLS_REJECT_UNAUTHORIZED: "0", NODE_NO_WARNINGS: "1",
      GPUQ_PYTHON: process.execPath, GPUQ: fileURLToPath(new URL("./fixtures/fake_gpuq.mjs", import.meta.url)), HOOK_PY: "none" },
  });
  const result = run(["--slug", "mina-1-v8"]);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.deepEqual(out.transcribed.map((x) => x.transcript).sort(), ["heard 2000 bytes", "heard 23 bytes", "heard 3000 bytes"]);
  assert.deepEqual(JSON.parse(run(["--slug", "mina-1-v8"]).stdout).transcribed, [], "a second run has nothing left to do");
  const again = run(["--slug", "mina-1-v8", "--comment", comment.id]);
  assert.equal(JSON.parse(again.stdout).transcribed.length, 1, "--comment redoes that one");
  assert.equal(run(["--slug", "mina-1-v8", "--comment", "nope"]).status, 1);
  const saved = (await (await fetchApp("/api/review/mina-1-v8/comments", { headers: { Cookie: cookie } })).json()).comments.find((c) => c.id === iphone.comment.id);
  assert.deepEqual([saved.text, saved.transcript], ["said it", "heard 3000 bytes"]);

  for (const [headers, id, status] of [[reviewer, comment.id, 403], [agent, (await runtime.db.prepare("SELECT id FROM comments WHERE slug = 'mina-1-v8' AND audio_key IS NULL LIMIT 1").first()).id, 404]]) {
    const response = await fetchApp(`/api/review/mina-1-v8/comments/${id}/transcript`, jsonInit("POST", { text: "x" }, headers));
    assert.equal(response.status, status);
    await response.arrayBuffer();
  }
  const gone = await fetchApp(`/api/review/mina-1-v8/comments/${comment.id}`, { method: "DELETE", headers: agent });
  assert.equal(gone.status, 200);
  await gone.arrayBuffer();
  assert.equal((await runtime.bucket.list({ prefix: "review/mina-1-v8/voice/" })).objects.length, 2, "its voice note is deleted with it");
});

test("deleting a test video removes its comments, submissions, media and empty test channel", async () => {
  const linked = publish(["--slug", "router-test-1", "--channel", "router-test", "--video", "router-test-1", "--version", "v1",
    "--title", "Router test", "--file", clipPath, "--replaces", "mina-1-v9"]);
  assert.equal(linked.replaces, "mina-1-v9", "--replaces links the new version from the old page");
  const latest = (await (await fetchApp("/api/review/mina-1-v9/submissions", { headers: agent })).json()).submissions.find((s) => s.kind === "changes");
  assert.equal(latest.result_slug, "router-test-1");
  assert.equal(latest.id, linked.linked_submission);
  await fetchApp("/api/review/router-test-1/comments", jsonInit("POST", { author: "Jon", t: 1, text: "x" })).then((r) => r.arrayBuffer());
  await fetchApp("/api/review/router-test-1/submit", jsonInit("POST", {})).then((r) => r.arrayBuffer());
  const reviewerDelete = await fetchApp("/api/review/router-test-1", { method: "DELETE", headers: { Cookie: cookie } });
  assert.equal(reviewerDelete.status, 403);
  await reviewerDelete.arrayBuffer();
  const gone = await fetchApp("/api/review/router-test-1", { method: "DELETE", headers: agent });
  assert.equal(gone.status, 200);
  await gone.arrayBuffer();
  assert.equal((await runtime.bucket.list({ prefix: "review/router-test-1/" })).objects.length, 0);
  const left = await runtime.db.prepare(`SELECT (SELECT COUNT(*) FROM comments WHERE slug = 'router-test-1') AS c,
    (SELECT COUNT(*) FROM submissions WHERE slug = 'router-test-1') AS s,
    (SELECT COUNT(*) FROM channels WHERE slug = 'router-test') AS ch, (SELECT COUNT(*) FROM channels) AS all_ch`).first();
  assert.deepEqual(left, { c: 0, s: 0, ch: 0, all_ch: 7 });
  const unlinked = (await (await fetchApp("/api/review/mina-1-v9/submissions", { headers: agent })).json()).submissions.find((s) => s.id === latest.id);
  assert.equal(unlinked.result_slug, null, "links to a deleted version are cleared");
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
