// Owner-only, read-only query through Wrangler's existing authenticated D1 access.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validSessionDate } from '../src/scorecard.js';

const args = process.argv.slice(2);
const remote = args.includes('--remote'), local = args.includes('--local');
const date = args.find(arg => !arg.startsWith('--'));
if (remote === local || args.some(arg => arg.startsWith('--') && !['--remote', '--local', '--json'].includes(arg)) ||
    (date && !validSessionDate(date)) || args.filter(arg => !arg.startsWith('--')).length > 1) {
  throw new Error('Usage: npm run scorecard -- --local|--remote [YYYY-MM-DD] [--json]');
}
const cli = process.env.CLONE_WRANGLER_CLI;
if (!cli) throw new Error('Set CLONE_WRANGLER_CLI to the installed wrangler.js path.');
const query = 'SELECT * FROM clone_session_scorecard' + (date ? " WHERE session_date = '" + date + "'" : '') + ' ORDER BY session_date DESC LIMIT 100';
const output = execFileSync(process.execPath, [cli, 'd1', 'execute', 'jonmacai-clone-upsells',
  remote ? '--remote' : '--local', '--config', fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
  '--command', query, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const rows = JSON.parse(output).flatMap(result => result.results || []);
if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else {
  console.log('Clone scorecard: observed events since activation; null = unavailable/unassigned.');
  console.table(rows);
}
