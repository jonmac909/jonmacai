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

  const players = [...document.querySelectorAll(".group-player")];
  for (const p of players) p.addEventListener("play", () => { for (const o of players) if (o !== p) o.pause(); });

  for (const block of document.querySelectorAll(".group-item[data-slug]")) {
    const slug = block.dataset.slug;
    const player = block.querySelector("video");
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
          status.textContent = (kind === "approve" ? "Approved." : "Submitted. The agent that made this video gets your note.") +
            (result.cardNote ? ` ${result.cardNote}` : "");
        } catch (error) {
          status.textContent = error.message;
        } finally {
          for (const b of buttons) b.disabled = false;
        }
      });
    }
  }
})();
