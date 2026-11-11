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



// Plants the clash (2026-11-11): deploy.ps1 named its check path $check, and deploy-core's -Check param
// shadowed it, so python got the scriptblock text, every live check failed and deploys rolled back.
// Runs deploy.ps1's own path line and Invoke-WranglerDeploy line against a fake wrangler and a fake python.
test('deploy.ps1 live check gets the check script path, not a scriptblock', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../scripts/deploy.ps1'), 'utf8');
  const assign = src.match(/^\$\w+ = '[^']*dash_version_check\.py'\s*$/m)?.[0];
  const call = src.match(/^Invoke-WranglerDeploy .*$/m)?.[0];
  assert.ok(assign && call, 'deploy.ps1 path line and Invoke-WranglerDeploy line');
  const dir = mkdtempSync(join(tmpdir(), 'dep-'));
  const log = join(dir, 'log.txt');
  const fake = join(dir, 'fake.ps1');
  writeFileSync(fake, `Add-Content '${log}' ($args -join ' ')
if ($args[0] -eq 'deployments') { Write-Output '[{"created_on":"2026-11-11T00:00:00Z","versions":[{"version_id":"prev-123","percentage":100}]}]' }
exit 0
`);
  const pyPath = join(dir, 'dash_version_check.py');
  const drv = join(dir, 'drv.ps1');
  writeFileSync(drv, `$ErrorActionPreference='Stop'
function python { Add-Content '${log}' ('PY ' + ($args -join '|')); $global:LASTEXITCODE = [int]($args[1] -ne '${pyPath}') }
$Base = 'http://x'; $sha = 'abc1234'
${assign.trim().replace(/'[^']*'/, `'${pyPath}'`)}
. '${core}'
${call.replace(/-Wrangler @\([^)]*\)/, `-Wrangler @('powershell','-NoProfile','-File','${fake}')`)}
`);
  const r = spawnSync('powershell', ['-NoProfile', '-File', drv], { encoding: 'utf8' });
  const out = existsSync(log) ? readFileSync(log, 'utf8') : '';
  assert.ok(out.includes(`PY -I|${pyPath}|http://x|abc1234`), out + r.stdout + r.stderr);
  assert.doesNotMatch(out, /rollback/);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
