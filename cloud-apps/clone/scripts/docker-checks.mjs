// Docker-only validation. No deployment, provider credentials or real mail.
import { spawnSync } from 'node:child_process';
const checks = [
  ['npm', ['test']],
  ['npm', ['run', 'test:whop:browser']],
  ['npm', ['run', 'test:readiness:browser']],
  ['npm', ['run', 'test:sandbox:mock']],
  ['npm', ['run', 'test:sandbox:pages']],
  ['wrangler', ['deploy', '--dry-run', '--config', 'wrangler.jsonc', '--outdir', '.wrangler/build']],
];
for (const [command, args] of checks) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS Docker checks and Worker bundle dry run; no deployment.');
