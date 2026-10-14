// Headless desktop Google Chrome (Jon's review gate): access gate, no autoplay, playback past 3 s,
// pausing ours pauses the muted source/first-60 players, and a comment created and resolved
// through the UI and through the agent API. Zero console errors allowed.
//   node test/browser.mjs                         local Miniflare + fixture clip
//   node test/browser.mjs --live --slug mina-1-v9 live site; secrets from env or ~/.jonmac-review.env
// Live runs delete their proof comments afterwards and never change the video status.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const live = argv.includes("--live");
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const outDir = arg("--out", fileURLToPath(new URL("../.proof/", import.meta.url)));

function liveSecrets() {
  const file = arg("--env-file", join(homedir(), ".jonmac-review.env"));
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) env[match[1]] = match[2];
    }
  }
  const pick = (name) => process.env[name] || env[name];
  return { REVIEW_SHARE_KEY: pick("REVIEW_SHARE_KEY"), REVIEW_PASSCODE: pick("REVIEW_PASSCODE"), REVIEW_API_TOKEN: pick("REVIEW_API_TOKEN") };
}

async function setup() {
  if (live) {
    const secrets = liveSecrets();
    for (const [name, value] of Object.entries(secrets)) assert.ok(value, `${name} missing`);
    return { base: arg("--base", "https://jonmac.ai"), slug: arg("--slug", "mina-1-v9"), secrets, done: async () => {} };
  }
  const { SECRETS, startRuntime } = await import("./harness.mjs");
  const runtime = await startRuntime({ listen: true, https: false });
  const clip = fileURLToPath(new URL("./fixtures/clip.mp4", import.meta.url));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/review_publish.mjs", import.meta.url)),
    "--base", runtime.url, "--slug", "proof-v1", "--channel", "mina", "--video", "proof", "--version", "v1",
    "--title", "Proof clip", "--file", clip, "--source", clip, "--compare", clip, "--chapters", fileURLToPath(new URL("./fixtures/chapters.json", import.meta.url))],
  { encoding: "utf8", env: { ...process.env, REVIEW_API_TOKEN: SECRETS.REVIEW_API_TOKEN } });
  assert.equal(result.status, 0, result.stderr);
  return { base: runtime.url, slug: "proof-v1", secrets: SECRETS, done: () => runtime.mf.dispose() };
}

async function main() {
  const { base, slug, secrets, done } = await setup();
  const api = async (path, init = {}) => {
    const response = await fetch(`${base}/api/review/${slug}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secrets.REVIEW_API_TOKEN}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
    const body = await response.json();
    assert.ok(response.ok, `${init.method || "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
    return body;
  };
  const report = { url: `${base}/review/${slug}`, browser: "", device: "Desktop 1440x900", consoleErrors: [], pageErrors: [], media: [] };
  const created = [];
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    report.browser = `Google Chrome ${browser.version()} (headless)`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => report.pageErrors.push(String(error)));
    page.on("response", (response) => {
      if (response.url().includes("/review/media/")) {
        report.media.push(`${response.status()} ${response.headers()["content-type"]} ${response.headers()["content-range"] || ""}`.trim());
      }
    });
    await page.addInitScript(() => {
      window.__plays = [];
      document.addEventListener("play", (event) => window.__plays.push({ id: event.target.id, at: performance.now() }), true);
    });

    // 1. Fresh browser, bare link (no share key): the passcode page, never a 404; then the video.
    const first = await page.goto(`${base}/review/${slug}`);
    report.bareLink = { status: first.status(), url: page.url() };
    assert.equal(first.status(), 200, "bare link shows a page, not a 404");
    assert.ok(page.url().startsWith(`${base}/review/login?next=`), `passcode page: ${page.url()}`);
    await page.fill("#passcode", secrets.REVIEW_PASSCODE);
    await Promise.all([page.waitForURL(`${base}/review/${slug}`), page.click("button[type=submit]")]);
    assert.ok(!page.url().includes("k="), "share key not in the address bar");
    await page.waitForFunction(() => document.getElementById("player").readyState >= 1, null, { timeout: 30000 });

    // 2. No autoplay: nothing plays and every media element stays paused without a tap.
    await page.waitForTimeout(3000);
    const idle = await page.evaluate(() => ({
      plays: window.__plays.length,
      paused: [...document.querySelectorAll("video, audio")].every((m) => m.paused),
      autoplayAttr: [...document.querySelectorAll("video, audio")].some((m) => m.autoplay),
      extras: [...document.querySelectorAll("video.extra-player")].map((v) => ({ id: v.id, muted: v.muted, open: v.closest("details").open })),
      t: document.getElementById("player").currentTime,
    }));
    assert.deepEqual({ plays: idle.plays, paused: idle.paused, autoplayAttr: idle.autoplayAttr }, { plays: 0, paused: true, autoplayAttr: false });
    for (const extra of idle.extras) assert.deepEqual([extra.muted, extra.open], [true, false], `${extra.id} is muted and collapsed`);
    report.noAutoplay = idle;

    // 3. Click play on our video (a real mouse click), then play past 3 s with sound on.
    const box = await page.locator("#player").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(800);
    report.playStartedBy = "mouse click on the video";
    if (await page.evaluate(() => document.getElementById("player").paused)) {
      await page.evaluate(() => document.getElementById("player").play());
      report.playStartedBy = "player.play() after the click";
    }
    await page.waitForFunction(() => document.getElementById("player").currentTime > 3.2, null, { timeout: 45000 });
    report.playedTo = await page.evaluate(() => document.getElementById("player").currentTime);
    report.ourMuted = await page.evaluate(() => document.getElementById("player").muted);
    assert.equal(report.ourMuted, false, "our video plays with sound");

    // 3b. Open the muted extras and start them; pausing ours must pause all of them.
    const extraIds = idle.extras.map((e) => e.id);
    for (const id of extraIds) {
      await page.click(`#${id.replace(/-player$/, "")} summary`);
      await page.evaluate((v) => document.getElementById(v).play(), id);
    }
    if (extraIds.length) {
      await page.waitForFunction((ids) => ids.every((v) => !document.getElementById(v).paused), extraIds);
      report.extrasPlayingMuted = await page.evaluate((ids) => ids.map((v) => document.getElementById(v).muted), extraIds);
      assert.ok(report.extrasPlayingMuted.every(Boolean), "extras stay muted while playing");
    }

    // 4. Pause fills the timestamp; UI comment; seek on click; resolve in the UI.
    await page.evaluate(() => document.getElementById("player").pause());
    if (extraIds.length) {
      await page.waitForFunction((ids) => ids.every((v) => document.getElementById(v).paused), extraIds);
      report.pauseAllPausedExtras = extraIds;
    }
    const paused = await page.evaluate(() => ({ t: document.getElementById("player").currentTime, stamp: document.getElementById("stamp").textContent }));
    const expected = `${Math.floor(paused.t / 60)}:${String(Math.floor(paused.t % 60)).padStart(2, "0")}.${Math.floor((paused.t * 10) % 10)}`;
    assert.equal(paused.stamp, expected, "pause auto-filled the timestamp");
    report.pausedStamp = paused.stamp;
    assert.ok(await page.isVisible("#author"), "name asked the first time");
    await page.fill("#author", "Proof bot");
    await page.fill("#note", "[proof] UI comment, safe to ignore");
    await page.click("#submit");
    const uiItem = page.locator("#comments li", { hasText: "[proof] UI comment" });
    await uiItem.waitFor();
    const uiId = await uiItem.getAttribute("data-id");
    created.push(uiId);
    await page.evaluate(() => { const p = document.getElementById("player"); p.currentTime = 0.5; });
    await uiItem.locator("button.time").click();
    await page.waitForFunction((t) => Math.abs(document.getElementById("player").currentTime - t) < 0.3, paused.t);
    await uiItem.locator("button.resolve").click();
    await page.locator(`#comments li.resolved[data-id="${uiId}"]`).waitFor();
    const uiCheck = (await api("/comments")).comments.find((c) => c.id === uiId);
    assert.equal(uiCheck.author, "Proof bot");
    assert.equal(uiCheck.resolved, true);
    assert.ok(Math.abs(uiCheck.t - paused.t) < 0.01);
    report.uiComment = { id: uiId, t: uiCheck.t, resolved: uiCheck.resolved, resolved_by: uiCheck.resolved_by };

    // 5. Agent API: create, appears in the UI, resolve, open list no longer has it.
    const { comment } = await api("/comments", { method: "POST", body: JSON.stringify({ author: "proof-agent", t: 1.5, text: "[proof] API comment, safe to ignore" }) });
    created.push(comment.id);
    assert.ok((await api("/comments?status=open")).comments.some((c) => c.id === comment.id));
    const resolved = await api(`/comments/${comment.id}/resolve`, { method: "POST", body: JSON.stringify({ by: "proof-agent" }) });
    assert.equal(resolved.comment.resolved, true);
    assert.ok(!(await api("/comments?status=open")).comments.some((c) => created.includes(c.id)));
    await page.reload();
    await page.locator(`#comments li.resolved[data-id="${comment.id}"]`).waitFor();
    assert.ok(await page.isVisible("#who-known"), "name remembered after reload");
    report.apiComment = { id: comment.id, resolved: resolved.comment.resolved, resolved_by: resolved.comment.resolved_by };

    mkdirSync(outDir, { recursive: true });
    report.screenshot = join(outDir, `${slug}-iphone.png`);
    await page.screenshot({ path: report.screenshot, fullPage: true });

    // 6. Index lists the video with its status.
    await page.goto(`${base}/review`);
    assert.ok(await page.isVisible(`a[href="/review/${slug}"]`), "index links the video");
    report.mediaOk = report.media.some((m) => /^206 video\/mp4 bytes /.test(m));
    assert.ok(report.mediaOk, `media served as 206 video/mp4: ${report.media.join(" | ")}`);
    assert.deepEqual(report.consoleErrors, [], "console errors");
    assert.deepEqual(report.pageErrors, [], "page errors");
    report.pass = true;
  } finally {
    if (live) {
      for (const id of created) await api(`/comments/${id}`, { method: "DELETE" }).catch((e) => console.error(`cleanup ${id}: ${e.message}`));
      report.cleanedUp = created;
    }
    await browser.close();
    await done();
    report.media = [...new Set(report.media)];
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(`BROWSER PROOF FAILED: ${error.stack || error}`);
  process.exit(1);
});
