// Jon's Approve and Submit changes reach the video's dashboard card and lock the video (Jon, 2026-11-09). The review
// Worker runs in workerd; its DASHBOARD binding is the real dashboard hook (command-center src/reviewhook.js) on a SQLite
// D1, and the owner's card_comment wake is caught by a fake fetch. Dummy slugs only.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Response as MFResponse } from "miniflare";
import { SECRETS, migrationStatements, startRuntime } from "./harness.mjs";
import { openVideos } from "../pages.js";

const cc = new URL("../../command-center/", import.meta.url);
// The Docker checks build with cloud-apps/review alone as context, so the dashboard's code is not there.
const skip = existsSync(new URL("src/reviewhook.js", cc)) ? false : "no command-center in this build context";
const [{ reviewHook }, { sqliteD1 }] = skip ? [{}, {}]
  : await Promise.all([import(new URL("src/reviewhook.js", cc)), import(new URL("test/sqlited1.mjs", cc))]);

const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}` };
const CARD = "t_00000000000000a1"; // "Dummy Dryer Video - Test Channel", video-editor, doing
const DONE = "t_00000000000000a2"; // the same name, done: an open card wins
const CODING = "t_00000000000000a3"; // the same name on a Coding card: never the video's card
const OTHER = "t_00000000000000b1"; // a differently named card, linked by the stored task id
const TITLE = "DUMMY dryer video! - Test Channel (v1)"; // case, punctuation and a (vN) tail all differ from the card
const HOOKS = Object.fromEntries(["video-editor", "home-guide-press", "ana"].map((bot) => [bot, { url: `https://hooks.example/${bot}`, secret: `whsec_${bot}` }]));

let runtime, cookie, ccDb, dashboardDown = false, submissionDown = false;
const wakes = [];
const realFetch = globalThis.fetch;

const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });
const jsonInit = (method, body, headers = agent) => ({ method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const asJon = () => ({ Cookie: cookie });
const call = async (path, init) => {
  const res = await fetchApp(path, init);
  return { status: res.status, body: await res.json() };
};
async function publish(slug, extra = {}) {
  const key = `review/${slug}/video-test.mp4`;
  await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
  const [, video, version] = /^(.*)-(v\d+[a-z]?)$/.exec(slug);
  return call(`/api/review/${slug}/publish`, jsonInit("POST", { channel: "test", video, version, title: TITLE, video_key: key, ...extra }));
}
const submit = (slug, kind) => call(`/api/review/${slug}/submit`, jsonInit("POST", { kind }, asJon()));
const rows = async (sql, ...args) => (await ccDb.prepare(sql).bind(...args).all()).results;
const cardComments = (id) => rows("SELECT author, body, wake_status FROM bot_task_comments WHERE task_id = ? ORDER BY created_at, rowid", id);
const cardHistory = (id) => rows("SELECT \"by\", kind, detail FROM bot_task_events WHERE task_id = ? AND kind = 'review' ORDER BY at, rowid", id);
// QC passes a version: a passed proof on a card, checked now (after the version's file was published).
const qcPass = (slug, link = `https://jonmac.ai/review/${slug}`, task = CARD) => ccDb.prepare(`INSERT INTO bot_proofs (id, task_id, kind, link, status,
    created_by, created_at, checked_by, checked_at) VALUES (?, ?, 'render', ?, 'passed', 'video-editor', ?, 'qc', ?)`)
  .bind(`p_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, task, link, new Date().toISOString(), new Date().toISOString()).run();

before(async () => {
  if (skip) return;
  ccDb = sqliteD1();
  const at = "2026-11-09T12:00:00.000Z";
  for (const [id, title, owner, status, project] of [
    [CARD, "Dummy Dryer Video - Test Channel", "video-editor", "doing", "home-guide-press"],
    [DONE, "Dummy dryer video - Test Channel", "home-guide-press", "done", "home-guide-press"],
    [CODING, "Dummy Dryer Video - review tool", "developer", "doing", "coding"],
    [OTHER, "Something else entirely - Test Channel", "home-guide-press", "doing", "home-guide-press"],
  ]) {
    await ccDb.prepare("INSERT INTO bot_tasks (id, title, owner, status, project, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ana', 'ana', ?, ?)")
      .bind(id, title, owner, status, project, at, at).run();
  }
  const ccEnv = { DB: ccDb, REVIEW_API_TOKEN: SECRETS.REVIEW_API_TOKEN, WEBHOOKS: JSON.stringify(HOOKS) };
  // The owner's wake leaves the dashboard as a plain fetch: caught here, everything else goes through.
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://hooks.example/")) return realFetch(url, init);
    wakes.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(null, { status: 202 });
  };
  runtime = await startRuntime({
    dashboard: async (request) => {
      if (dashboardDown || (submissionDown && !request.url.endsWith("/qc"))) return new MFResponse("down", { status: 500 });
      const res = await reviewHook(request, ccEnv); // no ctx: the wake is one awaited try
      return new MFResponse(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
    },
  });
  const login = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  await login.arrayBuffer();
});
after(async () => {
  globalThis.fetch = realFetch;
  await runtime?.mf.dispose();
});

test("approve: Jon's comment and a history line land on the card, and its owner is woken", { skip }, async () => {
  assert.equal((await publish("dummy-1-v1")).status, 201);
  await qcPass("dummy-1-v1");
  const approved = await submit("dummy-1-v1", "approve");
  assert.equal(approved.status, 201);
  assert.equal(approved.body.card, "posted");
  assert.equal(approved.body.cardNote, "It is on the video's dashboard card and video-editor was told.");

  const [comment, ...more] = await cardComments(CARD);
  assert.equal(more.length, 0);
  assert.equal(comment.author, "jon");
  assert.equal(comment.body, 'Jon approved v1 of "DUMMY dryer video! - Test Channel" on the review page. That version is final: upload it, '
    + "and don't post a newer one unless he asks for changes.\nhttps://jonmac.ai/review/dummy-1-v1");
  assert.equal(comment.wake_status, "202");
  assert.deepEqual(await cardHistory(CARD), [{ by: "jon", kind: "review", detail: "approved v1 on the review page" }]);
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].url, "https://hooks.example/video-editor");
  assert.equal(wakes[0].body.type, "card_comment");
  assert.deepEqual([wakes[0].body.data.task, wakes[0].body.data.review.kind, wakes[0].body.data.review.slug], [CARD, "approve", "dummy-1-v1"]);
  for (const id of [DONE, CODING, OTHER]) assert.equal((await cardComments(id)).length, 0, id);

  // A second tap is the same submission: nothing new on the card.
  const twice = await submit("dummy-1-v1", "approve");
  assert.equal(twice.body.duplicate, true);
  assert.equal((await cardComments(CARD)).length, 1);
});

test("after an approval a newer version is refused with 409, until Jon asks for changes", { skip }, async () => {
  const upload = await call("/api/review/dummy-1-v2/uploads", jsonInit("POST", { kind: "video" }));
  assert.equal(upload.status, 409);
  assert.match(upload.body.error, /^Jon approved dummy-1-v1 on the review page \(.+ Kelowna\)\. That version is final: no new version of this video until he asks for changes/);
  assert.equal((await publish("dummy-1-v2")).status, 409);
  assert.equal((await publish("dummy-1-v1")).status, 409, "republishing the approved version is refused too");
  assert.equal((await call("/api/review/dummy-1-v2", { headers: agent })).status, 404, "nothing was written");
  assert.equal((await publish("dummy-10-v1")).status, 201, "another video whose slug starts the same is not locked");

  // Jon comments and asks for changes: the card gets the notes, and the next version goes through.
  const note = await call("/api/review/dummy-1-v1/comments", jsonInit("POST", { author: "Jon", t: 12.4, text: "Louder music" }, asJon()));
  assert.equal(note.status, 201);
  const changes = await submit("dummy-1-v1", "changes");
  assert.equal(changes.status, 201);
  assert.equal(changes.body.card, "posted");
  const comments = await cardComments(CARD);
  assert.equal(comments.length, 2);
  assert.equal(comments[1].body, 'Jon asked for changes on v1 of "DUMMY dryer video! - Test Channel" on the review page, 1 note.\n'
    + "https://jonmac.ai/review/dummy-1-v1\n- 0:12 Louder music");
  assert.equal((await cardHistory(CARD))[1].detail, "changes asked on v1 on the review page (1 note)");
  assert.equal(wakes.at(-1).body.data.review.kind, "changes");
  assert.equal((await publish("dummy-1-v2")).status, 201);

  // Approving the new version (once QC passed it) locks the video again.
  await qcPass("dummy-1-v2");
  assert.equal((await submit("dummy-1-v2", "approve")).status, 201);
  assert.equal((await publish("dummy-1-v3")).status, 409);
  const subs = await call("/api/review/submissions", { headers: agent });
  assert.deepEqual(subs.body.submissions.filter((s) => s.slug.startsWith("dummy-1-")).map((s) => [s.slug, s.kind]),
    [["dummy-1-v2", "approve"], ["dummy-1-v1", "changes"], ["dummy-1-v1", "approve"]], "every press kept, newest first");
});

test("a QC fix on top of an approved version goes up with a fix note, stays QC-only and never reaches Jon's list", { skip }, async () => {
  const jonList = async () => (await call("/api/review/jon-list", { headers: agent })).body.slugs.filter((s) => s.startsWith("fixv-"));
  const fix = { fix: "New opening: host on screen from the first frame", title: "Fix test video - Nowhere" }; // no card: Jon's approve posts nowhere
  assert.equal((await publish("fixv-2-v1", fix)).status, 409, "a fix needs a standing approval");
  assert.equal((await publish("fixv-1-v1", { title: fix.title })).status, 201);
  await qcPass("fixv-1-v1");
  assert.equal((await submit("fixv-1-v1", "approve")).status, 201);

  const plain = await publish("fixv-1-v2", { title: fix.title });
  assert.equal(plain.status, 409, "without a fix note the lock still holds");
  assert.match(plain.body.error, /--fix/);
  assert.equal((await call("/api/review/fixv-1-v2/uploads", jsonInit("POST", { kind: "video" }))).status, 409);
  assert.equal((await call("/api/review/fixv-1-v1b/uploads", jsonInit("POST", { kind: "video", ...fix }))).status, 201);
  assert.equal((await publish("fixv-1-v1", fix)).status, 409, "a fix never overwrites the approved version");

  const fixed = await publish("fixv-1-v1b", fix);
  assert.equal(fixed.status, 201);
  assert.equal(fixed.body.fix_of, "fixv-1-v1");
  assert.equal(fixed.body.qc_only, true);
  assert.equal(fixed.body.video.status, "approved");
  assert.equal(fixed.body.video.notes, "Fix on top of approved v1 (Jon's approval carries; upload it once QC passes): New opening: host on screen from the first frame");
  assert.deepEqual(await jonList(), [], "QC-only, and approved");
  const page = await (await fetchApp("/review/fixv-1-v1b", { headers: asJon() })).text();
  assert.match(page, /id="qc-only"/, "QC-only until QC passes it");
  await qcPass("fixv-1-v1b");
  assert.deepEqual(await jonList(), [], "after QC passes it still asks Jon nothing");
  assert.doesNotMatch(await (await fetchApp("/review/fixv-1-v1b", { headers: asJon() })).text(), /id="qc-only"/);

  // QC finds another fault: the same fix slug goes up again; anything without a fix note is still refused.
  assert.equal((await publish("fixv-1-v1b", fix)).status, 200);
  assert.equal((await publish("fixv-1-v3", { title: fix.title })).status, 409);
  const subs = await call("/api/review/submissions", { headers: agent });
  assert.deepEqual(subs.body.submissions.filter((s) => s.slug.startsWith("fixv-")).map((s) => [s.slug, s.kind]), [["fixv-1-v1", "approve"]],
    "a fix adds no submission");
});

test("a stored task id picks the card; each submission is posted once; a failed post can be retried", { skip }, async () => {
  assert.equal((await publish("dummy-2-v1", { task_id: "t_nope" })).status, 400);
  assert.equal((await publish("dummy-2-v1", { task_id: OTHER })).status, 201);
  await qcPass("dummy-2-v1");
  const approved = await submit("dummy-2-v1", "approve");
  assert.equal(approved.body.card, "posted");
  assert.equal(approved.body.cardNote, "It is on the video's dashboard card and home-guide-press was told.");
  assert.equal((await cardComments(OTHER)).length, 1, "the stored id beats the title match");
  const id = approved.body.submission.id;
  const again = await call(`/api/review/submissions/${id}/card`, jsonInit("POST", {}));
  assert.equal(again.body.result, "already_posted");
  assert.equal((await cardComments(OTHER)).length, 1, "never posted twice");
  assert.equal((await call(`/api/review/submissions/${id}/card`, jsonInit("POST", {}, asJon()))).status, 403, "agent token only");

  // The dashboard is down: Jon's approval still saves, the page says the card missed it, and a retry posts it.
  assert.equal((await publish("dummy-3-v1", { task_id: OTHER })).status, 201);
  await qcPass("dummy-3-v1");
  submissionDown = true;
  const missed = await submit("dummy-3-v1", "approve");
  assert.equal(missed.status, 201);
  assert.equal(missed.body.card, "error 500");
  assert.equal(missed.body.cardNote, "Saved, but the video's dashboard card could not be updated.");
  submissionDown = false;
  const retried = await call(`/api/review/submissions/${missed.body.submission.id}/card`, jsonInit("POST", {}));
  assert.equal(retried.body.result, "posted");
  assert.equal((await cardComments(OTHER)).length, 2);
  const tries = await runtime.db.prepare("SELECT result FROM card_posts WHERE submission_id = ? ORDER BY created_at").bind(missed.body.submission.id).all();
  assert.deepEqual(tries.results.map((r) => r.result), ["error 500", "posted"]);
});

test("Jon's list shows only each video's newest QC-passed version; nothing is deleted", { skip }, async () => {
  for (const slug of ["qcvid-1-v1", "qcvid-1-v2", "qcvid-1-v3", "qcvid-2-v1", "qcvid-4-v1"]) assert.equal((await publish(slug)).status, 201, slug);
  const proof = (n, task, link, status) => ccDb.prepare("INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at) VALUES (?, ?, 'render', ?, ?, 'video-editor', ?)")
    .bind(`p_00000000000000${n}`, task, link, status, new Date().toISOString()).run();
  await proof("c1", CARD, "https://jonmac.ai/review/qcvid-1-v1", "passed");
  await proof("c2", CARD, "https://jonmac.ai/dashboard/review/qcvid-1-v2", "passed");
  await proof("c3", CARD, "https://jonmac.ai/review/qcvid-1-v3", "pending"); // not checked yet
  await proof("c4", CODING, "https://jonmac.ai/review/qcvid-2-v1", "passed"); // a Coding card's test, not the video's QC
  await proof("c5", CARD, "https://jonmac.ai/review/media/qcvid-4-v1/video.mp4", "passed");
  const listed = async () => {
    const page = await (await fetchApp("/review", { headers: asJon() })).text();
    return { page, slugs: [...page.matchAll(/href="\/review\/(qcvid-[a-z0-9-]+)"/g)].map((m) => m[1]) };
  };
  const { page, slugs } = await listed();
  assert.deepEqual(slugs.sort(), ["qcvid-1-v2", "qcvid-4-v1"]);
  assert.doesNotMatch(page, /QC results could not be read/);
  const all = (await call("/api/review/videos", { headers: agent })).body.videos.map((v) => v.slug);
  for (const slug of ["qcvid-1-v1", "qcvid-1-v3", "qcvid-2-v1"]) assert.ok(all.includes(slug), `${slug} is kept`);
  assert.equal((await fetchApp("/review/qcvid-1-v3", { headers: asJon() })).status, 200, "a hidden version still opens by its link");

  // The dashboard can't say: the gate fails closed, so nothing is shown and the page says why.
  dashboardDown = true;
  const fallback = await listed();
  const jonList = (await call("/api/review/jon-list", { headers: agent })).body;
  const approve = await submit("qcvid-1-v2", "approve");
  dashboardDown = false;
  assert.deepEqual(fallback.slugs, []);
  assert.match(fallback.page, /QC results could not be read from the dashboard, so no video is shown/);
  assert.deepEqual(jonList, { qc_read: false, slugs: [] });
  assert.equal(approve.status, 503);
  assert.deepEqual(openVideos([{ slug: "a-1-v1", status: "needs_review", created_at: "2026-11-09" }], null), []);
});

test("QC gate: a new version is QC-only (off Jon's list, no Approve, no link to Jon) until QC passes it", { skip }, async () => {
  const page = async (slug) => (await fetchApp(`/review/${slug}`, { headers: asJon() })).text();
  const jonList = async () => (await call("/api/review/jon-list", { headers: agent })).body.slugs;
  const onIndex = async (slug) => (await (await fetchApp("/review", { headers: asJon() })).text()).includes(`href="/review/${slug}"`);
  const before = { comments: (await rows("SELECT id FROM bot_task_comments")).length, wakes: wakes.length };

  const published = await publish("gate-1-v1");
  assert.equal(published.status, 201);
  assert.deepEqual([published.body.qc_only, published.body.visible_to_jon], [true, "only after QC passes its dashboard proof"]);
  assert.equal(await onIndex("gate-1-v1"), false);
  assert.equal((await jonList()).includes("gate-1-v1"), false);
  const held = await page("gate-1-v1");
  assert.match(held, /QC only: this version is hidden from Jon's list and can't be approved/);
  assert.match(held, /<video id="player"/, "QC can still open and play it");
  assert.doesNotMatch(held, /id="approve"|id="status"/);
  const refused = await submit("gate-1-v1", "approve");
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /^QC has not passed this version yet/);
  assert.equal((await call("/api/review/gate-1-v1/status", jsonInit("POST", { status: "approved" }, asJon()))).status, 409);
  assert.equal((await call("/api/review/videos", { headers: asJon() })).body.videos.some((v) => v.slug === "gate-1-v1"), false, "not in a reviewer's JSON list");
  assert.ok((await call("/api/review/videos", { headers: agent })).body.videos.some((v) => v.slug === "gate-1-v1"), "agents still list it");
  // The status every API reader sees: needs_review only once QC passed this file; until then qc_only (the stored value is unchanged).
  const seen = async (as) => (await call("/api/review/gate-1-v1", { headers: as })).body.video;
  assert.deepEqual([(await seen(agent)).status, (await seen(agent)).qc_only], ["qc_only", true]);
  assert.equal((await call("/api/review/videos", { headers: agent })).body.videos.find((v) => v.slug === "gate-1-v1").status, "qc_only");
  assert.equal(published.body.video.status, "qc_only");
  assert.equal((await rows("SELECT 1 FROM bot_proofs WHERE link LIKE '%gate-1-v1' AND status = 'passed'")).length, 0);
  // A proof that is waiting for QC or failed it doesn't count.
  for (const [n, status] of [["f1", "pending"], ["f2", "failed"]]) {
    await ccDb.prepare("INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at) VALUES (?, ?, 'render', 'https://jonmac.ai/review/gate-1-v1', ?, 'video-editor', ?)")
      .bind(`p_00000000000000${n}`, CARD, status, new Date().toISOString()).run();
  }
  assert.equal(await onIndex("gate-1-v1"), false);
  assert.deepEqual([(await rows("SELECT id FROM bot_task_comments")).length, wakes.length], [before.comments, before.wakes], "no card or wake carried its link");

  // A newer QC-only version is never linked from a page Jon can open: not in the version nav, not as "New version ready".
  assert.equal((await publish("gate-2-v1")).status, 201);
  await qcPass("gate-2-v1");
  assert.equal((await publish("gate-2-v2")).status, 201);
  await call("/api/review/gate-2-v1/comments", jsonInit("POST", { author: "Jon", t: 1, text: "Trim the intro" }, asJon()));
  assert.equal((await submit("gate-2-v1", "changes")).status, 201);
  assert.equal((await call("/api/review/gate-2-v1/next", jsonInit("POST", { result_slug: "gate-2-v2" }))).status, 200);
  assert.doesNotMatch(await page("gate-2-v1"), /gate-2-v2/);
  assert.ok((await call("/api/review/gate-2-v1/submissions", { headers: asJon() })).body.submissions.every((s) => s.result_slug === null));
  assert.equal((await call("/api/review/gate-2-v1/submissions", { headers: agent })).body.submissions[0].result_slug, "gate-2-v2", "stored as sent");
  assert.ok((await jonList()).includes("gate-2-v1"));

  // QC passes them: they show, link and approve like any version.
  await qcPass("gate-1-v1");
  await qcPass("gate-2-v2");
  assert.deepEqual([(await seen(agent)).status, (await seen(agent)).qc_only], ["needs_review", false], "QC passed: now it is needs_review");
  assert.equal(await onIndex("gate-1-v1"), true);
  assert.match(await page("gate-1-v1"), /id="approve"/);
  assert.match(await page("gate-2-v1"), /href="\/review\/gate-2-v2"/);
  assert.equal((await submit("gate-1-v1", "approve")).status, 201);

  // A recut of a passed version is QC-only again until QC passes the new file.
  const key = "review/gate-2-v2/video-recut.mp4";
  await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
  assert.equal((await call("/api/review/gate-2-v2/publish", jsonInit("POST", { channel: "test", video: "gate-2", version: "v2", title: TITLE, video_key: key }))).status, 200);
  assert.equal((await jonList()).includes("gate-2-v2"), false);
  await qcPass("gate-2-v2");
  assert.equal((await jonList()).includes("gate-2-v2"), true);
});

test("existing versions are held by migration 0007, a new table only, until a QC pass after they were made", { skip }, async () => {
  const made = "2026-11-01T10:00:00.000Z";
  await runtime.db.prepare(`INSERT INTO videos (slug, channel, video, version, title, status, video_key, created_at, updated_at)
    VALUES ('legacy-1-v1', 'test', 'legacy-1', 'v1', 'Legacy video - Test Channel', 'needs_review', 'review/legacy-1-v1/video-old.mp4', ?, ?)`).bind(made, made).run();
  const snapshot = async () => [await runtime.db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS u, GROUP_CONCAT(status) AS s FROM videos").first(),
    await runtime.db.prepare("SELECT COUNT(*) AS n FROM submissions").first()];
  const was = await snapshot();
  const hold = migrationStatements().filter((s) => /INTO qc_holds/.test(s) && /FROM videos/.test(s));
  assert.equal(hold.length, 1);
  await runtime.db.batch(hold.map((s) => runtime.db.prepare(s)));
  assert.deepEqual(await runtime.db.prepare("SELECT slug, video_key, created_at FROM qc_holds WHERE slug = 'legacy-1-v1'").first(),
    { slug: "legacy-1-v1", video_key: "review/legacy-1-v1/video-old.mp4", created_at: made });
  assert.deepEqual(await snapshot(), was, "no video or submission row changed");
  const jonList = async () => (await call("/api/review/jon-list", { headers: agent })).body.slugs;
  assert.equal((await jonList()).includes("legacy-1-v1"), false);
  // A pass checked before the video was made doesn't release it; one after does.
  await ccDb.prepare("INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at, checked_at) VALUES ('p_00000000000000e1', ?, 'render', 'https://jonmac.ai/review/legacy-1-v1', 'passed', 'qc', ?, ?)")
    .bind(CARD, "2026-10-30T00:00:00.000Z", "2026-10-31T00:00:00.000Z").run();
  assert.equal((await jonList()).includes("legacy-1-v1"), false);
  await qcPass("legacy-1-v1");
  assert.equal((await jonList()).includes("legacy-1-v1"), true);
  await runtime.db.batch(hold.map((s) => runtime.db.prepare(s))); // a rerun adds nothing
  assert.equal((await runtime.db.prepare("SELECT COUNT(*) AS n FROM qc_holds WHERE slug = 'legacy-1-v1'").first()).n, 1);
});

test("the Factory marks its own version QC-passed (Jon, 2026-11-12): on Jon's list with Approve; Approve stays his", { skip }, async () => {
  const jonList = async () => (await call("/api/review/jon-list", { headers: agent })).body.slugs;
  const page = async (slug) => (await fetchApp(`/review/${slug}`, { headers: asJon() })).text();
  const pass = (slug, body = { by: "factory", note: "Factory final checks passed" }, headers = agent) => call(`/api/review/${slug}/qc-pass`, jsonInit("POST", body, headers));
  assert.equal((await publish("factory-1-v1")).status, 201); // no task: the Factory has no card
  assert.equal((await jonList()).includes("factory-1-v1"), false);

  // Only the agent token marks a pass, with a note, on a version that exists.
  assert.equal((await pass("factory-1-v1", undefined, asJon())).status, 403, "Jon's session can't mark QC");
  assert.equal((await pass("factory-1-v1", undefined, { ...asJon(), Origin: "https://evil.example" })).status, 403);
  assert.equal((await pass("factory-1-v1", { by: "factory" })).status, 400, "a pass needs its note");
  assert.equal((await pass("factory-9-v1")).status, 404);
  assert.equal((await submit("factory-1-v1", "approve")).status, 409, "still QC-only");
  dashboardDown = true;
  const down = await pass("factory-1-v1");
  dashboardDown = false;
  assert.equal(down.status, 502, "nothing counts when the dashboard did not record it");
  assert.equal((await jonList()).includes("factory-1-v1"), false);

  const done = await pass("factory-1-v1");
  assert.equal(done.status, 200);
  assert.deepEqual([done.body.qc_only, done.body.approvable, done.body.video.status], [false, true, "needs_review"]);
  assert.deepEqual([done.body.qc_pass.by, done.body.qc_pass.note, done.body.qc_pass.video_key], ["factory", "Factory final checks passed", "review/factory-1-v1/video-test.mp4"]);
  const [stored] = await rows("SELECT slug, video_key, passed_by, note, at FROM review_qc_passes WHERE slug = 'factory-1-v1'");
  assert.deepEqual([stored.passed_by, stored.note, stored.at], ["factory", "Factory final checks passed", done.body.qc_pass.at], "who, what and when are recorded");
  assert.ok((await (await call("/api/review/videos", { headers: agent })).body.videos.find((v) => v.slug === "factory-1-v1")).qc_only === false);
  assert.ok((await jonList()).includes("factory-1-v1"), "on Jon's list");
  const shown = await page("factory-1-v1");
  assert.match(shown, /id="approve"/);
  assert.doesNotMatch(shown, /QC only:/);
  // The dashboard's own QC list counts it too, so the pipeline check sees no broken gate.
  assert.ok((await (await reviewHook(new Request("https://jonmac.ai/dashboard/api/review-hook/qc", { headers: agent }), { DB: ccDb, REVIEW_API_TOKEN: SECRETS.REVIEW_API_TOKEN })).json()).passes["factory-1-v1"]);

  // The agent still can't approve; Jon can, and his approval tells the owner it is final, then the 409 lock holds.
  assert.equal((await call("/api/review/factory-1-v1/submit", jsonInit("POST", { kind: "approve" }))).status, 403);
  assert.equal((await submit("factory-1-v1", "approve")).status, 201);
  assert.match((await cardComments(CARD)).at(-1).body, /^Jon approved v1 of .+ That version is final: upload it.+\nhttps:\/\/jonmac\.ai\/review\/factory-1-v1$/s, "the owner hears it passed QC");
  assert.equal((await publish("factory-1-v2")).status, 409);
  assert.equal((await pass("factory-1-v1")).status, 200, "a pass after his approval changes nothing else");
  assert.equal((await jonList()).includes("factory-1-v1"), false, "approved: off the to-do list");

  // A recut under the same slug is held again until it is passed again.
  assert.equal((await publish("factory-2-v1")).status, 201);
  assert.equal((await pass("factory-2-v1")).status, 200);
  await new Promise((r) => setTimeout(r, 5));
  const key = "review/factory-2-v1/video-recut.mp4";
  await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
  assert.equal((await call("/api/review/factory-2-v1/publish", jsonInit("POST", { channel: "test", video: "factory-2", version: "v1", title: TITLE, video_key: key }))).status, 200);
  assert.equal((await jonList()).includes("factory-2-v1"), false, "the recut is QC-only again");
});
