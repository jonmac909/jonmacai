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

const fixture = {
  nav: { brand: 'Jon Mac', badges: { support: 4 } },
  goal: { pct: 50 },
  sources: { support: { updatedAt: 'old' } },
  pages: {
    support: {
      title: 'Support',
      sub: 'example',
      actions: [{ label: 'Approve all safe replies', msg: 'example' }],
      tiles: [{ label: 'Waiting on you', value: '4' }],
      drafts: { title: 'Drafted replies', meta: 'Nothing sends without you', rows: [{ title: 'example' }] },
      money: { title: 'Money decisions', pill: '1 open', title2: 'example', sub: 'example' },
      topics: { title: 'What people ask about', meta: 'example', rows: [], box: 'example' },
    },
  },
};

function liveRow() {
  return {
    source: 'support',
    collected_at: '2026-09-18T17:55:00Z',
    data: JSON.stringify({
      answeredToday: 9,
      inboundToday: 13,
      refundsThisMonth: 0,
      weekCount: 20,
      topics: [
        { label: 'Export problems', n: 8 },
        { label: 'Billing', n: 5 },
        { label: 'How-to questions', n: 4 },
        { label: 'Bugs', n: 3 },
      ],
      tickets: [
        {
          id: 'd-1', uid: '1', subject: 'Export stuck at 90%', plan: 'Paid plan',
          waitedMs: 5 * 3600 * 1000, body: "Sorry about that. I've restarted your export.",
          category: 'Export problems', money: false, amount: 0,
          to: 'ada@example.com', inReplyTo: '<a@mail.gmail.com>', references: '<a@mail.gmail.com>',
        },
        {
          id: 'd-2', uid: '2', subject: 'How do I change the voice?', plan: 'Free trial',
          waitedMs: 2 * 3600 * 1000, body: 'You can switch voices from the panel on the right.',
          category: 'How-to questions', money: false, amount: 0,
          to: 'bea@example.com', inReplyTo: '<b@mail.gmail.com>', references: '<b@mail.gmail.com>',
        },
        {
          id: 'd-3', uid: '3', subject: 'Do you have a yearly plan?', plan: 'Visitor on live chat',
          waitedMs: 40 * 60 * 1000, body: 'Yes, the yearly plan saves you two months.',
          category: 'How-to questions', money: false, amount: 0,
          to: 'chat', inReplyTo: '', references: '',
        },
        {
          id: 'd-4', uid: '4', subject: 'Can I get a refund?', plan: 'Paid plan',
          waitedMs: 6 * 3600 * 1000, body: 'I can refund the $39 or keep the account open.',
          category: 'Billing', money: true, amount: 39,
          to: 'cam@example.com', inReplyTo: '<c@mail.gmail.com>', references: '<c@mail.gmail.com>',
        },
      ],
    }),
  };
}

test('merge overlays live drafts, waits, money and refunds onto Support', () => {
  const out = mergeSnapshot(fixture, [liveRow()], now);
  const p = out.pages.support;
  assert.equal(p.tiles[0].label, 'Waiting on you');
  assert.equal(p.tiles[0].value, '4');
  assert.equal(p.tiles[1].label, 'Oldest has waited');
  assert.equal(p.tiles[1].value, '6 hrs');
  assert.equal(p.tiles[2].value, '9');
  assert.equal(p.tiles[2].goal, '/ 13');
  assert.equal(p.tiles[3].value, '$0');
  assert.match(p.tiles[3].sub, /1 request open/);
  assert.equal(p.drafts.rows.length, 3);
  assert.equal(p.drafts.rows[0].title, '"Export stuck at 90%"');
  assert.match(p.drafts.rows[0].sub, /Paid plan/);
  assert.match(p.drafts.rows[0].sub, /waited 5 hours/);
  assert.equal(p.drafts.rows[0].kind, 'support.send');
  assert.equal(p.drafts.rows[0].payload.uid, '1');
  assert.equal(p.money.rows.length, 1);
  assert.equal(p.money.rows[0].kind, 'support.decide_refund');
  assert.equal(p.money.pill, '1 open');
  assert.equal(out.nav.badges.support, 4);
  assert.ok(!(p.actions || []).some((a) => a.kind === 'support.send_all_safe'));
});

test('answered-today bar stays within 0–100 when caught up past inbound', () => {
  const row = liveRow();
  const data = JSON.parse(row.data);
  data.answeredToday = 5;
  data.inboundToday = 2;
  row.data = JSON.stringify(data);
  const p = mergeSnapshot(fixture, [row], now).pages.support;
  assert.equal(p.tiles[2].value, '5');
  assert.equal(p.tiles[2].goal, '/ 2');
  assert.ok(p.tiles[2].pct <= 100);
});

test('support actions queue on GPU2', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  for (const kind of ['support.send', 'support.save_draft', 'support.decide_refund', 'support.send_all_safe']) {
    const res = await handleApi(req('/dashboard/api/actions', {
      method: 'POST',
      cookie: ck,
      headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
      body: JSON.stringify({ kind, payload: { uid: '1', ids: ['1'] }, idemKey: kind }),
    }), env);
    assert.equal(res.status, 200, kind);
    assert.equal((await res.json()).status, 'queued', kind);
    assert.equal(db.actions.at(-1).target, 'gpu2', kind);
    assert.equal(db.actions.at(-1).kind, kind);
  }
});

test('python snapshot splits money tickets and formats waits', () => {
  const r = runPy(
    'import json\n'
    + 'from support_mail import snapshot_from\n'
    + 'now = 1758218400000\n'
    + 'drafts = [\n'
    + '  {"uid":"1","subject":"Export stuck","body":"Restarted.","date_ms": now-5*3600*1000,"to":"a@x.com","in_reply_to":"<a@x>","references":"<a@x>","plan":""},\n'
    + '  {"uid":"2","subject":"Can I get a refund?","body":"Paid $39","date_ms": now-2*3600*1000,"to":"b@x.com","in_reply_to":"<b@x>","references":"<b@x>","plan":""},\n'
    + ']\n'
    + 'sent = [{"uid":"9","subject":"Re: voice","body":"done","date_ms": now-1000,"from_us": True}]\n'
    + 'd = snapshot_from(drafts, sent, inbound_today=3, now_ms=now, week_tickets=drafts)\n'
    + 'print(len(d["tickets"]))\n'
    + 'print(d["tickets"][1]["money"])\n'
    + 'print(d["tickets"][1]["amount"])\n'
    + 'print(d["answeredToday"])\n'
    + 'print(d["tickets"][0]["waitedMs"])\n',
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], '2');
  assert.equal(lines[1], 'True');
  assert.equal(lines[2], '39');
  assert.equal(lines[3], '1');
  assert.equal(lines[4], String(5 * 3600 * 1000));
});

test('python reply keeps In-Reply-To and References then deletes the draft', () => {
  const r = runPy(
    'from email.message import EmailMessage\n'
    + 'from support_mail import build_reply, send_draft\n'
    + 'msg = build_reply({"to":"jon@thejonmac.com","subject":"Re: ping","body":"hi","inReplyTo":"<id@x>","references":"<id@x>"})\n'
    + 'print(msg["In-Reply-To"])\n'
    + 'print(msg["References"])\n'
    + 'print(msg["To"])\n'
    + 'class Box:\n'
    + '    def __init__(self):\n'
    + '        self.deleted = []\n'
    + '    def uid(self, cmd, u, *a):\n'
    + '        self.deleted.append((cmd, u))\n'
    + '        return ("OK", [])\n'
    + '    def expunge(self):\n'
    + '        self.expunged = True\n'
    + 'box = Box()\n'
    + 'sent = []\n'
    + 'ok, result = send_draft(lambda m: sent.append(m), box, {"uid":"88","to":"jon@thejonmac.com","subject":"Re: ping","body":"hi","inReplyTo":"<id@x>","references":"<id@x>"})\n'
    + 'print(ok)\n'
    + 'print(result)\n'
    + 'print(sent[0]["In-Reply-To"])\n'
    + 'print(box.deleted[0][0])\n'
    + 'print(box.deleted[0][1])\n'
    + 'print(getattr(box, "expunged", False))\n',
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], '<id@x>');
  assert.equal(lines[1], '<id@x>');
  assert.equal(lines[2], 'jon@thejonmac.com');
  assert.equal(lines[3], 'True');
  assert.equal(lines[4], 'Reply sent');
  assert.equal(lines[5], '<id@x>');
  assert.equal(lines[6], 'STORE');
  assert.equal(lines[7], '88');
  assert.equal(lines[8], 'True');
});
