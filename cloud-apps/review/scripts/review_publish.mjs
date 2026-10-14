#!/usr/bin/env node
// Publish an MP4 (plus optional source MP4 and metadata) to jonmac.ai/review/<slug>.
// Uploads go through the review Worker in 50 MiB R2 multipart chunks, so the only
// credential needed is REVIEW_API_TOKEN (env, or ~/.jonmac-review.env). Node 18+, no deps.
//
//   node review_publish.mjs --slug mina-1-v9 --channel mina --video mina-1 --version v9 \
//     --title "Mina: AI shorts tutorial" --file mina01_v9.mp4 [--source source_h264.mp4] \
//     [--chapters versions.json] [--notes "what changed"] [--status needs_review] [--dry-run]
//
// --file/--source accept a local path or an http(s) URL. --chapters accepts a JSON array of
// [seconds, label] pairs, or a GPU1 versions.json ({"chapters": {"<file name>": [...]}}).
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, openSync, readFileSync, readSync, closeSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PART_SIZE = 50 * 1024 * 1024;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const match = /^--([a-z-]+)$/.exec(argv[i]);
    if (!match) throw new Error(`Unexpected argument: ${argv[i]}`);
    if (match[1] === "dry-run" || match[1] === "help") args[match[1]] = true;
    else args[match[1]] = argv[++i];
  }
  return args;
}

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

async function localFile(input, label) {
  if (!/^https?:\/\//i.test(input)) {
    if (!existsSync(input)) throw new Error(`${label} not found: ${input}`);
    return input;
  }
  const target = join(tmpdir(), `review-${randomUUID()}-${basename(new URL(input).pathname) || "video.mp4"}`);
  console.error(`Downloading ${label} ${input}`);
  const response = await fetch(input);
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${input}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  return target;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

// Top-level MP4 boxes: "moov" must come before "mdat" so phones can start playing at once.
export function topLevelBoxes(path) {
  const fd = openSync(path, "r");
  const size = statSync(path).size;
  const boxes = [];
  const header = Buffer.alloc(16);
  try {
    for (let offset = 0; offset + 8 <= size && boxes.length < 64;) {
      readSync(fd, header, 0, 16, offset);
      let length = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      if (length === 1) length = Number(header.readBigUInt64BE(8));
      else if (length === 0) length = size - offset;
      if (length < 8) break;
      boxes.push(type);
      offset += length;
    }
  } finally {
    closeSync(fd);
  }
  return boxes;
}

function probe(path) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name",
    "-of", "json", path], { encoding: "utf8" });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

async function inspect(path, label) {
  const size = statSync(path).size;
  const boxes = topLevelBoxes(path);
  if (!boxes.includes("moov")) throw new Error(`${label} is not an MP4 (no moov box)`);
  const warnings = [];
  if (boxes.indexOf("mdat") !== -1 && boxes.indexOf("mdat") < boxes.indexOf("moov")) {
    warnings.push(`${label} is not fast-start (moov after mdat); re-mux with: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`);
  }
  const info = probe(path);
  const streams = info?.streams || [];
  const videoCodec = streams.find((s) => s.codec_type === "video")?.codec_name;
  const audioCodec = streams.find((s) => s.codec_type === "audio")?.codec_name;
  if (videoCodec && videoCodec !== "h264") warnings.push(`${label} video codec is ${videoCodec}; iPhone-safe review copies should be H.264`);
  if (audioCodec && audioCodec !== "aac") warnings.push(`${label} audio codec is ${audioCodec}; use AAC`);
  const duration = Number(info?.format?.duration) || null;
  return { path, size, sha256: await sha256(path), duration, videoCodec, audioCodec, warnings };
}

function chaptersFrom(path, file) {
  if (!path) return undefined;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const list = Array.isArray(parsed) ? parsed : parsed?.chapters?.[basename(file)];
  if (!Array.isArray(list)) throw new Error(`No chapters for ${basename(file)} in ${path}`);
  return list;
}

function client(base, token) {
  return async function call(path, { method = "GET", body, raw, headers = {} } = {}) {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(`${base}/api/review/${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
          body: raw ?? (body ? JSON.stringify(body) : undefined),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) return data;
        const error = new Error(`${method} ${path} -> ${response.status} ${data.error || ""}`.trim());
        error.fatal = response.status < 500;
        throw error;
      } catch (error) {
        if (error.fatal || attempt >= 4) throw error;
        console.error(`Retrying after: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  };
}

async function upload(call, slug, kind, file) {
  const { key, uploadId } = await call(`${slug}/uploads`, { method: "POST", body: { kind } });
  const parts = [];
  const fd = openSync(file.path, "r");
  try {
    const total = Math.max(1, Math.ceil(file.size / PART_SIZE));
    for (let n = 1; n <= total; n++) {
      const length = Math.min(PART_SIZE, file.size - (n - 1) * PART_SIZE);
      const chunk = Buffer.alloc(length);
      readSync(fd, chunk, 0, length, (n - 1) * PART_SIZE);
      const part = await call(`${slug}/uploads/${encodeURIComponent(uploadId)}/${n}?key=${encodeURIComponent(key)}`, {
        method: "PUT", raw: chunk, headers: { "Content-Type": "application/octet-stream" },
      });
      parts.push(part);
      console.error(`Uploaded ${kind} part ${n}/${total} (${(length / 1048576).toFixed(1)} MiB)`);
    }
    const done = await call(`${slug}/uploads/${encodeURIComponent(uploadId)}/complete`, { method: "POST", body: { key, parts } });
    if (done.size !== file.size) throw new Error(`${kind} upload size ${done.size} != local ${file.size}`);
    return key;
  } catch (error) {
    await call(`${slug}/uploads/${encodeURIComponent(uploadId)}?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => {});
    throw error;
  } finally {
    closeSync(fd);
  }
}

async function verify(url, token, size) {
  const head = await fetch(url, { method: "HEAD", headers: { Authorization: `Bearer ${token}` } });
  const range = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Range: "bytes=0-1" } });
  await range.arrayBuffer();
  const ok = head.status === 200 && Number(head.headers.get("content-length")) === size &&
    head.headers.get("content-type") === "video/mp4" && range.status === 206 &&
    range.headers.get("content-range") === `bytes 0-1/${size}`;
  if (!ok) throw new Error(`Media check failed for ${url}: HEAD ${head.status} ${head.headers.get("content-length")}, range ${range.status} ${range.headers.get("content-range")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 13).join("\n").replace(/^\/\/ ?/gm, ""));
    return;
  }
  loadEnvFile(args["env-file"] || join(homedir(), ".jonmac-review.env"));
  const base = (args.base || process.env.REVIEW_BASE_URL || "https://jonmac.ai").replace(/\/+$/, "");
  const token = process.env.REVIEW_API_TOKEN;
  for (const name of ["slug", "channel", "video", "version", "title", "file"]) {
    if (!args[name]) throw new Error(`--${name} is required (see --help)`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(args.slug)) throw new Error("--slug must be lowercase letters, digits and dashes");

  const video = await inspect(await localFile(args.file, "video"), "video");
  const source = args.source ? await inspect(await localFile(args.source, "source"), "source") : null;
  const chapters = chaptersFrom(args.chapters, args.file);
  for (const warning of [...video.warnings, ...(source?.warnings || [])]) console.error(`WARNING: ${warning}`);
  if (args["dry-run"]) {
    console.log(JSON.stringify({ dryRun: true, base, video, source, chapters }, null, 2));
    return;
  }
  if (!token) throw new Error("REVIEW_API_TOKEN is not set (env or ~/.jonmac-review.env)");

  const call = client(base, token);
  const videoKey = await upload(call, args.slug, "video", video);
  const sourceKey = source ? await upload(call, args.slug, "source", source) : null;
  const { video: published } = await call(`${args.slug}/publish`, {
    method: "POST",
    body: {
      channel: args.channel, channel_name: args["channel-name"], video: args.video, version: args.version,
      title: args.title, status: args.status, notes: args.notes, chapters,
      video_key: videoKey, video_sha256: video.sha256, source_key: sourceKey, duration: video.duration,
    },
  });
  await verify(published.video_url, token, video.size);
  if (source) await verify(published.source_url, token, source.size);
  console.log(JSON.stringify({ ok: true, page_url: published.page_url, video_url: published.video_url,
    size: video.size, sha256: video.sha256, duration: video.duration, status: published.status }, null, 2));
}

if (process.argv[1] && basename(process.argv[1]) === basename(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(`review_publish failed: ${error.message}`);
    process.exit(1);
  });
}
