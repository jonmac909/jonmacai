// Version compare, the pure part: the changed spans of a version (<project>/v2/versions/vN.json, published with the version)
// and the fix brief built from a version's open timed comments. Shared by the Worker (router and dashboard card) and the
// compare page (public/compare.js); test/compare.test.mjs covers it. No DOM, no network.

const MAX_SPANS = 500;
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const words = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ms = (n) => Math.round(n * 1000) / 1000;

// One span {from, to, what}; also takes start/end and a [from, to, what] triple. null when it has no real time range.
export function normalizeSpan(raw) {
  if (Array.isArray(raw)) raw = { from: raw[0], to: raw[1], what: raw[2] };
  if (!raw || typeof raw !== "object") return null;
  let from = num(raw.from ?? raw.start), to = num(raw.to ?? raw.end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (to < from) [from, to] = [to, from];
  from = Math.max(0, from);
  if (to <= from) return null;
  return { from: ms(from), to: ms(to), what: words(raw.what ?? raw.label ?? raw.note, 200) };
}

// A version's changes as vN.json holds them: {version?, reason, changes|spans: [{from, to, what}]}, or a bare list of
// spans. Answers {version, reason, spans} (spans by start time), or null when it is not that shape at all.
export function normalizeChanges(raw) {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return null; } }
  if (Array.isArray(raw)) raw = { spans: raw };
  if (!raw || typeof raw !== "object") return null;
  const list = [raw.spans, raw.changes, raw.changed, raw.diff].find(Array.isArray);
  const reason = words(raw.reason ?? raw.why ?? raw.summary, 1000);
  if (!list && !reason) return null;
  const spans = (list || []).slice(0, MAX_SPANS).map(normalizeSpan).filter(Boolean)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const version = words(typeof raw.version === "number" ? `v${raw.version}` : raw.version, 40) || null;
  return { version, reason, spans };
}

// Where each span sits on a strip of the video's length: left and width in percent, clipped to the video, at least
// minWidth wide so a one-second change is still a target. Spans that start after the end are left out.
export function stripLayout(spans, duration, minWidth = 0.8) {
  const d = Number(duration);
  if (!Array.isArray(spans) || !Number.isFinite(d) || d <= 0) return [];
  return spans.filter((s) => s.from < d).map((s, index) => {
    const left = (s.from / d) * 100;
    const width = Math.max(minWidth, ((Math.min(s.to, d) - s.from) / d) * 100);
    return { index, span: s, left: Math.round(left * 100) / 100, width: Math.round(Math.min(width, 100 - left) * 100) / 100 };
  });
}

// The span playing at time t (the first one holding it), or null.
export function spanAt(spans, t) {
  if (!Array.isArray(spans) || !Number.isFinite(Number(t))) return null;
  return spans.find((s) => t >= s.from && t < s.to) || null;
}

export function clock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// The open comments of one version (not resolved, not yet sent), earliest first.
export const openComments = (comments) => (Array.isArray(comments) ? comments : [])
  .filter((c) => c && !c.resolved && !c.sent && !c.submission_id)
  .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));

// One fix brief from a version's comments: every comment with its time, the changed span it falls in (so the agent
// knows whether Jon is reacting to this version's change), and the version's reason. `onlyOpen` (default) keeps the open,
// unsent ones, as the compare page's "Send as fix brief" does; the Worker passes the submitted ones with onlyOpen false.
// null when there is nothing to send.
export function buildFixBrief({ title = "", version = "", comments = [], changes = null, compareWith = "", onlyOpen = true } = {}) {
  const list = onlyOpen ? openComments(comments) : [...(comments || [])].sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));
  if (!list.length) return null;
  const spans = changes?.spans || [];
  const head = `Fix brief: ${[title, version].filter(Boolean).join(" ") || "this version"} (${list.length} comment${list.length === 1 ? "" : "s"})`;
  const lines = [head];
  if (changes?.reason) lines.push(`Why this version was made: ${changes.reason}`);
  if (compareWith) lines.push(`Watched side by side with ${compareWith}.`);
  for (const c of list) {
    const said = words(c.text, 4000) || words(c.transcript, 4000) || (c.audio_url || c.voice ? "(voice note)" : c.drawing ? "(drawing on the frame)" : "");
    const hit = spanAt(spans, Number(c.t));
    const where = hit ? ` [in changed part ${clock(hit.from)}-${clock(hit.to)}${hit.what ? `: ${hit.what}` : ""}]` : spans.length ? " [outside the changed parts]" : "";
    lines.push(`- ${clock(c.t)}${where} ${said}${c.author ? ` (${words(c.author, 60)})` : ""}`);
  }
  lines.push("Fix each point at its time, keep everything else as it is, then publish the next version.");
  return lines.join("\n");
}
