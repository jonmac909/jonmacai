// Server-rendered HTML for the review portal. Client behaviour lives in public/app.js.
const STATUS_LABEL = { needs_review: "Needs review", changes_requested: "Changes requested", approved: "Approved" };
// Drawing colours, the only ones the Worker stores (parseDrawing).
export const INK = { "#ff3b30": "Red", "#ffcc00": "Yellow", "#34c759": "Green", "#0a84ff": "Blue", "#ffffff": "White" };

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function formatTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

// `prefix` is "" on jonmac.ai/review and "/dashboard" when the dashboard serves the same pages.
const layout = (title, body, { script = false, prefix = "" } = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${prefix}/review/_/app.css">
${script ? `<script src="${prefix}/review/_/app.js" defer></script>\n` : ""}</head>
<body>
${body}
</body>
</html>`;

const chip = (status) => `<span class="chip chip-${escapeHtml(status)}">${escapeHtml(STATUS_LABEL[status] || status)}</span>`;

export function renderGate({ next, k, error = "" }) {
  return layout("Review", `<main class="gate">
  <h1>Video review</h1>
  <p class="muted">Enter the passcode Jon gave you.</p>
  <form method="post" action="/review/login">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <input type="hidden" name="k" value="${escapeHtml(k)}">
    <label for="passcode">Passcode</label>
    <input id="passcode" name="passcode" type="password" autocomplete="current-password" required autofocus>
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
    <button type="submit" class="primary">Open reviews</button>
  </form>
</main>`);
}

// The review list is a to-do list (Jon, 2026-11-01): one row per video, its newest version, gone once approved. The slug
// stem groups versions: the video key and the channel can differ between them. This only hides rows: direct links, the
// version nav and /api/review/videos keep every version.
const CLEARED_BEFORE = "2026-10-17"; // Jon cleared the Oct 14 to 16 batch off the list
const stem = (slug) => slug.replace(/-v\d+$/, "");
export function openVideos(videos) {
  const newest = new Map();
  for (const v of videos) if (!(newest.get(stem(v.slug))?.created_at >= v.created_at)) newest.set(stem(v.slug), v);
  return [...newest.values()].filter((v) => v.status !== "approved" && v.created_at >= CLEARED_BEFORE);
}

export function renderIndex({ channels, videos }, message = "", prefix = "") {
  const open = openVideos(videos);
  const byChannel = new Map(channels.map((c) => [c.slug, { ...c, videos: [] }]));
  for (const v of open) {
    if (!byChannel.has(v.channel)) byChannel.set(v.channel, { slug: v.channel, name: v.channel, videos: [] });
    byChannel.get(v.channel).videos.push(v);
  }
  const counts = Object.entries(STATUS_LABEL).filter(([s]) => s !== "approved")
    .map(([s, label]) => `${open.filter((v) => v.status === s).length} ${label.toLowerCase()}`);
  const sections = [...byChannel.values()].map((channel) => {
    const items = channel.videos.map((v) => `<li class="video">
      <h3>${escapeHtml(v.title)} <span class="muted">${escapeHtml(v.video)}</span></h3>
      <ul class="versions"><li><a href="${prefix}/review/${escapeHtml(v.slug)}">
        <span class="version">${escapeHtml(v.version)}</span>${chip(v.status)}
        <span class="muted">${v.open_count ? `${v.open_count} open comment${v.open_count === 1 ? "" : "s"}` : v.total_count ? "all comments resolved" : "no comments"}</span>
        <span class="muted when">${escapeHtml((v.created_at || "").slice(0, 10))}</span></a></li></ul>
    </li>`).join("");
    return `<section class="channel"><h2>${escapeHtml(channel.name)}</h2>
      ${items ? `<ul class="videos">${items}</ul>` : '<p class="muted">Nothing to review.</p>'}</section>`;
  }).join("\n");
  return layout("Video reviews", `<main>
  ${prefix ? `<p class="crumbs"><a href="${prefix}/">Dashboard</a></p>` : ""}
  <header class="top"><h1>Video reviews</h1><p class="muted">${escapeHtml(counts.join(" · "))}</p></header>
  ${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ""}
  ${sections}
</main>`, { prefix });
}

// Secondary player (first-60 clip): collapsed, muted, never preloaded or autoplayed.
const extra = (id, label, url) => url ? `<details class="extra" id="${id}"><summary>${label}</summary>
    <video id="${id}-player" class="extra-player" controls playsinline webkit-playsinline muted preload="none" src="${escapeHtml(url)}" aria-label="${label}"></video>
  </details>` : "";

// Ours, with the drawing canvas laid over it (public/app.js).
const ours = (video) => `<div class="stage"><video id="player" controls playsinline webkit-playsinline preload="metadata"
    src="${escapeHtml(video.video_url)}#t=0.001" aria-label="Our video"></video><canvas id="ink" class="ink" aria-hidden="true"></canvas></div>`;

export function renderVideo(video, versions, channelName, submissions = [], prefix = "") {
  const data = JSON.stringify({ slug: video.slug, duration: video.duration, chapters: video.chapters, status: video.status, sync: video.sync, submissions,
    base: `${prefix}/review`, api: `${prefix}/api/review`, dashboard: Boolean(prefix) })
    .replace(/</g, "\\u003c");
  const versionLinks = versions.length > 1 ? `<nav class="version-nav" aria-label="Versions">${versions.map((v) =>
    v.slug === video.slug
      ? `<span class="current">${escapeHtml(v.version)}</span>`
      : `<a href="${prefix}/review/${escapeHtml(v.slug)}">${escapeHtml(v.version)}</a>`).join("")}</nav>` : "";
  const statusButtons = Object.entries(STATUS_LABEL).map(([value, label]) =>
    `<button type="button" class="status-btn" data-status="${value}" aria-pressed="${video.status === value}">${label}</button>`).join("");
  return layout(`${channelName} · ${video.title} ${video.version}`, `<main class="watch">
  <p class="crumbs">${prefix ? `<a href="${prefix}/">Dashboard</a> / ` : ""}<a href="${prefix}/review">All videos</a> / ${escapeHtml(channelName)}</p>
  <header class="top">
    <h1>${escapeHtml(video.title)} <span class="muted">${escapeHtml(video.version)}</span></h1>
    ${versionLinks}
  </header>
  ${video.source_url ? `<div class="duo" id="duo">
    <figure class="pane"><figcaption>Source <span class="muted" id="source-audio">muted</span></figcaption>
      <video id="source-player" controls playsinline webkit-playsinline muted preload="metadata"
        src="${escapeHtml(video.source_url)}#t=0.001" aria-label="Source video"></video>
      <p class="pane-error" id="source-error" hidden>The source video did not load. Ours still plays.</p></figure>
    <figure class="pane"><figcaption>Ours <span class="muted" id="ours-audio">sound on</span></figcaption>
      ${ours(video)}</figure>
  </div>
  <div class="transport" id="transport">
    <button type="button" class="primary" id="play-both">Play both</button>
    <button type="button" id="pause-both">Pause both</button>
    <button type="button" id="source-only">Source only</button>
    <button type="button" id="ours-only">Ours only</button>
    <label class="toggle"><input type="checkbox" id="sync" checked> Keep in sync <span class="muted">(${video.sync.length ? "cut map" : "same offset"})</span></label>
    <span class="audio-switch" role="radiogroup" aria-label="Sound from">Sound:
      <label><input type="radio" name="audio" value="ours" checked> Ours</label>
      <label><input type="radio" name="audio" value="source"> Source</label></span>
  </div>` : ours(video)}
  ${video.chapters.length ? `<div class="chapters" id="chapters">${video.chapters.map(([t, label]) =>
    `<button type="button" data-t="${Number(t)}">${formatTime(t)} ${escapeHtml(label)}</button>`).join("")}</div>` : ""}
  <div class="status-row"><span class="muted">Status</span><div class="status-btns" id="status">${statusButtons}</div></div>
  ${video.notes ? `<p class="notes">${escapeHtml(video.notes)}</p>` : ""}
  ${extra("compare", "First 60 s side by side (muted)", video.compare_url)}
  <section class="composer" aria-label="Add a comment">
    <form id="comment-form" novalidate>
      <div class="who" id="who">
        <label for="author">Your name</label>
        <input id="author" name="author" maxlength="60" autocomplete="name" placeholder="Shown next to your comments">
      </div>
      <p class="who-known" id="who-known" hidden>Commenting as <b id="who-name"></b> · <button type="button" class="link" id="who-change">change</button></p>
      <div class="stamp-row">
        <span>Comment at</span> <button type="button" class="stamp" id="stamp" title="Jump back to this time">0:00</button>
        <button type="button" class="link" id="stamp-now">use current time</button>
      </div>
      <div class="tools">
        <button type="button" id="draw" aria-pressed="false">Draw on frame</button>
        <span class="ink-tools" id="ink-tools" hidden>
          <span class="seg" role="group" aria-label="Shape">${["Pen", "Arrow", "Box"].map((t, i) =>
            `<button type="button" data-tool="${t.toLowerCase()}" aria-pressed="${i === 0}">${t}</button>`).join("")}</span>
          <span class="seg" role="group" aria-label="Colour">${Object.entries(INK).map(([c, name], i) =>
            `<button type="button" class="swatch" data-color="${c}" style="--ink:${c}" aria-label="${name}" aria-pressed="${i === 0}"></button>`).join("")}</span>
          <button type="button" id="ink-undo">Undo</button>
        </span>
        <button type="button" id="voice" hidden>Record voice</button>
        <span class="muted" id="voice-status" role="status"></span>
        <button type="button" class="link" id="voice-clear" hidden>remove</button>
      </div>
      <textarea id="note" name="text" rows="3" maxlength="4000" placeholder="Pause the video, then type, draw or record what should change"></textarea>
      <div class="actions"><button type="submit" class="primary" id="submit">Add comment</button><span class="muted" id="form-status" role="status"></span></div>
    </form>
  </section>
  <section class="send" id="send" aria-label="Send to the agent">
    <div class="send-btns">
      <button type="button" class="primary big" id="send-changes">${prefix ? "Send back" : "Submit changes"}</button>
      <button type="button" class="big approve" id="approve">Approve</button>
    </div>
    <p class="send-hint muted" id="send-status" role="status">${prefix
      ? "When you are done commenting, press Send back: its task goes back to Doing with your open comments. Approve moves the task to Done."
      : "When you are done commenting, press Submit changes. The agent that made this video gets your open comments."}</p>
    <ol class="submissions" id="submissions"></ol>
  </section>
  <section class="comments" aria-label="Comments">
    <h2>Comments <span class="muted" id="counts"></span></h2>
    <ol id="comments"></ol>
  </section>
  <script type="application/json" id="review-data">${data}</script>
</main>`, { script: true, prefix });
}
