/**
 * A real SQLite database behind the D1 interface, for tests that must see what
 * SQL actually does (cascades, foreign keys, subqueries) rather than a mock.
 * sql.js (SQLite compiled to wasm) with every migration in
 * worker/src/db/migrations applied in order and `PRAGMA foreign_keys = ON`
 * (as on D1). `batch()` is one transaction, rolled back on any error, as on D1.
 */
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

export interface SqliteD1 extends D1Database {
  raw: Database;
  /** Every row of a table (tests assert on what is left). */
  rows<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): T[];
}

/**
 * `stopBefore`: apply only the migrations whose file name sorts before it (a
 * migration's data step can then be tested on rows written first; apply the
 * rest with `applyMigrationsFrom`).
 */
export async function createSqliteD1(opts: { stopBefore?: string } = {}): Promise<SqliteD1> {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (opts.stopBefore && file >= opts.stopBefore) break;
    raw.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  raw.exec('PRAGMA foreign_keys = ON');

  const rows = <T,>(sql: string, params: SqlValue[] = []): T[] => {
    const stmt = raw.prepare(sql);
    try {
      stmt.bind(params);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  };

  const run = (sql: string, params: SqlValue[]) => {
    const stmt = raw.prepare(sql);
    try {
      stmt.bind(params);
      while (stmt.step()) { /* drain */ }
    } finally {
      stmt.free();
    }
    return { success: true, meta: { changes: raw.getRowsModified() }, results: [] };
  };

  // D1 rejects compound SELECTs with more than a few terms ("too many terms in
  // compound SELECT"); plain SQLite allows 500. Fail here too, so tests catch it.
  const D1_MAX_UNIONS = 4;
  function checkD1Limits(sql: string) {
    const unions = (sql.match(/\bUNION\b/gi) || []).length;
    if (unions > D1_MAX_UNIONS) throw new Error(`D1_ERROR: too many terms in compound SELECT (${unions + 1} terms)`);
  }

  function statement(sql: string, params: SqlValue[] = []): D1PreparedStatement & { _exec(): unknown } {
    checkD1Limits(sql);
    const stmt = {
      bind: (...p: unknown[]) => statement(sql, p.map((v) => (v === undefined ? null : v)) as SqlValue[]),
      first: async <T,>(col?: string) => {
        const r = rows<Record<string, unknown>>(sql, params)[0];
        if (!r) return null;
        return (col ? r[col] : r) as T;
      },
      all: async <T,>() => ({ success: true, results: rows<T>(sql, params), meta: {} }),
      run: async () => run(sql, params),
      raw: async () => rows<Record<string, unknown>>(sql, params).map((r) => Object.values(r)),
      _exec: () => (/^\s*(select|with)\b/i.test(sql) ? { success: true, results: rows(sql, params), meta: {} } : run(sql, params)),
    };
    return stmt as unknown as D1PreparedStatement & { _exec(): unknown };
  }

  const db = {
    raw,
    rows,
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      raw.exec('BEGIN');
      try {
        const out = stmts.map((s) => (s as unknown as { _exec(): unknown })._exec());
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    exec: async (sql: string) => {
      raw.exec(sql);
      return { count: 0, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  };
  return db as unknown as SqliteD1;
}

/** Apply the migrations from `first` (a file name prefix, e.g. '0086') onwards. */
export function applyMigrationsFrom(db: SqliteD1, first: string): void {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) if (file >= first) db.raw.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
}
