// Video page: timestamped comments (typed, drawn on the frame or spoken), seek-on-click, resolve, status,
// Submit changes / Approve. No autoplay. The dashboard serves this same page under /dashboard (data.api, data.base).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const data = JSON.parse($("review-data").textContent);
  const player = $("player");
  const api = `${data.api || "/api/review"}/${encodeURIComponent(data.slug)}`;
  const NAME_KEY = "review.author";
  let stamp = 0;
  let comments = [];
  let submissions = Array.isArray(data.submissions) ? data.submissions : [];

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
    // X-CC: the dashboard's check that a write came from its own pages. A FormData body sets its own type.
    const response = await fetch(api + path, {
      credentials: "same-origin",
      ...options,
      headers: { "X-CC": "1", ...(typeof options.body === "string" ? { "Content-Type": "application/json" } : {}) },
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

  // Drawing on the paused frame: pen, arrow or box in five colours, with undo. Points are 0..1 across the video
  // picture (not the letterboxed player), so a drawing lines up at any size. It is saved with the next comment;
  // a saved one shows over ours from its comment's time for HOLD seconds, and while paused there.
  const ink = $("ink");
  const pen = ink.getContext("2d");
  const HOLD = 2;
  let drawMode = false, tool = "pen", color = "#ff3b30", shapes = [], live = null, overlay = null;
  const clamp = (n) => Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4;
  function picture() {
    const w = player.clientWidth, h = player.clientHeight;
    const vw = player.videoWidth || 16, vh = player.videoHeight || 9;
    const s = Math.min(w / vw, h / vh);
    return { x: player.clientLeft + (w - vw * s) / 2, y: player.clientTop + (h - vh * s) / 2, w: vw * s, h: vh * s };
  }
  function stroke(shape, box) {
    const at = ([x, y]) => [box.x + x * box.w, box.y + y * box.h];
    const a = at(shape.points[0]), b = at(shape.points[shape.points.length - 1]);
    pen.strokeStyle = shape.color;
    pen.lineWidth = Math.max(2, box.w / 250);
    pen.lineCap = pen.lineJoin = "round";
    if (shape.tool === "box") { pen.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); return; }
    pen.beginPath();
    pen.moveTo(...a);
    for (const p of shape.points.slice(1)) pen.lineTo(...at(p));
    if (shape.tool === "arrow") {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]), head = pen.lineWidth * 5;
      for (const turn of [-0.5, 0.5]) { pen.moveTo(...b); pen.lineTo(b[0] - head * Math.cos(angle + turn), b[1] - head * Math.sin(angle + turn)); }
    }
    pen.stroke();
  }
  function paint() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(ink.clientWidth * dpr), h = Math.round(ink.clientHeight * dpr);
    if (ink.width !== w || ink.height !== h) { ink.width = w; ink.height = h; }
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.clearRect(0, 0, w, h);
    const draft = live ? [...shapes, live] : shapes;
    const box = picture();
    for (const shape of drawMode || draft.length ? draft : overlay?.drawing?.shapes || []) stroke(shape, box);
  }
  function showAt(time) {
    const hit = comments.find((c) => c.drawing && time >= c.t - 0.1 && time < c.t + HOLD) || null;
    if (hit !== overlay) { overlay = hit; paint(); }
  }
  new ResizeObserver(paint).observe(player);
  player.addEventListener("loadedmetadata", paint);
  player.addEventListener("timeupdate", () => showAt(player.currentTime));
  player.addEventListener("seeked", () => showAt(player.currentTime));
  const pointAt = (event) => {
    const r = ink.getBoundingClientRect(), box = picture();
    return [clamp((event.clientX - r.left - box.x) / box.w), clamp((event.clientY - r.top - box.y) / box.h)];
  };
  ink.addEventListener("pointerdown", (event) => {
    if (!drawMode || shapes.length >= 50) return;
    event.preventDefault();
    ink.setPointerCapture(event.pointerId);
    const p = pointAt(event);
    live = { tool, color, points: [p, p] };
    paint();
  });
  ink.addEventListener("pointermove", (event) => {
    if (!live) return;
    const p = pointAt(event);
    if (tool !== "pen") live.points[1] = p;
    else if (live.points.length < 1000) live.points.push(p);
    paint();
  });
  const finish = () => { if (live) { shapes.push(live); live = null; paint(); } };
  ink.addEventListener("pointerup", finish);
  ink.addEventListener("pointercancel", finish);
  function setDrawMode(on) {
    drawMode = on;
    if (on) player.pause();
    ink.classList.toggle("on", on);
    $("draw").setAttribute("aria-pressed", String(on));
    $("draw").textContent = on ? "Done drawing" : shapes.length ? "Edit drawing" : "Draw on frame";
    $("ink-tools").hidden = !on;
    paint();
  }
  $("draw").addEventListener("click", () => setDrawMode(!drawMode));
  $("ink-undo").addEventListener("click", () => { shapes.pop(); paint(); });
  $("ink-tools").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tool], button[data-color]");
    if (!button) return;
    const key = button.dataset.tool ? "tool" : "color";
    if (key === "tool") tool = button.dataset.tool; else color = button.dataset.color;
    for (const b of $("ink-tools").querySelectorAll(`button[data-${key}]`)) b.setAttribute("aria-pressed", String(b === button));
  });

  // Voice notes: MediaRecorder, up to 2 minutes. iPhone Safari records mp4/AAC; others webm or ogg Opus.
  // The note goes up with the next comment; GPU1 transcribes it (scripts/review_voice.mjs).
  const VOICE_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  const VOICE_SECONDS = 120;
  const VOICE_EXT = { "audio/mp4": "m4a", "audio/webm": "webm", "audio/ogg": "ogg" };
  let recorder = null, voice = null;
  const clockS = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  function showVoice() {
    $("voice").textContent = voice ? "Record again" : "Record voice";
    $("voice").classList.remove("rec");
    $("voice-status").textContent = voice ? `Voice note (${clockS(voice.seconds)}) goes with this comment` : "";
    $("voice-clear").hidden = !voice;
  }
  $("voice").hidden = !(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  $("voice").addEventListener("click", async () => {
    if (recorder) { recorder.stop(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      $("voice-status").textContent = `No microphone: ${error.message}`;
      return;
    }
    const mimeType = VOICE_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [], started = Date.now();
    const tick = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      $("voice").textContent = `Stop (${clockS(s)})`;
      if (s >= VOICE_SECONDS && rec.state === "recording") rec.stop();
    }, 250);
    rec.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
    rec.addEventListener("stop", () => {
      clearInterval(tick);
      for (const track of stream.getTracks()) track.stop();
      const type = (rec.mimeType || mimeType || "audio/mp4").split(";")[0];
      voice = chunks.length ? { blob: new Blob(chunks, { type }), type, seconds: (Date.now() - started) / 1000 } : null;
      recorder = null;
      showVoice();
    });
    player.pause();
    recorder = rec;
    rec.start();
    $("voice").textContent = "Stop (0:00)";
    $("voice").classList.add("rec");
    $("voice-status").textContent = "Recording…";
  });
  $("voice-clear").addEventListener("click", () => { voice = null; showVoice(); });

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
      textEl.textContent = c.text || (c.audio_url ? "Voice note" : "Drawing");
      textEl.addEventListener("click", () => seek(c.t));
      const extras = [];
      if (c.drawing) {
        const drew = document.createElement("button");
        drew.type = "button";
        drew.className = "drew";
        drew.textContent = "Show drawing";
        drew.addEventListener("click", () => seek(c.t));
        extras.push(drew);
      }
      if (c.audio_url) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = c.audio_url;
        const said = document.createElement("p");
        said.className = "transcript";
        said.textContent = c.transcript ? `“${c.transcript}”` : "Transcript coming from GPU1…";
        extras.push(audio, said);
      }
      const meta = document.createElement("p");
      meta.className = "meta";
      const when = new Date(c.created_at);
      meta.textContent = `${c.author} · ${when.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` +
        (c.resolved ? ` · resolved${c.resolved_by ? ` by ${c.resolved_by}` : ""}` : "");
      if (c.sent) {
        const sent = document.createElement("span");
        sent.className = "sent";
        sent.textContent = " · sent to the agent";
        meta.append(sent);
      }
      body.append(textEl, ...extras, meta);
      item.append(time, body);
      // Sent comments are locked: the agent resolves them when the fix is in.
      if (!c.sent) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "resolve";
        toggle.textContent = c.resolved ? "Reopen" : "Resolve";
        toggle.addEventListener("click", () => resolve(c, !c.resolved, toggle));
        item.append(toggle);
      }
      list.append(item);
    }
    const unsent = comments.filter((c) => !c.resolved && !c.sent).length;
    const label = data.dashboard ? "Send back" : "Submit changes";
    $("send-changes").textContent = unsent ? `${label} (${unsent})` : label;
    overlay = null;
    showAt(player.currentTime);
  }

  // Submissions: newest first. The GPU2 router fills delivered_to/at; the agent adds result_slug.
  const clock = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function renderSubmissions() {
    const list = $("submissions");
    list.textContent = "";
    for (const s of submissions.slice(0, 5)) {
      const item = document.createElement("li");
      const count = `${s.comment_count} comment${s.comment_count === 1 ? "" : "s"}`;
      if (s.result_slug) {
        item.className = "ready";
        item.append("New version ready: ");
        const link = document.createElement("a");
        link.href = `${data.base || "/review"}/${encodeURIComponent(s.result_slug)}`;
        link.textContent = s.result_slug;
        item.append(link, ` (from ${count} sent ${clock(s.created_at)})`);
      } else if (s.kind === "approve") {
        item.textContent = s.delivered_at
          ? `Approved. Sent to ${s.delivered_to} at ${clock(s.delivered_at)}, starting the next video.`
          : `Approved at ${clock(s.created_at)}. Telling the agent (within 2 minutes)…`;
      } else {
        item.textContent = s.delivered_at
          ? `Sent to ${s.delivered_to} at ${clock(s.delivered_at)}, working on it (${count}).`
          : `Submitted ${count} at ${clock(s.created_at)}. Sending to the agent (within 2 minutes)…`;
      }
      list.append(item);
    }
    schedulePoll();
  }

  // While a submission waits for the router, check every 20 s so "Sent to …" appears by itself.
  let pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (submissions.some((s) => !s.delivered_at)) pollTimer = setTimeout(loadSubmissions, 20000);
  }
  async function loadSubmissions() {
    try {
      submissions = (await call("/submissions")).submissions;
    } catch {}
    renderSubmissions();
  }

  function setStatus(status) {
    for (const b of $("status").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.status === status));
  }

  async function send(kind, button) {
    const status = $("send-status");
    if (kind === "changes" && !comments.some((c) => !c.resolved && !c.sent)) {
      status.textContent = "Add a comment first.";
      $("note").focus();
      return;
    }
    const ask = data.dashboard ? "Approve this version? Its dashboard task moves to Done."
      : "Approve this version? The agent will mark it approved and start this channel's next video.";
    if (kind === "approve" && !window.confirm(ask)) return;
    for (const b of [$("send-changes"), $("approve")]) b.disabled = true;
    status.textContent = "Sending…";
    try {
      const result = await call("/submit", { method: "POST", body: JSON.stringify({ kind }) });
      setStatus(result.status);
      submissions = [result.submission, ...submissions.filter((s) => s.id !== result.submission.id)];
      const count = `${result.submission.comment_count} comment${result.submission.comment_count === 1 ? "" : "s"}`;
      status.textContent = (kind === "approve" ? "Approved." : data.dashboard ? `Sent back ${count}.`
        : `Submitted ${count}. You can keep commenting; new comments go in the next submission.`) +
        (result.taskNote ? ` ${result.taskNote}` : "");
      renderSubmissions();
      await load();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      for (const b of [$("send-changes"), $("approve")]) b.disabled = false;
    }
  }
  $("send-changes").addEventListener("click", (event) => send("changes", event.currentTarget));
  $("approve").addEventListener("click", (event) => send("approve", event.currentTarget));

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
    if (!text && !shapes.length && !voice) { status.textContent = "Type, draw or record a change note first."; $("note").focus(); return; }
    if (recorder) { status.textContent = "Stop the recording first."; return; }
    const drawing = shapes.length ? { v: 1, shapes } : null;
    let body = JSON.stringify({ author, t: stamp, text, ...(drawing ? { drawing } : {}) });
    if (voice) {
      body = new FormData();
      for (const [key, value] of Object.entries({ author, t: stamp, text })) body.append(key, String(value));
      if (drawing) body.append("drawing", JSON.stringify(drawing));
      body.append("audio", voice.blob, `voice.${VOICE_EXT[voice.type] || "m4a"}`);
    }
    $("submit").disabled = true;
    status.textContent = "Saving…";
    try {
      const { comment, wakes } = await call("/comments", { method: "POST", body });
      comments = [...comments, comment].sort((a, b) => a.t - b.t || a.created_at.localeCompare(b.created_at));
      $("note").value = "";
      shapes = [];
      voice = null;
      showVoice();
      setDrawMode(false);
      status.textContent = `Saved at ${fmt(comment.t)}.${wakes ? ` Telling ${wakes}.` : ""}`;
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
      setStatus(status);
    } catch (error) {
      $("form-status").textContent = error.message;
    }
  });

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { load(); loadSubmissions(); } });
  showName();
  setStamp(0);
  renderSubmissions();
  load();
})();
