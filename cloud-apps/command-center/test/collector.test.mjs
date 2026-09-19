import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';

function run(code, cwd) {
  return spawnSync(py, ['-c', code], { encoding: 'utf8', cwd });
}

test('adding a source is one module with source() and collect()', () => {
  const file = join(root, 'collectors/mac/sources/heartbeat.py');
  assert.equal(existsSync(file), true);
  const r = run(
    'from sources.heartbeat import source, collect\n'
    + 'd = collect("mac")\n'
    + 'print(source("mac"))\n'
    + 'print(d["ok"])\n'
    + 'print(d["hostname"])\n',
    join(root, 'collectors/mac'),
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'agents_mac');
  assert.equal(lines[1], 'True');
  assert.ok(lines[2].length > 0);
});

test('gpu2 heartbeat source name is agents_gpu2', () => {
  const r = run(
    'from sources.heartbeat import source, collect\n'
    + 'print(source("gpu2"))\n'
    + 'print(collect("gpu2")["machine"])\n',
    join(root, 'collectors/gpu2'),
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'agents_gpu2');
  assert.equal(lines[1], 'gpu2');
});

test('gpu2 video source is named video', () => {
  const r = run(
    'from sources.video import source\n'
    + 'print(source("gpu2"))\n',
    join(root, 'collectors/gpu2'),
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'video');
});

test('collect keeps other sources when one throws', () => {
  const r = run(
    'from pathlib import Path\n'
    + 'import tempfile\n'
    + 'from cc import collect_payloads\n'
    + 'd = Path(tempfile.mkdtemp())\n'
    + '(d / "ok.py").write_text("def source(m):\\n    return \\"ok\\"\\ndef collect(m):\\n    return {\\"n\\": 1}\\n")\n'
    + '(d / "bad.py").write_text("def source(m):\\n    return \\"bad\\"\\ndef collect(m):\\n    raise RuntimeError(\\"boom\\")\\n")\n'
    + 'rows = collect_payloads(d, "gpu2")\n'
    + 'print(len(rows))\n'
    + 'print(rows[0][0])\n'
    + 'print(rows[0][1]["n"])\n',
    join(root, 'collectors/lib'),
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], '1');
  assert.equal(lines[1], 'ok');
  assert.equal(lines[2], '1');
});

test('ping handler returns the machine-up message', () => {
  const r = run(
    'from cc import handle_action\n'
    + 'ok, msg = handle_action("ping", {}, "mac")\n'
    + 'print(ok)\n'
    + 'print(msg)\n',
    join(root, 'collectors/lib'),
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'True');
  assert.equal(lines[1], 'Mac mini is up');
});

test('second runner exits at once when the lock is held', () => {
  const lock = join(tmpdir(), `cc-run-lock-${process.pid}`);
  const lib = join(root, 'collectors/lib');
  const env = { ...process.env, CC_RUN_LOCK: lock };
  const holder = spawn(py, ['-c',
    'from cc import acquire_run_lock\n'
    + 'acquire_run_lock("gpu2")\n'
    + 'import time; time.sleep(20)\n'],
    { cwd: lib, env, stdio: 'ignore' },
  );
  try {
    const start = Date.now();
    while (Date.now() - start < 4000) {
      if (existsSync(lock)) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    const r = spawnSync(py, ['-c',
      'from cc import acquire_run_lock\n'
      + 'acquire_run_lock("gpu2")\n'
      + 'print("got lock")\n'],
      { cwd: lib, env, encoding: 'utf8', timeout: 8000 },
    );
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(`${r.stdout}${r.stderr}`, /already running/i);
  } finally {
    holder.kill();
    try { unlinkSync(lock); } catch {}
  }
});
