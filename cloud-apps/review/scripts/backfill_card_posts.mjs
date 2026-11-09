#!/usr/bin/env node
// One-off (2026-11-09): Jon's approvals on jonmac.ai/review from before the card hook never reached the dashboard
// (Rosa Clean 2: v3, v4 and v8 approved, nobody saw it). For every video whose newest submission, across all its
// versions, is an approval, this posts that approval to the video's card, once.
//
//   node scripts/backfill_card_posts.mjs [--apply] [--only <slug stem, e.g. rosa-clean-2>] [--out result.json]
//
// Reads only, by default (a dry run): every video and its submissions through the review API (GET, agent token), and
// the dashboard cards and newest 500 proofs (GET /dashboard/api/v1, the developer bot token) to show which card each
// approval maps to, with the dashboard's own title matcher (command-center src/reviewhook.js).
// --apply (after deploy): POST /api/review/submissions/<id>/card {backfill: true} for each. The review Worker posts a
// submission at most once (card_posts) and the dashboard leaves done cards alone and wakes no one without a card.
// Tokens: REVIEW_API_TOKEN (env or ~/.jonmac-review.env); dashboard token D:\AgentTeam\secrets\bot-tokens\<DASH_BOT or developer>.token.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cardByTitle } from "../../command-center/src/reviewhook.js";

const BASE = (process.env.REVIEW_BASE_URL || "https://jonmac.ai").replace(/\/+$/, "");
const DASH = process.env.DASH_BASE || "https://jonmac.ai/dashboard/api/v1";
const stem = (slug) => slug.replace(/-v\d+$/, "");
const REVIEW_PAGE = /jonmac\.ai\/(?:dashboard\/)?review\/(?:media\/)?([a-z0-9-]+)(?:[/?#]|$)/i;

function args(argv) {
  const out = { apply: false, only: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") out.apply = true;
    else if (argv[i] === "--only" || argv[i] === "--out") out[argv[i].slice(2)] = argv[++i];
    else throw new Error(`Unexpected argument: ${argv[i]}`);
  }
  return out;
}

function reviewToken() {
  const file = join(homedir(), ".jonmac-review.env");
  if (!process.env.REVIEW_API_TOKEN && existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*REVIEW_API_TOKEN\s*=\s*(.*?)\s*$/.exec(line);
      if (m) process.env.REVIEW_API_TOKEN = m[1].replace(/^["']|["']$/g, "");
    }
  }
  if (!process.env.REVIEW_API_TOKEN) throw new Error("REVIEW_API_TOKEN is not set (env or ~/.jonmac-review.env)");
  return process.env.REVIEW_API_TOKEN;
}

async function call(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method || "GET"} ${new URL(url).pathname} -> ${res.status} ${body.error || ""}`.trim());
  return body;
}

async function pool(items, size, work) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(work)));
  return out;
}

// Each video whose newest submission across its versions is an approval: [{stem, submission, video}].
async function standingApprovals(token, only) {
  const { videos } = await call(`${BASE}/api/review/videos`, token);
  const bySlug = new Map(videos.map((v) => [v.slug, v]));
  const picked = videos.filter((v) => !only || stem(v.slug) === only);
  const lists = await pool(picked, 8, (v) => call(`${BASE}/api/review/${v.slug}/submissions`, token).then((r) => r.submissions));
  const byStem = new Map();
  for (const s of lists.flat()) byStem.set(stem(s.slug), [...(byStem.get(stem(s.slug)) || []), s]);
  const out = [];
  for (const [key, subs] of byStem) {
    const [last] = subs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (last.kind === "approve") out.push({ stem: key, submission: last, video: bySlug.get(last.slug), older: subs.filter((s) => s.kind === "approve").length - 1 });
  }
  return out.sort((a, b) => a.submission.created_at.localeCompare(b.submission.created_at));
}

// The dashboard's cards (every status but cancelled) and the newest proofs, read with a bot token, for the dry run.
async function dashboardCards() {
  const bot = (process.env.DASH_BOT || "developer").trim().toLowerCase();
  const token = readFileSync(join(process.env.DASH_TOKEN_DIR || "D:\\AgentTeam\\secrets\\bot-tokens", `${bot}.token`), "utf8").trim();
  const lists = await pool(["todo", "doing", "waiting_on_jon", "qc", "review", "done"], 6,
    (status) => call(`${DASH}/tasks?status=${status}&limit=500`, token).then((r) => r.tasks));
  const tasks = lists.flat().map((t) => ({ id: t.id, title: t.title, owner: t.owner, status: t.status, project: t.project, updated_at: t.updatedAt }));
  const { proofs } = await call(`${DASH}/proofs?limit=500`, token);
  return { tasks, proofs, truncated: lists.some((l) => l.length >= 500) };
}

// Same order as the dashboard's findCard: (no stored task ids exist before deploy), title, then a proof on the page.
function predict(item, { tasks, proofs }) {
  const named = cardByTitle(item.video?.title, tasks);
  let task = named, by = named ? "title" : null;
  if (!task) {
    const byId = new Map(tasks.filter((t) => t.status !== "cancelled" && t.project !== "coding").map((t) => [t.id, t]));
    const hits = proofs.filter((p) => REVIEW_PAGE.exec(p.link || "")?.[1]?.toLowerCase() === item.submission.slug && byId.has(p.taskId)).map((p) => byId.get(p.taskId));
    task = hits.find((t) => t.status === "review") || hits[0] || null;
    by = task ? "proof (newest 500 proofs)" : null;
  }
  return { task, by, result: !task ? "no_card" : task.status === "done" ? "skipped" : "posted" };
}

async function main() {
  const opts = args(process.argv.slice(2));
  const token = reviewToken();
  const items = await standingApprovals(token, opts.only);
  const rows = [];
  if (opts.apply) {
    for (const item of items) {
      const r = await call(`${BASE}/api/review/submissions/${encodeURIComponent(item.submission.id)}/card`, token, { method: "POST", body: JSON.stringify({ backfill: true }) });
      rows.push({ stem: item.stem, slug: item.submission.slug, approved_at: item.submission.created_at, result: r.result, task: r.task || null });
    }
  } else {
    const cards = await dashboardCards();
    if (cards.truncated) console.error("WARNING: a status list hit 500 cards; some cards may be missing from the match");
    for (const item of items) {
      const p = predict(item, cards);
      rows.push({ stem: item.stem, slug: item.submission.slug, approved_at: item.submission.created_at, older_approvals: item.older,
        title: item.video?.title || null, would: p.result, matched_by: p.by,
        card: p.task ? { id: p.task.id, title: p.task.title, status: p.task.status, owner: p.task.owner } : null });
    }
  }
  if (opts.out) writeFileSync(opts.out, JSON.stringify({ mode: opts.apply ? "apply" : "dry-run", at: new Date().toISOString(), rows }, null, 1));
  const count = (k) => rows.filter((r) => (r.would || r.result) === k).length;
  console.log(`${opts.apply ? "APPLY" : "DRY RUN (nothing posted)"}: ${rows.length} videos whose newest submission is an approval. `
    + `${opts.apply ? "posted" : "would post"} ${count("posted")}, ${opts.apply ? "" : "would "}skip ${count("skipped")} (card done), no card ${count("no_card")}`
    + (opts.apply ? `, already posted ${count("already_posted")}, errors ${rows.filter((r) => String(r.result).startsWith("error")).length}` : ""));
  for (const r of rows) {
    console.log(`${r.would || r.result}\t${r.slug}\tapproved ${r.approved_at}\t${r.card ? `${r.card.id} [${r.card.status}, ${r.card.owner}] ${r.card.title} (by ${r.matched_by})` : r.task || "-"}`);
  }
}

main().catch((error) => {
  console.error(`backfill_card_posts: ${error.message}`);
  process.exit(1);
});
