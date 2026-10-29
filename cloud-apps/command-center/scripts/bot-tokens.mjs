// Issues one dashboard token per bot listed in BOTS.md and registers its SHA-256 hash in D1.
// Raw tokens go only to <out>/<slug>.token (never to git, D1, chat or logs). The token file is
// the truth: an existing file is reused, and any other active hash for that bot is revoked, so
// re-running is safe. The slug is the bot's rules file name (areas/<slug>.md).
//
//   node scripts/bot-tokens.mjs [--env preview] [--rotate <slug>] [--dry-run]
//     --bots D:\AgentTeam\rules\BOTS.md   --out D:\AgentTeam\secrets\bot-tokens
//     WRANGLER=<path to wrangler(.cmd)>   (default: npx wrangler)
// Rotate a lost or leaked token: run with --rotate <slug> (production), then again with
// --env preview and no --rotate so the preview database revokes the old one too.
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const OPTIONS = ['bots', 'out', 'env', 'rotate'];
const FLAGS = ['dry-run'];

export function parseArgs(argv) {
  const out = { bots: 'D:\\AgentTeam\\rules\\BOTS.md', out: 'D:\\AgentTeam\\secrets\\bot-tokens', env: '', rotate: '', 'dry-run': false };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`Unexpected argument: ${argv[i]}`);
    const [, name, inline] = m;
    if (FLAGS.includes(name) && inline === undefined) out[name] = true;
    else if (OPTIONS.includes(name)) {
      const value = inline ?? argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
      out[name] = value;
    } else throw new Error(`Unknown option --${name}`);
  }
  if (out.env && out.env !== 'preview') throw new Error('--env can only be preview');
  // Each run revokes hashes that don't match the token files, so only the real folder may write.
  if (out.out !== 'D:\\AgentTeam\\secrets\\bot-tokens' && !out['dry-run']) throw new Error('--out needs --dry-run');
  if (out.rotate && out.env) throw new Error('Rotate in production first (no --env), then re-run with --env preview');
  return out;
}

export function botsFrom(markdown) {
  const out = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*areas\/([a-z0-9-]+)\.md\s*\|/);
    if (m && !out.some((b) => b.slug === m[2])) out.push({ name: m[1], slug: m[2] });
  }
  return out;
}

export const newToken = () => `ccb_${randomBytes(32).toString('base64url')}`;
export const hashOf = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

export function tokenSql(slug, hash, now) {
  return [
    `INSERT OR IGNORE INTO bot_tokens (token_hash, bot, created_at) VALUES ('${hash}', '${slug}', '${now}');`,
    `UPDATE bot_tokens SET revoked_at = '${now}' WHERE bot = '${slug}' AND token_hash != '${hash}' AND revoked_at IS NULL;`,
  ];
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const database = opt.env === 'preview' ? 'command_center_preview' : 'command_center';
  const bots = botsFrom(readFileSync(opt.bots, 'utf8'));
  if (!bots.length) throw new Error(`No bots found in ${opt.bots}`);
  if (opt.rotate && !bots.some((b) => b.slug === opt.rotate)) throw new Error(`--rotate ${opt.rotate}: not in ${opt.bots}`);
  if (opt.rotate && opt['dry-run']) throw new Error('--rotate cannot be a dry run');
  mkdirSync(opt.out, { recursive: true });

  const now = new Date().toISOString();
  const rows = [];
  for (const { name, slug } of bots) {
    const file = join(opt.out, `${slug}.token`);
    let state = 'existing token';
    if (slug === opt.rotate || !existsSync(file)) {
      writeFileSync(file, `${newToken()}\n`, { flag: slug === opt.rotate ? 'w' : 'wx' });
      state = slug === opt.rotate ? 'rotated' : 'new token';
    }
    const token = readFileSync(file, 'utf8').trim();
    if (!/^ccb_[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error(`${file} does not hold a valid token`);
    const hash = hashOf(token);
    rows.push(...tokenSql(slug, hash, now));
    console.log(`${slug.padEnd(18)} ${name.padEnd(18)} ${state.padEnd(15)} sha256 ${hash.slice(0, 8)}…`);
  }
  if (opt['dry-run']) return;

  const dir = mkdtempSync(join(tmpdir(), 'bot-tokens-'));
  const sqlFile = join(dir, 'bot-tokens.sql');
  try {
    writeFileSync(sqlFile, `${rows.join('\n')}\n`);
    const wrangler = process.env.WRANGLER ? `"${process.env.WRANGLER}"` : 'npx wrangler';
    const cmd = `${wrangler} d1 execute ${database} --remote --file "${sqlFile}"${opt.env ? ` --env ${opt.env}` : ''}`;
    const r = spawnSync(cmd, { cwd: APP_DIR, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) {
      console.error((r.stdout || '').slice(-1500), (r.stderr || '').slice(-1500));
      throw new Error(`wrangler d1 execute failed (${r.status})`);
    }
    console.log(`Registered ${bots.length} token hashes in ${database}; older hashes for these bots are revoked.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`bot-tokens: ${err.message}`);
    process.exit(1);
  }
}
