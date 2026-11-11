// Plants the fault: fake wrangler prints a warning on stderr but succeeds -> must reach live check.
// A real failure (live check fails) must trigger rollback; a deploy exit 1 must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const core = resolve(import.meta.dirname, '../scripts/deploy-core.ps1');
function run({ deployExit = 0, checkExit = 0, ver = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'dep-'));
  const log = join(dir, 'log.txt');
  const fake = join(dir, 'fake.ps1');
  const deps = ver ? '[{"created_on":"2026-11-11T00:00:00Z","versions":[{"version_id":"prev-123","percentage":100}]}]' : '[]';
  writeFileSync(fake, `
$a = $args -join ' '
Add-Content '${log}' $a
[Console]::Error.WriteLine('▲ [WARNING] The version of Wrangler you are using is now out of date.')
if ($args[0] -eq 'deployments') { Write-Output '${deps}'; exit 0 }
if ($args[0] -eq 'deploy') { exit ${deployExit} }
exit 0
`);
  const drv = join(dir, 'drv.ps1');
  writeFileSync(drv, `$ErrorActionPreference='Stop'
. '${core}'
Invoke-WranglerDeploy -Wrangler @('powershell','-NoProfile','-File','${fake}') -Base 'http://x' -Sha 'abc1234' -Check { param($b,$s) Add-Content '${log}' 'CHECK'; Write-Output 'ok: live commit abc1234'; ${checkExit} }
`);
  const r = spawnSync('powershell', ['-NoProfile', '-File', drv], { encoding: 'utf8' });
  return { r, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}
test('wrangler warning on stderr is non-fatal: live check runs and passes', () => {
  const { r, log } = run({});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(log, /CHECK/);
  assert.doesNotMatch(log, /rollback/);
});
test('failed live check triggers rollback to previous version', () => {
  const { r, log } = run({ checkExit: 1 });
  assert.notEqual(r.status, 0);
  assert.match(log, /CHECK/);
  assert.match(log, /rollback prev-123/);
});
test('real deploy failure (exit 1) fails, no live check', () => {
  const { r, log } = run({ deployExit: 1 });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(log, /CHECK/);
  assert.doesNotMatch(log, /rollback/);
});
test('missing version id fails before deploying', () => {
  const { r, log } = run({ ver: false });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(log, /^deploy --tag/m);
});


// deploy.ps1 dot-sources deploy-core, so a script variable named like an Invoke-WranglerDeploy parameter
// (PowerShell names are case-insensitive: $check vs -Check) would be shadowed and break the live check.
function clashes(src) {
  const params = ['Wrangler', 'Check'];
  const assigned = [...src.matchAll(/^\s*\$(\w+)\s*=/gm)].map(m => m[1].toLowerCase());
  return params.filter(p => assigned.includes(p.toLowerCase()));
}
test('deploy.ps1 has no variable that clashes with a core parameter name', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../scripts/deploy.ps1'), 'utf8');
  assert.deepEqual(clashes(src), []);
});
test('clash detector catches a planted $check assignment', () => {
  assert.deepEqual(clashes("$check = 'x'\n"), ['Check']);
});
