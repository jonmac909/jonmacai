import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { buildMachine, buildMachines, HOSTS } from '../src/machines.js';
import { mergeSnapshot } from '../src/snapshot.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const now = Date.parse('2026-10-15T22:00:00Z');
const gpu1 = HOSTS[0];
const gpu2 = HOSTS[1];

function beat(ageMin, data = {}) {
  return {
    source: 'machine_gpu2',
    collected_at: new Date(now - ageMin * 60000).toISOString(),
    data: JSON.stringify({
      hostname: 'GPU2',
      gpus: [{ name: 'NVIDIA GeForce RTX 3090', util: 7, memUsedGb: 1.7, memTotalGb: 24, tempC: 40 }],
      ram: { usedGb: 38.7, totalGb: 63.9 },
      commit: { usedGb: 60, limitGb: 166.9, pct: 36 },
      disks: [{ drive: 'C:', freeGb: 93, totalGb: 1861.9 }, { drive: 'D:', freeGb: 1804, totalGb: 1863 }],
      running: { resolve: { open: false }, ffmpeg: 1, python: [{ kind: 'python', script: 'server.py' }], qwen: 2, docker: true, orca: true },
      gaming: { on: false, why: 'free' },
      ...data,
    }),
  };
}

test('fresh heartbeat is online and green', () => {
  const m = buildMachine(gpu2, beat(0.5), now);
  assert.equal(m.online, true);
  assert.equal(m.stale, false);
  assert.equal(m.level, 'ok');
  assert.equal(m.gpus[0].name, 'RTX 3090');
  assert.equal(m.gaming.on, false);
  assert.equal(m.running.find((r) => r.label === 'Qwen image jobs').value, '2 running');
  assert.equal(m.running.find((r) => r.label === 'Docker').value, 'up');
});

test('stale after 3 min, red offline after 5 min', () => {
  const stale = buildMachine(gpu2, beat(4), now);
  assert.equal(stale.stale, true);
  assert.equal(stale.online, true);
  assert.equal(stale.level, 'stale');
  const off = buildMachine(gpu2, beat(6), now);
  assert.equal(off.online, false);
  assert.equal(off.level, 'crit');
  assert.match(off.alerts[0], /Offline/);
});

test('red when a drive has under 50 GB or commit is over 90%', () => {
  const disk = buildMachine(gpu2, beat(0, { disks: [{ drive: 'C:', freeGb: 42, totalGb: 1000 }] }), now);
  assert.equal(disk.level, 'crit');
  assert.match(disk.alerts.join(), /C: only 42 GB free/);
  const commit = buildMachine(gpu2, beat(0, { commit: { usedGb: 150, limitGb: 160, pct: 94 } }), now);
  assert.equal(commit.level, 'crit');
  assert.equal(commit.commit.high, true);
});

test('missing heartbeat shows no data, never a number', () => {
  const [m1] = buildMachines({}, now);
  assert.equal(m1.id, 'gpu1');
  assert.equal(m1.updatedAt, undefined);
  assert.equal(m1.level, 'crit');
  assert.deepEqual(m1.gpus, []);
  assert.equal(buildMachine(gpu1, beat(0), now).gaming, undefined);
});

test('snapshot puts machines on home and agents, with a 60 s stale window', () => {
  const out = mergeSnapshot(snapshot, [beat(4)], now);
  assert.equal(out.pages.home.machines.length, 2);
  assert.equal(out.pages.agents.hosts[1].stale, true);
  assert.equal(out.sources.machine_gpu2.stale, true);
});

test('a machine can only ingest its own machine source', async () => {
  const env = { SESSION_SECRET: 'x'.repeat(32), MACHINE_TOKEN_GPU2: 'gpu2-token-value', MACHINE_TOKEN_GPU1: 'gpu1-token-value' };
  const send = (token, source) => handleApi(new Request('https://jonmac.ai/dashboard/api/ingest', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, collectedAt: new Date(now).toISOString(), data: {} }),
  }), env);
  assert.equal((await send('gpu2-token-value', 'machine_gpu1')).status, 401);
  assert.equal((await send('gpu1-token-value', 'machine_gpu1')).status, 200);
});

test('collector parses nvidia-smi and keeps only python script names', () => {
  const code = [
    'import json, machine_stats as m',
    'g = m.parse_gpus("NVIDIA GeForce RTX 5090, 88, 20480, 32607, 71\\n")',
    'p = m.label_python(r\'"C:\\\\py\\\\python.exe" C:\\\\jobs\\\\qwen_image.py --token=abc\')',
    'q = m.label_python("python -m http.server 8000")',
    'r = m.summarize(["resolve.exe", "ffmpeg.exe", "ffmpeg.exe", "orca.exe"], [p], ["DaVinci Resolve Studio - Theo ep 12"])',
    'print(json.dumps([g, p, q, r]))',
  ].join('\n');
  const res = spawnSync(py, ['-c', code], { encoding: 'utf8', cwd: join(root, 'collectors/lib') });
  assert.equal(res.status, 0, res.stderr);
  const [g, p, q, r] = JSON.parse(res.stdout);
  assert.deepEqual(g[0], { name: 'NVIDIA GeForce RTX 5090', util: 88, memUsedGb: 20, memTotalGb: 31.8, tempC: 71 });
  assert.deepEqual(p, { kind: 'qwen', script: 'qwen_image.py' });
  assert.equal(q.script, 'http.server');
  assert.equal(r.ffmpeg, 2);
  assert.equal(r.qwen, 1);
  assert.equal(r.resolve.project, 'Theo ep 12');
  assert.equal(r.docker, false);
  assert.equal(r.orca, true);
});
