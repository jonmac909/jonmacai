const { chromium } = require("C:/Users/partn/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright");
const assert = require("node:assert/strict");

(async () => {
  const baseUrl = process.env.V2_BASE_URL || "http://127.0.0.1:4177/cloud-apps/youtube-gen-v2/";
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.removeItem("jonmac_youtube_gen_v2_projects_v1"));
  await page.reload({ waitUntil: "domcontentloaded" });

  const cardData = () => page.locator(".video-card").evaluateAll((cards) => cards.map((card) => ({
    age: Number(card.dataset.ageDays),
    uploadDate: card.dataset.uploadDate,
    duration: Number(card.dataset.durationSeconds),
    views: Number(card.dataset.views),
    metric: Number(card.dataset.metric),
  })));
  let cards = await cardData();
  assert.ok(cards.length > 0, "Discovery should render qualified videos");
  const expectedAge = (raw) => {
    const published = Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)));
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.max(0, Math.floor((today - published) / 86400000));
  };
  assert.ok(cards.filter((card) => /^\d{8}$/.test(card.uploadDate)).every((card) => card.age === expectedAge(card.uploadDate)), "Displayed ages must derive from upload_date");

  const thumbnail = page.locator("[data-source-thumbnail]").first();
  const sourceButton = page.locator("[data-source-link]").first();
  const expectedSourceUrl = await thumbnail.getAttribute("href");
  assert.match(expectedSourceUrl, /^https:\/\/www\.youtube\.com\/watch\?v=/, "Thumbnail must link to YouTube");
  assert.equal(await thumbnail.getAttribute("target"), "_blank", "Thumbnail must open a new tab");
  assert.equal(await sourceButton.getAttribute("href"), expectedSourceUrl, "External-link button must use the same source URL");
  assert.equal(await sourceButton.getAttribute("target"), "_blank", "External-link button must open a new tab");
  let popupPromise = page.waitForEvent("popup");
  await thumbnail.click();
  let popup = await popupPromise;
  await popup.waitForURL(/youtube\.com\/watch/, { timeout: 10000 });
  assert.ok(popup.url().includes(new URL(expectedSourceUrl).searchParams.get("v")), "Thumbnail tab must open the correct video");
  await popup.close();

  await page.locator("#trend-search").fill("Claude Design + Higgsfield");
  await page.locator('[data-video-id="xwSVLN4qPhk"]').waitFor({ state: "visible" });
  assert.equal(await page.locator('[data-video-id="xwSVLN4qPhk"] .channel-line span').last().textContent(), "2mo ago", "June 17 video must not use stale 5-day snapshot age");
  await page.locator("#trend-search").fill("");
  await page.locator(".video-card").first().waitFor({ state: "visible" });
  popupPromise = page.waitForEvent("popup");
  await sourceButton.click();
  popup = await popupPromise;
  await popup.waitForURL(/youtube\.com\/watch/, { timeout: 10000 });
  assert.ok(popup.url().includes(new URL(expectedSourceUrl).searchParams.get("v")), "External-link tab must open the correct video");
  await popup.close();

  await page.locator("#date-filter").selectOption("90");
  cards = await cardData();
  assert.ok(cards.length > 0 && cards.every((card) => card.age <= 90), "Date filter must limit age");
  await page.locator("#date-filter").selectOption("all");

  await page.locator("#duration-filter").selectOption("short");
  cards = await cardData();
  assert.ok(cards.length > 0 && cards.every((card) => card.duration < 900), "Duration filter must limit runtime");
  await page.locator("#duration-filter").selectOption("all");

  await page.locator("#views-filter").selectOption("50000");
  cards = await cardData();
  assert.ok(cards.length > 0 && cards.every((card) => card.views >= 50000), "Minimum views filter must apply");
  await page.locator("#views-filter").selectOption("0");

  await page.locator("#outliers-filter").check();
  cards = await cardData();
  assert.ok(cards.length > 0 && cards.every((card) => card.metric >= 3), "Outliers-only must use selected metric");
  await page.locator("#metric-filter").selectOption("velocity");
  cards = await cardData();
  assert.ok(cards.length > 0 && cards.every((card) => card.metric >= 3), "Velocity outliers must be recalculated");
  assert.deepEqual(cards.map((card) => card.metric), cards.map((card) => card.metric).sort((a, b) => b - a), "Cards must sort by selected metric");

  await page.locator("#date-filter").selectOption("90");
  await page.locator("#duration-filter").selectOption("short");
  await page.locator("#views-filter").selectOption("10000");
  cards = await cardData();
  assert.ok(cards.every((card) => card.age <= 90 && card.duration < 900 && card.views >= 10000 && card.metric >= 3), "Combined filters must compose");

  await page.locator("[data-refresh]").click();
  await page.waitForFunction(() => document.querySelector("[data-refresh]")?.textContent.includes("Refresh trends"));
  assert.match(await page.locator(".filter-result").textContent(), /refreshed/i, "Refresh should report completion");

  await page.locator("#date-filter").selectOption("all");
  await page.locator("#duration-filter").selectOption("all");
  await page.locator("#views-filter").selectOption("0");
  await page.locator("#outliers-filter").uncheck();
  await page.locator("#metric-filter").selectOption("views");
  await page.screenshot({ path: "C:/Users/partn/AppData/Local/Temp/jonmac-yt-v2-filters.png", fullPage: false });

  await page.locator("[data-remake]").first().click();
  await page.locator("[data-create-project]").click();
  await page.locator("[data-approve-plan]").click();
  await page.locator("[data-approve-script]").click();
  await page.locator("[data-demo-assets]").click();
  await page.locator("[data-start-edit]").click();
  await page.locator("[data-approve-edit]").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector("[data-approve-edit]")?.disabled, null, { timeout: 10000 });
  await page.locator("[data-approve-edit]").click();
  await page.locator("[data-upload-youtube]").click();
  await page.locator(".youtube-success").waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: "C:/Users/partn/AppData/Local/Temp/jonmac-yt-v2-final.png", fullPage: true });

  const result = {
    title: await page.title(),
    url: page.url(),
    heading: await page.locator("h2").first().textContent(),
    success: await page.locator(".youtube-success strong").textContent(),
    projects: await page.evaluate(() => JSON.parse(localStorage.getItem("jonmac_youtube_gen_v2_projects_v1") || "[]").length),
    filtersVerified: ["date", "duration", "minimum views", "outliers only", "metric sorting", "combined filters", "refresh"],
    sourceLinksVerified: ["thumbnail new tab", "external button new tab", "matching YouTube video ID"],
    datesVerified: ["calculated from upload_date", "date filters use calculated age", "June 17 example shows 2mo ago"],
    filtersScreenshot: "C:/Users/partn/AppData/Local/Temp/jonmac-yt-v2-filters.png",
    consoleErrors,
    pageErrors,
    screenshot: "C:/Users/partn/AppData/Local/Temp/jonmac-yt-v2-final.png",
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
  if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
