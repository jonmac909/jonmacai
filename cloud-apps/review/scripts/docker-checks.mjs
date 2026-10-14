// Docker-only validation. No deployment and no production credentials.
import { spawnSync } from 'node:child_process';
const checks = [
  ['npm', ['test']],
  ['node', ['test/browser.mjs', '--out', '/tmp/proof']],
  ['wrangler', ['deploy', '--dry-run', '--config', 'wrangler.toml', '--outdir', '.wrangler/build']],
];
for (const [command, args] of checks) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS review portal Docker checks (unit, Workers runtime, desktop Chrome playback, bundle dry run); no deployment.');
