const MODEL = "gpt-image-2-5-flare-image-to-image";
const PROMPT_VERSION = "source-layout-lock-v6";
const PROTOCOL = "thumbnail-identity-lock-v6";
const JON_REFS = [
  "https://jonmac.ai/yt/cloud-apps/youtube-gen/reference/jon-mac-profile-local.png",
  "https://jonmac.ai/yt/cloud-apps/youtube-gen/reference/jon-mac-profile.png",
  "https://jonmac.ai/yt/cloud-apps/youtube-gen/reference/jon-mac-reaction.png",
];
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PROXY_HOSTS = new Set(["jonmac.ai", "www.jonmac.ai", "i.ytimg.com", "img.youtube.com"]);


function text(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function collectUrls(value, found = new Set(), depth = 0) {
  if (!value || depth > 8) return found;
  let parsed = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { parsed = JSON.parse(trimmed); } catch { parsed = value; }
    }
  }
  if (typeof parsed === "string") {
    const item = parsed.trim();
    if (/^(https?:)?\/\//i.test(item) || item.startsWith("/")) found.add(item);
    return found;
  }
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectUrls(item, found, depth + 1);
    return found;
  }
  if (parsed && typeof parsed === "object") {
    for (const item of Object.values(parsed)) collectUrls(item, found, depth + 1);
  }
  return found;
}

function firstHttpUrl(value) {
  const urls = [...collectUrls(value)];
  if (typeof value === "string") urls.unshift(value);
  for (const candidate of urls) {
    const item = text(candidate);
    if (!item || /^data:|^blob:/i.test(item)) continue;
    try {
      const url = new URL(item.startsWith("//") ? `https:${item}` : item);
      if (["http:", "https:"].includes(url.protocol)) return url.toString();
    } catch {}
  }
  return "";
}

function unwrap(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function taskIdFrom(payload) {
  const queue = [{ value: unwrap(payload), depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const { value, depth } = queue.shift();
    const node = unwrap(value);
    if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) continue;
    seen.add(node);
    for (const [key, nested] of Object.entries(node)) {
      if (["taskid", "jobid"].includes(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
        const id = text(nested);
        if (id) return id;
      }
    }
    for (const nested of Object.values(node)) {
      if (nested && typeof nested === "object") queue.push({ value: nested, depth: depth + 1 });
    }
  }
  return "";
}

function apiKeyFrom(request, env) {
  const header = request.headers.get("x-kie-api-key") || request.headers.get("x-api-key") || "";
  const auth = request.headers.get("authorization") || "";
  return text(env.KIE_API_KEY || env.KIE_AI_API_KEY || env.MU_API_KEY || auth || header)
    .replace(/^Authorization:\s*/i, "")
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "");
}

function enqueue(controller, event) {
  controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
}

function sourceThumb(packageData) {
  const source = packageData.sourceVideos?.[0];
  if (source?.thumbnail?.startsWith("http")) return source.thumbnail;
  if (source?.id) return `https://i.ytimg.com/vi/${encodeURIComponent(source.id)}/hqdefault.jpg`;
  return "";
}

function proxyUrl(request, src) {
  const url = new URL("/yt/api/cloud/youtube-gen/kie-assets/proxy", request.url);
  url.searchParams.set("src", src);
  return url.toString();
}

function allowedMediaUrl(raw) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && PROXY_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function proxyImage(src) {
  if (!allowedMediaUrl(src)) {
    return Response.json({ ok: false, error: "Unsupported media URL." }, { status: 400 });
  }
  const response = await fetch(src, {
    headers: { "user-agent": BROWSER_UA, accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
    redirect: "follow",
  });
  if (!response.ok) {
    return new Response("Media unavailable.", { status: response.status });
  }
  return new Response(response.body, {
    headers: {
      "content-type": response.headers.get("content-type") || "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
}

async function usableSourceUrl(packageData) {
  const source = packageData.sourceVideos?.[0] || {};
  const candidates = [
    source.thumbnail,
    source.id ? `https://i.ytimg.com/vi/${encodeURIComponent(source.id)}/maxresdefault.jpg` : "",
    source.id ? `https://i.ytimg.com/vi/${encodeURIComponent(source.id)}/hqdefault.jpg` : "",
    source.id ? `https://img.youtube.com/vi/${encodeURIComponent(source.id)}/hqdefault.jpg` : "",
  ].filter((value) => String(value || "").startsWith("http"));
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { method: "GET", headers: { "user-agent": BROWSER_UA } });
      if (response.ok) return candidate;
    } catch {}
  }
  return candidates[0] || "";
}


function conflictsWithImageMap(prompt) {
  return /image\s+1\s+is\s+the\s+layout\s+lock/i.test(prompt)
    || /image\s+1\s+is\s+the\s+source\s+thumbnail/i.test(prompt)
    || /reverse\s+engineer\s+image\s+1/i.test(prompt)
    || /swap\s+the\s+visible\s+presenter\/person\s+in\s+image\s+1/i.test(prompt)
    || /using\s+images\s+2-4\s+as\s+identity\s+references/i.test(prompt)
    || /reverse engineer the source thumbnail image into a production-ready/i.test(prompt);
}

function hasMatchingImageMap(prompt) {
  return /image\s+1\s+is\s+the\s+primary\s+jon\s+mac\s+identity\s+reference/i.test(prompt)
    && /image\s+2\s+is\s+the\s+source\s+thumbnail/i.test(prompt);
}

function identityLockPrompt(packageData, index) {
  const source = packageData.sourceVideos?.[0] || {};
  const title = text(packageData.titles?.[index - 1] || packageData.titles?.[0] || source.title, "source thumbnail");
  return [
    "Render one finished 16:9 YouTube thumbnail. Do not output a prompt, description, mockup, or explanation.",
    `Prompt protocol: ${PROTOCOL}.`,
    `Option ${index}.`,
    "Image map for generation: image 1 is the primary Jon Mac identity reference. Image 2 is the source thumbnail and layout lock. Images 3-4 are secondary Jon Mac identity references.",
    "Identity replacement is required, not optional. Preserve Jon Mac facial identity from image 1. Use image 2 only for composition, crop, pose, and text placement.",
    "Do not inherit face identity, brow shape, beard style, hairline, age, or facial likeness from image 2 or the source presenter.",
    "If identity and layout conflict, keep Jon Mac's face from image 1 and loosen layout second. One visible presenter only, and that presenter must be Jon Mac.",
    `Source thumbnail topic to preserve structurally: ${title}.`,
  ].join(" ");
}

function buildPrompt(packageData, index, overrides = {}) {
  const override = text(overrides[String(index)]);
  const stored = text(packageData.thumbnailPrompts?.[index - 1]);
  const candidate = override || stored;
  if (candidate && hasMatchingImageMap(candidate) && !conflictsWithImageMap(candidate)) return candidate;
  const base = identityLockPrompt(packageData, index);
  if (override && !conflictsWithImageMap(override) && !hasMatchingImageMap(override)) {
    return `${base} Requested change: ${override}`;
  }
  return base;
}

async function kie(path, apiKey, init = {}) {
  const response = await fetch(`https://api.kie.ai${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch {
    throw new Error(`Kie returned an invalid response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(text(payload.msg || payload.message || payload.error || raw || `Kie request failed with ${response.status}`).slice(0, 260));
  }
  return payload;
}

async function createTask(request, apiKey, prompt, sourceImageUrl) {
  const source = firstHttpUrl(sourceImageUrl);
  if (!source) throw new Error("Kie needs a public source thumbnail URL before it can generate this thumbnail.");
  const inputUrls = [
    proxyUrl(request, JON_REFS[0]),
    proxyUrl(request, source),
    ...JON_REFS.slice(1).map((url) => proxyUrl(request, url)),
  ];
  const payload = await kie("/api/v1/jobs/createTask", apiKey, {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      input: {
        prompt,
        input_urls: inputUrls,
        aspect_ratio: "16:9",
        resolution: "1K",
        background: "opaque",
      },
    }),
  });
  const id = taskIdFrom(payload);
  if (!id) throw new Error("Kie returned success without a task id.");
  return id;
}

async function waitForTask(apiKey, taskId, onProgress) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const payload = await kie(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, apiKey);
    const state = payload?.data?.state || payload?.state;
    const percent = Number(payload?.data?.progress ?? payload?.progress ?? payload?.data?.percent ?? payload?.percent);
    const fallback = Math.min(96, 12 + Math.round(attempt / 120 * 84));
    onProgress(Number.isFinite(percent) ? percent : fallback, state ? `Kie status: ${state}` : "Waiting for Kie.");
    if (state === "success") {
      const urls = [...collectUrls([
        payload?.data?.resultJson, payload?.resultJson, payload?.data?.resultUrls, payload?.data?.resultUrl,
        payload?.data?.imageUrls, payload?.data?.imageUrl, payload?.data?.images, payload?.data?.output,
        payload?.resultUrls, payload?.imageUrls, payload?.imageUrl, payload?.images, payload?.output,
      ])];
      if (!urls.length) throw new Error("Kie finished, but no image URL was found in the result.");
      return urls;
    }
    if (["fail", "failed", "error"].includes(String(state || "").toLowerCase())) {
      throw new Error(text(payload?.data?.failMsg || payload?.failMsg || payload?.msg || "Kie image generation failed."));
    }
  }
  throw new Error("Kie image generation timed out.");
}

async function persistImages(env, request, urls, taskId, index) {
  const saved = [];
  for (const [offset, rawUrl] of urls.entries()) {
    const url = firstHttpUrl(rawUrl);
    if (!url) continue;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Kie finished, but its image could not be copied to permanent storage (${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024) {
      throw new Error("Kie returned an empty image or one larger than 12 MB.");
    }
    const contentType = response.headers.get("content-type") || "image/png";
    const ext = /jpe?g/i.test(contentType) || /\.jpe?g(?:$|\?)/i.test(url) ? "jpg"
      : /webp/i.test(contentType) || /\.webp(?:$|\?)/i.test(url) ? "webp" : "png";
    const safeTask = taskId.replace(/[^a-z0-9_-]/gi, "").slice(0, 80) || crypto.randomUUID();
    const filename = `${Date.now()}-${safeTask}-${index}-${offset + 1}.${ext}`;
    if (env.UPLOADS) {
      await env.UPLOADS.put(`manual-thumbnails/${filename}`, bytes, {
        httpMetadata: { contentType: contentType.startsWith("image/") ? contentType : `image/${ext === "jpg" ? "jpeg" : ext}` },
        customMetadata: { provider: "kie", taskId: taskId.slice(0, 200) },
      });
      saved.push(`https://jonmac.ai/yt/api/cloud/youtube-gen/manual-thumbnail/file/${filename}`);
    } else {
      saved.push(url);
    }
  }
  if (!saved.length) throw new Error("Kie finished, but no generated image could be saved.");
  return saved;
}

function optionEvent(event, index) {
  return {
    ...event,
    status: "progress",
    optionIndex: index,
    detail: `${text(event.detail)} Option ${index}.`.trim(),
  };
}

async function submitOne(request, apiKey, prompt, sourceUrl, index, onProgress) {
  onProgress({
    status: "progress",
    percent: 4,
    step: "Submitting to GPT Image 2.5",
    detail: `Thumbnail ${index} queued.`,
    optionIndex: index,
    optionStatus: "submitting",
  });
  const taskId = await createTask(request, apiKey, prompt, sourceUrl);
  onProgress({
    status: "progress",
    percent: 12,
    step: "GPT Image 2.5 task queued",
    detail: `Task ${taskId}`,
    optionIndex: index,
    optionStatus: "submitted",
    taskId,
  });
  return { index, prompt, taskId };
}

async function finishOne(env, request, apiKey, job, onProgress) {
  const urls = await waitForTask(apiKey, job.taskId, (percent, detail) => {
    onProgress({
      status: "progress",
      percent,
      step: "Generating thumbnail",
      detail,
      optionIndex: job.index,
      optionStatus: "waiting",
      taskId: job.taskId,
    });
  });
  const saved = await persistImages(env, request, urls, job.taskId, job.index);
  const asset = {
    type: "thumbnail",
    index: job.index,
    prompt: job.prompt,
    urls: saved,
    taskId: job.taskId,
    filename: `youtube-gen-thumbnail-${job.index}.png`,
    promptVersion: PROMPT_VERSION,
  };
  onProgress({
    status: "progress",
    percent: 100,
    step: "Thumbnail ready",
    detail: `Thumbnail ${job.index} generated.`,
    asset,
    optionIndex: job.index,
    optionStatus: "ready",
  });
  return asset;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/proxy")) {
      return proxyImage(url.searchParams.get("src") || "");
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, x-kie-api-key, x-api-key, Authorization",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        },
      });
    }
    if (request.method !== "POST") {
      return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
    }

    const apiKey = apiKeyFrom(request, env);
    if (!apiKey) {
      return Response.json({
        ok: false,
        error: "Kie is not configured in AIOS Hub. Add KIE_API_KEY or MU_API_KEY with wrangler secret put, or save a Kie key in this browser.",
      }, { status: 503 });
    }

    let body;
    try { body = await request.json(); } catch {
      return Response.json({ ok: false, error: "Invalid Kie asset request." }, { status: 400 });
    }

    const packageData = body.package || {};
    const indexes = (body.targets?.thumbnails || [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 5);
    if ((body.targets?.visualHooks || []).length && !indexes.length) {
      return Response.json({ ok: false, error: "Visual hook generation is not wired in the cloud route yet. Generate thumbnails first." }, { status: 501 });
    }
    if (!indexes.length) {
      return Response.json({ ok: false, error: "Choose at least one thumbnail target." }, { status: 400 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const assets = { references: [], thumbnails: [], visualHooks: [] };
        const warnings = [];
        try {
          enqueue(controller, {
            status: "progress",
            percent: 1,
            step: "Starting GPT Image 2.5",
            detail: `Preparing ${indexes.length} thumbnail${indexes.length === 1 ? "" : "s"}.`,
            assets,
          });
          const sourceUrl = await usableSourceUrl(packageData) || sourceThumb(packageData);
          const overrides = body.promptOverrides || {};
          const jobs = await Promise.all(indexes.map(async (index) => {
            try {
              const prompt = buildPrompt(packageData, index, overrides);
              return await submitOne(request, apiKey, prompt, sourceUrl, index, (event) => {
                enqueue(controller, optionEvent(event, index));
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : "Kie image generation failed.";
              warnings.push(`Option ${index}: ${message}`);
              enqueue(controller, {
                status: "progress",
                percent: 12,
                step: "Thumbnail not submitted",
                detail: `Option ${index}: ${message}`,
                optionIndex: index,
                optionStatus: "error",
                error: message,
                assets,
              });
              return null;
            }
          }));
          enqueue(controller, {
            status: "progress",
            percent: 15,
            step: "All thumbnails submitted",
            detail: `Queued ${jobs.filter(Boolean).length} of ${indexes.length} GPT Image 2.5 jobs.`,
            assets,
          });
          await Promise.all(jobs.filter(Boolean).map(async (job) => {
            try {
              const asset = await finishOne(env, request, apiKey, job, (event) => {
                enqueue(controller, optionEvent(event, job.index));
              });
              assets.thumbnails.push(asset);
              assets.thumbnails.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
              enqueue(controller, {
                status: "progress",
                percent: Math.min(99, 18 + Math.round(assets.thumbnails.length / indexes.length * 78)),
                step: "Saved thumbnail",
                detail: `Thumbnail ${job.index} saved.`,
                optionIndex: job.index,
                optionStatus: "ready",
                asset,
                assets,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : "Kie image generation failed.";
              warnings.push(`Option ${job.index}: ${message}`);
              enqueue(controller, {
                status: "progress",
                percent: Math.min(99, 18 + Math.round((assets.thumbnails.length + 1) / indexes.length * 78)),
                step: "Thumbnail not saved",
                detail: `Option ${job.index}: ${message}`,
                optionIndex: job.index,
                optionStatus: "error",
                error: message,
                assets,
              });
            }
          }));
          if (!assets.thumbnails.length) throw new Error(warnings[0] || "Kie image generation failed.");
          enqueue(controller, {
            status: "complete",
            percent: 100,
            step: warnings.length ? "Partial Kie assets complete" : "Kie assets complete",
            detail: warnings.length
              ? `Generated ${assets.thumbnails.length} of ${indexes.length} thumbnails. ${warnings.slice(0, 2).join(" ")}`
              : `Generated ${assets.thumbnails.length} thumbnail${assets.thumbnails.length === 1 ? "" : "s"}.`,
            assets,
            warnings,
          });
        } catch (error) {
          enqueue(controller, {
            status: "error",
            percent: 0,
            step: "Asset generation failed",
            detail: error instanceof Error ? error.message : "Kie asset generation failed.",
            error: error instanceof Error ? error.message : "Kie asset generation failed.",
            assets,
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  },
};
