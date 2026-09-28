import test from "node:test";
import assert from "node:assert/strict";
import worker from "./ytgen-kie-assets-worker.js";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const realSetTimeout = setTimeout;
const LEGACY_LAYOUT_LOCK_PROMPT = "Reverse engineer the source thumbnail image into a production-ready YouTube thumbnail prompt, then render that thumbnail for Jon Mac. Imported source thumbnail reference: https://i.ytimg.com/vi/_bC_-BW0Z5A/maxresdefault.jpg. Image 1 is the layout lock. Recreate the same composition, crop, subject placement, text-block locations, icon/logo areas, background style, and visual hierarchy. Swap any visible presenter/person with Jon Mac from the reference images while keeping the same pose, scale, crop, and lighting. If the source has no presenter, do not add one.";
const SOURCE_THUMB = "https://i.ytimg.com/vi/_bC_-BW0Z5A/maxresdefault.jpg";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function optionIndexFromPrompt(prompt) {
  const match = String(prompt || "").match(/option-(\d+)/i) || String(prompt || "").match(/Option\s+(\d+)/i);
  return Number(match?.[1] || 0);
}

function unwrapSrc(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("src") || parsed.toString();
  } catch {
    return String(url || "");
  }
}

function installFetch(options = {}) {
  const {
    createDelayMs = {},
    succeedOnPoll = {},
    failOn = {},
  } = options;
  const log = { creates: [], recordInfo: [], successAt: [], payloads: [], seq: 0 };
  const stamp = () => {
    log.seq += 1;
    return log.seq;
  };

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes("/api/v1/jobs/createTask")) {
      const body = JSON.parse(init.body || "{}");
      const prompt = String(body?.input?.prompt || "");
      const index = optionIndexFromPrompt(prompt);
      const delay = Number(createDelayMs[index] || 0);
      if (delay) await new Promise((resolve) => realSetTimeout(resolve, delay));
      log.payloads.push(body);
      log.creates.push({ index, seq: stamp(), prompt, imageInput: body?.input?.image_input || [] });
      return json({ data: { taskId: `task-${index || log.creates.length}` } });
    }
    if (href.includes("/api/v1/jobs/recordInfo")) {
      const taskId = new URL(href).searchParams.get("taskId") || "";
      const index = Number(String(taskId).replace("task-", "") || 0);
      const count = log.recordInfo.filter((row) => row.index === index).length + 1;
      log.recordInfo.push({ index, seq: stamp(), count });
      if (failOn[index]) {
        return json({ data: { state: "fail", failMsg: failOn[index] } });
      }
      if (count >= Number(succeedOnPoll[index] || 1)) {
        log.successAt.push({ index, seq: stamp() });
        return json({
          data: {
            state: "success",
            resultUrls: [`https://img.example.test/${index}.png`],
          },
        });
      }
      return json({ data: { state: "waiting", progress: 40 } });
    }
    return new Response(PNG, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  return log;
}

function restoreFetch() {
  globalThis.setTimeout = realSetTimeout;
}

function zeroPollDelay() {
  globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms === 3000) return realSetTimeout(fn, 0, ...args);
    return realSetTimeout(fn, ms, ...args);
  };
}

async function readEvents(response) {
  const text = await response.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function requestBody(overrides = {}) {
  return {
    package: {
      sourceVideos: [{
        id: "_bC_-BW0Z5A",
        title: "Source",
        thumbnail: SOURCE_THUMB,
      }],
      titles: ["t1", "t2", "t3", "t4", "t5"],
      thumbnailPrompts: ["option-1", "option-2", "option-3", "option-4", "option-5"],
    },
    targets: { thumbnails: [1, 2, 3, 4, 5] },
    ...overrides,
  };
}

async function runWorker(body = requestBody()) {
  const response = await worker.fetch(new Request("https://jonmac.ai/yt/api/cloud/youtube-gen/kie-assets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kie-api-key": "test-key",
    },
    body: JSON.stringify(body),
  }), {
    UPLOADS: { put: async () => {} },
  });
  const events = await readEvents(response);
  return { response, events };
}

function firstAssets(events) {
  const seen = new Set();
  const first = [];
  for (const event of events) {
    const index = Number(event.asset?.index || 0);
    if (!index || seen.has(index)) continue;
    seen.add(index);
    first.push(index);
  }
  return first;
}

test("generate-all submits all 5 jobs before any job completes", async (t) => {
  t.after(restoreFetch);
  zeroPollDelay();
  const log = installFetch({
    createDelayMs: { 1: 0, 2: 25, 3: 50, 4: 75, 5: 100 },
  });
  const { events } = await runWorker();
  const complete = events.find((event) => event.status === "complete");
  assert.equal(log.creates.length, 5);
  assert.deepEqual(log.creates.map((row) => row.index).sort(), [1, 2, 3, 4, 5]);
  assert.ok(log.successAt.length >= 1, "at least one job completed");
  const lastCreateSeq = Math.max(...log.creates.map((row) => row.seq));
  const firstSuccessSeq = Math.min(...log.successAt.map((row) => row.seq));
  assert.ok(
    lastCreateSeq < firstSuccessSeq,
    `all 5 createTask calls must finish before any success (lastCreate=${lastCreateSeq}, firstSuccess=${firstSuccessSeq})`,
  );
  assert.equal(complete?.assets?.thumbnails?.length, 5);
});

test("out-of-order completion emits the fast option before slower ones", async (t) => {
  t.after(restoreFetch);
  zeroPollDelay();
  installFetch({
    succeedOnPoll: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 1 },
  });
  const { events } = await runWorker();
  const first = firstAssets(events);
  assert.equal(first[0], 5);
  assert.deepEqual([...first].sort(), [1, 2, 3, 4, 5]);
});

test("one failed option does not block the other four", async (t) => {
  t.after(restoreFetch);
  zeroPollDelay();
  installFetch({ failOn: { 3: "provider rejected option 3" } });
  const { events } = await runWorker();
  const complete = events.find((event) => event.status === "complete");
  const failed = events.filter((event) => String(event.detail || "").includes("Option 3"));
  const indexes = (complete?.assets?.thumbnails || []).map((asset) => asset.index).sort();
  assert.deepEqual(indexes, [1, 2, 4, 5]);
  assert.ok(failed.length >= 1);
  assert.equal(events.some((event) => event.status === "error"), false);
});

test("legacy Image-1-layout-lock prompt cannot ship against identity-first image_input", async (t) => {
  t.after(restoreFetch);
  zeroPollDelay();
  const log = installFetch();
  await runWorker({
    package: {
      sourceVideos: [{
        id: "_bC_-BW0Z5A",
        title: "Poppy Content Machine",
        thumbnail: SOURCE_THUMB,
      }],
      titles: ["t1", "t2", "t3", "t4", "t5"],
      thumbnailPrompts: Array.from({ length: 5 }, () => LEGACY_LAYOUT_LOCK_PROMPT),
    },
    targets: { thumbnails: [4] },
  });
  assert.equal(log.payloads.length, 1);
  const body = log.payloads[0];
  const input = body.input;
  const prompt = String(input.prompt || "");
  assert.equal(body.model, "gpt-image-2-5-flare-image-to-image");
  assert.equal(Object.hasOwn(input, "image_input"), false);
  assert.equal(body.model.includes("nano"), false);
  const images = (input.input_urls || []).map(unwrapSrc);
  assert.equal(input.aspect_ratio, "16:9");
  assert.equal(input.resolution, "1K");
  assert.equal(input.background, "opaque");
  assert.match(images[0], /jon-mac-profile-local/);
  assert.match(images[1], /_bC_-BW0Z5A/);
  assert.match(images[2], /jon-mac-profile\.png/);
  assert.match(images[3], /jon-mac-reaction/);
  assert.equal(/image 1 is the layout lock/i.test(prompt), false);
  assert.match(prompt, /image 1 is the primary Jon Mac identity reference/i);
  assert.match(prompt, /image 2 is the source thumbnail and layout lock/i);
  assert.match(prompt, /Render one finished 16:9 YouTube thumbnail/i);
  assert.match(prompt, /Do not inherit face identity/i);
  assert.match(prompt, /Identity replacement is required/i);
});
