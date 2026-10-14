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

  // Source / first-60 players stay muted; closing one pauses it; pausing ours pauses everything.
  const extras = [...document.querySelectorAll("video.extra-player")];
  for (const extra of extras) {
    extra.muted = true;
    const box = extra.closest("details");
    box.addEventListener("toggle", () => { if (!box.open) extra.pause(); });
  }
  player.addEventListener("pause", () => { for (const extra of extras) extra.pause(); });

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
