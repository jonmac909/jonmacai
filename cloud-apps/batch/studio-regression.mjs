// Run: node cloud-apps/batch/studio-regression.mjs
// Execute the page's actual helpers with controllable media/storage boundaries.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import vm from "node:vm";
import worker from "./worker.js";

// The copied user catalog is authoritative: no editorial remapping by old graphic ID.
const catalog = JSON.parse(readFileSync(new URL("./public/sabri/all_61/catalog_61.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("./public/modules.json", import.meta.url), "utf8"));
assert.equal(catalog.total, 61);
assert.equal(manifest.total, catalog.total);
assert.equal(manifest.project_id, "365e01c6-0f23-4637-82ed-be6905b2bbcb");
assert.equal(manifest.catalog_id, "sabri-master-61");
assert.equal(manifest.modules.length, catalog.modules.length);
for (const [index, original] of catalog.modules.entries()) {
  const module = manifest.modules[index];
  assert.deepEqual(
    [module.id, module.source_id, module.num, module.title, module.description, module.timestamp, module.timeSeconds, module.durationSeconds],
    [`G${String(index + 1).padStart(2, "0")}`, original.id, original.num, original.title, original.title, original.timestamp, original.timeSeconds, original.durationSeconds],
  );
  assert.deepEqual(module.reference, {
    title: original.title,
    video_url: `/batch/sabri/all_61/${original.referenceVideo}`,
    poster_url: `/batch/sabri/all_61/${original.referencePoster}`,
  });
  for (const file of [original.referenceVideo, original.referencePoster]) {
    assert.ok(statSync(new URL(`./public/sabri/all_61/${file}`, import.meta.url)).isFile(), `${module.id}: missing ${file}`);
  }
  assert.equal(module.clips.length, index === 0 ? 1 : 0, `${module.id}: incorrect ready/pending state`);
}
const proof = manifest.modules[0].clips[0];
assert.equal(proof.video_url, "https://jonmac.ai/frame/api/media?file=g01_loom_single_91c8a22091a875ed");
assert.equal(proof.review_url, "https://jonmac.ai/frame/?p=365e01c6-0f23-4637-82ed-be6905b2bbcb&file=g01_loom_single_91c8a22091a875ed");
assert.equal(proof.poster_url, "/batch/posters/G01.jpg");

const source = readFileSync(new URL("./public/index.html", import.meta.url), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
const stored = new Map();
let failRead = false;
let failWrite = false;
const context = vm.createContext({
  URL,
  location: new URL("https://jonmac.ai/batch"),
  document: { getElementById: () => ({}) },
  fetch: () => new Promise(() => {}), // Leave page bootstrap pending; exercise helpers below.
  localStorage: {
    getItem(key) { if (failRead) throw new Error("Storage unavailable"); return stored.get(key) ?? null; },
    setItem(key, value) { if (failWrite) throw new Error("Quota exceeded"); stored.set(key, value); },
  },
});
vm.runInContext(source, context);

// Validate the same manifest used by the page, including valid pending entries.
assert.equal(context.validateManifest(manifest), manifest.modules);
for (const invalidate of [
  value => { value.modules.pop(); },
  value => { value.modules[1].id = "G01"; },
  value => { value.modules[1].timeSeconds = 0; },
  value => { value.modules[0].timestamp = "00:99"; },
  value => { value.modules[0].durationSeconds = 0; },
  value => { value.modules[0].reference.video_url = "/batch/sabri/old.mp4"; },
  value => { value.modules[0].reference.poster_url = "https://elsewhere.test/poster.png"; },
  value => { value.modules[1].clips = [{ label: "Not actually ready" }]; },
]) {
  const invalid = structuredClone(manifest);
  invalidate(invalid);
  assert.throws(() => context.validateManifest(invalid));
}

// Export reads current drafts (including unsaved ones), retaining every source description and timestamp.
const drafts = new Map(manifest.modules.map(module => [module.id, `Unsaved draft for ${module.id}`]));
const exported = context.exportNotes(manifest, id => drafts.get(id));
const blocks = exported.split(/^## /m).slice(1);
assert.deepEqual(blocks.map(block => block.match(/^G\d{2}\b/)?.[0]), manifest.modules.map(module => module.id));
for (const [index, original] of catalog.modules.entries()) {
  for (const value of [original.title, original.id, original.timestamp, String(original.timeSeconds), String(original.durationSeconds), drafts.get(manifest.modules[index].id)]) {
    assert.ok(blocks[index].includes(value), `Export omitted ${value}`);
  }
}
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
  context.bindPair(videos, button, message);
  return { videos, button, message };
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

// An older rejected start cannot cancel a newer play request after Pause Both.
{
  const { videos, button } = pair();
  emit(button, "click");
  emit(button, "click");
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

function notes(project = "project-a", catalogId = "sabri-master-61") {
  const textarea = node();
  const message = node();
  const retry = node();
  context.bindNotes(project, catalogId, "G01", textarea, message, retry);
  return { textarea, message, retry };
}

// Failed writes retain the draft; retry persists it, and another project cannot read it.
{
  const { textarea, message, retry } = notes();
  stored.set("batch-notes:project-a:G01", "Original batch notes");
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
  assert.equal(notes("project-a", "another-catalog").textarea.value, "");
  assert.equal(stored.get("batch-notes:project-a:G01"), "Original batch notes");
  failRead = true;
  const reload = notes();
  assert.match(reload.message.textContent, /could not be loaded/);
  failRead = false;
  emit(reload.retry, "click");
  assert.equal(reload.textarea.value, textarea.value);
}

// Old renumbered IDs must never populate the new ledger, even on the first visit.
stored.set("batch-notes:legacy-project:G01", "Old graphic one");
assert.equal(notes("legacy-project").textarea.value, "");
assert.equal(stored.get("batch-notes:legacy-project:G01"), "Old graphic one");

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
console.log("Studio regression check passed: 61 catalog references/files, ready/pending contract, draft export, paired playback, isolated notes, and static video ranges.");
