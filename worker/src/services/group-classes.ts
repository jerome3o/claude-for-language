/**
 * Group classes — EXPERIMENTAL web-only prototype (docs/GROUP_CLASSES.md).
 *
 * A group is a tutor's list of 2–6 of HER active students; each member row
 * keeps the 1:1 relationship it came from, and every read re-checks that the
 * relationship is still active, so a group never grants more than the
 * relationships already do. A session is one live class in a GroupRoom
 * Durable Object; at most one is live per group.
 */

import { cleanGroupName, memberProblem } from '@shared/group';
import { generateId } from './cards';

export class GroupError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503, readonly problems?: string[]) {
    super(message);
    this.name = 'GroupError';
  }
}

export interface GroupMember {
  user_id: string;
  name: string;
  picture_url: string | null;
  relationship_id: string;
}

export interface GroupSession {
  id: string;
  group_id: string;
  tutor_id: string;
  status: 'live' | 'ended';
  created_at: number;
  ended_at: number | null;
  joined_count: number;
}

export interface GroupSummary {
  id: string;
  name: string;
  tutor_id: string;
  tutor_name: string;
  created_at: string;
  members: GroupMember[];
  live_session: GroupSession | null;
}

/** The tutor's side of an ACTIVE relationship, as SQL over `r` (tutor_relationships). */
const TUTOR_OF = `CASE WHEN r.requester_role = 'tutor' THEN r.requester_id ELSE r.recipient_id END`;
const STUDENT_OF = `CASE WHEN r.requester_role = 'tutor' THEN r.recipient_id ELSE r.requester_id END`;

const displayName = (name: string | null, email: string | null) => name || (email ? email.split('@')[0] : 'Someone');

/** The tutor's active students — who can go in a group. */
export async function listCandidateStudents(db: D1Database, tutorId: string): Promise<GroupMember[]> {
  const rows = await db
    .prepare(
      `SELECT r.id AS relationship_id, u.id AS user_id, u.name, u.email, u.picture_url
       FROM tutor_relationships r JOIN users u ON u.id = ${STUDENT_OF}
       WHERE r.status = 'active' AND ${TUTOR_OF} = ? AND u.id != 'claude-ai'
       ORDER BY u.name COLLATE NOCASE`,
    )
    .bind(tutorId)
    .all<{ relationship_id: string; user_id: string; name: string | null; email: string | null; picture_url: string | null }>();
  return (rows.results ?? []).map((r) => ({ user_id: r.user_id, name: displayName(r.name, r.email), picture_url: r.picture_url, relationship_id: r.relationship_id }));
}

async function membersOf(db: D1Database, groupIds: string[]): Promise<Map<string, GroupMember[]>> {
  const out = new Map<string, GroupMember[]>();
  if (groupIds.length === 0) return out;
  const rows = await db
    .prepare(
      `SELECT m.group_id, m.relationship_id, u.id AS user_id, u.name, u.email, u.picture_url
       FROM class_group_members m
       JOIN users u ON u.id = m.student_id
       JOIN tutor_relationships r ON r.id = m.relationship_id AND r.status = 'active'
       WHERE m.group_id IN (${groupIds.map(() => '?').join(',')})
       ORDER BY u.name COLLATE NOCASE`,
    )
    .bind(...groupIds)
    .all<{ group_id: string; relationship_id: string; user_id: string; name: string | null; email: string | null; picture_url: string | null }>();
  for (const r of rows.results ?? []) {
    const list = out.get(r.group_id) ?? [];
    list.push({ user_id: r.user_id, name: displayName(r.name, r.email), picture_url: r.picture_url, relationship_id: r.relationship_id });
    out.set(r.group_id, list);
  }
  return out;
}

async function liveSessionsOf(db: D1Database, groupIds: string[]): Promise<Map<string, GroupSession>> {
  const out = new Map<string, GroupSession>();
  if (groupIds.length === 0) return out;
  const rows = await db
    .prepare(`SELECT * FROM group_class_sessions WHERE status = 'live' AND group_id IN (${groupIds.map(() => '?').join(',')}) ORDER BY created_at DESC`)
    .bind(...groupIds)
    .all<GroupSession>();
  for (const s of rows.results ?? []) if (!out.has(s.group_id)) out.set(s.group_id, s);
  return out;
}

type GroupRow = { id: string; name: string; tutor_id: string; tutor_name: string | null; tutor_email: string | null; created_at: string };

async function summarize(db: D1Database, rows: GroupRow[]): Promise<GroupSummary[]> {
  const ids = rows.map((r) => r.id);
  const [members, live] = await Promise.all([membersOf(db, ids), liveSessionsOf(db, ids)]);
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    tutor_id: g.tutor_id,
    tutor_name: displayName(g.tutor_name, g.tutor_email),
    created_at: g.created_at,
    members: members.get(g.id) ?? [],
    live_session: live.get(g.id) ?? null,
  }));
}

const GROUP_SELECT = `SELECT g.id, g.name, g.tutor_id, g.created_at, t.name AS tutor_name, t.email AS tutor_email FROM class_groups g JOIN users t ON t.id = g.tutor_id`;

/** Groups I teach, and groups I'm a member of (through a still-active relationship). */
export async function listGroups(db: D1Database, userId: string): Promise<{ teaching: GroupSummary[]; member_of: GroupSummary[] }> {
  const [teaching, memberOf] = await Promise.all([
    db.prepare(`${GROUP_SELECT} WHERE g.tutor_id = ? AND g.archived_at IS NULL ORDER BY g.created_at DESC`).bind(userId).all<GroupRow>(),
    db
      .prepare(
        `${GROUP_SELECT} JOIN class_group_members m ON m.group_id = g.id AND m.student_id = ?
         JOIN tutor_relationships r ON r.id = m.relationship_id AND r.status = 'active'
         WHERE g.archived_at IS NULL ORDER BY g.created_at DESC`,
      )
      .bind(userId)
      .all<GroupRow>(),
  ]);
  return { teaching: await summarize(db, teaching.results ?? []), member_of: await summarize(db, memberOf.results ?? []) };
}

export async function getGroup(db: D1Database, groupId: string): Promise<GroupSummary | null> {
  const row = await db.prepare(`${GROUP_SELECT} WHERE g.id = ? AND g.archived_at IS NULL`).bind(groupId).first<GroupRow>();
  return row ? (await summarize(db, [row]))[0] : null;
}

/** The group, if `userId` teaches it. */
export async function requireOwnGroup(db: D1Database, groupId: string, userId: string): Promise<GroupSummary> {
  const group = await getGroup(db, groupId);
  if (!group || group.tutor_id !== userId) throw new GroupError('Group not found', 404);
  return group;
}

/** Validate a member list against the tutor's active students → member rows. */
async function resolveMembers(db: D1Database, tutorId: string, studentIds: unknown): Promise<GroupMember[]> {
  if (!Array.isArray(studentIds) || !studentIds.every((s) => typeof s === 'string')) throw new GroupError('Pick the students', 400, ['Pick the students']);
  const ids = [...new Set(studentIds as string[])];
  const problem = memberProblem(ids);
  if (problem) throw new GroupError(problem, 400, [problem]);
  const candidates = new Map((await listCandidateStudents(db, tutorId)).map((c) => [c.user_id, c]));
  const missing = ids.filter((id) => !candidates.has(id));
  if (missing.length) throw new GroupError('Only your active students can be in a group', 400, ['Only your active students can be in a group']);
  return ids.map((id) => candidates.get(id)!);
}

export async function createGroup(db: D1Database, tutorId: string, body: { name?: unknown; student_ids?: unknown }): Promise<GroupSummary> {
  const name = cleanGroupName(body.name);
  if ('problem' in name) throw new GroupError(name.problem, 400, [name.problem]);
  const members = await resolveMembers(db, tutorId, body.student_ids);
  const id = generateId();
  await db.batch([
    db.prepare('INSERT INTO class_groups (id, tutor_id, name) VALUES (?, ?, ?)').bind(id, tutorId, name.name),
    ...members.map((m) => db.prepare('INSERT INTO class_group_members (group_id, student_id, relationship_id) VALUES (?, ?, ?)').bind(id, m.user_id, m.relationship_id)),
  ]);
  return (await getGroup(db, id))!;
}

export async function updateGroup(db: D1Database, groupId: string, tutorId: string, body: { name?: unknown; student_ids?: unknown }): Promise<GroupSummary> {
  await requireOwnGroup(db, groupId, tutorId);
  const writes: D1PreparedStatement[] = [];
  if (body.name !== undefined) {
    const name = cleanGroupName(body.name);
    if ('problem' in name) throw new GroupError(name.problem, 400, [name.problem]);
    writes.push(db.prepare(`UPDATE class_groups SET name = ?, updated_at = datetime('now') WHERE id = ?`).bind(name.name, groupId));
  }
  if (body.student_ids !== undefined) {
    const members = await resolveMembers(db, tutorId, body.student_ids);
    writes.push(db.prepare('DELETE FROM class_group_members WHERE group_id = ?').bind(groupId));
    for (const m of members) writes.push(db.prepare('INSERT INTO class_group_members (group_id, student_id, relationship_id) VALUES (?, ?, ?)').bind(groupId, m.user_id, m.relationship_id));
  }
  if (writes.length) await db.batch(writes);
  return (await getGroup(db, groupId))!;
}

/** Archive (the rows stay; nothing else refers to them). Returns the live session to end, if any. */
export async function archiveGroup(db: D1Database, groupId: string, tutorId: string): Promise<GroupSession | null> {
  const group = await requireOwnGroup(db, groupId, tutorId);
  await db.prepare(`UPDATE class_groups SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(groupId).run();
  return group.live_session;
}

/** Start the group's live class, or return the one already live. */
export async function startSession(db: D1Database, groupId: string, tutorId: string, now = Date.now()): Promise<{ session: GroupSession; reused: boolean; group: GroupSummary }> {
  const group = await requireOwnGroup(db, groupId, tutorId);
  if (group.members.length === 0) throw new GroupError('Nobody in this group has an active connection with you any more', 409);
  if (group.live_session) return { session: group.live_session, reused: true, group };
  const session: GroupSession = { id: generateId(), group_id: groupId, tutor_id: tutorId, status: 'live', created_at: now, ended_at: null, joined_count: 0 };
  await db
    .prepare(`INSERT INTO group_class_sessions (id, group_id, tutor_id, status, created_at) VALUES (?, ?, ?, 'live', ?)`)
    .bind(session.id, groupId, tutorId, now)
    .run();
  return { session, reused: false, group };
}

export async function getSession(db: D1Database, sessionId: string): Promise<GroupSession | null> {
  return db.prepare('SELECT * FROM group_class_sessions WHERE id = ?').bind(sessionId).first<GroupSession>();
}

/** A session `userId` may see / join: the group's tutor, or a member through an active relationship. */
export async function requireSessionAccess(db: D1Database, sessionId: string, userId: string): Promise<{ session: GroupSession; group: GroupSummary; role: 'tutor' | 'student' }> {
  const session = await getSession(db, sessionId);
  if (!session) throw new GroupError('Class not found', 404);
  const group = await getGroup(db, session.group_id);
  if (!group) throw new GroupError('Class not found', 404);
  if (group.tutor_id === userId) return { session, group, role: 'tutor' };
  if (group.members.some((m) => m.user_id === userId)) return { session, group, role: 'student' };
  throw new GroupError('Class not found', 404);
}

/** Written by the room when the class ends (idempotent). */
export async function markSessionEnded(db: D1Database, sessionId: string, endedAt: number, joinedCount: number): Promise<void> {
  await db
    .prepare(`UPDATE group_class_sessions SET status = 'ended', ended_at = COALESCE(ended_at, ?), joined_count = MAX(joined_count, ?) WHERE id = ?`)
    .bind(endedAt, joinedCount, sessionId)
    .run();
}

