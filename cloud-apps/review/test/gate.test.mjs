// Bot writes to a review page go through the gates (card t_857032018ae54620): /meta and /source only with
// tools/review_edit.mjs's marker (sha256 of the exact body), /publish only with publish_gate.py's PASS for that file.
// Jon's own session writes (status) are unaffected. Dummy slugs only.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SECRETS, allPassed, startRuntime } from "./harness.mjs";

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}`, "Content-Type": "application/json" };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const marked = (body) => ({ ...agent, "X-Review-Gate": `review_edit:${sha(body)}` });
let runtime, cookie;
const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });
const call = async (path, init) => { const res = await fetchApp(path, init); return { status: res.status, text: await res.text() }; };

const SLUG = "gate-video-v1";
const VIDEO_SHA = sha("video bytes");
const publishBody = (gate) => JSON.stringify({ channel: "test", video: "gate-video", version: "v1", title: "Gate test",
  video_key: `review/${SLUG}/video-test.mp4`, video_w: 1080, video_h: 1920, video_sha256: VIDEO_SHA, ...(gate ? { gate } : {}) });

before(async () => {
  runtime = await startRuntime({ bindings: { ...SECRETS, REVIEW_GATE: "on" }, dashboard: allPassed(() => runtime) });
  await runtime.bucket.put(`review/${SLUG}/video-test.mp4`, new Uint8Array([0, 0, 0, 24]));
  const login = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  await login.arrayBuffer();
});
after(async () => runtime?.mf.dispose());

test("publish: refused without a PASS gate for this file, accepted with one", async () => {
  const url = `/api/review/${SLUG}/publish`;
  for (const gate of [null, { verdict: "FAIL", sha256: VIDEO_SHA }, { verdict: "PASS", sha256: sha("other file") },
    { verdict: "PASS", sha256: VIDEO_SHA, stubbed: ["ffprobe"] }]) {
    const r = await call(url, { method: "POST", headers: agent, body: publishBody(gate) });
    assert.equal(r.status, 403, `${JSON.stringify(gate)}: ${r.text}`);
    assert.match(r.text, /publish_gate_required/);
  }
  const ok = await call(url, { method: "POST", headers: agent, body: publishBody({ verdict: "PASS", sha256: VIDEO_SHA, stubbed: [] }) });
  assert.ok(ok.status === 200 || ok.status === 201, ok.text);
});

test("meta: refused unmarked or with a wrong hash, accepted with the right marker", async () => {
  const url = `/api/review/${SLUG}/meta`;
  const body = JSON.stringify({ title: "New title" });
  for (const headers of [agent, marked("something else"), { ...agent, "X-Review-Gate": "review_edit:nothex" }]) {
    const r = await call(url, { method: "POST", headers, body });
    assert.equal(r.status, 403, r.text);
    assert.match(r.text, /edit_gate_required/);
  }
  const ok = await call(url, { method: "POST", headers: marked(body), body });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(JSON.parse(ok.text).video.title, "New title");
});

test("source: POST and DELETE refused unmarked, accepted marked", async () => {
  const url = `/api/review/${SLUG}/source`;
  const upBody = JSON.stringify({ kind: "source" });
  const up = JSON.parse((await call(`/api/review/${SLUG}/uploads`, { method: "POST", headers: agent, body: upBody })).text);
  await runtime.bucket.put(up.key, new Uint8Array([0, 0, 0, 24]));
  const body = JSON.stringify({ source_key: up.key });
  const bad = await call(url, { method: "POST", headers: agent, body });
  assert.equal(bad.status, 403, bad.text);
  const ok = await call(url, { method: "POST", headers: marked(body), body });
  assert.equal(ok.status, 200, ok.text);
  const badDel = await call(url, { method: "DELETE", headers: agent });
  assert.equal(badDel.status, 403, badDel.text);
  const okDel = await call(url, { method: "DELETE", headers: marked("") });
  assert.equal(okDel.status, 200, okDel.text);
});

test("Jon's session: status writes unaffected, gated writes still agent-only", async () => {
  const status = await call(`/api/review/${SLUG}/status`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "changes_requested" }) });
  assert.equal(status.status, 200, status.text);
  const meta = await call(`/api/review/${SLUG}/meta`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "x" }) });
  assert.equal(meta.status, 403);
  assert.match(meta.text, /agent_token_required/);
});
