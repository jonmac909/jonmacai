// Run: node cloud-apps/batch/studio-regression.mjs
// Execute the page's actual helpers with controllable media/storage boundaries.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import worker from "./worker.js";

const source = readFileSync(new URL("./public/index.html", import.meta.url), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
const stored = new Map();
let failRead = false;
let failWrite = false;
const context = vm.createContext({
  document: { getElementById: () => ({}) },
  fetch: () => new Promise(() => {}), // Leave page bootstrap pending; exercise helpers below.
  localStorage: {
    getItem(key) { if (failRead) throw new Error("Storage unavailable"); return stored.get(key) ?? null; },
    setItem(key, value) { if (failWrite) throw new Error("Quota exceeded"); stored.set(key, value); },
  },
});
vm.runInContext(source, context);
const node = () => Object.assign(new EventTarget(), { value: "", textContent: "", hidden: false });
const emit = (target, event) => target.dispatchEvent(new Event(event));
const settle = () => new Promise(resolve => setImmediate(resolve));
function media() {
  const video = Object.assign(node(), { paused: true, ended: false, currentTime: 7, error: null, starts: [] });
  video.getAttribute = () => "/clip.mp4";
  video.pause = () => { video.paused = true; queueMicrotask(() => emit(video, "pause")); };
  video.play = () => {
    video.paused = false;
    emit(video, "play");
    return new Promise((resolve, reject) => video.starts.push({ resolve, reject }));
  };
  return video;
}
function pair() {
  const videos = [media(), media()];
  const button = node();
  const message = node();
  const control = context.bindPair(videos, button, message);
  return { videos, button, message, control };
}

// Late successful starts cannot undo a newer Pause Both.
{
  const { videos, button } = pair();
  emit(button, "click");
  emit(button, "click");
  for (const video of videos) { video.paused = false; video.starts[0].resolve(); }
  await settle();
  assert.ok(videos.every(video => video.paused));
  assert.equal(button.textContent, "Play Both");
}

// A rejection pauses both, retains the failure message, and a late sibling stays paused.
{
  const { videos, button, message } = pair();
  emit(button, "click");
  videos[0].starts[0].reject(Object.assign(new Error("Blocked"), { name: "NotAllowedError" }));
  await settle();
  videos[1].paused = false;
  videos[1].starts[0].resolve();
  await settle();
  assert.ok(videos.every(video => video.paused));
  assert.match(message.textContent, /blocked/i);
}

// An older rejected start cannot cancel a newer play request after a variant reset.
{
  const { videos, button, control } = pair();
  emit(button, "click");
  control.pause();
  emit(button, "click");
  videos[0].starts[0].reject(new Error("Old source aborted"));
  videos[1].starts[0].resolve();
  videos.forEach(video => video.starts[1].resolve());
  await settle();
  assert.ok(videos.every(video => !video.paused));
  assert.equal(button.textContent, "Pause Both");
  assert.deepEqual(videos.map(video => video.currentTime), [7, 7]);
  videos[0].ended = true;
  videos[0].paused = true;
  emit(videos[0], "ended");
  assert.equal(videos[1].paused, false);
  assert.equal(button.textContent, "Pause Both");
  emit(button, "click");
  emit(button, "click");
  assert.deepEqual(videos.map(video => video.currentTime), [0, 7]);
  videos.forEach(video => video.starts[2].resolve());
  await settle();
}

function notes(project = "project-a") {
  const textarea = node();
  const message = node();
  const retry = node();
  context.bindNotes(project, "G01", textarea, message, retry);
  return { textarea, message, retry };
}

// Failed writes retain the draft; retry persists it, and another project cannot read it.
{
  const { textarea, message, retry } = notes();
  textarea.value = "00:03 — soften texture";
  failWrite = true;
  emit(textarea, "input");
  assert.equal(textarea.value, "00:03 — soften texture");
  assert.match(message.textContent, /not saved/i);
  assert.equal(retry.hidden, false);
  failWrite = false;
  emit(retry, "click");
  assert.match(message.textContent, /^Saved/);
  assert.equal(notes().textarea.value, textarea.value);
  assert.equal(notes("project-b").textarea.value, "");
  failRead = true;
  const reload = notes();
  assert.match(reload.message.textContent, /could not be loaded/);
  failRead = false;
  emit(reload.retry, "click");
  assert.equal(reload.textarea.value, textarea.value);
}

// Static assets ignore Range; the Worker must return seekable, exact partial bytes.
{
  const body = new Uint8Array([10, 20, 30, 40, 50]);
  const env = { ASSETS: { fetch: async () => new Response(body, {
    headers: { "Content-Type": "video/mp4", ETag: '"clip"' },
  }) } };
  const get = (headers = {}, method = "GET") => worker.fetch(new Request("https://jonmac.ai/batch/sabri/clip.mp4", { headers, method }), env);
  for (const [header, expected, contentRange] of [
    ["bytes=1-2", [20, 30], "bytes 1-2/5"],
    ["bytes=3-", [40, 50], "bytes 3-4/5"],
    ["bytes=-2", [40, 50], "bytes 3-4/5"],
  ]) {
    const response = await get({ Range: header });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), contentRange);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expected);
  }
  const invalid = await get({ Range: "bytes=5-" });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("Content-Range"), "bytes */5");
  assert.equal((await invalid.arrayBuffer()).byteLength, 0);
  const changed = await get({ Range: "bytes=1-2", "If-Range": '"old"' });
  assert.equal(changed.status, 200);
  assert.deepEqual([...new Uint8Array(await changed.arrayBuffer())], [...body]);
}
console.log("Studio regression check passed: paired playback, recoverable notes, and static video ranges.");
