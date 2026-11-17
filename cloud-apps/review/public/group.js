// Review group page (/review/g/<name>): each video block has its own note, Submit changes and Approve, sent to the same
// endpoints as the single page (POST /api/review/<slug>/comments, then /submit). Playing one video pauses the others.
(() => {
  const data = JSON.parse(document.getElementById("group-data").textContent);
  const NAME_KEY = "review.author";
  // Each player box takes its own video's shape: --ar comes from the stored size, and is corrected here from the file itself.
  for (const video of document.querySelectorAll(".frame > video")) {
    const fit = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const ar = (Math.round(video.videoWidth / video.videoHeight * 1e5) / 1e5).toString();
      video.parentElement.style.setProperty("--ar", ar);
    };
    video.addEventListener("loadedmetadata", fit);
    if (video.readyState >= 1) fit();
  }
  const nameInput = document.getElementById("author");
  try { nameInput.value = localStorage.getItem(NAME_KEY) || ""; } catch {}
  nameInput.addEventListener("change", () => { try { localStorage.setItem(NAME_KEY, nameInput.value.trim()); } catch {} });

  async function call(slug, path, body) {
    const response = await fetch(`${data.api}/${encodeURIComponent(slug)}${path}`, {
      method: "POST", credentials: "same-origin", body: JSON.stringify(body),
      headers: { "X-CC": "1", "Content-Type": "application/json" },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  }

  // Playing one video pauses every other player on the page, except the original paired with it (Play both).
  const players = [...document.querySelectorAll(".group-player, .group-source")];
  const pair = (p) => { const item = p.closest(".group-item"); return item ? [...item.querySelectorAll(".group-player, .group-source")] : [p]; };
  for (const p of players) p.addEventListener("play", () => { const mine = pair(p); for (const o of players) if (!mine.includes(o)) o.pause(); });

  // Our time to the original's time with the cut map ([ours_start, ours_end, source_start, source_end]), as on the single page.
  function toSource(sync, t) {
    const hit = sync.find((s) => t >= s[0] && t < s[1]);
    if (hit) return hit[2] + (t - hit[0]) * (hit[1] > hit[0] ? (hit[3] - hit[2]) / (hit[1] - hit[0]) : 0);
    let before = null;
    for (const s of sync) if (s[0] <= t && (!before || s[0] > before[0])) before = s;
    return before ? Math.max(0, before[2] + (t - before[0])) : t;
  }
  for (const block of document.querySelectorAll(".group-item[data-slug]")) {
    const ours = block.querySelector(".group-player"), source = block.querySelector(".group-source");
    if (!source) continue;
    let sync = [];
    try { sync = JSON.parse(block.dataset.sync || "[]"); } catch {}
    const align = () => { source.currentTime = toSource(sync, ours.currentTime); };
    const play = (m) => m.play().catch(() => {});
    block.querySelector('[data-both="play"]').addEventListener("click", () => { align(); play(source); play(ours); });
    block.querySelector('[data-both="pause"]').addEventListener("click", () => { ours.pause(); source.pause(); });
    ours.addEventListener("seeked", () => { if (!source.paused) align(); });
  }

  for (const block of document.querySelectorAll(".group-item[data-slug]")) {
    const slug = block.dataset.slug;
    const player = block.querySelector(".group-player");
    const note = block.querySelector(".group-note");
    const status = block.querySelector(".group-status");
    const buttons = [...block.querySelectorAll("button[data-act]")];
    for (const button of buttons) {
      button.addEventListener("click", async () => {
        const kind = button.dataset.act;
        const text = note.value.trim();
        if (kind === "changes" && !text) { status.textContent = "Type what should change first."; note.focus(); return; }
        if (kind === "approve" && !window.confirm("Approve this video? The agent will mark it approved and start this channel's next video.")) return;
        for (const b of buttons) b.disabled = true;
        status.textContent = "Sending…";
        try {
          if (text) {
            await call(slug, "/comments", { author: nameInput.value.trim() || "Jon", t: player.currentTime || 0, text });
            note.value = "";
          }
          const result = await call(slug, "/submit", { kind });
          for (const b of buttons) if (b.dataset.act === "approve") b.textContent = kind === "approve" ? "Approved" : "Approve";
          status.textContent = (kind === "approve" ? "Approved." : "Submitted. The agent that made this video gets your note.") +
            (result.cardNote ? ` ${result.cardNote}` : "");
        } catch (error) {
          status.textContent = error.message;
        } finally {
          for (const b of buttons) b.disabled = b.textContent === "Approved";
        }
      });
    }
  }
})();
