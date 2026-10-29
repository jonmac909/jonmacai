// A real-SQLite stand-in for D1 (node:sqlite), loaded with the repo's migrations, so tests run
// the same SQL the Worker sends to D1.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function sqliteD1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  const plain = (row) => (row ? { ...row } : null);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async first() { return plain(db.prepare(sql).get(...args)); },
    async all() { return { success: true, results: db.prepare(sql).all(...args).map(plain) }; },
    async run() {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    sqlite: db,
    prepare: (sql) => statement(sql),
  };
}
