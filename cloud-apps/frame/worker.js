const PREFIX = "/frame";
const MAX_FILES = 4;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const RASTER = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

function rasterType(declared, bytes) {
  const u = new Uint8Array(bytes);
  let sniffed = "";
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) sniffed = "image/png";
  else if (u[0] === 0xff && u[1] === 0xd8) sniffed = "image/jpeg";
  else if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) sniffed = "image/gif";
  else if (u[0] === 0x52 && u[1] === 0x49 && u[8] === 0x57 && u[9] === 0x45) sniffed = "image/webp";
  const mime = (sniffed || String(declared || "").toLowerCase()).split(";")[0].trim();
  if (mime === "image/svg+xml" || mime.includes("svg")) return "";
  return RASTER.has(mime) ? mime : "";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function driveId(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/d\/([A-Za-z0-9_-]{10,})/) || text.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || text.match(/^([A-Za-z0-9_-]{25,})$/);
  return match ? match[1] : null;
}

function clipId(value) {
  const text = String(value || "").trim();
  if (/^local-[A-Za-z0-9_-]+$/.test(text)) return text;
  return driveId(text);
}

function commentKey(fileId, id) {
  return `c:${fileId}:${id}`;
}

function imageKey(id) {
  return `i:${id}`;
}

function projectKey(id) {
  return `p:${id}`;
}

const PROJECT_INDEX = "idx:projects";

async function listByPrefix(env, prefix) {
  const rows = [];
  let cursor;
  do {
    const page = await env.COMMENTS.list({ prefix, cursor });
    for (const key of page.keys) {
      const row = await env.COMMENTS.get(key.name, { type: "json" });
      if (row) rows.push(row);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return rows;
}

async function loadProjects(env) {
  const raw = await env.COMMENTS.get(PROJECT_INDEX);
  if (raw == null) {
    const found = (await listByPrefix(env, "p:")).sort((a, b) => (a.at || 0) - (b.at || 0));
    await env.COMMENTS.put(PROJECT_INDEX, JSON.stringify(found.map((p) => p.id)));
    return found;
  }
  const ids = JSON.parse(raw);
  const rows = [];
  for (const id of ids) {
    const row = await env.COMMENTS.get(projectKey(id), { type: "json" });
    if (row) rows.push(row);
  }
  return rows;
}

function isHtml(response) {
  return (response.headers.get("content-type") || "").toLowerCase().includes("text/html");
}

function passMedia(response) {
  const out = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has("content-type")) out.set("content-type", "video/mp4");
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  out.set("cache-control", "private, max-age=60");
  return new Response(response.body, { status: response.status, headers: out });
}

function mediaHeaders(request) {
  const headers = { "user-agent": "Mozilla/5.0" };
  headers.Range = boundRange(request.headers.get("Range"));
  return headers;
}

function boundRange(header) {
  const max = 256 * 1024;
  const match = String(header || "").match(/bytes=(\d+)-(\d*)/);
  const start = match ? Number(match[1]) : 0;
  const requestedEnd = match && match[2] !== "" ? Number(match[2]) : start + max - 1;
  const end = Math.min(requestedEnd, start + max - 1);
  return `bytes=${start}-${end}`;
}

function parseUuid(html) {
  return html.match(/name=["']uuid["']\s+value=["']([^"']+)["']/)?.[1] || null;
}

function userContentUrl(fileId, uuid) {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t&uuid=${uuid}`;
}

async function fromR2(env, fileId, request) {
  if (!env.MEDIA) return null;
  const head = await env.MEDIA.head(fileId);
  if (!head) return null;
  const size = head.size;
  const match = String(request.headers.get("Range") || "").match(/bytes=(\d+)-(\d*)/);
  const headers = {
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=3600",
  };
  if (!match) {
    const obj = await env.MEDIA.get(fileId);
    headers["content-length"] = String(size);
    return new Response(obj.body, { status: 200, headers });
  }
  const start = Number(match[1]);
  const end = match[2] !== "" ? Math.min(Number(match[2]), size - 1) : size - 1;
  const length = Math.max(0, end - start + 1);
  const obj = await env.MEDIA.get(fileId, { range: { offset: start, length } });
  if (!obj) return null;
  headers["content-length"] = String(length);
  headers["content-range"] = `bytes ${start}-${end}/${size}`;
  return new Response(obj.body, { status: 206, headers });
}

async function proxyMedia(fileId, request, env) {
  const r2 = await fromR2(env, fileId, request);
  if (r2) return r2;

  const rangeHeaders = mediaHeaders(request);
  const probeHeaders = { "user-agent": "Mozilla/5.0" };

  const cached = await env.COMMENTS.get(`u:${fileId}`);
  if (cached) {
    const hit = await fetch(userContentUrl(fileId, cached), { headers: rangeHeaders, redirect: "follow" });
    if (!isHtml(hit)) return passMedia(hit);
    await env.COMMENTS.delete(`u:${fileId}`);
  }

  const first = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`, {
    headers: probeHeaders,
    redirect: "follow",
  });
  if (!isHtml(first)) return passMedia(first);

  const uuid = parseUuid(await first.text());
  if (!uuid) throw new Error("Drive did not return a download token");
  await env.COMMENTS.put(`u:${fileId}`, uuid, { expirationTtl: 900 });
  const second = await fetch(userContentUrl(fileId, uuid), { headers: rangeHeaders, redirect: "follow" });
  if (!isHtml(second)) return passMedia(second);
  await env.COMMENTS.delete(`u:${fileId}`);
  throw new Error("Drive download is not available");
}

async function listComments(env, fileId) {
  const rows = [];
  let cursor;
  do {
    const page = await env.COMMENTS.list({ prefix: `c:${fileId}:`, cursor });
    const batch = await Promise.all(page.keys.map((key) => env.COMMENTS.get(key.name, { type: "json" })));
    for (const row of batch) if (row) rows.push(row);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  rows.sort((a, b) => (a.tSec || 0) - (b.tSec || 0) || (a.at || 0) - (b.at || 0));
  return rows;
}

function b64ToBuf(data) {
  const raw = String(data || "").replace(/^data:[^;]+;base64,/, "");
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function readCommentBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      file: String(form.get("file") || ""),
      text: String(form.get("text") || ""),
      t: String(form.get("t") || ""),
      tSec: Number(form.get("tSec")),
      files: form.getAll("images").filter((f) => f && typeof f === "object" && typeof f.arrayBuffer === "function"),
    };
  }
  const body = await request.json().catch(() => ({}));
  const files = [];
  for (const item of [...(body.files || []), ...(body.images || [])]) {
    if (!item || !item.data) continue;
    const buf = b64ToBuf(item.data);
    files.push({
      name: String(item.name || "file").slice(0, 80),
      type: item.type || "",
      arrayBuffer: async () => buf,
      size: buf.byteLength,
    });
  }
  return {
    file: body.file || body.fileId || "",
    text: body.text || "",
    t: body.t || "",
    tSec: body.tSec,
    files,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === PREFIX) {
      url.pathname = `${PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === `${PREFIX}/api/media`) {
      const fileId = driveId(url.searchParams.get("file") || "");
      if (!fileId) return json({ error: "file required" }, 400);
      try {
        return await proxyMedia(fileId, request, env);
      } catch (err) {
        return json({ error: String(err.message || err) }, 502);
      }
    }

    if (url.pathname === `${PREFIX}/api/image`) {
      const id = String(url.searchParams.get("id") || "");
      if (!id) return json({ error: "id required" }, 400);
      const stored = await env.COMMENTS.getWithMetadata(imageKey(id), { type: "arrayBuffer" });
      if (!stored.value) return json({ error: "not found" }, 404);
      const type = stored.metadata?.type || "application/octet-stream";
      const name = String(stored.metadata?.name || `comment-${id.slice(0, 8)}`).replace(/[^\w.\-]+/g, "_");
      const raster = !!rasterType(type, stored.value);
      const dl = url.searchParams.has("download") || !raster;
      return new Response(stored.value, {
        headers: {
          "content-type": raster && !dl ? type : type || "application/octet-stream",
          "x-content-type-options": "nosniff",
          "content-disposition": `${dl ? "attachment" : "inline"}; filename="${name || "file"}"`,
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }
    if (url.pathname === `${PREFIX}/api/projects`) {
      if (request.method === "GET") {
        return json({ projects: await loadProjects(env) });
      }
      if (request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const name = String(body.name || "").trim().slice(0, 80) || "Untitled";
        const row = { id: crypto.randomUUID(), name, items: [], at: Date.now() };
        const ids = JSON.parse((await env.COMMENTS.get(PROJECT_INDEX)) || "[]");
        ids.push(row.id);
        await env.COMMENTS.put(projectKey(row.id), JSON.stringify(row));
        await env.COMMENTS.put(PROJECT_INDEX, JSON.stringify(ids));
        return json({ ok: true, project: row });
      }
      if (request.method === "DELETE") {
        const id = String(url.searchParams.get("id") || "");
        if (!id) return json({ error: "id required" }, 400);
        const ids = JSON.parse((await env.COMMENTS.get(PROJECT_INDEX)) || "[]").filter((x) => x !== id);
        await env.COMMENTS.put(PROJECT_INDEX, JSON.stringify(ids));
        await env.COMMENTS.delete(projectKey(id));
        return json({ ok: true });
      }
      return json({ error: "method" }, 405);
    }

    if (url.pathname === `${PREFIX}/api/project-items`) {
      if (request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const projectId = String(body.projectId || "");
        const file = driveId(body.url || body.file || "");
        if (!projectId || !file) return json({ error: "project and media ID required" }, 400);
        const media = body.media ?? "drive";
        if (media !== "drive" && media !== "r2") return json({ error: "unsupported media source" }, 400);
        const project = await env.COMMENTS.get(projectKey(projectId), { type: "json" });
        if (!project) return json({ error: "not found" }, 404);
        if (media === "r2" && !(await env.MEDIA?.head(file))) return json({ error: "uploaded media not found" }, 404);
        const item = {
          id: crypto.randomUUID(),
          fileId: file,
          media,
          url: media === "r2" ? `${PREFIX}/api/media?file=${encodeURIComponent(file)}` : `https://drive.google.com/file/d/${file}/view`,
          name: String(body.name || "").trim().slice(0, 80) || "Video",
        };
        project.items = [...(project.items || []).filter((x) => x.fileId !== file), item];
        await env.COMMENTS.put(projectKey(projectId), JSON.stringify(project));
        return json({ ok: true, project, item });
      }
      if (request.method === "DELETE") {
        const projectId = String(url.searchParams.get("project") || "");
        const itemId = String(url.searchParams.get("id") || "");
        const project = await env.COMMENTS.get(projectKey(projectId), { type: "json" });
        if (!project) return json({ error: "not found" }, 404);
        project.items = (project.items || []).filter((x) => x.id !== itemId);
        await env.COMMENTS.put(projectKey(projectId), JSON.stringify(project));
        return json({ ok: true, project });
      }
      return json({ error: "method" }, 405);
    }

    if (url.pathname === `${PREFIX}/api/comments`) {
      const fileId = clipId(url.searchParams.get("file") || "");
      if (request.method === "GET") {
        if (!fileId) return json({ error: "file required" }, 400);
        return json({ fileId, comments: await listComments(env, fileId) });
      }
      if (request.method === "DELETE") {
        const id = String(url.searchParams.get("id") || "");
        if (!fileId || !id) return json({ error: "file and id required" }, 400);
        const key = commentKey(fileId, id);
        const row = await env.COMMENTS.get(key, { type: "json" });
        if (!row) return json({ error: "not found" }, 404);
        await env.COMMENTS.delete(key);
        const ids = [...(row.images || []), ...(row.files || []).map((f) => f.id)];
        for (const fid of [...new Set(ids)]) await env.COMMENTS.delete(imageKey(fid));
        return json({ ok: true });
      }
      if (request.method === "POST") {
        const body = await readCommentBody(request);
        const id = clipId(body.file || fileId || "");
        const text = String(body.text || "").trim();
        if (!id) return json({ error: "file required" }, 400);
        if (body.files.length > MAX_FILES) return json({ error: "too many files" }, 400);
        const files = [];
        for (const file of body.files) {
          const bytes = await file.arrayBuffer();
          if (bytes.byteLength > MAX_FILE_BYTES) return json({ error: "file too large" }, 400);
          if (!bytes.byteLength) return json({ error: "empty file" }, 400);
          const raster = rasterType(file.type, bytes);
          const mime = raster || String(file.type || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
          const fid = crypto.randomUUID();
          const name = String(file.name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 80) || "file";
          await env.COMMENTS.put(imageKey(fid), bytes, { metadata: { type: mime, name } });
          files.push({ id: fid, name, type: mime });
        }
        if (!text && !files.length) return json({ error: "text or file required" }, 400);
        const timed = body.tSec != null && body.tSec !== "" && Number.isFinite(Number(body.tSec));
        const tSec = timed ? Number(body.tSec) : null;
        const row = {
          id: crypto.randomUUID(),
          text: text.slice(0, 2000),
          t: timed ? String(body.t || "").trim().slice(0, 16) : "",
          tSec,
          at: Date.now(),
          files,
          images: files.map((f) => f.id),
        };
        await env.COMMENTS.put(commentKey(id, row.id), JSON.stringify(row));
        return json({ ok: true, comment: row });
      }
      return json({ error: "method" }, 405);
    }

    let assetPath = url.pathname.slice(PREFIX.length) || "/";
    if (assetPath === "/") assetPath = "/index.html";
    const assetUrl = new URL(request.url);
    assetUrl.pathname = assetPath;
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("Cache-Control", assetPath.endsWith(".html") ? "no-store" : "public, max-age=60");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
