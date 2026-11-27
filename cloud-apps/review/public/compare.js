// Version compare page (pages.js renderCompare): pick two versions, play them side by side from one play / seek control,
// see each version's changed spans (from its vN.json) on a strip under the players, leave timed comments on either one
// and send a version's open comments as one fix brief. The brief is that version's own Submit changes, so it goes down the
// same path as the video page (dashboard card, GPU2 router, Studio's status poll); the Worker adds the brief text.
import { buildFixBrief, clock, openComments, spanAt, stripLayout } from "./compare-core.js";

const $ = (id) => document.getElementById(id);
const data = JSON.parse($("compare-data").textContent);
const NAME_KEY = "review.author";
const SIDES = ["a", "b"];
const versions = Array.isArray(data.versions) ? data.versions : [];
const players = { a: $("player-a"), b: $("player-b") };
const picked = { a: data.a, b: data.b };
const comments = { a: [], b: [] };
let stamp = 0;
let syncing = false;

const store = {
  get() { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } },
  set(value) { try { localStorage.setItem(NAME_KEY, value); } catch {} },
};
const version = (side) => versions.find((v) => v.slug === picked[side]) || versions[0] || {};
const other = (side) => (side === "a" ? "b" : "a");

async function call(slug, path, options = {}) {
  const response = await fetch(`${data.api}/${encodeURIComponent(slug)}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { "X-CC": "1", ...(typeof options.body === "string" ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

// ---- players: one control drives both ----
const longest = () => Math.max(...SIDES.map((s) => Number(players[s].duration) || Number(version(s).duration) || 0), 0);
function seekBoth(t) {
  syncing = true;
  for (const s of SIDES) {
    const p = players[s];
    const d = Number(p.duration) || Infinity;
    try { p.currentTime = Math.max(0, Math.min(t, d)); } catch {}
  }
  setStamp(t);
  showTime(t);
  setTimeout(() => { syncing = false; }, 50);
}
function playBoth() {
  const t = players.b.currentTime || players.a.currentTime || 0;
  seekBoth(t);
  for (const s of SIDES) players[s].play().catch(() => {});
}
function pauseBoth() {
  syncing = true;
  for (const s of SIDES) players[s].pause();
  setStamp(players[soundSide()].currentTime);
  setTimeout(() => { syncing = false; }, 50);
}
$("play-both").addEventListener("click", playBoth);
$("pause-both").addEventListener("click", pauseBoth);
$("scrub").addEventListener("input", (event) => seekBoth(Number(event.target.value) || 0));

// The players' own controls drive the other one too (with a guard so the echo does not loop).
for (const s of SIDES) {
  const p = players[s];
  const o = () => players[other(s)];
  p.addEventListener("play", () => { if (!syncing && o().paused) { o().currentTime = Math.min(p.currentTime, Number(o().duration) || Infinity); o().play().catch(() => {}); } });
  p.addEventListener("pause", () => { if (!syncing && !o().paused) o().pause(); if (!syncing) setStamp(p.currentTime); });
  p.addEventListener("seeked", () => {
    if (syncing) return;
    if (Math.abs(o().currentTime - p.currentTime) > 0.3) seekBoth(p.currentTime);
  });
  p.addEventListener("timeupdate", () => {
    if (s !== soundSide()) return;
    showTime(p.currentTime);
    // Drift correction while both play.
    if (!syncing && !p.paused && !o().paused && p.currentTime < (Number(o().duration) || Infinity)
      && Math.abs(o().currentTime - p.currentTime) > 0.3) o().currentTime = p.currentTime;
  });
  p.addEventListener("loadedmetadata", () => {
    if (p.videoWidth && p.videoHeight) p.parentElement.style.setProperty("--ar", (Math.round(p.videoWidth / p.videoHeight * 1e5) / 1e5).toString());
    $("scrub").max = String(longest() || 1);
    renderStrips();
  });
}

// ---- sound ----
const soundSide = () => document.querySelector('input[name="audio"]:checked')?.value || "b";
function applySound() {
  const on = soundSide();
  for (const s of SIDES) {
    players[s].muted = s !== on;
    $(`audio-${s}`).textContent = s === on ? "sound on" : "muted";
  }
}
for (const r of document.querySelectorAll('input[name="audio"]')) r.addEventListener("change", applySound);

function showTime(t) {
  $("scrub-time").textContent = `${clock(t)} / ${clock(longest())}`;
  if (document.activeElement !== $("scrub")) $("scrub").value = String(t);
  for (const head of document.querySelectorAll(".strip-head")) {
    const d = Number(head.dataset.duration) || 0;
    head.style.left = d ? `${Math.min(100, (t / d) * 100)}%` : "0";
  }
  for (const s of SIDES) {
    const hit = spanAt(version(s).changes?.spans || [], t);
    for (const el of document.querySelectorAll(`.strip[data-side="${s}"] .span`)) el.classList.toggle("on", hit !== null && Number(el.dataset.from) === hit.from);
  }
}

function setStamp(t) {
  stamp = Math.max(0, Number(t) || 0);
  $("stamp").textContent = clock(stamp);
}
$("stamp").addEventListener("click", () => seekBoth(stamp));
$("stamp-now").addEventListener("click", () => setStamp(players[commentSide()].currentTime));

// ---- strips of changed spans ----
function renderStrips() {
  const box = $("strips");
  box.textContent = "";
  let any = false;
  for (const s of SIDES) {
    const v = version(s);
    const spans = v.changes?.spans || [];
    const duration = Number(players[s].duration) || Number(v.duration) || 0;
    if (!spans.length && !v.changes?.reason) continue;
    any = true;
    const row = document.createElement("div");
    row.className = "strip-row";
    const label = document.createElement("p");
    label.className = "strip-label";
    label.textContent = `${s.toUpperCase()} · ${v.version || ""}${v.changes?.reason ? ` · why: ${v.changes.reason}` : ""}`;
    const strip = document.createElement("div");
    strip.className = "strip";
    strip.dataset.side = s;
    for (const item of stripLayout(spans, duration)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "span";
      b.dataset.from = String(item.span.from);
      b.style.left = `${item.left}%`;
      b.style.width = `${item.width}%`;
      const tip = `${clock(item.span.from)}-${clock(item.span.to)}${item.span.what ? `: ${item.span.what}` : ""}`;
      b.title = tip;
      b.setAttribute("aria-label", `Changed ${tip}. Jump both players here.`);
      b.addEventListener("click", () => seekBoth(item.span.from));
      strip.append(b);
    }
    const head = document.createElement("span");
    head.className = "strip-head";
    head.dataset.duration = String(duration);
    strip.append(head);
    row.append(label, strip);
    box.append(row);
  }
  box.hidden = !any;
}

// ---- pickers ----
function pick(side, slug) {
  picked[side] = slug;
  const v = version(side);
  const t = players[side].currentTime || 0;
  players[side].src = `${v.video_url || ""}#t=0.001`;
  players[side].addEventListener("loadedmetadata", () => { try { players[side].currentTime = Math.min(t, players[side].duration || t); } catch {} }, { once: true });
  const url = new URL(location.href);
  url.searchParams.set("a", picked.a);
  url.searchParams.set("b", picked.b);
  history.replaceState(null, "", url);
  applySound();
  renderStrips();
  labels();
  load(side);
}
for (const s of SIDES) $(`pick-${s}`).addEventListener("change", (event) => pick(s, event.target.value));

function labels() {
  for (const s of SIDES) {
    const name = `${s.toUpperCase()} · ${version(s).version || ""}`;
    $(`on-${s}`).textContent = name;
    $(`list-${s}-title`).textContent = name;
  }
}

// ---- comments ----
const commentSide = () => document.querySelector('input[name="on"]:checked')?.value || "b";

function renderList(side) {
  const list = $(`list-${side}`);
  list.textContent = "";
  const open = openComments(comments[side]);
  if (!open.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No open comments on this version.";
    list.append(li);
  }
  for (const c of open) {
    const li = document.createElement("li");
    li.className = "comment";
    const at = document.createElement("button");
    at.type = "button";
    at.className = "stamp";
    at.textContent = clock(c.t);
    at.title = "Jump both players here";
    at.addEventListener("click", () => seekBoth(Number(c.t) || 0));
    const text = document.createElement("span");
    text.textContent = ` ${c.text || c.transcript || (c.audio_url ? "(voice note)" : c.drawing ? "(drawing on the frame)" : "")}`;
    const who = document.createElement("span");
    who.className = "muted";
    who.textContent = c.author ? ` · ${c.author}` : "";
    li.append(at, text, who);
    list.append(li);
  }
  $(`brief-${side}`).disabled = !open.length;
}

async function load(side) {
  const slug = picked[side];
  if (!slug) return;
  try {
    const { comments: list } = await call(slug, "/comments");
    if (picked[side] !== slug) return;
    comments[side] = list || [];
    // The same version on both sides shares one list.
    if (picked[other(side)] === slug) comments[other(side)] = comments[side];
  } catch (error) {
    $(`brief-status-${side}`).textContent = `Could not load comments: ${error.message}`;
  }
  for (const s of SIDES) renderList(s);
}

function showName() {
  const name = store.get();
  $("who").hidden = Boolean(name);
  $("who-known").hidden = !name;
  $("who-name").textContent = name;
}
$("who-change").addEventListener("click", () => { $("author").value = store.get(); store.set(""); showName(); $("author").focus(); });

$("comment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("form-status");
  if (!$("who").hidden) {
    const name = $("author").value.trim();
    if (!name) { status.textContent = "Add your name first."; $("author").focus(); return; }
    store.set(name);
  }
  const text = $("note").value.trim();
  if (!text) { status.textContent = "Type what should change first."; $("note").focus(); return; }
  const side = commentSide();
  const slug = picked[side];
  $("submit").disabled = true;
  status.textContent = "Saving…";
  try {
    const { comment } = await call(slug, "/comments", { method: "POST", body: JSON.stringify({ author: store.get(), t: stamp, text }) });
    for (const s of SIDES) if (picked[s] === slug && !comments[s].includes(comment)) comments[s] = [...comments[s], comment];
    if (picked.a === slug && picked.b === slug) comments.b = comments.a;
    $("note").value = "";
    status.textContent = `Saved on ${version(side).version || side.toUpperCase()} at ${clock(comment.t)}.`;
    showName();
    for (const s of SIDES) renderList(s);
  } catch (error) {
    status.textContent = `Not saved: ${error.message}`;
  } finally {
    $("submit").disabled = false;
  }
});

// ---- send as fix brief: the version's own Submit changes ----
async function sendBrief(side) {
  const v = version(side);
  const status = $(`brief-status-${side}`);
  const preview = $(`brief-preview-${side}`);
  const brief = buildFixBrief({
    title: data.title, version: v.version, comments: comments[side], changes: v.changes,
    compareWith: picked[other(side)] !== v.slug ? version(other(side)).version : "",
  });
  if (!brief) { status.textContent = "No open comments to send."; return; }
  preview.textContent = brief;
  preview.hidden = false;
  if (!window.confirm(`Send this fix brief for ${v.version || "this version"}?\n\n${brief}`)) { status.textContent = "Not sent."; return; }
  $(`brief-${side}`).disabled = true;
  status.textContent = "Sending…";
  try {
    const result = await call(v.slug, "/submit", { method: "POST", body: JSON.stringify({ kind: "changes" }) });
    const n = result.submission?.comment_count ?? 0;
    status.textContent = `Sent ${n} comment${n === 1 ? "" : "s"} as a fix brief.${result.cardNote ? ` ${result.cardNote}` : ""}`;
    await load(side);
  } catch (error) {
    status.textContent = `Not sent: ${error.message}`;
    $(`brief-${side}`).disabled = false;
  }
}
for (const s of SIDES) $(`brief-${s}`).addEventListener("click", () => sendBrief(s));

applySound();
labels();
showName();
setStamp(0);
renderStrips();
showTime(0);
load("a");
if (picked.b !== picked.a) load("b");
