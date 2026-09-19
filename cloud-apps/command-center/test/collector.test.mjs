import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

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
