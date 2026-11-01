import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { byteRange, makeSession, mediaTag, parseDrawing, safeEqual, validSlug, verifySession } from "../worker.js";
import { escapeHtml, formatTime, openVideos, renderIndex } from "../pages.js";
import { topLevelBoxes } from "../scripts/review_publish.mjs";
import { SECRETS } from "./harness.mjs";

test("browser byte probes, open-ended and suffix seeks", () => {
  assert.equal(byteRange(null, 100), null);
  assert.deepEqual(byteRange("bytes=0-1", 100), { offset: 0, length: 2 });
  assert.deepEqual(byteRange("bytes=90-", 100), { offset: 90, length: 10 });
  assert.deepEqual(byteRange("bytes=-10", 100), { offset: 90, length: 10 });
  assert.deepEqual(byteRange("bytes=90-999", 100), { offset: 90, length: 10 });
});

test("invalid or unsatisfiable ranges never read outside the object", () => {
  for (const range of ["bytes=100-", "bytes=9-2", "bytes=-0", "bytes=-", "bytes=0-1,4-5", "bytes=999999999999999999999-"]) {
    assert.throws(() => byteRange(range, 100), RangeError);
  }
});

test("slugs are lowercase, dashed and never reserved paths", () => {
  for (const slug of ["mina-1-v9", "a", "zane02-v12"]) assert.ok(validSlug(slug), slug);
  for (const slug of ["", "Mina", "-a", "a-", "a/b", "media", "login", "api", "_", "a".repeat(81), "../x"]) assert.ok(!validSlug(slug), slug);
});

test("sessions are signed, expire, and die when the passcode rotates", async () => {
  const now = Date.UTC(2026, 9, 14);
  const session = await makeSession(SECRETS, now);
  assert.ok(await verifySession(SECRETS, session, now));
  assert.ok(await verifySession(SECRETS, session, now + 29 * 86400e3), "valid for 30 days");
  assert.ok(!(await verifySession(SECRETS, session, now + 31 * 86400e3)), "expired");
  assert.ok(!(await verifySession({ ...SECRETS, REVIEW_PASSCODE: "rotated-passcode" }, session, now)), "passcode rotated");
  assert.ok(!(await verifySession(SECRETS, session.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now)), "tampered");
  assert.ok(!(await verifySession(SECRETS, "", now)));
});

test("constant-time compare rejects empty and different values", async () => {
  assert.ok(await safeEqual("abc", "abc"));
  assert.ok(!(await safeEqual("abc", "abd")));
  assert.ok(!(await safeEqual("", "")));
  assert.ok(!(await safeEqual(undefined, "x")));
});

test("helpers escape HTML, format times and tag media", () => {
  assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(75.9), "1:15");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(mediaTag("review/mina-1-v9/video-abc123.mp4"), "video-abc123");
});

test("drawings are rewritten from known parts only, or refused", () => {
  assert.equal(parseDrawing(undefined), null);
  assert.equal(parseDrawing(""), null);
  const line = { tool: "pen", color: "#ffcc00", points: [[0.333333, 1], [0, 0.5]] };
  assert.deepEqual(parseDrawing(JSON.stringify({ v: 9, shapes: [{ ...line, style: "x" }], html: "<b>" })), { v: 1, shapes: [{ ...line, points: [[0.3333, 1], [0, 0.5]] }] });
  for (const bad of ["{", "x".repeat(70000), { shapes: [{ ...line, color: "#FFCC00" }] }, { shapes: [{ ...line, points: [[NaN, 0], [0, 0]] }] },
    { shapes: [{ ...line, points: [[0, 0, 0], [0, 0]] }] }, { shapes: "nope" }, { shapes: Array.from({ length: 6 }, () => ({ ...line, points: Array(1000).fill([0, 0]) })) }]) {
    assert.throws(() => parseDrawing(bad), RangeError, JSON.stringify(bad).slice(0, 60));
  }
});

test("publish script reads MP4 box order for the fast-start check", () => {
  const boxes = topLevelBoxes(fileURLToPath(new URL("./fixtures/clip.mp4", import.meta.url)));
  assert.ok(boxes.indexOf("moov") < boxes.indexOf("mdat"), boxes.join(","));
});

test("the review list shows each video's newest version, until it is approved", () => {
  const v = (slug, video, status, created_at, channel = "mina") => ({ slug, video, status, created_at, channel, title: slug, version: slug.split("-").pop() });
  const videos = [
    v("a-1-v2", "a-1", "approved", "2026-11-01T10:00:00Z"), // approved: its older open version leaves with it
    v("a-1-v1", "a-1", "needs_review", "2026-10-31T10:00:00Z"),
    v("b-1-v2", "b-1", "changes_requested", "2026-11-01T10:00:00Z"), // newest open version only
    v("b-1-v1", "b-1", "needs_review", "2026-10-31T10:00:00Z"),
    v("c-1-v2", "c-1", "needs_review", "2026-11-01T10:00:00Z", "viral-view"), // versions can move channel
    v("c-1-v1", "c-1", "changes_requested", "2026-10-31T10:00:00Z"),
    v("b-1-v0", "b-trial", "changes_requested", "2026-10-30T10:00:00Z"), // the video key can differ too
    v("d-1-v1", "d-1", "changes_requested", "2026-10-16T23:00:00Z"), // the Oct 14 to 16 batch Jon cleared
    v("e-1-v1", "e-1", "needs_review", "2026-10-17T00:00:00Z"),
  ];
  assert.deepEqual(openVideos(videos).map((x) => x.slug), ["b-1-v2", "c-1-v2", "e-1-v1"]);
  const page = renderIndex({ channels: [{ slug: "mina", name: "Mina" }, { slug: "empty", name: "Empty" }], videos });
  assert.deepEqual([...page.matchAll(/href="\/review\/([a-z0-9-]+)"/g)].map((m) => m[1]), ["b-1-v2", "e-1-v1", "c-1-v2"]);
  assert.match(page, /2 needs review · 1 changes requested</);
  assert.doesNotMatch(page, /approved</i);
  assert.match(page, /<h2>Empty<\/h2>\s*<p class="muted">Nothing to review\.<\/p>/);
});
