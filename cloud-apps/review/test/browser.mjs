// Headless desktop Google Chrome (Jon's review gate). Fresh browser, exact share link -> passcode ->
// side-by-side page: source (left) and ours (right) both load, nothing autoplays, "Play both" runs
// both past 3 s with exactly one audio track (ours), the sound switch moves it, sync keeps the
// source on the cut map, Source only / Ours only / Pause both work, a comment is created and
// resolved through the UI and the agent API, and ours still plays when the source fails.
// Zero console errors allowed (outside the deliberate source-failure check).
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
  const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/review_publish.mjs", import.meta.url)),
    "--base", runtime.url, "--slug", "proof-v1", "--channel", "mina", "--video", "proof", "--version", "v1",
    "--title", "Proof clip", "--file", fixture("clip.mp4"), "--source", fixture("clip.mp4"), "--compare", fixture("clip.mp4"),
    "--chapters", fixture("versions.json")],
  { encoding: "utf8", env: { ...process.env, REVIEW_API_TOKEN: SECRETS.REVIEW_API_TOKEN } });
  assert.equal(result.status, 0, result.stderr);
  return { base: runtime.url, slug: "proof-v1", secrets: SECRETS, done: () => runtime.mf.dispose() };
}

const state = () => {
  const v = (id) => document.getElementById(id);
  const all = [...document.querySelectorAll("video")];
  return {
    ours: { t: v("player").currentTime, paused: v("player").paused, muted: v("player").muted, ready: v("player").readyState },
    source: { t: v("source-player").currentTime, paused: v("source-player").paused, muted: v("source-player").muted, ready: v("source-player").readyState },
    audible: all.filter((m) => !m.paused && !m.muted && m.volume > 0).map((m) => m.id),
  };
};

async function signIn(page, url, passcode, base, slug) {
  const first = await page.goto(url);
  const landed = { status: first.status(), url: page.url() };
  assert.equal(first.status(), 200, "link shows a page, not a 404");
  assert.ok(page.url().startsWith(`${base}/review/login?next=`), `passcode page: ${page.url()}`);
  await page.fill("#passcode", passcode);
  await Promise.all([page.waitForURL(`${base}/review/${slug}`), page.click("button[type=submit]")]);
  return landed;
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
  const shareLink = `${base}/review/${slug}?k=${encodeURIComponent(secrets.REVIEW_SHARE_KEY)}`;
  const report = { url: `${base}/review/${slug}`, browser: "", device: "Desktop 1440x900", consoleErrors: [], pageErrors: [], media: [] };
  const created = [];
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    report.browser = `Google Chrome ${browser.version()} (headless, Chromium)`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => report.pageErrors.push(String(error)));
    page.on("response", (response) => {
      if (response.url().includes("/review/media/")) {
        const kind = /\/(video|source|compare)\.mp4/.exec(response.url())?.[1];
        report.media.push(`${kind} ${response.status()} ${response.headers()["content-type"]}`);
      }
    });
    await page.addInitScript(() => {
      window.__plays = [];
      document.addEventListener("play", (event) => window.__plays.push(event.target.id), true);
    });

    // 1. Fresh browser, exact share link -> passcode page -> the video page.
    report.shareLink = await signIn(page, shareLink, secrets.REVIEW_PASSCODE, base, slug);
    assert.ok(!page.url().includes("k="), "share key not left in the address bar");

    // 2. Side by side: source left, ours right, same size; both load; nothing autoplays.
    await page.waitForFunction(() => ["player", "source-player"].every((id) => document.getElementById(id).readyState >= 1), null, { timeout: 30000 });
    const layout = await page.evaluate(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const s = box("source-player"), o = box("player");
      return { sourceLeft: s.left < o.left, sameRow: Math.abs(s.top - o.top) < 2, widths: [Math.round(s.width), Math.round(o.width)], heights: [Math.round(s.height), Math.round(o.height)] };
    });
    assert.ok(layout.sourceLeft && layout.sameRow, `source left of ours: ${JSON.stringify(layout)}`);
    assert.ok(Math.abs(layout.widths[0] - layout.widths[1]) <= 2 && Math.abs(layout.heights[0] - layout.heights[1]) <= 2, `same size: ${JSON.stringify(layout)}`);
    report.layout = layout;
    await page.waitForTimeout(3000);
    const idle = await page.evaluate(state);
    const plays = await page.evaluate(() => window.__plays.length);
    assert.equal(plays, 0, "nothing autoplays");
    assert.ok(idle.ours.paused && idle.source.paused, "both paused before any click");
    assert.deepEqual([idle.ours.muted, idle.source.muted], [false, true], "ours has sound, source muted");
    const extras = await page.evaluate(() => [...document.querySelectorAll("video.extra-player")].map((v) => ({ id: v.id, muted: v.muted, open: v.closest("details").open, paused: v.paused })));
    for (const e of extras) assert.deepEqual([e.muted, e.open, e.paused], [true, false, true], `${e.id} muted, collapsed, paused`);
    report.idle = { ...idle, plays, extras };

    // 3. Play both: both run past 3 s, exactly one audio track (ours), source follows the map.
    await page.click("#play-both");
    await page.waitForFunction(() => ["player", "source-player"].every((id) => document.getElementById(id).currentTime > 3.2 && !document.getElementById(id).paused), null, { timeout: 45000 });
    const both = await page.evaluate(state);
    assert.deepEqual(both.audible, ["player"], `only ours audible: ${both.audible}`);
    const drift = [];
    for (let i = 0; i < 5; i++) {
      drift.push(await page.evaluate(() => Math.abs(document.getElementById("source-player").currentTime - window.reviewSync.toSource(document.getElementById("player").currentTime))));
      await page.waitForTimeout(300);
    }
    report.playBoth = { ours: both.ours.t, source: both.source.t, audible: both.audible, syncDriftSeconds: drift.map((d) => Math.round(d * 100) / 100) };
    assert.ok(drift.filter((d) => d < 0.5).length >= 3, `source stays on the sync map: ${drift}`);

    // 4. Sound switch: source only audible, then back to ours. Never two at once.
    await page.check('input[name="audio"][value="source"]');
    const switched = await page.evaluate(state);
    assert.deepEqual(switched.audible, ["source-player"], `switch to source: ${switched.audible}`);
    await page.check('input[name="audio"][value="ours"]');
    const back = await page.evaluate(state);
    assert.deepEqual(back.audible, ["player"], `switch back to ours: ${back.audible}`);
    report.soundSwitch = { source: switched.audible, ours: back.audible };

    // 5. Pause both fills the comment stamp; Source only / Ours only play one side.
    await page.click("#pause-both");
    await page.waitForFunction(() => document.getElementById("player").paused && document.getElementById("source-player").paused);
    await page.waitForFunction(() => document.getElementById("stamp").textContent !== "0:00.0"); // pause event fills it
    const paused = await page.evaluate(() => ({ t: document.getElementById("player").currentTime, stamp: document.getElementById("stamp").textContent }));
    const [mm, ss] = paused.stamp.split(":").map(Number);
    assert.ok(Math.abs(mm * 60 + ss - paused.t) < 0.2, `pausing filled the timestamp: ${paused.stamp} vs ${paused.t}`);
    report.pausedStamp = paused.stamp;
    await page.click("#source-only");
    await page.waitForTimeout(1200);
    const srcOnly = await page.evaluate(state);
    assert.ok(!srcOnly.source.paused && srcOnly.ours.paused, "source only");
    await page.click("#ours-only");
    await page.waitForTimeout(1200);
    const oursOnly = await page.evaluate(state);
    assert.ok(!oursOnly.ours.paused && oursOnly.source.paused, "ours only");
    assert.deepEqual(oursOnly.audible, ["player"]);
    report.onlyButtons = { sourceOnly: !srcOnly.source.paused && srcOnly.ours.paused, oursOnly: !oursOnly.ours.paused && oursOnly.source.paused };
    await page.click("#pause-both");

    // 6. Comment via the UI at the paused time: seek on click, resolve in the UI.
    const at = await page.evaluate(() => document.getElementById("player").currentTime);
    if (await page.isVisible("#author")) await page.fill("#author", "Proof bot");
    await page.fill("#note", "[proof] UI comment, safe to ignore");
    await page.click("#submit");
    const uiItem = page.locator("#comments li", { hasText: "[proof] UI comment" });
    await uiItem.waitFor();
    const uiId = await uiItem.getAttribute("data-id");
    created.push(uiId);
    await page.evaluate(() => { document.getElementById("player").currentTime = 0.5; });
    await uiItem.locator("button.time").click();
    await page.waitForFunction((t) => Math.abs(document.getElementById("player").currentTime - t) < 0.3, at);
    await uiItem.locator("button.resolve").click();
    await page.locator(`#comments li.resolved[data-id="${uiId}"]`).waitFor();
    const uiCheck = (await api("/comments")).comments.find((c) => c.id === uiId);
    assert.equal(uiCheck.resolved, true);
    report.uiComment = { id: uiId, t: uiCheck.t, resolved: uiCheck.resolved, resolved_by: uiCheck.resolved_by };

    // 7. Agent API: create, resolve, gone from the open list, shown resolved in the UI.
    const { comment } = await api("/comments", { method: "POST", body: JSON.stringify({ author: "proof-agent", t: 1.5, text: "[proof] API comment, safe to ignore" }) });
    created.push(comment.id);
    const resolved = await api(`/comments/${comment.id}/resolve`, { method: "POST", body: JSON.stringify({ by: "proof-agent" }) });
    assert.equal(resolved.comment.resolved, true);
    assert.ok(!(await api("/comments?status=open")).comments.some((c) => created.includes(c.id)));
    await page.reload();
    await page.locator(`#comments li.resolved[data-id="${comment.id}"]`).waitFor();
    report.apiComment = { id: comment.id, resolved: resolved.comment.resolved, resolved_by: resolved.comment.resolved_by };

    mkdirSync(outDir, { recursive: true });
    report.screenshot = join(outDir, `${slug}-chrome.png`);
    await page.screenshot({ path: report.screenshot, fullPage: true });
    assert.ok(report.media.some((m) => /^video 206 video\/mp4/.test(m)) && report.media.some((m) => /^source 206 video\/mp4/.test(m)), `both media 206: ${report.media}`);
    assert.deepEqual(report.consoleErrors, [], "console errors");
    assert.deepEqual(report.pageErrors, [], "page errors");

    // 8. Fresh browser, bare link (no key): passcode page, never a 404.
    const bareContext = await browser.newContext();
    const barePage = await bareContext.newPage();
    const bare = await barePage.goto(`${base}/review/${slug}`);
    report.bareLink = { status: bare.status(), url: barePage.url() };
    assert.equal(bare.status(), 200);
    assert.ok(barePage.url().startsWith(`${base}/review/login?next=`));
    await bareContext.close();

    // 9. Source fails to load (blocked): ours still plays, the page says so.
    const failContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const failPage = await failContext.newPage();
    await failPage.route("**/source.mp4*", (route) => route.abort());
    await signIn(failPage, shareLink, secrets.REVIEW_PASSCODE, base, slug);
    await failPage.locator("#source-error").waitFor({ state: "visible", timeout: 30000 });
    await failPage.click("#ours-only");
    await failPage.waitForFunction(() => document.getElementById("player").currentTime > 2 && !document.getElementById("player").paused, null, { timeout: 30000 });
    report.sourceFailure = { errorShown: true, playBothDisabled: await failPage.isDisabled("#play-both"), oursPlayedTo: await failPage.evaluate(() => document.getElementById("player").currentTime) };
    await failContext.close();
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
