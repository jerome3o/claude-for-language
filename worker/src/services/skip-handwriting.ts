/**
 * "Skip handwriting exercises" (shared/lesson/handwriting.ts; docs/STUDY_SESSION.md "Skip
 * handwriting"): one switch per account, `users.skip_handwriting` (migration 0139; NULL / 0 = off).
 * On /api/auth/me and /api/sync/changes as `skip_handwriting`; both apps cache it on the device so
 * a lesson played offline follows it.
 */

export async function getSkipHandwriting(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT skip_handwriting FROM users WHERE id = ?').bind(userId).first<{ skip_handwriting: number | null }>();
  return Number(row?.skip_handwriting) === 1;
}

export async function setSkipHandwriting(db: D1Database, userId: string, on: boolean): Promise<boolean> {
  await db.prepare('UPDATE users SET skip_handwriting = ? WHERE id = ?').bind(on ? 1 : 0, userId).run();
  return on;
}
