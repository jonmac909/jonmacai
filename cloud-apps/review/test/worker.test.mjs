import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { byteRange, makeSession, mediaTag, safeEqual, validSlug, verifySession } from "../worker.js";
import { escapeHtml, formatTime } from "../pages.js";
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

test("publish script reads MP4 box order for the fast-start check", () => {
  const boxes = topLevelBoxes(fileURLToPath(new URL("./fixtures/clip.mp4", import.meta.url)));
  assert.ok(boxes.indexOf("moov") < boxes.indexOf("mdat"), boxes.join(","));
});
