// jonmac.ai/review: private video review portal (Worker + D1 comments + R2 media).
// Secrets (wrangler secret put, never committed): REVIEW_SHARE_KEY, REVIEW_PASSCODE,
// REVIEW_SESSION_SECRET, REVIEW_API_TOKEN. Missing secrets fail closed with 503.
// jonmac.ai/dashboard/review serves these same pages under the dashboard sign-in (see caller()).
import { INK, renderGate, renderIndex, renderVideo } from "./pages.js";

export const STATUSES = ["needs_review", "changes_requested", "approved"];
const SECRETS = ["REVIEW_SHARE_KEY", "REVIEW_PASSCODE", "REVIEW_SESSION_SECRET", "REVIEW_API_TOKEN"];
const SESSION_COOKIE = "review_session";
const LINK_COOKIE = "review_link";
const SESSION_DAYS = 30;
const LINK_DAYS = 30;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const RESERVED = new Set(["login", "media", "api", "submissions", "videos"]);
const KINDS = { changes: "changes_requested", approve: "approved" };
const TOOLS = ["pen", "arrow", "box"];
// Voice notes as MediaRecorder makes them (iPhone Safari mp4/AAC, Chrome webm/Opus, Firefox ogg/Opus),
// checked by their first bytes as well as the type the browser claims.
const VOICE = {
  "audio/webm": { ext: "webm", ok: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  "audio/mp4": { ext: "m4a", ok: (b) => String.fromCharCode(...b.subarray(4, 8)) === "ftyp" },
  "audio/ogg": { ext: "ogg", ok: (b) => String.fromCharCode(...b.subarray(0, 4)) === "OggS" },
};
const VOICE_MAX = 5 * 1024 * 1024;
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

// A drawing as the client sends it, checked and rewritten: 1 to 50 shapes (a pen has 2 to 1000 points,
// an arrow or a box exactly 2, at most 5000 in all), one of the five colours, every coordinate 0 to 1
// rounded to 4 places. Anything else throws, so nothing unchecked is stored or drawn.
export function parseDrawing(value) {
  if (value == null || value === "") return null;
  let drawing = value;
  if (typeof drawing === "string") {
    if (drawing.length > 65536) throw new RangeError("drawing is too big");
    try { drawing = JSON.parse(drawing); } catch { throw new RangeError("drawing must be JSON"); }
  }
  const shapes = drawing && typeof drawing === "object" ? drawing.shapes : null;
  if (!Array.isArray(shapes) || !shapes.length || shapes.length > 50) throw new RangeError("drawing needs 1 to 50 shapes");
  let total = 0;
  const coord = (n) => {
    if (typeof n !== "number" || !(n >= 0 && n <= 1)) throw new RangeError("drawing points must be from 0 to 1");
    return Math.round(n * 1e4) / 1e4;
  };
  const out = shapes.map((s) => {
    const max = s?.tool === "pen" ? 1000 : 2;
    if (!TOOLS.includes(s?.tool) || !Object.hasOwn(INK, s.color) || !Array.isArray(s.points) || s.points.length < 2 || s.points.length > max) {
      throw new RangeError("each shape must be a pen, arrow or box in one of the five colours");
    }
    total += s.points.length;
    return { tool: s.tool, color: s.color, points: s.points.map((p) => {
      if (!Array.isArray(p) || p.length !== 2) throw new RangeError("each point must be [x, y]");
      return [coord(p[0]), coord(p[1])];
    }) };
  });
  if (total > 5000) throw new RangeError("drawing has too many points");
  return { v: 1, shapes: out };
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
// Production always runs on https (see route); only local http test servers drop Secure.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const cookie = (url, name, value, days) =>
  `${name}=${value}; Path=/; Max-Age=${days * 86400}; HttpOnly;${url.protocol === "https:" ? " Secure;" : ""} SameSite=Lax`;

async function hasSession(request, env) {
  return verifySession(env, cookies(request)[SESSION_COOKIE]);
}
async function isAgent(request, env) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") || "");
  return Boolean(match) && safeEqual(match[1], env.REVIEW_API_TOKEN);
}
// The dashboard Worker checks Jon's dashboard sign-in, then forwards to this Worker over a service binding
// with the agent token and X-Review-Via: dashboard (cloud-apps/command-center/src/videoreview.js). That is a
// reviewer, never an agent, and its links start with /dashboard. The header alone, without the token, is ignored.
async function caller(request, env) {
  const token = await isAgent(request, env);
  const dashboard = token && request.headers.get("X-Review-Via") === "dashboard";
  return { agent: token && !dashboard, reviewer: dashboard || (!token && await hasSession(request, env)), prefix: dashboard ? "/dashboard" : "" };
}

const SECURITY = {
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
// WebKit's native video controls inject inline styles that a page CSP would block (console error).
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}
// no-transform keeps Cloudflare's zone-level Web Analytics beacon out of the private pages
// (it would also trip the CSP and log console errors).
const html = (body, status = 200, extra = {}) => new Response(body, {
  status,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, no-transform", "Content-Security-Policy": CSP, ...extra },
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

// A multipart form, keeping at most `max` bytes (null past that; the rest is read and dropped so the client
// gets the 413). Content-Length can't be trusted to be there: a service binding or a chunked upload may drop it.
async function readForm(request, max) {
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  for (let part = reader && await reader.read(); part && !part.done; part = await reader.read()) {
    size += part.value.byteLength;
    if (size <= max) chunks.push(part.value);
  }
  if (size > max) return null;
  const bytes = new Uint8Array(size);
  chunks.reduce((at, chunk) => (bytes.set(chunk, at), at + chunk.byteLength), 0);
  return new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") } }).formData().catch(() => undefined);
}

const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const now = () => new Date().toISOString();

function publicComment(row, base) {
  let drawing = null;
  try { drawing = row.drawing ? JSON.parse(row.drawing) : null; } catch {}
  return {
    id: row.id, slug: row.slug, author: row.author, t: row.t, text: row.text,
    created_at: row.created_at, resolved: Boolean(row.resolved),
    resolved_at: row.resolved_at || null, resolved_by: row.resolved_by || null,
    sent: Boolean(row.submission_id), submission_id: row.submission_id || null,
    drawing, transcript: row.transcript || null,
    audio_url: row.audio_key ? `${base}/api/review/${row.slug}/comments/${row.id}/audio` : null,
  };
}

function publicSubmission(row, origin) {
  let ids = [];
  try { ids = JSON.parse(row.comment_ids || "[]"); } catch {}
  return {
    id: row.id, slug: row.slug, kind: row.kind, created_at: row.created_at,
    comment_ids: ids, comment_count: ids.length,
    delivered_at: row.delivered_at || null, delivered_to: row.delivered_to || null,
    result_slug: row.result_slug || null, result_url: row.result_slug ? `${origin}/review/${row.result_slug}` : null,
  };
}
const slugSubmissions = (env, slug, limit = 50) =>
  env.DB.prepare("SELECT * FROM submissions WHERE slug = ? ORDER BY created_at DESC LIMIT ?").bind(slug, limit).all();

function publicVideo(row, origin) {
  let chapters = [], sync = [];
  try { chapters = row.chapters ? JSON.parse(row.chapters) : []; } catch {}
  try { sync = row.sync_map ? JSON.parse(row.sync_map) : []; } catch {}
  return {
    slug: row.slug, channel: row.channel, video: row.video, version: row.version, title: row.title,
    status: row.status, duration: row.duration, chapters, sync, notes: row.notes || "",
    page_url: `${origin}/review/${row.slug}`,
    video_url: `${origin}/review/media/${row.slug}/video.mp4?v=${mediaTag(row.video_key)}`,
    source_url: row.source_key ? `${origin}/review/media/${row.slug}/source.mp4?v=${mediaTag(row.source_key)}` : null,
    compare_url: row.compare_key ? `${origin}/review/media/${row.slug}/compare.mp4?v=${mediaTag(row.compare_key)}` : null,
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

async function streamMedia(request, env, key, type) {
  if (!key) return notFound();
  const info = await env.MEDIA.head(key);
  if (!info) return notFound();
  const headers = new Headers({
    "Content-Type": type,
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

const safeNext = (value) => /^\/review(\/[a-z0-9-]{1,80})?$/.test(value || "") ? value : "/review";
const redirect = (location, headers = {}) =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", ...headers } });

// Signed-out visitors always land on the passcode page, with or without a share key; a missing
// or wrong key never 404s. A valid key is remembered in a cookie (30 days) once they sign in.
function loginRedirect(path, key) {
  const query = new URLSearchParams({ next: safeNext(path) });
  if (key) query.set("k", key);
  return redirect(`/review/login?${query}`);
}

async function login(request, env, url) {
  if (request.method === "GET" || request.method === "HEAD") {
    const next = safeNext(url.searchParams.get("next"));
    if (await hasSession(request, env)) return redirect(next);
    return html(renderGate({ next, k: url.searchParams.get("k") || "" }));
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get("next"));
  const key = form?.get("k") || "";
  if (!await safeEqual(form?.get("passcode") || "", env.REVIEW_PASSCODE)) {
    return html(renderGate({ next, k: key, error: "That passcode is not right." }), 401);
  }
  const headers = new Headers({ Location: next, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookie(url, SESSION_COOKIE, await makeSession(env), SESSION_DAYS));
  if (key && await safeEqual(key, env.REVIEW_SHARE_KEY)) {
    headers.append("Set-Cookie", cookie(url, LINK_COOKIE, await linkToken(env), LINK_DAYS));
  }
  return new Response(null, { status: 303, headers });
}

async function pages(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/review";
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });

  const who = await caller(request, env);
  const media = /^\/review\/media\/([^/]+)\/(video|source|compare)\.mp4$/.exec(path);
  if (media) {
    if (!who.reviewer && !who.agent) {
      return new Response("Sign in at /review first.", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (!validSlug(media[1])) return notFound();
    const row = await env.DB.prepare("SELECT video_key, source_key, compare_key FROM videos WHERE slug = ?").bind(media[1]).first();
    return row ? streamMedia(request, env, row[`${media[2]}_key`], "video/mp4") : notFound();
  }

  const slug = path === "/review" ? null : path.slice("/review/".length);
  if (!who.reviewer) return loginRedirect(path, url.searchParams.get("k"));
  if (slug !== null && !validSlug(slug)) return notFound();
  // Signed in: drop the share key from the address bar.
  if (url.searchParams.has("k")) return redirect(who.prefix + path);

  if (slug === null) return html(renderIndex(await listVideos(env), "", who.prefix));
  const row = await getVideo(env, slug);
  if (!row) return html(renderIndex(await listVideos(env), `No video called “${slug}”.`, who.prefix), 404);
  const versions = await env.DB.prepare(
    "SELECT slug, version, status, created_at FROM videos WHERE channel = ? AND video = ? ORDER BY created_at DESC",
  ).bind(row.channel, row.video).all();
  const channel = await env.DB.prepare("SELECT name FROM channels WHERE slug = ?").bind(row.channel).first();
  const submissions = (await slugSubmissions(env, slug, 10)).results.map((s) => publicSubmission(s, who.prefix));
  return html(renderVideo(publicVideo(row, who.prefix), versions.results, channel?.name || row.channel, submissions, who.prefix));
}

async function api(request, env, url) {
  const who = await caller(request, env);
  const { agent, reviewer } = who;
  if (!agent && !reviewer) return fail(401, "unauthorized");
  const base = url.origin + who.prefix;
  // Cookie-authenticated writes must come from this site (SameSite=Lax plus an Origin check).
  if (reviewer && request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return fail(403, "bad_origin");
  }

  const parts = url.pathname.slice("/api/review/".length).split("/").filter(Boolean).map(decodeURIComponent);
  const method = request.method;
  if (parts.length === 1 && parts[0] === "videos" && method === "GET") {
    const { channels, videos } = await listVideos(env);
    return json({ channels, videos: videos.map((row) => publicVideo(row, base)) });
  }
  if (parts[0] === "submissions") {
    if (!agent) return fail(403, "agent_token_required");
    return routerApi(request, env, url, parts.slice(1));
  }
  const [slug, resource, id, action, extra] = parts;
  if (!validSlug(slug) || extra !== undefined) return fail(404, "not_found");

  if (resource === "uploads" || resource === "publish" || resource === "source") {
    if (!agent) return fail(403, "agent_token_required");
    return publishApi(request, env, url, slug, resource, id, action);
  }

  const row = await getVideo(env, slug);
  if (!row) return fail(404, "video_not_found");

  if (resource === undefined && method === "GET") return json({ video: publicVideo(row, base) });
  if (resource === undefined && method === "DELETE") {
    if (!agent) return fail(403, "agent_token_required");
    return deleteVideo(env, row);
  }

  if (resource === "submit" && id === undefined && method === "POST") return submit(request, env, base, row, who);
  if (resource === "submissions" && id === undefined && method === "GET") {
    return json({ submissions: (await slugSubmissions(env, slug)).results.map((s) => publicSubmission(s, base)) });
  }
  if (resource === "next" && id === undefined && method === "POST") {
    if (!agent) return fail(403, "agent_token_required");
    return nextVersion(request, env, url, slug);
  }

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
    return json({ video: publicVideo(row, base), comments: rows.results.map((c) => publicComment(c, base)) });
  }

  // A comment: JSON {author, t, text, drawing?}, or a multipart form with the same fields plus an audio file
  // (a voice note). Text may be empty when there is a drawing or a voice note.
  if (id === undefined && method === "POST") {
    const form = /^multipart\/form-data\b/i.test(request.headers.get("Content-Type") || "");
    const fields = form ? await readForm(request, VOICE_MAX + 65536) : null;
    if (fields === null && form) return fail(413, "Voice notes are limited to 5 MB");
    const body = form ? fields && Object.fromEntries(["author", "t", "text", "drawing"].map((k) => [k, fields.get(k) ?? undefined])) : await readJson(request);
    if (!body) return fail(400, "send JSON with author, t and text");
    const author = text(body.author, 60);
    const note = text(body.text, 4000);
    const t = typeof body.t === "number" ? body.t : Number(body.t);
    const maxT = row.duration ? row.duration + 1 : 86400;
    let drawing;
    try { drawing = parseDrawing(body.drawing); } catch (error) { return fail(400, error.message); }
    const file = typeof fields?.get("audio") === "object" ? fields.get("audio") : null;
    const type = String(file?.type || "").split(";")[0].trim().toLowerCase();
    if (file && !Object.hasOwn(VOICE, type)) return fail(415, "A voice note must be audio/webm, audio/mp4 or audio/ogg");
    if (file && (!file.size || file.size > VOICE_MAX)) return fail(413, "Voice notes are limited to 5 MB");
    if (!author) return fail(400, "author is required");
    if (!note && !drawing && !file) return fail(400, "text is required");
    if (!Number.isFinite(t) || t < 0 || t > maxT) return fail(400, "t must be seconds within the video");
    const comment = {
      id: crypto.randomUUID(), slug, author, t: Math.round(t * 1000) / 1000, text: note, created_at: now(), resolved: 0,
      drawing: drawing ? JSON.stringify(drawing) : null, audio_key: null, audio_type: null,
    };
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!VOICE[type].ok(bytes)) return fail(415, "That file is not the audio type it says it is");
      comment.audio_key = `review/${slug}/voice/${comment.id}.${VOICE[type].ext}`;
      comment.audio_type = type;
      await env.MEDIA.put(comment.audio_key, bytes, { httpMetadata: { contentType: type } });
    }
    await env.DB.prepare("INSERT INTO comments (id, slug, author, t, text, created_at, resolved, drawing, audio_key, audio_type) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)")
      .bind(comment.id, slug, author, comment.t, note, comment.created_at, comment.drawing, comment.audio_key, comment.audio_type).run();
    return json({ comment: publicComment(comment, base) }, 201);
  }

  // GET /api/review/<slug>/comments/<id>/audio: the voice note, with byte ranges (Safari plays audio by range).
  if (id !== undefined && action === "audio" && (method === "GET" || method === "HEAD")) {
    const voice = await env.DB.prepare("SELECT audio_key, audio_type FROM comments WHERE id = ? AND slug = ?").bind(id, slug).first();
    return voice?.audio_key ? streamMedia(request, env, voice.audio_key, voice.audio_type) : fail(404, "no_voice_note");
  }

  // POST /api/review/<slug>/comments/<id>/transcript {text} (agent token only): scripts/review_voice.mjs posts
  // what Parakeet heard in the voice note.
  if (id !== undefined && action === "transcript" && method === "POST") {
    if (!agent) return fail(403, "agent_token_required");
    const words = text((await readJson(request))?.text, 8000);
    if (!words) return fail(400, "text is required");
    const result = await env.DB.prepare("UPDATE comments SET transcript = ? WHERE id = ? AND slug = ? AND audio_key IS NOT NULL")
      .bind(words, id, slug).run();
    if (!result.meta.changes) return fail(404, "no_voice_note");
    return json({ comment: publicComment(await env.DB.prepare("SELECT * FROM comments WHERE id = ?").bind(id).first(), base) });
  }

  if (id !== undefined && action === "resolve" && method === "POST") {
    const body = (await readJson(request)) || {};
    const resolved = body.resolved !== false;
    const by = text(body.by, 60) || (agent ? "agent" : "reviewer");
    // Comments sent to the agent are locked for reviewers; the agent resolves them when fixed.
    const current = await env.DB.prepare("SELECT submission_id FROM comments WHERE id = ? AND slug = ?").bind(id, slug).first();
    if (current?.submission_id && !agent) return fail(409, "This comment was already sent to the agent.");
    const result = await env.DB.prepare(
      "UPDATE comments SET resolved = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND slug = ?",
    ).bind(resolved ? 1 : 0, resolved ? now() : null, resolved ? by : null, id, slug).run();
    if (!result.meta.changes) return fail(404, "comment_not_found");
    const updated = await env.DB.prepare("SELECT * FROM comments WHERE id = ?").bind(id).first();
    return json({ comment: publicComment(updated, base) });
  }

  if (id !== undefined && action === undefined && method === "DELETE") {
    if (!agent) return fail(403, "agent_token_required");
    const voice = await env.DB.prepare("SELECT audio_key FROM comments WHERE id = ? AND slug = ?").bind(id, slug).first();
    const result = await env.DB.prepare("DELETE FROM comments WHERE id = ? AND slug = ?").bind(id, slug).run();
    if (voice?.audio_key) await env.MEDIA.delete(voice.audio_key).catch((err) => console.error("voice note delete", err)); // the comment is gone either way
    return result.meta.changes ? json({ deleted: id }) : fail(404, "comment_not_found");
  }

  return fail(405, "method_not_allowed");
}

// Submit changes / Approve (reviewer session or agent). Snapshots the open, unsent comments, locks
// them to this submission and sets the video status, all in one transaction. The dedupe key
// (slug, kind, sorted comment ids) is UNIQUE, so a double tap returns the first row, never a second.
async function submit(request, env, base, row, who = {}) {
  const body = (await readJson(request)) || {};
  const kind = body.kind === undefined ? "changes" : body.kind;
  if (!Object.hasOwn(KINDS, kind)) return fail(400, "kind must be changes or approve");
  if (kind === "approve" && who.agent) return fail(403, "only_a_reviewer_can_approve"); // Approve finishes the card; only Jon does that
  const open = await env.DB.prepare(
    "SELECT id FROM comments WHERE slug = ? AND resolved = 0 AND submission_id IS NULL ORDER BY t, created_at",
  ).bind(row.slug).all();
  const ids = open.results.map((c) => c.id);
  if (kind === "changes" && !ids.length) return fail(400, "Add a comment first");
  const dedupe = `${row.slug}|${kind}|${[...ids].sort().join(",")}`;
  const id = crypto.randomUUID();
  const stamp = now();
  // The dashboard already tells the owner of this Send back (its card wake): stored as delivered, the GPU2 router skips it.
  const told = who.prefix === "/dashboard" && request.headers.get("X-Review-Delivered-To") === "dashboard";
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO submissions (id, slug, kind, created_at, comment_ids, dedupe_key, delivered_at, delivered_to)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, row.slug, kind, stamp, JSON.stringify(ids), dedupe, told ? stamp : null, told ? "dashboard" : null),
    env.DB.prepare(`UPDATE comments SET submission_id = ?1 WHERE slug = ?2 AND submission_id IS NULL
        AND id IN (SELECT value FROM json_each(?3)) AND EXISTS (SELECT 1 FROM submissions WHERE id = ?1)`)
      .bind(id, row.slug, JSON.stringify(ids)),
    env.DB.prepare("UPDATE videos SET status = ?, updated_at = ? WHERE slug = ?").bind(KINDS[kind], stamp, row.slug),
  ]);
  const saved = await env.DB.prepare("SELECT * FROM submissions WHERE dedupe_key = ?").bind(dedupe).first();
  const duplicate = saved.id !== id;
  return json({ submission: publicSubmission(saved, base), status: KINDS[kind], duplicate }, duplicate ? 200 : 201);
}

// The GPU2 router (agent token only):
//   GET  /api/review/submissions?undelivered=1   oldest first, with each comment's time and text
//   POST /api/review/submissions/<id>/delivered  {to, at}
async function routerApi(request, env, url, [id, action, extra]) {
  const method = request.method;
  if (id === undefined && method === "GET") {
    const undelivered = url.searchParams.get("undelivered") === "1";
    const rows = (await env.DB.prepare(`SELECT s.*, v.title, v.channel, v.version, v.status FROM submissions s
        JOIN videos v ON v.slug = s.slug ${undelivered ? "WHERE s.delivered_at IS NULL ORDER BY s.created_at" : "ORDER BY s.created_at DESC"} LIMIT 100`).all()).results;
    const ids = rows.flatMap((r) => publicSubmission(r, url.origin).comment_ids);
    const found = ids.length
      ? (await env.DB.prepare("SELECT * FROM comments WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all()).results
      : [];
    const byId = new Map(found.map((c) => [c.id, c]));
    return json({
      submissions: rows.map((r) => {
        const submission = publicSubmission(r, url.origin);
        return {
          ...submission, title: r.title, channel: r.channel, version: r.version, video_status: r.status,
          page_url: `${url.origin}/review/${r.slug}`,
          comments: submission.comment_ids.map((cid) => byId.get(cid)).filter(Boolean)
            .map((c) => ({ id: c.id, t: c.t, text: c.text, author: c.author })),
        };
      }),
    });
  }
  // POST /api/review/submissions/<id>/requeue: the dashboard stored a Send back as delivered (its card wake), then
  // couldn't wake the owner after all, so the router picks it up again.
  if (id !== undefined && action === "requeue" && extra === undefined && method === "POST") {
    await env.DB.prepare("UPDATE submissions SET delivered_at = NULL, delivered_to = NULL WHERE id = ? AND delivered_to = 'dashboard'").bind(id).run();
    return json({ ok: true });
  }
  if (id !== undefined && action === "delivered" && extra === undefined && method === "POST") {
    const body = await readJson(request);
    const to = text(body?.to, 80);
    if (!to) return fail(400, "to is required");
    const at = typeof body.at === "string" && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at).toISOString() : now();
    const result = await env.DB.prepare("UPDATE submissions SET delivered_at = ?, delivered_to = ? WHERE id = ?").bind(at, to, id).run();
    if (!result.meta.changes) return fail(404, "submission_not_found");
    return json({ submission: publicSubmission(await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first(), url.origin) });
  }
  return id === undefined ? fail(405, "method_not_allowed") : fail(404, "not_found");
}

// POST /api/review/<slug>/next {result_slug, submission_id?}: the agent links its new version to the
// submission it answered (default: the latest "changes" one), so the old page shows the link.
async function nextVersion(request, env, url, slug) {
  const body = await readJson(request);
  const result = text(body?.result_slug, 80);
  if (!validSlug(result) || result === slug) return fail(400, "result_slug must be the new version's slug");
  if (!await env.DB.prepare("SELECT 1 FROM videos WHERE slug = ?").bind(result).first()) return fail(400, "publish the new version first");
  const target = body.submission_id
    ? await env.DB.prepare("SELECT id FROM submissions WHERE id = ? AND slug = ?").bind(String(body.submission_id), slug).first()
    : await env.DB.prepare("SELECT id FROM submissions WHERE slug = ? AND kind = 'changes' ORDER BY created_at DESC LIMIT 1").bind(slug).first();
  if (!target) return fail(409, "no changes submission for this video");
  await env.DB.prepare("UPDATE submissions SET result_slug = ? WHERE id = ?").bind(result, target.id).run();
  return json({ submission: publicSubmission(await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(target.id).first(), url.origin) });
}

// DELETE /api/review/<slug> (agent token only): removes a test or mistaken video with its comments,
// submissions and media; an auto-created channel left empty goes too (the seeded seven stay).
async function deleteVideo(env, row) {
  const voices = (await env.DB.prepare("SELECT audio_key FROM comments WHERE slug = ? AND audio_key IS NOT NULL").bind(row.slug).all()).results;
  await env.DB.batch([
    env.DB.prepare("UPDATE submissions SET result_slug = NULL WHERE result_slug = ?").bind(row.slug),
    env.DB.prepare("DELETE FROM submissions WHERE slug = ?").bind(row.slug),
    env.DB.prepare("DELETE FROM comments WHERE slug = ?").bind(row.slug),
    env.DB.prepare("DELETE FROM videos WHERE slug = ?").bind(row.slug),
    env.DB.prepare("DELETE FROM channels WHERE slug = ?1 AND sort >= 100 AND NOT EXISTS (SELECT 1 FROM videos WHERE channel = ?1)").bind(row.channel),
  ]);
  const keys = [row.video_key, row.source_key, row.compare_key, ...voices.map((v) => v.audio_key)].filter(Boolean);
  if (keys.length) await env.MEDIA.delete(keys);
  return json({ deleted: row.slug });
}

// Publishing (agent token only): chunked R2 multipart upload, then metadata.
//   POST /api/review/<slug>/uploads                         {kind: "video"|"source"} -> {key, uploadId}
//   PUT  /api/review/<slug>/uploads/<uploadId>/<part>?key=  raw bytes                -> {partNumber, etag}
//   POST /api/review/<slug>/uploads/<uploadId>/complete     {key, parts}             -> {key, size}
//   POST /api/review/<slug>/publish                         {channel, video, version, title, video_key, ...}
//   POST /api/review/<slug>/source                          {source_key}  adds an original to a video with none
async function publishApi(request, env, url, slug, resource, uploadId, action) {
  const method = request.method;
  const ownKey = (key) => typeof key === "string" && key.startsWith(`review/${slug}/`) && /^[\w./-]+\.mp4$/.test(key) && !key.includes("..");

  if (resource === "uploads" && uploadId === undefined && method === "POST") {
    const body = await readJson(request);
    if (!body || !["video", "source", "compare"].includes(body.kind)) return fail(400, "kind must be video, source or compare");
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

  // Adds the original to a video that has none. Unlike publish it replaces nothing and deletes nothing.
  if (resource === "source" && uploadId === undefined && method === "POST") {
    const body = await readJson(request);
    if (!body || !ownKey(body.source_key)) return fail(400, "source_key must come from this slug's uploads");
    if (!await env.MEDIA.head(body.source_key)) return fail(400, "source_key was not uploaded");
    const saved = await env.DB.prepare("UPDATE videos SET source_key = ?, updated_at = ? WHERE slug = ? AND source_key IS NULL")
      .bind(body.source_key, now(), slug).run();
    if (!saved.meta.changes) return fail(409, "no such video, or it already has a source");
    return json({ video: publicVideo(await getVideo(env, slug), url.origin) });
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
    const extras = ["source_key", "compare_key"];
    if (!ownKey(body.video_key) || extras.some((k) => body[k] != null && !ownKey(body[k]))) return fail(400, "keys must come from this slug's uploads");
    const videoInfo = await env.MEDIA.head(body.video_key);
    if (!videoInfo) return fail(400, "video_key was not uploaded");
    for (const k of extras) if (body[k] && !await env.MEDIA.head(body[k])) return fail(400, `${k} was not uploaded`);
    const duration = Number(body.duration);
    const chapters = Array.isArray(body.chapters)
      ? JSON.stringify(body.chapters.filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0]))).slice(0, 100).map((c) => [Number(c[0]), text(String(c[1] ?? ""), 120)]))
      : null;
    const syncOk = (s) => Array.isArray(s) && s.length === 4 && s.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
    const syncMap = Array.isArray(body.sync) && body.sync.length && body.sync.length <= 5000 && body.sync.every(syncOk)
      ? JSON.stringify(body.sync.map((s) => s.map((n) => Math.round(n * 1000) / 1000))) : null;
    const previous = await env.DB.prepare("SELECT video_key, source_key, compare_key FROM videos WHERE slug = ?").bind(slug).first();
    const stamp = now();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO channels (slug, name, sort) VALUES (?, ?, 100)")
        .bind(channel, text(body.channel_name, 60) || channel.charAt(0).toUpperCase() + channel.slice(1)),
      env.DB.prepare(`INSERT INTO videos (slug, channel, video, version, title, status, video_key, video_size, video_sha256,
          source_key, compare_key, duration, chapters, sync_map, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET channel = excluded.channel, video = excluded.video, version = excluded.version,
          title = excluded.title, status = excluded.status, video_key = excluded.video_key, video_size = excluded.video_size,
          video_sha256 = excluded.video_sha256, source_key = excluded.source_key, compare_key = excluded.compare_key, duration = excluded.duration,
          chapters = excluded.chapters, sync_map = excluded.sync_map, notes = excluded.notes, updated_at = excluded.updated_at`)
        .bind(slug, channel, video, version, title, status, body.video_key, videoInfo.size,
          /^[a-f0-9]{64}$/.test(body.video_sha256 || "") ? body.video_sha256 : null,
          body.source_key || null, body.compare_key || null, Number.isFinite(duration) && duration > 0 ? duration : null,
          chapters, syncMap, text(body.notes, 2000) || null, stamp, stamp),
    ]);
    const kept = new Set([body.video_key, body.source_key, body.compare_key]);
    const stale = [previous?.video_key, previous?.source_key, previous?.compare_key].filter((k) => k && !kept.has(k));
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
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    url.protocol = "https:";
    return new Response(null, { status: 308, headers: { Location: url.href, "Cache-Control": "no-store" } });
  }
  if (url.pathname.startsWith("/review/_/")) return asset(request, env, url);
  const isApi = url.pathname.startsWith("/api/review/");
  if (!isApi && url.pathname !== "/review" && !url.pathname.startsWith("/review/")) return notFound();
  if (SECRETS.some((name) => !env[name] || env[name].length < 8)) {
    return isApi ? fail(503, "not_configured") : new Response("Review portal is not configured.", { status: 503 });
  }
  if (isApi) return api(request, env, url);
  if (url.pathname === "/review/login") return login(request, env, url);
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
