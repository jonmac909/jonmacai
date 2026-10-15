// Video page: timestamped comments, seek-on-click, resolve, status. No autoplay.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const data = JSON.parse($("review-data").textContent);
  const player = $("player");
  const api = `/api/review/${encodeURIComponent(data.slug)}`;
  const NAME_KEY = "review.author";
  let stamp = 0;
  let comments = [];

  const store = {
    get() { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } },
    set(value) { try { localStorage.setItem(NAME_KEY, value); } catch {} },
  };

  const fmt = (seconds) => {
    const s = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    const tenth = Math.floor((s * 10) % 10);
    return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}.${tenth}`;
  };

  async function call(path, options = {}) {
    const response = await fetch(api + path, {
      credentials: "same-origin",
      ...options,
      headers: options.body ? { "Content-Type": "application/json" } : {},
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function seek(t) {
    player.pause();
    player.currentTime = t;
    setStamp(t);
    player.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function setStamp(t) {
    stamp = Math.max(0, Number(t) || 0);
    $("stamp").textContent = fmt(stamp);
  }

  // Pausing (or seeking while paused) fills the timestamp for the next comment.
  player.addEventListener("pause", () => setStamp(player.currentTime));
  player.addEventListener("seeked", () => { if (player.paused) setStamp(player.currentTime); });
  $("stamp-now").addEventListener("click", () => setStamp(player.currentTime));
  $("stamp").addEventListener("click", () => seek(stamp));
  $("note").addEventListener("focus", () => { if (!player.paused) player.pause(); });
  $("note").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) $("comment-form").requestSubmit();
  });

  const chapters = $("chapters");
  if (chapters) chapters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-t]");
    if (button) seek(Number(button.dataset.t));
  });

  // First-60 clip: collapsed and muted; closing it or pausing ours pauses it.
  const extras = [...document.querySelectorAll("video.extra-player")];
  for (const extra of extras) {
    extra.muted = true;
    const box = extra.closest("details");
    box.addEventListener("toggle", () => { if (!box.open) extra.pause(); });
  }
  player.addEventListener("pause", () => { for (const extra of extras) extra.pause(); });

  // Sound: exactly one player may have sound. Ours by default; the switch or unmuting a
  // player's own controls moves the sound to that player and mutes every other one.
  const source = $("source-player");
  const media = [player, source, ...extras].filter(Boolean);
  let soundFrom = player;
  function applySound() {
    for (const m of media) m.muted = m !== soundFrom;
    for (const radio of document.querySelectorAll('input[name="audio"]')) {
      radio.checked = (radio.value === "ours" && soundFrom === player) || (radio.value === "source" && soundFrom === source);
    }
    if (source) {
      $("ours-audio").textContent = soundFrom === player ? "sound on" : "muted";
      $("source-audio").textContent = soundFrom === source ? "sound on" : "muted";
    }
  }
  for (const m of media) m.addEventListener("volumechange", () => { if (!m.muted && m !== soundFrom) { soundFrom = m; applySound(); } });
  for (const radio of document.querySelectorAll('input[name="audio"]')) {
    radio.addEventListener("change", () => { soundFrom = radio.value === "source" ? source : player; applySound(); });
  }
  applySound();

  // Side by side: source left, ours right. Sync maps our time to source time with the cut map
  // ([ours_start, ours_end, source_start, source_end], first match wins); without one it keeps
  // the offset the two had when Play both was pressed. Ours never depends on the source.
  const sync = Array.isArray(data.sync) ? data.sync : [];
  let offset = 0;
  function toSource(t) {
    if (!sync.length) return Math.max(0, t + offset);
    const hit = sync.find((s) => t >= s[0] && t < s[1]);
    if (hit) return hit[2] + (t - hit[0]) * (hit[1] > hit[0] ? (hit[3] - hit[2]) / (hit[1] - hit[0]) : 0);
    let before = null;
    for (const s of sync) if (s[0] <= t && (!before || s[0] > before[0])) before = s;
    return before ? Math.max(0, before[2] + (t - before[0])) : t;
  }
  window.reviewSync = { toSource };
  if (source) {
    let mode = null; // "both" | "ours" | "source"
    let sourceOk = true;
    const syncOn = () => $("sync").checked && sourceOk;
    const align = () => { if (syncOn()) source.currentTime = toSource(player.currentTime); };
    const play = (m) => m.play().catch(() => {});
    const sourceFailed = () => {
      sourceOk = false;
      $("source-error").hidden = false;
      for (const id of ["play-both", "source-only"]) $(id).disabled = true;
      if (soundFrom === source) { soundFrom = player; applySound(); }
    };
    source.addEventListener("error", sourceFailed);
    // A fast failure can fire before this deferred script runs.
    if (source.error || source.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) sourceFailed();
    $("play-both").addEventListener("click", () => {
      mode = "both";
      if (!sync.length) offset = source.currentTime - player.currentTime;
      align();
      play(player);
      play(source);
    });
    $("pause-both").addEventListener("click", () => { mode = null; player.pause(); source.pause(); });
    $("source-only").addEventListener("click", () => { mode = "source"; player.pause(); play(source); });
    $("ours-only").addEventListener("click", () => { mode = "ours"; source.pause(); play(player); });
    const recompute = () => { mode = !player.paused && !source.paused ? "both" : !player.paused ? "ours" : !source.paused ? "source" : mode; };
    player.addEventListener("play", recompute);
    source.addEventListener("play", recompute);
    // Pausing one side while both run pauses the other (pausing ours pauses everything).
    player.addEventListener("pause", () => { if (mode === "both") source.pause(); });
    source.addEventListener("pause", () => { if (mode === "both") player.pause(); });
    player.addEventListener("seeked", () => { if (mode !== "source") align(); });
    setInterval(() => {
      if (mode !== "both" || player.paused || source.paused || !syncOn()) return;
      if (Math.abs(source.currentTime - toSource(player.currentTime)) > 0.4) align();
    }, 500);
  }

  function showName() {
    const name = store.get();
    $("who").hidden = Boolean(name);
    $("who-known").hidden = !name;
    $("who-name").textContent = name;
    if (!name) $("author").value = "";
  }
  $("who-change").addEventListener("click", () => {
    $("author").value = store.get();
    $("who").hidden = false;
    $("who-known").hidden = true;
    $("author").focus();
  });

  function render() {
    const list = $("comments");
    list.textContent = "";
    const open = comments.filter((c) => !c.resolved).length;
    $("counts").textContent = comments.length ? `${open} open · ${comments.length - open} resolved` : "none yet";
    for (const c of comments) {
      const item = document.createElement("li");
      item.className = c.resolved ? "comment resolved" : "comment";
      item.dataset.id = c.id;
      const time = document.createElement("button");
      time.type = "button";
      time.className = "time";
      time.textContent = fmt(c.t);
      time.title = "Jump to this moment";
      time.addEventListener("click", () => seek(c.t));
      const body = document.createElement("div");
      body.className = "body";
      const textEl = document.createElement("p");
      textEl.className = "text";
      textEl.textContent = c.text;
      textEl.addEventListener("click", () => seek(c.t));
      const meta = document.createElement("p");
      meta.className = "meta";
      const when = new Date(c.created_at);
      meta.textContent = `${c.author} · ${when.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` +
        (c.resolved ? ` · resolved${c.resolved_by ? ` by ${c.resolved_by}` : ""}` : "");
      body.append(textEl, meta);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "resolve";
      toggle.textContent = c.resolved ? "Reopen" : "Resolve";
      toggle.addEventListener("click", () => resolve(c, !c.resolved, toggle));
      item.append(time, body, toggle);
      list.append(item);
    }
  }

  async function load() {
    try {
      comments = (await call("/comments")).comments;
      render();
    } catch (error) {
      $("form-status").textContent = `Could not load comments: ${error.message}`;
    }
  }

  async function resolve(comment, resolved, button) {
    button.disabled = true;
    try {
      const { comment: updated } = await call(`/comments/${encodeURIComponent(comment.id)}/resolve`, {
        method: "POST", body: JSON.stringify({ resolved, by: store.get() || "reviewer" }),
      });
      comments = comments.map((c) => (c.id === updated.id ? updated : c));
      render();
    } catch (error) {
      button.disabled = false;
      $("form-status").textContent = error.message;
    }
  }

  $("comment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("form-status");
    const nameInput = $("author");
    if (!$("who").hidden) {
      const name = nameInput.value.trim();
      if (!name) { status.textContent = "Add your name first."; nameInput.focus(); return; }
      store.set(name);
    }
    const author = store.get() || nameInput.value.trim();
    const text = $("note").value.trim();
    if (!text) { status.textContent = "Type a change note first."; $("note").focus(); return; }
    $("submit").disabled = true;
    status.textContent = "Saving…";
    try {
      const { comment } = await call("/comments", { method: "POST", body: JSON.stringify({ author, t: stamp, text }) });
      comments = [...comments, comment].sort((a, b) => a.t - b.t || a.created_at.localeCompare(b.created_at));
      $("note").value = "";
      status.textContent = `Saved at ${fmt(comment.t)}.`;
      showName();
      render();
    } catch (error) {
      status.textContent = `Not saved: ${error.message}`;
    } finally {
      $("submit").disabled = false;
    }
  });

  $("status").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button || button.getAttribute("aria-pressed") === "true") return;
    try {
      const { status } = await call("/status", { method: "POST", body: JSON.stringify({ status: button.dataset.status }) });
      for (const b of $("status").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.status === status));
    } catch (error) {
      $("form-status").textContent = error.message;
    }
  });

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  showName();
  setStamp(0);
  load();
})();
