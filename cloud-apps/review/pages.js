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

// The original lesson text of a text-only Skool lesson (videos.source_text). Only these tags survive, with no attributes
// except an https/http/mailto href on <a>; everything else (scripts, styles, event handlers, images, iframes, unknown tags)
// is dropped and stray < & > are escaped. It runs when the text is stored and again when the page renders.
const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote", "br", "hr", "a"]);
const VOID_TAGS = new Set(["br", "hr"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|textarea|svg|math|head|title|form|select|button)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const escapeText = (t) => t.replace(/&(?!(?:amp|lt|gt|quot|#39|#\d{1,6}|#x[0-9a-f]{1,6});)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeBasic = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export function sanitizeSourceHtml(input, max = 200000) {
  const src = String(input ?? "").slice(0, max).replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(DROP_WITH_CONTENT, "");
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  const stack = []; // {name, emitted}
  let out = "", last = 0, m;
  const close = (name) => {
    const at = stack.map((e) => e.name).lastIndexOf(name);
    if (at < 0) return;
    for (const e of stack.splice(at).reverse()) if (e.emitted) out += `</${e.name}>`;
  };
  while ((m = tag.exec(src))) {
    out += escapeText(src.slice(last, m.index));
    last = tag.lastIndex;
    const name = m[2].toLowerCase();
    if (!TEXT_TAGS.has(name)) continue;
    if (m[1]) { close(name); continue; }
    if (VOID_TAGS.has(name)) { out += `<${name}>`; continue; }
    if (name === "a") {
      const h = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(m[3]);
      const href = decodeBasic((h && (h[1] ?? h[2] ?? h[3])) || "").trim();
      if (/^(?:https?:\/\/|mailto:)[^\s<>"']+$/i.test(href)) {
        stack.push({ name, emitted: true });
        out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">`;
      } else stack.push({ name, emitted: false });
      continue;
    }
    stack.push({ name, emitted: true });
    out += `<${name}>`;
  }
  out += escapeText(src.slice(last));
  while (stack.length) { const e = stack.pop(); if (e.emitted) out += `</${e.name}>`; }
  return out;
}

// A player box takes its video's own shape (Jon, 2026-11-16: "always make sure the video player is same sizing as the video
// itself"): --ar is width / height as a number, from the stored size or 16:9 until the file's metadata says otherwise
// (public/app.js). CSS caps the box at about 80vh and centres it; the width follows from the ratio.
export const arOf = (w, h) => {
  const n = Number(w) / Number(h);
  return Number.isFinite(n) && n > 0.05 && n < 20 ? String(Math.round(n * 1e5) / 1e5) : "1.77778";
};
const frameStyle = (w, h) => ` style="--ar:${arOf(w, h)}"${Number(w) > 0 && Number(h) > 0 ? ' data-known="1"' : ""}`;

// `prefix` is "" on jonmac.ai/review and "/dashboard" when the dashboard serves the same pages.
const layout = (title, body, { script = false, prefix = "", module = false } = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${prefix}/review/_/app.css">
${script ? `<script src="${prefix}/review/_/${script === true ? "app.js" : script}"${module ? ' type="module"' : " defer"}></script>\n` : ""}</head>
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
// `passed` (Jon, 2026-11-09): the slugs QC passed. Given, only those count, so a newer version QC hasn't passed waits
// off the list; null means the dashboard could not say, and the list is empty, with a note (the QC gate fails closed).
const CLEARED_BEFORE = "2026-10-17"; // Jon cleared the Oct 14 to 16 batch off the list
export const stem = (slug) => slug.replace(/-v\d+[a-z]?$/, ""); // v9b, a fix on top of v9, is the same video
export function openVideos(videos, passed = undefined) {
  if (passed === null) return [];
  const newest = new Map();
  for (const v of videos) {
    if (passed && !passed.has(v.slug)) continue;
    if (!(newest.get(stem(v.slug))?.created_at >= v.created_at)) newest.set(stem(v.slug), v);
  }
  return [...newest.values()].filter((v) => v.status !== "approved" && v.created_at >= CLEARED_BEFORE);
}

export function renderIndex({ channels, videos, passed }, message = "", prefix = "") {
  const open = openVideos(videos, passed);
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
  ${passed === null ? `<p class="error" role="status">QC results could not be read from the dashboard, so no video is shown until they can be. Reload in a minute.</p>` : ""}
  ${sections}
</main>`, { prefix });
}

// Secondary player (first-60 clip): collapsed, muted, never preloaded or autoplayed.
const extra = (id, label, url) => url ? `<details class="extra" id="${id}"><summary>${label}</summary>
    <div class="frame"${frameStyle()}><video id="${id}-player" class="extra-player" controls playsinline webkit-playsinline muted preload="none" src="${escapeHtml(url)}" aria-label="${label}"></video></div>
  </details>` : "";

// Ours, with the drawing canvas laid over it (public/app.js).
const ours = (video) => `<div class="stage frame"${frameStyle(video.video_w, video.video_h)}><video id="player" controls playsinline webkit-playsinline preload="metadata"
    src="${escapeHtml(video.video_url)}#t=0.001" aria-label="Our video"></video><canvas id="ink" class="ink" aria-hidden="true"></canvas></div>`;

const qcOnlyNote = (gate, attrs = "") => gate.qcOnly ? `<p class="error" role="status" ${attrs}>${gate.qcUnknown ? "QC results could not be read from the dashboard. " : ""}QC only: this version is hidden from Jon's list until QC passes its dashboard proof. Approve still works: its card is told it still needs QC.</p>` : "";

// One video of a review group, as on the single page (Jon, 2026-11-16): the original beside ours. An original video is a
// muted second player (.group-source) with its own shape; a text-only Skool lesson shows its original text. Each box
// takes its own video's shape. A video with no original attached shows ours alone.
const groupDuo = (video) => {
  const ourPlayer = `<div class="frame"${frameStyle(video.video_w, video.video_h)}><video class="group-player" controls playsinline webkit-playsinline preload="none" src="${escapeHtml(video.video_url)}" aria-label="${escapeHtml(video.title)}"></video></div>`;
  if (video.source_url) {
    return `<div class="duo group-duo">
      <figure class="pane"><figcaption>Source <span class="muted">muted</span></figcaption>
        <div class="frame"${frameStyle(video.source_w, video.source_h)}><video class="group-source" controls playsinline webkit-playsinline muted preload="none" src="${escapeHtml(video.source_url)}" aria-label="Source video: ${escapeHtml(video.title)}"></video></div></figure>
      <figure class="pane"><figcaption>Ours</figcaption>${ourPlayer}</figure>
    </div>
    <div class="transport group-transport">
      <button type="button" data-both="play">Play both</button>
      <button type="button" data-both="pause">Pause both</button>
    </div>`;
  }
  const sourceText = video.source_text ? sanitizeSourceHtml(video.source_text) : "";
  if (sourceText) {
    return `<div class="duo group-duo">
      <figure class="pane"><figcaption>Source (Skool text lesson)</figcaption>
        <div class="frame source-frame"${frameStyle(video.video_w, video.video_h)}><article class="source-text" tabindex="0" aria-label="Original lesson text">${sourceText}</article></div></figure>
      <figure class="pane"><figcaption>Ours</figcaption>${ourPlayer}</figure>
    </div>`;
  }
  return ourPlayer;
};

// A review group (/review/g/<name>): one player per video, stacked in the group's order, each with its own note,
// Submit changes and Approve (public/group.js), sent to the same endpoints as the single page. preload="none" keeps a
// long batch light on a phone. items: [{ video, gate }] or [{ slug, missing: true }].
export function renderGroup(group, items, prefix = "") {
  const data = JSON.stringify({ api: `${prefix}/api/review` }).replace(/</g, "\\u003c");
  const blocks = items.map((item, i) => {
    if (item.missing) return `<section class="group-item" data-missing="${escapeHtml(item.slug)}"><h2>${i + 1}. ${escapeHtml(item.slug)}</h2>
    <p class="muted">Not published yet.</p></section>`;
    const { video, gate } = item;
    return `<section class="group-item" data-slug="${escapeHtml(video.slug)}" data-sync="${escapeHtml(JSON.stringify(video.source_url ? video.sync || [] : []))}" aria-label="${escapeHtml(video.title)}">
    <h2>${i + 1}. ${escapeHtml(video.title)} <span class="muted">${escapeHtml(video.version)}</span> ${chip(video.status)}</h2>
    ${qcOnlyNote(gate)}
    ${groupDuo(video)}
    <p class="muted"><a href="${prefix}/review/${escapeHtml(video.slug)}">Open the full page</a> (side by side, drawing, voice notes)</p>
    <textarea class="group-note" rows="2" maxlength="4000" placeholder="What should change? Pause the video first: the note gets that time."></textarea>
    <div class="send-btns">
      <button type="button" class="primary" data-act="changes">Submit changes</button>
      <button type="button" class="approve" data-act="approve"${video.status === "approved" ? " disabled" : ""}>${video.status === "approved" ? "Approved" : "Approve"}</button>
    </div>
    <p class="muted group-status" role="status"></p>
  </section>`;
  }).join("\n  ");
  const title = group.title || group.name;
  return layout(title, `<main class="group">
  <p class="crumbs"><a href="${prefix}/review">All videos</a> / Group</p>
  <header class="top"><h1>${escapeHtml(title)} <span class="muted">${items.length} video${items.length === 1 ? "" : "s"}</span></h1></header>
  <div class="who"><label for="author">Your name</label>
    <input id="author" maxlength="60" autocomplete="name" placeholder="Shown next to your notes"></div>
  ${blocks || '<p class="muted">This group has no videos yet.</p>'}
  <script type="application/json" id="group-data">${data}</script>
</main>`, { script: "group.js", prefix });
}

// Back / Next through the slug's review group (gate.nav: {label, prev, next}); Left / Right arrows do the same (app.js).
const groupNav = (nav, prefix) => `<nav class="group-nav" aria-label="${escapeHtml(nav.label)}">
    ${nav.prev ? `<a class="nav-btn" id="nav-prev" rel="prev" href="${prefix}/review/${escapeHtml(nav.prev)}">&larr; Back</a>`
      : '<span class="nav-gap"></span>'}
    <span class="nav-pos">${escapeHtml(nav.label)}</span>
    ${nav.next ? `<a class="nav-btn" id="nav-next" rel="next" href="${prefix}/review/${escapeHtml(nav.next)}">Next &rarr;</a>`
      : '<span class="nav-gap"></span>'}
  </nav>`;

// gate.qcOnly: QC hasn't passed this version, so the page says so and has no status buttons. Approve stays (Jon, 2026-11-17: Approve on every review page).
// gate.nav: Back / Next when the slug is in a review group.
export function renderVideo(video, versions, channelName, submissions = [], prefix = "", gate = {}) {
  const data = JSON.stringify({ slug: video.slug, duration: video.duration, chapters: video.chapters, status: video.status, sync: video.sync, submissions, qcOnly: Boolean(gate.qcOnly),
    base: `${prefix}/review`, api: `${prefix}/api/review`, dashboard: Boolean(prefix) })
    .replace(/</g, "\\u003c");
  const versionLinks = versions.length > 1 ? `<nav class="version-nav" aria-label="Versions">${versions.map((v) =>
    v.slug === video.slug
      ? `<span class="current">${escapeHtml(v.version)}</span>`
      : `<a href="${prefix}/review/${escapeHtml(v.slug)}">${escapeHtml(v.version)}</a>`).join("")}${prefix ? ""
      : `<a class="compare-link" href="/review/${escapeHtml(video.slug)}/compare">Compare versions</a>`}</nav>` : "";
  const sourceText = video.source_url || !video.source_text ? "" : sanitizeSourceHtml(video.source_text);
  const statusButtons = Object.entries(STATUS_LABEL).map(([value, label]) =>
    `<button type="button" class="status-btn" data-status="${value}" aria-pressed="${video.status === value}">${label}</button>`).join("");
  return layout(`${channelName} · ${video.title} ${video.version}`, `<main class="watch">
  <p class="crumbs">${prefix ? `<a href="${prefix}/">Dashboard</a> / ` : ""}<a href="${prefix}/review">All videos</a> / ${escapeHtml(channelName)}</p>
  <header class="top">
    <h1>${escapeHtml(video.title)} <span class="muted">${escapeHtml(video.version)}</span></h1>
    ${versionLinks}
  </header>
  ${qcOnlyNote(gate, 'id="qc-only"')}
  ${video.source_url ? `<div class="duo" id="duo">
    <figure class="pane"><figcaption>Source <span class="muted" id="source-audio">muted</span></figcaption>
      <div class="frame"${frameStyle(video.source_w, video.source_h)}><video id="source-player" controls playsinline webkit-playsinline muted preload="metadata"
        src="${escapeHtml(video.source_url)}#t=0.001" aria-label="Source video"></video></div>
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
  </div>` : sourceText ? `<div class="duo" id="duo">
    <figure class="pane"><figcaption>Source (Skool text lesson)</figcaption>
      <div class="frame source-frame"${frameStyle(video.video_w, video.video_h)}><article class="source-text" id="source-text" tabindex="0" aria-label="Original lesson text">${sourceText}</article></div></figure>
    <figure class="pane"><figcaption>Ours</figcaption>
      ${ours(video)}</figure>
  </div>` : ours(video)}
  ${gate.nav ? groupNav(gate.nav, prefix) : ""}
  ${video.chapters.length ? `<div class="chapters" id="chapters">${video.chapters.map(([t, label]) =>
    `<button type="button" data-t="${Number(t)}">${formatTime(t)} ${escapeHtml(label)}</button>`).join("")}</div>` : ""}
  ${gate.qcOnly ? "" : `<div class="status-row"><span class="muted">Status</span><div class="status-btns" id="status">${statusButtons}</div></div>`}
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

// Version compare (/review/<slug>/compare, public/compare.js): two version pickers, the two players side by side (stacked on
// a phone) driven by one play / seek control, a strip of each version's changed spans under them (only when its vN.json was
// published), timed comments on either player and "Send as fix brief", which is the page's own Submit changes for that version.
// page: {title, slug, versions: [{slug, version, video_url, duration, video_w, video_h, changes}], a, b}
export function renderCompare(page, channelName, prefix = "") {
  const data = JSON.stringify({ ...page, base: `${prefix}/review`, api: `${prefix}/api/review` }).replace(/</g, "\u003c");
  const options = (pick) => page.versions.map((v) =>
    `<option value="${escapeHtml(v.slug)}"${v.slug === pick ? " selected" : ""}>${escapeHtml(v.version)}</option>`).join("");
  const side = (key, pick) => {
    const v = page.versions.find((x) => x.slug === pick) || page.versions[0];
    return `<figure class="pane" data-side="${key}"><figcaption><label>${key.toUpperCase()} <select id="pick-${key}" aria-label="Version ${key.toUpperCase()}">${options(pick)}</select></label>
      <span class="muted" id="audio-${key}">${key === "b" ? "sound on" : "muted"}</span></figcaption>
      <div class="frame"${frameStyle(v?.video_w, v?.video_h)}><video id="player-${key}" controls playsinline webkit-playsinline preload="metadata"${key === "a" ? " muted" : ""}
        src="${escapeHtml(v?.video_url || "")}#t=0.001" aria-label="Version ${key.toUpperCase()}"></video></div></figure>`;
  };
  const list = (key) => `<section class="send" data-side="${key}" aria-label="Comments on ${key.toUpperCase()}"><h2 id="list-${key}-title">${key.toUpperCase()}</h2>
      <ol class="clist" id="list-${key}"></ol>
      <button type="button" class="primary" id="brief-${key}">Send as fix brief</button>
      <pre class="brief" id="brief-preview-${key}" hidden></pre>
      <p class="muted" id="brief-status-${key}" role="status"></p></section>`;
  return layout(`${channelName} · ${page.title} · compare versions`, `<main class="watch compare">
  <p class="crumbs"><a href="${prefix}/review">All videos</a> / ${escapeHtml(channelName)} / <a href="${prefix}/review/${escapeHtml(page.slug)}">${escapeHtml(page.title)}</a></p>
  <header class="top"><h1>${escapeHtml(page.title)} <span class="muted">compare versions</span></h1></header>
  <div class="duo" id="duo">
    ${side("a", page.a)}
    ${side("b", page.b)}
  </div>
  <div class="transport" id="transport">
    <button type="button" class="primary" id="play-both">Play both</button>
    <button type="button" id="pause-both">Pause both</button>
    <input type="range" id="scrub" min="0" max="1" step="0.1" value="0" aria-label="Seek both">
    <span class="scrub-time" id="scrub-time">0:00</span>
    <span class="audio-switch" role="radiogroup" aria-label="Sound from">Sound:
      <label><input type="radio" name="audio" value="a"> A</label>
      <label><input type="radio" name="audio" value="b" checked> B</label></span>
  </div>
  <section class="strips" id="strips" aria-label="Changed parts" hidden></section>
  <section class="composer" aria-label="Add a timed comment">
    <form id="comment-form" novalidate>
      <div class="who" id="who"><label for="author">Your name</label>
        <input id="author" name="author" maxlength="60" autocomplete="name" placeholder="Shown next to your comments"></div>
      <p class="who-known" id="who-known" hidden>Commenting as <b id="who-name"></b> · <button type="button" class="link" id="who-change">change</button></p>
      <div class="stamp-row"><span>Comment on</span>
        <span class="audio-switch" role="radiogroup" aria-label="Comment on">
          <label><input type="radio" name="on" value="a"> <span id="on-a">A</span></label>
          <label><input type="radio" name="on" value="b" checked> <span id="on-b">B</span></label></span>
        <span>at</span> <button type="button" class="stamp" id="stamp" title="Jump both players to this time">0:00</button>
        <button type="button" class="link" id="stamp-now">use current time</button></div>
      <textarea id="note" name="text" rows="3" maxlength="4000" placeholder="Pause, then type what should change at this moment"></textarea>
      <div class="actions"><button type="submit" class="primary" id="submit">Add comment</button><span class="muted" id="form-status" role="status"></span></div>
    </form>
  </section>
  <div class="compare-lists">
    ${list("a")}
    ${list("b")}
  </div>
  <script type="application/json" id="compare-data">${data}</script>
</main>`, { script: "compare.js", prefix, module: true });
}
