// jonmac.ai/review: private video review portal (Worker + D1 comments + R2 media).
// Secrets (wrangler secret put, never committed): REVIEW_SHARE_KEY, REVIEW_PASSCODE,
// REVIEW_SESSION_SECRET, REVIEW_API_TOKEN. Missing secrets fail closed with 503.
import { renderGate, renderIndex, renderVideo } from "./pages.js";

export const STATUSES = ["needs_review", "changes_requested", "approved"];
const SECRETS = ["REVIEW_SHARE_KEY", "REVIEW_PASSCODE", "REVIEW_SESSION_SECRET", "REVIEW_API_TOKEN"];
const SESSION_COOKIE = "review_session";
const LINK_COOKIE = "review_link";
const SESSION_DAYS = 90;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const RESERVED = new Set(["login", "media", "api"]);
const enc = new TextEncoder();

export const validSlug = (slug) => typeof slug === "string" && SLUG.test(slug) && !RESERVED.has(slug);

export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0) throw new RangeError("Invalid range");
  const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const last = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (![first, last, ...(match[2] ? [Number(match[2])] : [])].every(Number.isSafeInteger) ||
      first < 0 || first >= size || last < first || (!match[1] && Number(match[2]) === 0)) {
    throw new RangeError("Unsatisfiable range");
  }
  return { offset: first, length: last - first + 1 };
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export async function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Sessions are bound to the passcode and share key, so rotating either signs everyone out.
const sessionMessage = (env, exp) => `session|${exp}|${env.REVIEW_PASSCODE}|${env.REVIEW_SHARE_KEY}`;
export async function makeSession(env, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  return `${exp}.${await hmac(env.REVIEW_SESSION_SECRET, sessionMessage(env, exp))}`;
}
export async function verifySession(env, value, now = Date.now()) {
  const match = /^(\d{1,12})\.([\w-]{43})$/.exec(value || "");
  if (!match || Number(match[1]) * 1000 <= now) return false;
  return safeEqual(match[2], await hmac(env.REVIEW_SESSION_SECRET, sessionMessage(env, match[1])));
}
const linkToken = (env) => hmac(env.REVIEW_SESSION_SECRET, `link|${env.REVIEW_SHARE_KEY}`);

function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const cookie = (name, value, days) =>
  `${name}=${value}; Path=/; Max-Age=${days * 86400}; HttpOnly; Secure; SameSite=Lax`;

async function hasSession(request, env) {
  return verifySession(env, cookies(request)[SESSION_COOKIE]);
}
async function hasLink(request, env, url) {
  const key = url.searchParams.get("k");
  if (key && await safeEqual(key, env.REVIEW_SHARE_KEY)) return true;
  return safeEqual(cookies(request)[LINK_COOKIE], await linkToken(env));
}
async function isAgent(request, env) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") || "");
  return Boolean(match) && safeEqual(match[1], env.REVIEW_API_TOKEN);
}

const SECURITY = {
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}
const html = (body, status = 200, extra = {}) => new Response(body, {
  status,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP, ...extra },
});
const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const fail = (status, error) => json({ error }, status);

async function readJson(request) {
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return null;
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const now = () => new Date().toISOString();

function publicComment(row) {
  return {
    id: row.id, slug: row.slug, author: row.author, t: row.t, text: row.text,
    created_at: row.created_at, resolved: Boolean(row.resolved),
    resolved_at: row.resolved_at || null, resolved_by: row.resolved_by || null,
  };
}

function publicVideo(row, origin) {
  let chapters = [];
  try { chapters = row.chapters ? JSON.parse(row.chapters) : []; } catch {}
  return {
    slug: row.slug, channel: row.channel, video: row.video, version: row.version, title: row.title,
    status: row.status, duration: row.duration, chapters, notes: row.notes || "",
    page_url: `${origin}/review/${row.slug}`,
    video_url: `${origin}/review/media/${row.slug}/video.mp4?v=${mediaTag(row.video_key)}`,
    source_url: row.source_key ? `${origin}/review/media/${row.slug}/source.mp4?v=${mediaTag(row.source_key)}` : null,
    video_size: row.video_size, video_sha256: row.video_sha256,
    open_comments: row.open_count ?? undefined, total_comments: row.total_count ?? undefined,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}
export const mediaTag = (key) => (key || "").split("/").pop().replace(/\.mp4$/, "");

const VIDEO_LIST = `SELECT v.*,
  (SELECT COUNT(*) FROM comments c WHERE c.slug = v.slug AND c.resolved = 0) AS open_count,
  (SELECT COUNT(*) FROM comments c WHERE c.slug = v.slug) AS total_count
  FROM videos v`;

async function listVideos(env) {
  const [channels, videos] = await env.DB.batch([
    env.DB.prepare("SELECT slug, name, sort FROM channels ORDER BY sort, name"),
    env.DB.prepare(`${VIDEO_LIST} ORDER BY v.channel, v.video, v.created_at DESC`),
  ]);
  return { channels: channels.results, videos: videos.results };
}
const getVideo = (env, slug) => env.DB.prepare(`${VIDEO_LIST} WHERE v.slug = ?`).bind(slug).first();

async function streamMedia(request, env, row, kind) {
  const key = kind === "video" ? row.video_key : row.source_key;
  if (!key) return notFound();
  const info = await env.MEDIA.head(key);
  if (!info) return notFound();
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "ETag": info.httpEtag,
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": "inline",
  });
  if (request.headers.get("If-None-Match") === info.httpEtag) return new Response(null, { status: 304, headers });
  let range;
  const ifRange = request.headers.get("If-Range");
  try {
    range = byteRange(!ifRange || ifRange === info.httpEtag ? request.headers.get("Range") : null, info.size);
  } catch {
    headers.set("Content-Range", `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Length", String(range ? range.length : info.size));
  if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${info.size}`);
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const object = await env.MEDIA.get(key, range ? { range } : undefined);
  if (!object) return notFound();
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

async function login(request, env, url) {
  const form = await request.formData().catch(() => null);
  const next = /^\/review(\/[a-z0-9-]{1,80})?$/.test(form?.get("next") || "") ? form.get("next") : "/review";
  const key = form?.get("k") || "";
  const linked = (key && await safeEqual(key, env.REVIEW_SHARE_KEY)) ||
    await safeEqual(cookies(request)[LINK_COOKIE], await linkToken(env));
  if (!linked) return notFound();
  if (!await safeEqual(form.get("passcode") || "", env.REVIEW_PASSCODE)) {
    return html(renderGate({ next, k: key, error: "That passcode is not right." }), 401);
  }
  const headers = new Headers({ Location: next, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, await makeSession(env), SESSION_DAYS));
  headers.append("Set-Cookie", cookie(LINK_COOKIE, await linkToken(env), 365));
  return new Response(null, { status: 303, headers });
}

async function pages(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/review";
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });

  const media = /^\/review\/media\/([^/]+)\/(video|source)\.mp4$/.exec(path);
  if (media) {
    if (!(await hasSession(request, env) || await isAgent(request, env)) || !validSlug(media[1])) return notFound();
    const row = await env.DB.prepare("SELECT video_key, source_key FROM videos WHERE slug = ?").bind(media[1]).first();
    return row ? streamMedia(request, env, row, media[2]) : notFound();
  }

  const slug = path === "/review" ? null : path.slice("/review/".length);
  if (slug !== null && !validSlug(slug)) return notFound();
  if (!await hasSession(request, env)) {
    if (!await hasLink(request, env, url)) return notFound();
    const headers = {};
    if (url.searchParams.has("k")) headers["Set-Cookie"] = cookie(LINK_COOKIE, await linkToken(env), 365);
    return html(renderGate({ next: slug ? `/review/${slug}` : "/review", k: url.searchParams.get("k") || "" }), 200, headers);
  }
  // Signed in: drop the share key from the address bar.
  if (url.searchParams.has("k")) return new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });

  if (slug === null) return html(renderIndex(await listVideos(env)));
  const row = await getVideo(env, slug);
  if (!row) return html(renderIndex(await listVideos(env), `No video called “${slug}”.`), 404);
  const versions = await env.DB.prepare(
    "SELECT slug, version, status, created_at FROM videos WHERE channel = ? AND video = ? ORDER BY created_at DESC",
  ).bind(row.channel, row.video).all();
  const channel = await env.DB.prepare("SELECT name FROM channels WHERE slug = ?").bind(row.channel).first();
  return html(renderVideo(publicVideo(row, ""), versions.results, channel?.name || row.channel));
}

async function api(request, env, url) {
  const agent = await isAgent(request, env);
  const reviewer = !agent && await hasSession(request, env);
  if (!agent && !reviewer) return fail(401, "unauthorized");
  // Cookie-authenticated writes must come from this site (SameSite=Lax plus an Origin check).
  if (reviewer && request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return fail(403, "bad_origin");
  }

  const parts = url.pathname.slice("/api/review/".length).split("/").filter(Boolean).map(decodeURIComponent);
  const method = request.method;
  if (parts.length === 1 && parts[0] === "videos" && method === "GET") {
    const { channels, videos } = await listVideos(env);
    return json({ channels, videos: videos.map((row) => publicVideo(row, url.origin)) });
  }
  const [slug, resource, id, action, extra] = parts;
  if (!validSlug(slug) || extra !== undefined) return fail(404, "not_found");

  if (resource === "uploads" || resource === "publish") {
    if (!agent) return fail(403, "agent_token_required");
    return publishApi(request, env, url, slug, resource, id, action);
  }

  const row = await getVideo(env, slug);
  if (!row) return fail(404, "video_not_found");

  if (resource === undefined && method === "GET") return json({ video: publicVideo(row, url.origin) });

  if (resource === "status" && id === undefined && method === "POST") {
    const body = await readJson(request);
    if (!body || !STATUSES.includes(body.status)) return fail(400, `status must be one of ${STATUSES.join(", ")}`);
    await env.DB.prepare("UPDATE videos SET status = ?, updated_at = ? WHERE slug = ?").bind(body.status, now(), slug).run();
    return json({ slug, status: body.status });
  }

  if (resource !== "comments") return fail(404, "not_found");

  if (id === undefined && method === "GET") {
    const filter = url.searchParams.get("status") || "all";
    if (!["all", "open", "resolved"].includes(filter)) return fail(400, "status must be all, open or resolved");
    const where = filter === "open" ? " AND resolved = 0" : filter === "resolved" ? " AND resolved = 1" : "";
    const rows = await env.DB.prepare(`SELECT * FROM comments WHERE slug = ?${where} ORDER BY t, created_at`).bind(slug).all();
    return json({ video: publicVideo(row, url.origin), comments: rows.results.map(publicComment) });
  }

  if (id === undefined && method === "POST") {
    const body = await readJson(request);
    if (!body) return fail(400, "send JSON with author, t and text");
    const author = text(body.author, 60);
    const note = text(body.text, 4000);
    const t = typeof body.t === "number" ? body.t : Number(body.t);
    const maxT = row.duration ? row.duration + 1 : 86400;
    if (!author) return fail(400, "author is required");
    if (!note) return fail(400, "text is required");
    if (!Number.isFinite(t) || t < 0 || t > maxT) return fail(400, "t must be seconds within the video");
    const comment = { id: crypto.randomUUID(), slug, author, t: Math.round(t * 1000) / 1000, text: note, created_at: now(), resolved: 0 };
    await env.DB.prepare("INSERT INTO comments (id, slug, author, t, text, created_at, resolved) VALUES (?, ?, ?, ?, ?, ?, 0)")
      .bind(comment.id, slug, author, comment.t, note, comment.created_at).run();
    return json({ comment: publicComment(comment) }, 201);
  }

  if (id !== undefined && action === "resolve" && method === "POST") {
    const body = (await readJson(request)) || {};
    const resolved = body.resolved !== false;
    const by = text(body.by, 60) || (agent ? "agent" : "reviewer");
    const result = await env.DB.prepare(
      "UPDATE comments SET resolved = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND slug = ?",
    ).bind(resolved ? 1 : 0, resolved ? now() : null, resolved ? by : null, id, slug).run();
    if (!result.meta.changes) return fail(404, "comment_not_found");
    const updated = await env.DB.prepare("SELECT * FROM comments WHERE id = ?").bind(id).first();
    return json({ comment: publicComment(updated) });
  }

  if (id !== undefined && action === undefined && method === "DELETE") {
    if (!agent) return fail(403, "agent_token_required");
    const result = await env.DB.prepare("DELETE FROM comments WHERE id = ? AND slug = ?").bind(id, slug).run();
    return result.meta.changes ? json({ deleted: id }) : fail(404, "comment_not_found");
  }

  return fail(405, "method_not_allowed");
}

// Publishing (agent token only): chunked R2 multipart upload, then metadata.
//   POST /api/review/<slug>/uploads                         {kind: "video"|"source"} -> {key, uploadId}
//   PUT  /api/review/<slug>/uploads/<uploadId>/<part>?key=  raw bytes                -> {partNumber, etag}
//   POST /api/review/<slug>/uploads/<uploadId>/complete     {key, parts}             -> {key, size}
//   POST /api/review/<slug>/publish                         {channel, video, version, title, video_key, ...}
async function publishApi(request, env, url, slug, resource, uploadId, action) {
  const method = request.method;
  const ownKey = (key) => typeof key === "string" && key.startsWith(`review/${slug}/`) && /^[\w./-]+\.mp4$/.test(key) && !key.includes("..");

  if (resource === "uploads" && uploadId === undefined && method === "POST") {
    const body = await readJson(request);
    if (!body || !["video", "source"].includes(body.kind)) return fail(400, "kind must be video or source");
    const key = `review/${slug}/${body.kind}-${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}.mp4`;
    const upload = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: "video/mp4" } });
    return json({ key, uploadId: upload.uploadId }, 201);
  }

  if (resource === "uploads" && uploadId && /^\d{1,5}$/.test(action || "") && method === "PUT") {
    const key = url.searchParams.get("key");
    const partNumber = Number(action);
    if (!ownKey(key) || partNumber < 1 || partNumber > 10000) return fail(400, "bad key or part number");
    if (!request.body || !request.headers.get("Content-Length")) return fail(411, "Content-Length required");
    const part = await env.MEDIA.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, request.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  }

  if (resource === "uploads" && uploadId && action === "complete" && method === "POST") {
    const body = await readJson(request);
    if (!body || !ownKey(body.key) || !Array.isArray(body.parts) || !body.parts.length) return fail(400, "send key and parts");
    const parts = body.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }));
    const object = await env.MEDIA.resumeMultipartUpload(body.key, uploadId).complete(parts);
    return json({ key: object.key, size: object.size, etag: object.httpEtag });
  }

  if (resource === "uploads" && uploadId && action === undefined && method === "DELETE") {
    const key = url.searchParams.get("key");
    if (!ownKey(key)) return fail(400, "bad key");
    await env.MEDIA.resumeMultipartUpload(key, uploadId).abort();
    return json({ aborted: uploadId });
  }

  if (resource === "publish" && uploadId === undefined && method === "POST") {
    const body = await readJson(request);
    if (!body) return fail(400, "send JSON metadata");
    const channel = text(body.channel, 40).toLowerCase();
    const video = text(body.video, 80).toLowerCase();
    const version = text(body.version, 40);
    const title = text(body.title, 200);
    const status = body.status === undefined ? "needs_review" : body.status;
    if (!validSlug(channel) || !validSlug(video) || !version || !title) return fail(400, "channel, video, version and title are required (lowercase slugs)");
    if (!STATUSES.includes(status)) return fail(400, "bad status");
    if (!ownKey(body.video_key) || (body.source_key != null && !ownKey(body.source_key))) return fail(400, "keys must come from this slug's uploads");
    const videoInfo = await env.MEDIA.head(body.video_key);
    if (!videoInfo) return fail(400, "video_key was not uploaded");
    if (body.source_key && !await env.MEDIA.head(body.source_key)) return fail(400, "source_key was not uploaded");
    const duration = Number(body.duration);
    const chapters = Array.isArray(body.chapters)
      ? JSON.stringify(body.chapters.filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0]))).slice(0, 100).map((c) => [Number(c[0]), text(String(c[1] ?? ""), 120)]))
      : null;
    const previous = await env.DB.prepare("SELECT video_key, source_key FROM videos WHERE slug = ?").bind(slug).first();
    const stamp = now();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO channels (slug, name, sort) VALUES (?, ?, 100)")
        .bind(channel, text(body.channel_name, 60) || channel.charAt(0).toUpperCase() + channel.slice(1)),
      env.DB.prepare(`INSERT INTO videos (slug, channel, video, version, title, status, video_key, video_size, video_sha256,
          source_key, duration, chapters, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET channel = excluded.channel, video = excluded.video, version = excluded.version,
          title = excluded.title, status = excluded.status, video_key = excluded.video_key, video_size = excluded.video_size,
          video_sha256 = excluded.video_sha256, source_key = excluded.source_key, duration = excluded.duration,
          chapters = excluded.chapters, notes = excluded.notes, updated_at = excluded.updated_at`)
        .bind(slug, channel, video, version, title, status, body.video_key, videoInfo.size,
          /^[a-f0-9]{64}$/.test(body.video_sha256 || "") ? body.video_sha256 : null,
          body.source_key || null, Number.isFinite(duration) && duration > 0 ? duration : null,
          chapters, text(body.notes, 2000) || null, stamp, stamp),
    ]);
    const stale = [previous?.video_key, previous?.source_key].filter((k) => k && k !== body.video_key && k !== body.source_key);
    if (stale.length) await env.MEDIA.delete(stale);
    return json({ video: publicVideo(await getVideo(env, slug), url.origin) }, previous ? 200 : 201);
  }

  return fail(405, "method_not_allowed");
}

async function asset(request, env, url) {
  const name = url.pathname.slice("/review/_/".length);
  if (!["app.js", "app.css"].includes(name)) return notFound();
  const response = await env.ASSETS.fetch(new Request(new URL(`/${name}`, url), { method: request.method }));
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(response.body, { status: response.status, headers });
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/review/_/")) return asset(request, env, url);
  const isApi = url.pathname.startsWith("/api/review/");
  if (!isApi && url.pathname !== "/review" && !url.pathname.startsWith("/review/")) return notFound();
  if (SECRETS.some((name) => !env[name] || env[name].length < 8)) {
    return isApi ? fail(503, "not_configured") : new Response("Review portal is not configured.", { status: 503 });
  }
  if (isApi) return api(request, env, url);
  if (url.pathname === "/review/login") return request.method === "POST" ? login(request, env, url) : notFound();
  return pages(request, env, url);
}

export default {
  async fetch(request, env) {
    let response;
    try {
      response = await route(request, env);
    } catch (error) {
      console.error("review portal error", error?.stack || error);
      response = json({ error: "server_error" }, 500);
    }
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY)) headers.set(name, value);
    const version = env.REVIEW_VERSION;
    if (version) headers.set("X-Review-Version", version.tag || version.id || "");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
