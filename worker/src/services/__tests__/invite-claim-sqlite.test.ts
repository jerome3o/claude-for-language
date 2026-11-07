/**
 * An invite's uses are taken atomically (Nov 2026): two people racing for the last use of
 * a link can't both get in, and a revoked / expired invite gives nothing. Real SQLite.
 */
import { describe, it, expect } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { claimInviteUse, recordRedemption } from '../../db/invite-queries';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

async function seed(invite: { max_uses?: number; use_count?: number; expires_at?: string | null; revoked_at?: string | null } = {}) {
  const db = await createSqliteD1();
  exec(db, "INSERT INTO users (id, email, name, role) VALUES ('tutor', 't@example.com', 'Tutor', 'tutor')");
  for (const id of ['a', 'b']) exec(db, 'INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', id, `${id}@example.com`, id, 'student');
  exec(db, 'INSERT INTO invites (id, created_by, max_uses, use_count, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)',
    'inv', 'tutor', invite.max_uses ?? 1, invite.use_count ?? 0, invite.expires_at ?? null, invite.revoked_at ?? null);
  return db;
}

async function useCount(db: SqliteD1): Promise<number> {
  return (await db.prepare('SELECT use_count FROM invites WHERE id = ?').bind('inv').first<{ use_count: number }>())!.use_count;
}

describe('claimInviteUse', () => {
  it('a one-use link: the first claim wins, the second gets nothing', async () => {
    const db = await seed();
    const [first, second] = await Promise.all([claimInviteUse(db, 'inv'), claimInviteUse(db, 'inv')]);
    expect([first, second].sort()).toEqual([false, true]);
    expect(await useCount(db)).toBe(1);
  });

  it('refuses a revoked or expired invite', async () => {
    expect(await claimInviteUse(await seed({ revoked_at: '2026-11-01T00:00:00Z' }), 'inv')).toBe(false);
    expect(await claimInviteUse(await seed({ expires_at: '2020-01-01T00:00:00.000Z' }), 'inv')).toBe(false);
    expect(await claimInviteUse(await seed({ expires_at: '2999-01-01T00:00:00.000Z' }), 'inv')).toBe(true);
  });

  it('recordRedemption: the second person finds the link used; the same person again changes nothing', async () => {
    const db = await seed();
    expect(await recordRedemption(db, 'inv', 'a')).toEqual({ redeemed: true, full: false });
    expect(await recordRedemption(db, 'inv', 'a')).toEqual({ redeemed: false, full: false });
    expect(await recordRedemption(db, 'inv', 'b')).toEqual({ redeemed: false, full: true });
    expect(await useCount(db)).toBe(1);
    const rows = await db.prepare('SELECT user_id FROM invite_redemptions').all<{ user_id: string }>();
    expect(rows.results.map((r) => r.user_id)).toEqual(['a']);
  });
});
