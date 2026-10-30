#!/usr/bin/env node
// Transcribe a review video's voice notes on GPU1 and post the text back (Jon, 2026-10-30). The bot woken by a
// card_comment with data.review.audio runs it once. It never loops or waits for new notes. Node 18+, no deps.
//
//   node review_voice.mjs --slug topview-2-v2 [--comment <id>] [--base https://jonmac.ai]
//
// For each voice note on that video with no transcript yet (or only --comment, even if it has one):
// download it with REVIEW_API_TOKEN (env, or ~/.jonmac-review.env), run Parakeet under the GPU1 queue
//   python D:\gpu-queue\gpuq.py run --model parakeet -- D:\envs\parakeet\Scripts\python.exe -I
//     C:\Users\jonst\aieditor\tools\parakeet_transcribe.py <audio> <out.json>
// and POST the text to /api/review/<slug>/comments/<id>/transcript. Prints {ok, slug, transcribed: [{id, t, transcript}]}.
// GPUQ_PYTHON, GPUQ, PARAKEET_PYTHON and PARAKEET_SCRIPT override those paths. On failure it sends script_failure
// through D:\AgentTeam\tools\hook.py (HOOK_PY overrides it) and exits 1.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile, parseArgs } from "./review_publish.mjs";

const setting = (name, fallback) => process.env[name] || fallback;
const EXT = { "audio/mp4": "m4a", "audio/webm": "webm", "audio/ogg": "ogg" };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(args["env-file"] || join(homedir(), ".jonmac-review.env"));
  const base = (args.base || process.env.REVIEW_BASE_URL || "https://jonmac.ai").replace(/\/+$/, "");
  const token = process.env.REVIEW_API_TOKEN;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(args.slug || "")) throw new Error("--slug is required (lowercase letters, digits and dashes)");
  if (!token) throw new Error("REVIEW_API_TOKEN is not set (env or ~/.jonmac-review.env)");
  const auth = { Authorization: `Bearer ${token}` };
  const api = `${base}/api/review/${args.slug}/comments`;
  const listed = await fetch(api, { headers: auth });
  if (!listed.ok) throw new Error(`Listing the comments failed: HTTP ${listed.status}`);
  const todo = (await listed.json()).comments.filter((c) => c.audio_url && (args.comment ? c.id === args.comment : !c.transcript));
  if (args.comment && !todo.length) throw new Error(`No voice note on comment ${args.comment}`);
  const dir = mkdtempSync(join(tmpdir(), "review-voice-"));
  const transcribed = [];
  try {
    for (const c of todo) {
      const audio = await fetch(`${api}/${encodeURIComponent(c.id)}/audio`, { headers: auth });
      if (!audio.ok) throw new Error(`Downloading voice note ${c.id} failed: HTTP ${audio.status}`);
      const file = join(dir, `${c.id}.${EXT[audio.headers.get("content-type")] || "audio"}`);
      const out = join(dir, `${c.id}.json`);
      writeFileSync(file, Buffer.from(await audio.arrayBuffer()));
      const run = spawnSync(setting("GPUQ_PYTHON", "python"), [setting("GPUQ", "D:\\gpu-queue\\gpuq.py"), "run", "--model", "parakeet", "--who", "review-voice", "--",
        setting("PARAKEET_PYTHON", "D:\\envs\\parakeet\\Scripts\\python.exe"), "-I",
        setting("PARAKEET_SCRIPT", "C:\\Users\\jonst\\aieditor\\tools\\parakeet_transcribe.py"), file, out], { encoding: "utf8", windowsHide: true });
      if (run.status !== 0) throw new Error(`Parakeet failed on voice note ${c.id}: ${(run.stderr || run.error?.message || "").trim().slice(-300)}`);
      const transcript = String(JSON.parse(readFileSync(out, "utf8")).text || "").trim() || "(no speech heard)";
      const posted = await fetch(`${api}/${encodeURIComponent(c.id)}/transcript`, {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ text: transcript }),
      });
      if (!posted.ok) throw new Error(`Posting the transcript of ${c.id} failed: HTTP ${posted.status}`);
      transcribed.push({ id: c.id, t: c.t, transcript });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ok: true, slug: args.slug, transcribed }, null, 2));
}

main().catch((error) => {
  console.error(`review_voice failed: ${error.message}`);
  const hook = setting("HOOK_PY", "D:\\AgentTeam\\tools\\hook.py");
  if (existsSync(hook)) {
    spawnSync("python", ["-I", hook, "fire", "script_failure", "--data", "-"],
      { input: JSON.stringify({ script: "review_voice", error: error.message.slice(0, 500) }), windowsHide: true, timeout: 60000 });
  }
  process.exit(1);
});
