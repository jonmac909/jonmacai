// Headless Chrome check of the version compare page on local Miniflare: no console errors, both players load, Play both runs
// both with one audio track, a changed span seeks both, a timed comment on A, "Send as fix brief" makes A's changes
// submission (with the brief on the router), and at phone width the players stack.   node test/compare-browser.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SECRETS, allPassed, startRuntime } from "./harness.mjs";

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}`, "Content-Type": "application/json" };
const clip = readFileSync(new URL("./fixtures/clip.mp4", import.meta.url));
const runtime = await startRuntime({ listen: true, https: false, dashboard: allPassed(() => runtime) });
const base = runtime.url;
const errors = [];
let browser;
try {
  for (const [version, changes] of [["v1", undefined], ["v2", { reason: "new b-roll", changes: [{ from: 1, to: 2, what: "new b-roll" }] }]]) {
    const key = `review/cmpb-${version}/video-test.mp4`;
    await runtime.bucket.put(key, clip, { httpMetadata: { contentType: "video/mp4" } });
    const res = await fetch(`${base}/api/review/cmpb-${version}/publish`, { method: "POST", headers: agent,
      body: JSON.stringify({ channel: "test", video: "cmpb", version, title: "Compare proof", video_key: key, ...(changes ? { changes } : {}) }) });
    assert.equal(res.status, 201, await res.text());
  }
  browser = await chromium.launch({ channel: "chrome", chromiumSandbox: process.env.CHROME_NO_SANDBOX !== "1" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/review/cmpb-v2/compare?k=${encodeURIComponent(SECRETS.REVIEW_SHARE_KEY)}`);
  assert.ok(page.url().includes("/review/login?next="), `passcode page: ${page.url()}`);
  await page.fill("#passcode", SECRETS.REVIEW_PASSCODE);
  await Promise.all([page.waitForURL(`${base}/review/cmpb-v2/compare`), page.click("button[type=submit]")]);
  await page.waitForFunction(() => ["player-a", "player-b"].every((id) => document.getElementById(id).readyState >= 1), null, { timeout: 15000 });
  assert.equal(await page.locator("#strips").isHidden(), false, "strip shown for v2's changes");
  assert.equal(await page.locator(".strip .span").count(), 1);
  await page.click("#play-both");
  await page.waitForFunction(() => ["player-a", "player-b"].every((id) => !document.getElementById(id).paused), null, { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => ["player-a", "player-b"].map((id) => document.getElementById(id).muted)), [true, false]);
  await page.click("#pause-both");
  await page.click(".strip .span");
  await page.waitForTimeout(300);
  const times = await page.evaluate(() => ["player-a", "player-b"].map((id) => document.getElementById(id).currentTime));
  assert.ok(times.every((t) => Math.abs(t - 1) < 0.15), `span seeks both: ${times}`);
  await page.fill("#author", "Proof");
  await page.check('input[name="on"][value="a"]');
  await page.fill("#note", "slower here");
  await page.click("#submit");
  await page.waitForFunction(() => document.querySelectorAll("#list-a .comment").length === 1, null, { timeout: 5000 });
  await page.click("#brief-a");
  await page.waitForFunction(() => /Sent 1 comment/.test(document.getElementById("brief-status-a").textContent), null, { timeout: 5000 });
  const router = await (await fetch(`${base}/api/review/submissions?undelivered=1`, { headers: agent })).json();
  const sub = (router.submissions || router).find((s) => s.slug === "cmpb-v1" && s.kind === "changes");
  assert.match(sub?.brief || "", /0:01 .*slower here \(Proof\)/);
  await page.setViewportSize({ width: 390, height: 844 });
  const [a, b] = await Promise.all(["#player-a", "#player-b"].map((s) => page.locator(s).boundingBox()));
  assert.ok(b.y > a.y + a.height - 1 && b.width > 300, "players stacked at phone width");
  assert.deepEqual(errors, []);
  console.log("compare-browser: ok");
} finally {
  await browser?.close();
  await runtime.mf.dispose();
}
