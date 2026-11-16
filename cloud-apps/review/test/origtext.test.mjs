// Review pages, 2026-11-16: (1) a text-only lesson shows the original Skool text in the left "Source" panel, sanitized;
// (2) every player box takes its own video's shape (9:16 reel = tall narrow player, 16:9 stays 16:9). Dummy slugs only.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SECRETS, allPassed, startRuntime } from "./harness.mjs";
import { sanitizeSourceHtml } from "../pages.js";

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}`, "Content-Type": "application/json" };
const dashboardVia = { ...agent, "X-Review-Via": "dashboard" };
let runtime, cookie;
const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });

const HOSTILE = [
  "<h2>The Big Idea</h2>",
  "<p>First sentence of the lesson. <strong>Bold</strong> and <a href=\"https://example.com/a?x=1&amp;y=2\">a link</a>.</p>",
  "<script>alert(1)</script>",
  "<p onclick=\"alert(2)\">clicky</p>",
  "<img src=x onerror=alert(3)>",
  "<a href=\"javascript:alert(4)\">bad link</a>",
  "<iframe src=\"https://evil.example\"></iframe>",
  "<ul><li>one</li><li>two &amp; three</li></ul>",
  "<style>body{display:none}</style>",
  "1 < 2 and <b>unclosed",
].join("\n");

async function publish(slug, extra = {}) {
  const key = `review/${slug}/video-test.mp4`;
  await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
  const [, video, version] = /^(.*)-(v\d+)$/.exec(slug);
  const res = await fetchApp(`/api/review/${slug}/publish`, { method: "POST", headers: agent,
    body: JSON.stringify({ channel: "test", video, version, title: `Title ${slug}`, video_key: key, ...extra }) });
  const body = await res.text();
  assert.ok(res.status === 200 || res.status === 201, body);
}
const meta = (slug, body, headers = agent) => fetchApp(`/api/review/${slug}/meta`, { method: "POST", headers, body: JSON.stringify(body) });
const reviewerPage = async (slug) => (await fetchApp(`/review/${slug}`, { headers: { Cookie: cookie } })).text();
const dashboardPage = async (slug) => (await fetchApp(`/review/${slug}`, { headers: dashboardVia })).text();
const duoOf = (html) => /<div class="duo" id="duo">[\s\S]*?<\/figure>\s*<\/div>/.exec(html)?.[0] ?? null;
const addSource = async (slug) => {
  const up = await (await fetchApp(`/api/review/${slug}/uploads`, { method: "POST", headers: agent, body: JSON.stringify({ kind: "source" }) })).json();
  await runtime.bucket.put(up.key, new Uint8Array([0, 0, 0, 24]));
  const res = await fetchApp(`/api/review/${slug}/source`, { method: "POST", headers: agent, body: JSON.stringify({ source_key: up.key }) });
  const body = await res.text();
  assert.equal(res.status, 200, body);
};

before(async () => {
  runtime = await startRuntime({ dashboard: allPassed(() => runtime) });
  const login = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  await login.arrayBuffer();
});
after(async () => runtime?.mf.dispose());

test("sanitizer keeps safe tags and drops scripts, handlers, bad links, images and styles", () => {
  const out = sanitizeSourceHtml(HOSTILE);
  assert.match(out, /<h2>The Big Idea<\/h2>/);
  assert.match(out, /<strong>Bold<\/strong>/);
  assert.match(out, /<a href="https:\/\/example\.com\/a\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer nofollow">a link<\/a>/);
  assert.match(out, /<ul><li>one<\/li><li>two &amp; three<\/li><\/ul>/);
  assert.match(out, /1 &lt; 2 and <b>unclosed<\/b>/, "stray < is escaped and open tags are closed");
  for (const bad of ["alert", "onclick", "onerror", "javascript:", "<script", "<img", "<iframe", "<style", "display:none", "evil.example"]) {
    assert.ok(!out.includes(bad), `${bad} must not survive: ${out}`);
  }
  assert.match(out, /bad link/, "the text of a refused link stays");
});

test("a text-only version shows the original text left, ours right, on both routes, with <script> removed", async () => {
  await publish("ot-lesson-v1", { notes: "Left: the original Skool lesson 1 (X), a text lesson. Right: our remake." });
  const set = await meta("ot-lesson-v1", { source_text: HOSTILE });
  assert.equal(set.status, 200);
  await set.arrayBuffer();
  for (const html of [await reviewerPage("ot-lesson-v1"), await dashboardPage("ot-lesson-v1")]) {
    const duo = duoOf(html);
    assert.ok(duo, "side-by-side block present");
    assert.match(duo, /<figcaption>Source \(Skool text lesson\)<\/figcaption>/);
    assert.match(duo, /<article class="source-text" id="source-text"[^>]*>[\s\S]*<h2>The Big Idea<\/h2>[\s\S]*First sentence of the lesson\./);
    assert.ok(duo.indexOf('id="source-text"') < duo.indexOf('id="player"'), "original left, ours right");
    assert.ok(!duo.includes("source-player"), "no source video player for a text lesson");
    assert.ok(!/alert\(|onclick|onerror|javascript:|<iframe|<img|<style/.test(html), "nothing hostile reaches the page");
    assert.equal((html.match(/<script/g) || []).length, 2, "only the page's own data block and app.js");
    assert.match(html, /Left: the original Skool lesson 1 \(X\), a text lesson\. Right: our remake\./, "caption line stays");
    assert.ok(!html.includes('id="transport"'), "no play-both controls without a source video");
  }
});

test("the meta call is agent-only, rejects bad input and changes only what was sent", async () => {
  const before = await (await fetchApp("/api/review/ot-lesson-v1", { headers: agent })).json();
  const asReviewer = await meta("ot-lesson-v1", { source_text: "x" }, { Cookie: cookie, "Content-Type": "application/json" });
  assert.equal(asReviewer.status, 403);
  assert.equal((await meta("ot-lesson-v1", {})).status, 400);
  assert.equal((await meta("ot-lesson-v1", { video_w: "1080" })).status, 400);
  assert.equal((await meta("ot-lesson-v1", { source_text: 5 })).status, 400);
  assert.equal((await meta("ot-nothing-v1", { source_text: "x" })).status, 404);
  const same = await meta("ot-lesson-v1", { source_w: 640, source_h: 360 });
  assert.equal(same.status, 200);
  const after = (await same.json()).video;
  for (const k of ["video_url", "status", "title", "version", "created_at", "source_url"]) assert.equal(after[k], before.video[k], k);
  assert.equal(after.has_source_text, true, "the text stays when it is not sent");
  assert.equal(after.source_w, 640);
});

test("a recut that sends no text keeps the text; a video with a source video shows the video, not the text", async () => {
  await publish("ot-lesson-v1", {});
  assert.equal((await (await fetchApp("/api/review/ot-lesson-v1", { headers: agent })).json()).video.has_source_text, true);
  await publish("ot-both-v1", { source_text: "<p>Text original</p>" });
  await addSource("ot-both-v1");
  const duo = duoOf(await reviewerPage("ot-both-v1"));
  assert.ok(duo.includes('id="source-player"') && !duo.includes('id="source-text"'));
});

test("no source video and no text: ours alone, no duo", async () => {
  await publish("ot-plain-v1");
  const html = await reviewerPage("ot-plain-v1");
  assert.equal(duoOf(html), null);
  assert.ok(!html.includes("source-text"));
});

test("a 9:16 video gets a 9:16 player box; 16:9 and unknown sizes stay 16:9", async () => {
  await publish("ot-reel-v1", { video_w: 1080, video_h: 1920 });
  await publish("ot-wide-v1", { video_w: 1920, video_h: 1080 });
  await publish("ot-unknown-v1");
  const reel = await reviewerPage("ot-reel-v1");
  assert.match(reel, /<div class="stage frame" style="--ar:0\.5625" data-known="1"><video id="player"/);
  assert.match(await reviewerPage("ot-wide-v1"), /<div class="stage frame" style="--ar:1\.77778" data-known="1"><video id="player"/);
  const unknown = await reviewerPage("ot-unknown-v1");
  assert.match(unknown, /<div class="stage frame" style="--ar:1\.77778"><video id="player"/);
  assert.ok(!unknown.includes("data-known"));
  const api = (await (await fetchApp("/api/review/ot-reel-v1", { headers: agent })).json()).video;
  assert.deepEqual([api.video_w, api.video_h], [1080, 1920]);
});

test("in the duo each side uses its own video's shape; a text original follows ours", async () => {
  await publish("ot-duo-v1", { video_w: 1920, video_h: 1080 });
  await addSource("ot-duo-v1");
  assert.equal((await meta("ot-duo-v1", { source_w: 1080, source_h: 1920 })).status, 200);
  const duo = duoOf(await reviewerPage("ot-duo-v1"));
  assert.match(duo, /<div class="frame" style="--ar:0\.5625" data-known="1"><video id="source-player"/);
  assert.match(duo, /<div class="stage frame" style="--ar:1\.77778" data-known="1"><video id="player"/);
  await publish("ot-textreel-v1", { video_w: 1080, video_h: 1920, source_text: "<p>Original</p>" });
  assert.match(duoOf(await reviewerPage("ot-textreel-v1")), /<div class="frame source-frame" style="--ar:0\.5625" data-known="1"><article class="source-text"/);
});

test("css and script size every player from its own video, capped near 80vh and centred", () => {
  const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
  assert.match(css, /\.frame \{[^}]*width: min\(100%, calc\(80vh \* var\(--ar\)\)\)[^}]*aspect-ratio: var\(--ar\)[^}]*margin: 0 auto/);
  assert.match(css, /\.frame > video \{[^}]*width: 100%; height: 100%/);
  assert.ok(!/max-height: 70vh/.test(css) && !/\.pane video \{ aspect-ratio/.test(css), "no fixed 16:9 or 70vh box left");
  for (const file of ["app.js", "group.js"]) {
    const js = readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
    assert.match(js, /loadedmetadata[\s\S]*videoWidth|videoWidth[\s\S]*loadedmetadata/, `${file} corrects the shape from the file itself`);
  }
});
