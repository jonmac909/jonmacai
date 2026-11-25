// Card t_60828ebeeb2845fd: Harper (Skool Host) and Piper (Social Posting) become dashboard bots.
// Planted fault: before their token rows exist, owner harper/piper is "Unknown bot"; registering a token with the
// same SQL scripts/bot-tokens.mjs --add runs makes the owner accepted and the token sign in as that bot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { nameOf } from '../src/d2.js';
import { sqliteD1 } from './sqlited1.mjs';
import { hashOf, newToken, parseArgs, tokenSql } from '../scripts/bot-tokens.mjs';

const DEV = `ccb_${'d'.repeat(43)}`;
function call(env, method, path, token, body) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const init = { method, headers };
  if (body !== undefined) { headers.set('Content-Type', 'application/json'); init.body = JSON.stringify(body); }
  return handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, init), { DB: env.DB })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

for (const [slug, name] of [['harper', 'Harper'], ['piper', 'Piper']]) {
  test(`${slug}: unknown owner before its token, accepted after; its token signs in as ${slug}`, async () => {
    const db = sqliteD1();
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(DEV), 'developer', '2026-11-25T00:00:00.000Z').run();
    const env = { DB: db };

    const before = await call(env, 'POST', '/tasks', DEV, { title: `Test card for ${name}`, owner: slug });
    assert.deepEqual([before.status, before.body.error], [400, `Unknown bot: ${slug}`], 'the old fault: owner rejected');

    assert.equal(parseArgs(['--add', slug]).add, slug);
    const token = newToken();
    for (const sql of tokenSql(slug, hashOf(token), '2026-11-25T01:00:00.000Z')) db.sqlite.exec(sql);

    const after = await call(env, 'POST', '/tasks', DEV, { title: `Test card for ${name}`, owner: slug });
    assert.deepEqual([after.status, after.body.task.owner], [201, slug]);
    const me = await call(env, 'GET', '/me', token);
    assert.deepEqual([me.status, me.body.bot], [200, slug]);
    const mine = await call(env, 'GET', '/tasks?owner=me', token);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.tasks.some((t) => t.id === after.body.task.id), `${slug} sees its own card`);
    assert.equal(nameOf(slug), name, 'Jon reads the first name, not the slug');
  });
}
