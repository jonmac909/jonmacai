// Version compare: the changed spans of a version (vN.json), the strip layout, the fix brief, and the Worker side (changes
// stored with a version, the compare page, the brief on the router's changes submissions).
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { buildFixBrief, clock, normalizeChanges, normalizeSpan, openComments, spanAt, stripLayout } from "../public/compare-core.js";
import { SECRETS, allPassed, startRuntime } from "./harness.mjs";

describe("spans", () => {
  test("normalizeSpan takes from/to, start/end and triples, swaps reversed ones and drops empty ones", () => {
    assert.deepEqual(normalizeSpan({ from: 42, to: 55, what: "new b-roll" }), { from: 42, to: 55, what: "new b-roll" });
    assert.deepEqual(normalizeSpan({ start: "1.5", end: 3 }), { from: 1.5, to: 3, what: "" });
    assert.deepEqual(normalizeSpan([10, 4, "  re-voiced \n line "]), { from: 4, to: 10, what: "re-voiced line" });
    assert.deepEqual(normalizeSpan({ from: -2, to: 1.23456 }), { from: 0, to: 1.235, what: "" });
    for (const bad of [null, "x", {}, { from: 3, to: 3 }, { from: "a", to: 2 }, { from: -5, to: -1 }]) assert.equal(normalizeSpan(bad), null);
  });

  test("normalizeChanges reads vN.json shapes and sorts the spans", () => {
    const c = normalizeChanges(JSON.stringify({ version: 3, reason: "Jon: tighter intro", changes: [{ from: 42, to: 55, what: "b" }, { from: 1, to: 2 }, { from: 9, to: 9 }] }));
    assert.deepEqual(c, { version: "v3", reason: "Jon: tighter intro", spans: [{ from: 1, to: 2, what: "" }, { from: 42, to: 55, what: "b" }] });
    assert.deepEqual(normalizeChanges([{ from: 5, to: 6 }]), { version: null, reason: "", spans: [{ from: 5, to: 6, what: "" }] });
    assert.deepEqual(normalizeChanges({ why: "new voice" }), { version: null, reason: "new voice", spans: [] });
    for (const bad of ["{", 7, null, { foo: 1 }]) assert.equal(normalizeChanges(bad), null);
  });

  test("stripLayout places spans in percent, clips to the video, keeps tiny ones clickable", () => {
    const spans = [{ from: 0, to: 10 }, { from: 50, to: 50.1 }, { from: 90, to: 200 }, { from: 150, to: 160 }];
    const out = stripLayout(spans, 100);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((x) => [x.left, x.width]), [[0, 10], [50, 0.8], [90, 10]]);
    assert.deepEqual(stripLayout(spans, 0), []);
    assert.deepEqual(stripLayout(null, 100), []);
  });

  test("spanAt and clock", () => {
    const spans = [{ from: 1, to: 2 }, { from: 42, to: 55 }];
    assert.equal(spanAt(spans, 42), spans[1]);
    assert.equal(spanAt(spans, 55), null);
    assert.equal(spanAt(spans, 0.5), null);
    assert.equal(clock(65.9), "1:05");
    assert.equal(clock(3725), "1:02:05");
  });
});

describe("fix brief", () => {
  const changes = { reason: "new b-roll for the battle", spans: [{ from: 42, to: 55, what: "new b-roll" }] };
  const comments = [
    { t: 50, text: "too dark here", author: "Jon" },
    { t: 3, text: "keep this", author: "Jon", sent: true },
    { t: 10, text: "", transcript: "slower please", author: "Jon" },
    { t: 12, text: "done", resolved: true },
    { t: 70, audio_url: "x" },
  ];

  test("collects the open comments, in time order, marked inside / outside the changed parts", () => {
    assert.deepEqual(openComments(comments).map((c) => c.t), [10, 50, 70]);
    const brief = buildFixBrief({ title: "Battle", version: "v3", comments, changes, compareWith: "v2" });
    assert.equal(brief, [
      "Fix brief: Battle v3 (3 comments)",
      "Why this version was made: new b-roll for the battle",
      "Watched side by side with v2.",
      "- 0:10 [outside the changed parts] slower please (Jon)",
      "- 0:50 [in changed part 0:42-0:55: new b-roll] too dark here (Jon)",
      "- 1:10 [outside the changed parts] (voice note)",
      "Fix each point at its time, keep everything else as it is, then publish the next version.",
    ].join("\n"));
  });

  test("without changes there are no span marks; nothing open gives null; onlyOpen false keeps sent ones", () => {
    const brief = buildFixBrief({ title: "T", comments: [{ t: 1, text: "a" }] });
    assert.equal(brief.split("\n")[1], "- 0:01 a");
    assert.equal(buildFixBrief({ comments: [{ t: 1, text: "a", sent: true }] }), null);
    assert.equal(buildFixBrief({}), null);
    assert.match(buildFixBrief({ comments: [{ t: 1, text: "a", sent: true }], onlyOpen: false }), /\(1 comment\)/);
  });
});

describe("worker", () => {
  const agent = { Authorization: `Bearer ${SECRETS.REVIEW_API_TOKEN}` };
  let runtime, cookie;
  const fetchApp = (path, init = {}) => runtime.mf.dispatchFetch(`${runtime.url}${path}`, { redirect: "manual", ...init });
  const jsonInit = (method, body, headers = agent) => ({ method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const call = async (path, init) => {
    const res = await fetchApp(path, init);
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    return { status: res.status, body };
  };
  const publish = async (slug, extra = {}) => {
    const key = `review/${slug}/video-test.mp4`;
    await runtime.bucket.put(key, new Uint8Array([0, 0, 0, 24]));
    const [, video, version] = /^(.*)-(v\d+)$/.exec(slug);
    return call(`/api/review/${slug}/publish`, jsonInit("POST", { channel: "test", video, version, title: "Compare me", video_key: key, ...extra }));
  };

  before(async () => {
    runtime = await startRuntime({ dashboard: allPassed(() => runtime) });
    const login = await fetchApp("/review/login", { method: "POST", body: new URLSearchParams({ passcode: SECRETS.REVIEW_PASSCODE, next: "/review" }) });
    cookie = login.headers.get("set-cookie").split(";")[0];
    await login.arrayBuffer();
  });
  after(async () => runtime?.mf.dispose());

  test("publish stores a version's changes; bad changes are refused; meta can replace them", async () => {
    assert.equal((await publish("cmp-video-v1")).status, 201);
    const bad = await publish("cmp-video-v2", { changes: "not json" });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    const ok = await publish("cmp-video-v2", { changes: { reason: "new b-roll", changes: [{ from: 42, to: 55, what: "new b-roll" }] } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const got = await call("/api/review/cmp-video-v2/changes", { headers: agent });
    assert.equal(got.status, 200);
    assert.deepEqual(got.body.changes, { version: null, reason: "new b-roll", spans: [{ from: 42, to: 55, what: "new b-roll" }] });
    assert.equal((await call("/api/review/cmp-video-v1/changes", { headers: agent })).body.changes, null);
    const meta = await call("/api/review/cmp-video-v2/meta", jsonInit("POST", { changes: { reason: "new b-roll", changes: [[40, 56, "wider"]] } }));
    assert.ok(meta.status < 300, JSON.stringify(meta.body));
    assert.equal((await call("/api/review/cmp-video-v2/changes", { headers: agent })).body.changes.spans[0].from, 40);
  });

  test("the compare page shows both pickers, the module script and the version list; the video page links to it", async () => {
    const page = await call("/review/cmp-video-v2/compare", { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    for (const id of ['id="pick-a"', 'id="pick-b"', 'id="player-a"', 'id="player-b"', 'id="scrub"', 'id="brief-a"', 'id="brief-b"', 'type="module"']) assert.ok(page.body.includes(id), id);
    const data = JSON.parse(/<script type="application\/json" id="compare-data">([^<]*)<\/script>/.exec(page.body)[1]);
    assert.deepEqual([data.a, data.b], ["cmp-video-v1", "cmp-video-v2"]);
    assert.equal(data.versions.find((v) => v.slug === "cmp-video-v2").changes.spans[0].from, 40);
    assert.doesNotMatch(page.body, /\$\d|price/i);
    const video = await call("/review/cmp-video-v2", { headers: { Cookie: cookie } });
    assert.ok(video.body.includes('href="/review/cmp-video-v2/compare"'));
    const js = await fetchApp("/review/_/compare.js", { headers: { Cookie: cookie } });
    assert.equal(js.status, 200);
    await js.arrayBuffer();
    const core = await fetchApp("/review/_/compare-core.js", { headers: { Cookie: cookie } });
    assert.equal(core.status, 200);
    await core.arrayBuffer();
  });

  test("a changes submission carries the fix brief to the router", async () => {
    const posted = await call("/api/review/cmp-video-v2/comments", jsonInit("POST", { author: "Jon", t: 50, text: "too dark" }, { Cookie: cookie, "X-CC": "1" }));
    assert.ok(posted.status < 300, JSON.stringify(posted.body));
    const sent = await call("/api/review/cmp-video-v2/submit", jsonInit("POST", { kind: "changes" }, { Cookie: cookie, "X-CC": "1" }));
    assert.ok(sent.status < 300, JSON.stringify(sent.body));
    const router = await call("/api/review/submissions?undelivered=1", { headers: agent });
    assert.equal(router.status, 200, JSON.stringify(router.body));
    const list = router.body.submissions || router.body;
    const mine = list.find((s) => s.slug === "cmp-video-v2" && s.kind === "changes");
    assert.ok(mine, JSON.stringify(router.body).slice(0, 300));
    assert.match(mine.brief, /in changed part 0:40-0:56: wider\] too dark \(Jon\)/);
  });
});
