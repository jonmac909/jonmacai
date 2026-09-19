import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { memD1 } from './memd1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const SECRET = 'test-session-secret-32-bytes-ok!';
const MAC = 'mac-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GPU = 'gpu-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const now = Date.parse('2026-09-18T18:00:00Z');

function runPy(code, cwd = join(root, 'collectors/lib')) {
  return spawnSync(py, ['-c', code], { encoding: 'utf8', cwd });
}

function envWith(db) {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: '909090',
    MACHINE_TOKEN_MAC: MAC,
    MACHINE_TOKEN_GPU2: GPU,
    DB: db,
  };
}

function req(path, { method = 'GET', cookie, headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  return new Request(`https://jonmac.ai${path}`, { method, headers: h, body });
}

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

function status(title, preview, lastMs, nowMs, daily) {
  const r = runPy(
    'from agent_status import agent_status\n'
    + `print(agent_status(${JSON.stringify(title)}, ${JSON.stringify(preview)}, ${lastMs}, ${nowMs}, ${daily ? 'True' : 'False'}))\n`,
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

const fixture = {
  nav: { brand: 'Jon Mac', badges: { agents: 2, mastermind: 3 } },
  goal: { pct: 50 },
  sources: {
    agents_mac: { updatedAt: 'old' },
    agents_gpu2: { updatedAt: 'old' },
    mastermind: { updatedAt: 'old' },
  },
  pages: {
    home: { tiles: [{ value: '$5,000' }] },
    agents: {
      title: 'Agents',
      sub: 'example',
      tiles: [{ label: 'Need you', value: '2' }],
      waiting: { title: 'Waiting on you', jobs: [{ title: 'example' }] },
      all: { title: 'All agents', rows: [{ agent: 'Example' }] },
    },
    mastermind: {
      title: 'Mastermind',
      sub: 'example',
      actions: [{ label: 'Scan now', msg: 'Scanning the group now' }],
      tiles: [{ label: 'Messages read for you', value: '41' }],
      picks: { title: "Today's picks", jobs: [{ title: 'Idea headline goes here' }] },
      building: { title: 'Being built', meta: 'Ideas you sent to Planner', rows: [{ title: 'Idea from Sep 12' }] },
      parked: {
        title: 'Parked',
        meta: '4 saved for later',
        rows: [{ title: 'Parked idea' }],
        more: { title: '2 more', sub: 'Older than 2 weeks', btn: 'Show all', msg: 'Showing all parked ideas' },
      },
    },
  },
};

test('spinner in the title is Working', () => {
  assert.equal(status('⠋ Meta Ads', '', now, now, true), 'working');
});

test('waiting on input is Needs you, even with a spinner', () => {
  assert.equal(status('⠋ Planner', 'Needs the bank\'s text code. Waiting on you.', now, now, true), 'needs_you');
});

test('daily job quiet for 48 hours is Quiet too long', () => {
  const last = now - 48 * 3600 * 1000;
  assert.equal(status('Content Marketing', 'Last ran 2 days ago', last, now, true), 'quiet');
});

test('everything else is Idle', () => {
  assert.equal(status('Sponsors', 'Finished inbox scan', now, now, true), 'idle');
  assert.equal(status('Landing Page', '', now - 72 * 3600 * 1000, now, false), 'idle');
});

test('spinner in the preview is Working', () => {
  assert.equal(status('Feature - Dashboard', '⠸ 2m > Grok 4.6', now, now, false), 'working');
});

test('orca worktree status working is Working', () => {
  const r = runPy(
    'from agent_status import agent_status\n'
    + `print(agent_status('Feature', 'idle 98ms', ${now}, ${now}, False, 'working', []))\n`,
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'working');
});

test('orca agent state working is Working', () => {
  const r = runPy(
    'from agent_status import agent_status\n'
    + `print(agent_status('Landing-Page', 'PS prompt', ${now}, ${now}, False, 'active', ['working']))\n`,
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'working');
});

test('merge overlays pinned agents from both machines onto the agents page', () => {
  const rows = [{
    source: 'agents_mac',
    data: JSON.stringify({
      machine: 'mac',
      hostname: 'mini.local',
      ok: true,
      agents: [{
        name: 'Sponsors',
        runs: 'Mac mini',
        now: 'Finished inbox scan at 8:05',
        job: 'Done',
        pct: 100,
        pg: 'ok',
        status: 'idle',
        pill: 'Idle',
        page: 'sponsors',
      }, {
        name: 'Finances',
        runs: 'Mac mini',
        now: 'Needs the bank\'s text code',
        job: 'Waiting',
        pct: 50,
        pg: 'risk',
        status: 'needs_you',
        pill: 'Needs you',
        pillCls: 'risk',
        waiting: { title: 'Needs the bank\'s text code', lines: ['Business credit card scan is paused'], waitLabel: 'Paused' },
      }],
    }),
    collected_at: '2026-09-18T17:58:00Z',
  }, {
    source: 'agents_gpu2',
    data: JSON.stringify({
      machine: 'gpu2',
      hostname: 'gpu2',
      ok: true,
      agents: [{
        name: 'Meta Ads',
        runs: 'GPU2',
        now: 'Polishing a new ad',
        job: 'Working',
        pct: 40,
        status: 'working',
        pill: 'Working',
        pillCls: 'ok',
      }, {
        name: 'Content Marketing',
        runs: 'GPU2',
        now: 'Last ran 2 days ago',
        job: 'Not run',
        pct: 0,
        pg: 'crit',
        status: 'quiet',
        pill: 'Quiet too long',
        pillCls: 'crit',
        restart: 'Restart',
        restartMsg: 'Content Marketing agent restarted',
      }],
    }),
    collected_at: '2026-09-18T17:58:00Z',
  }];
  const out = mergeSnapshot(fixture, rows, now);
  assert.equal(out.pages.home.tiles[0].value, '$5,000');
  assert.equal(out.pages.agents.tiles[0].value, '1');
  assert.equal(out.pages.agents.tiles[1].value, '1');
  assert.equal(out.pages.agents.waiting.jobs[0].area, 'Finances');
  const names = out.pages.agents.all.rows.map((r) => r.agent);
  assert.deepEqual(names, ['Sponsors', 'Finances', 'Meta Ads', 'Content Marketing']);
  const quiet = out.pages.agents.all.rows.find((r) => r.agent === 'Content Marketing');
  assert.equal(quiet.pill, 'Quiet too long');
  assert.equal(quiet.restart, 'Restart');
});

test('merge overlays mastermind picks from the digest, implement then park', () => {
  const rows = [{
    source: 'mastermind',
    data: JSON.stringify({
      scanned: 41,
      scannedAt: '2026-09-18T14:30:00Z',
      picks: [
        { id: 'a1', area: 'Outreach', title: 'Pause Instantly on 4% bounce', text: 'one-click Instantly pause', verdict: 'implement', lines: ['From the group', 'Why it fits: Instantly'] },
        { id: 'a2', area: 'Content', title: 'Higgsfield UI clone', text: 'Fun to look at', verdict: 'park', lines: ['From the group'] },
      ],
    }),
    collected_at: '2026-09-18T14:30:00Z',
  }];
  const out = mergeSnapshot(fixture, rows, now, []);
  assert.equal(out.pages.mastermind.tiles[0].value, '41');
  assert.equal(out.pages.mastermind.picks.jobs[0].title, 'Pause Instantly on 4% bounce');
  assert.equal(out.pages.mastermind.picks.jobs[0].pill, 'Worth doing');
  assert.equal(out.pages.mastermind.picks.jobs[1].pill, 'Maybe');
  assert.equal(out.pages.mastermind.building.rows.length, 0);
  assert.match(out.pages.mastermind.sub, /BuiltWithAI digest/);
  assert.doesNotMatch(out.pages.mastermind.sub, /Telegram|AI Advanced group/);
  assert.equal(out.pages.mastermind.parked.rows.length, 0);
});

test("mastermind overlay restores don't from don'anonymous copy glitch", () => {
  const rows = [{
    source: 'mastermind',
    data: JSON.stringify({
      scanned: 2,
      scannedAt: '2026-09-19T22:55:00Z',
      picks: [{
        id: 'g1',
        area: 'Mastermind',
        title: "Jev's sweet spot",
        text: "wins; don'anonymous force it into top-level orchestration.",
        verdict: 'park',
      }],
    }),
    collected_at: '2026-09-19T22:55:00Z',
  }];
  const out = mergeSnapshot(fixture, rows, now, []);
  const job = out.pages.mastermind.picks.jobs[0];
  const blob = [job.title, ...(job.lines || []), job.payload?.body, job.linePayload?.body].join('\n');
  assert.match(blob, /don't force/);
  assert.doesNotMatch(blob, /anonymous/);
});

test('parked ideas from the dashboard replace the parked list', () => {
  const rows = [{
    source: 'mastermind',
    data: JSON.stringify({ scanned: 3, picks: [] }),
    collected_at: '2026-09-18T14:30:00Z',
  }];
  const ideas = [{
    id: 'p1', title: 'Parked later', body: 'body', area: 'Content', verdict: 'park',
    status: 'parked', created_at: '2026-09-16T00:00:00Z', updated_at: '2026-09-16T00:00:00Z',
  }, {
    id: 'b1', title: 'Sent idea', body: 'body', area: 'Viral View', verdict: 'implement',
    status: 'building', created_at: '2026-09-12T00:00:00Z', updated_at: '2026-09-12T00:00:00Z',
  }];
  const out = mergeSnapshot(fixture, rows, now, ideas);
  assert.equal(out.pages.mastermind.parked.rows[0].title, 'Parked later');
  assert.equal(out.pages.mastermind.building.rows[0].title, 'Sent idea');
  assert.equal(out.pages.mastermind.building.rows[0].pill, 'Building');
});

test('mastermind.park is dashboard-only and writes the ideas table', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  const res = await handleApi(req('/dashboard/api/actions', {
    method: 'POST',
    cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({
      kind: 'mastermind.park',
      payload: { id: 'a1', title: 'Pause Instantly', body: 'bounce', area: 'Outreach' },
      idemKey: 'park-1',
    }),
  }), env);
  assert.equal(res.status, 200);
  const row = await res.json();
  assert.equal(row.status, 'done');
  assert.equal(row.result, 'Parked for later');
  assert.equal(db.actions[0].target, 'worker');
  const idea = db.ideas.get('a1');
  assert.equal(idea.status, 'parked');
  assert.equal(idea.title, 'Pause Instantly');
});

test('mastermind.send_to_planner queues on GPU2', async () => {
  const db = memD1();
  const env = envWith(db);
  const res = await handleApi(req('/dashboard/api/actions', {
    method: 'POST',
    cookie: await cookie(),
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({
      kind: 'mastermind.send_to_planner',
      payload: { id: 'a1', title: 'Pause Instantly', body: 'bounce' },
      idemKey: 'send-1',
    }),
  }), env);
  assert.equal(res.status, 200);
  const row = await res.json();
  assert.equal(row.status, 'queued');
  assert.equal(db.actions[0].target, 'gpu2');
  assert.equal(db.actions[0].kind, 'mastermind.send_to_planner');
});

test('agent.restart on a Mac agent queues on Mac', async () => {
  const db = memD1();
  const env = envWith(db);
  const res = await handleApi(req('/dashboard/api/actions', {
    method: 'POST',
    cookie: await cookie(),
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({
      kind: 'agent.restart',
      payload: { machine: 'mac', name: 'Sponsors' },
      idemKey: 'restart-1',
    }),
  }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'queued');
  assert.equal(db.actions[0].target, 'mac');
});

test('gpu2 mastermind source reads implement then park from the filter', () => {
  const r = runPy(
    'import json, os, tempfile\n'
    + 'from pathlib import Path\n'
    + 'import mastermind_picks as m\n'
    + 'td = Path(tempfile.mkdtemp())\n'
    + 'filt = {"count": 3, "ran": "2026-09-18T14:30:00Z", "items": [\n'
    + '  {"text": "Pause Instantly", "source": "advanced-chat", "action": "implement"},\n'
    + '  {"text": "Fun clone", "source": "advanced-chat", "action": "ignore"},\n'
    + '  {"text": "Mail the list", "source": "advanced-chat", "action": "park"},\n'
    + ']}\n'
    + '(td / "morning-filter.json").write_text(json.dumps(filt), encoding="utf-8")\n'
    + '(td / "telegram-digest.json").write_text(json.dumps([{"text": "a"},{"text": "b"},{"text": "c"}]), encoding="utf-8")\n'
    + 'd = m.picks_from_state(td)\n'
    + 'print(d["scanned"])\n'
    + 'print(d["picks"][0]["verdict"])\n'
    + 'print(d["picks"][1]["verdict"])\n'
    + 'print(len(d["picks"]))\n'
    + 'print(d["picks"][0]["lines"][0])\n',
    join(root, 'collectors/lib'),
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], '3');
  assert.equal(lines[1], 'implement');
  assert.equal(lines[2], 'park');
  assert.equal(lines[3], '2');
  assert.equal(lines[4], 'From BuiltWithAI digest');
});

test('digest parser keeps takeaways as advanced-chat items', () => {
  const r = runPy(
    'from telegram_digest import parse_digest\n'
    + 'html = """771 messages · 84 active members\\n## Key Takeaways\\n- Jev classifiers belong in agent stacks.\\n- Use system user tokens for Meta ads.\\n"""\n'
    + 'items, scanned = parse_digest(html)\n'
    + 'print(len(items))\n'
    + 'print(items[0]["source"])\n'
    + 'print(items[0]["text"][:20])\n'
    + 'print(scanned)\n',
    join(root, 'collectors/lib'),
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], '2');
  assert.equal(lines[1], 'advanced-chat');
  assert.match(lines[2], /Jev classifiers/);
  assert.equal(lines[3], '771');
});

test('digest parser reads HTML takeaways and comment-split counts', () => {
  const r = runPy(
    'from telegram_digest import parse_digest\n'
    + 'html = """<p>771<!-- --> messages</p><h2>Key Takeaways</h2><ul>'
    + '<li><span></span><span>Jev classifiers belong in agent stacks.</span></li></ul>"""\n'
    + 'items, scanned = parse_digest(html)\n'
    + 'print(len(items), scanned, items[0]["text"][:16])\n',
    join(root, 'collectors/lib'),
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 771 Jev classifiers/);
});

test("digest parser restores don't from don&#x27;anonymous", () => {
  const r = runPy(
    'from telegram_digest import parse_digest\n'
    + 'html = """<p>12 messages</p><h2>Key Takeaways</h2><ul>'
    + '<li><span></span><span>wins; don&#x27;anonymous force it.</span></li></ul>"""\n'
    + 'items, scanned = parse_digest(html)\n'
    + 'print(items[0]["text"])\n',
    join(root, 'collectors/lib'),
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /don't force/);
  assert.doesNotMatch(r.stdout, /anonymous/);
});
