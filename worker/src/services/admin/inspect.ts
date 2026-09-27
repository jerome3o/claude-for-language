/**
 * Read-only account inspection for the admin (Admin page + admin_* MCP tools):
 * who the user is, how their devices last reported in, their relationships,
 * and their decks INCLUDING deleted ones and the share rows around them — what
 * you need to debug "I deleted it and it is still there".
 *
 * Nothing here writes. `setUserRole` is the one small write (users.role).
 */
import type { UserRole } from '../../types';

export const USER_ROLES: readonly UserRole[] = ['student', 'tutor'];

export interface AdminUserRef {
  id: string;
  email: string | null;
  name: string | null;
}

/** An id, or an email (case-insensitive) — admins and MCP tools think in emails. */
export async function resolveUserRef(db: D1Database, idOrEmail: string): Promise<AdminUserRef | null> {
  const ref = idOrEmail.trim();
  if (!ref) return null;
  const byId = await db.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(ref).first<AdminUserRef>();
  if (byId) return byId;
  if (!ref.includes('@')) return null;
  return db.prepare('SELECT id, email, name FROM users WHERE lower(email) = lower(?)').bind(ref).first<AdminUserRef>();
}

export async function setUserRole(db: D1Database, userId: string, role: UserRole): Promise<boolean> {
  const res = await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run();
  return Number(res.meta?.changes ?? 0) > 0;
}

const n = (v: unknown) => Number(v ?? 0);

export async function inspectUser(db: D1Database, userId: string) {
  const user = await db
    .prepare(
      `SELECT id, email, name, picture_url, role, is_admin, can_invite, landing_page, created_at, last_login_at,
              install_kind, cached_audio_count, last_opened_at, new_cards_per_day, secondary_cards_per_day
       FROM users WHERE id = ?`
    )
    .bind(userId)
    .first<Record<string, unknown>>();
  if (!user) return null;

  const counts = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM decks WHERE user_id = ?1) AS decks,
         (SELECT COUNT(*) FROM notes WHERE deck_id IN (SELECT id FROM decks WHERE user_id = ?1)) AS notes,
         (SELECT COUNT(*) FROM review_events WHERE user_id = ?1) AS review_events,
         (SELECT MAX(reviewed_at) FROM review_events WHERE user_id = ?1) AS last_review_at,
         (SELECT COUNT(*) FROM graded_readers WHERE user_id = ?1) AS readers,
         (SELECT COUNT(*) FROM custom_lessons WHERE user_id = ?1) AS custom_lessons,
         (SELECT COUNT(*) FROM lesson_library WHERE owner_id = ?1 AND archived_at IS NULL) AS library_lessons,
         (SELECT COUNT(*) FROM deleted_items WHERE user_id = ?1 AND kind = 'deck') AS deleted_decks,
         (SELECT COUNT(*) FROM deleted_items WHERE user_id = ?1 AND kind = 'note') AS deleted_notes`
    )
    .bind(userId)
    .first<Record<string, unknown>>();

  const sync = await db
    .prepare(
      `SELECT
         (SELECT last_sync_at FROM sync_metadata WHERE user_id = ?1) AS last_event_sync_at,
         (SELECT last_event_at FROM sync_metadata WHERE user_id = ?1) AS last_event_at,
         (SELECT COUNT(*) FROM auth_sessions WHERE user_id = ?1 AND expires_at > datetime('now')) AS active_sessions,
         (SELECT MAX(created_at) FROM auth_sessions WHERE user_id = ?1) AS last_session_created_at,
         (SELECT COUNT(*) FROM oauth_tokens WHERE user_id = ?1) AS mcp_tokens`
    )
    .bind(userId)
    .first<Record<string, unknown>>();

  const rels = await db
    .prepare(
      `SELECT tr.id, tr.status, tr.created_at, tr.requester_id, tr.requester_role,
              o.id AS other_id, o.email AS other_email, o.name AS other_name
       FROM tutor_relationships tr
       JOIN users o ON o.id = CASE WHEN tr.requester_id = ?1 THEN tr.recipient_id ELSE tr.requester_id END
       WHERE tr.requester_id = ?1 OR tr.recipient_id = ?1
       ORDER BY tr.created_at`
    )
    .bind(userId)
    .all<{ id: string; status: string; created_at: string; requester_id: string; requester_role: string; other_id: string; other_email: string | null; other_name: string | null }>();

  const requests = await db
    .prepare(
      `SELECT id, created_at, page_context, status, approval_status, substr(content, 1, 300) AS content, screenshot_url
       FROM feature_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
    )
    .bind(userId)
    .all<Record<string, unknown>>();

  return {
    user: { ...user, is_admin: !!user.is_admin, can_invite: !!user.can_invite },
    counts: {
      decks: n(counts?.decks),
      notes: n(counts?.notes),
      review_events: n(counts?.review_events),
      last_review_at: (counts?.last_review_at as string | null) ?? null,
      readers: n(counts?.readers),
      custom_lessons: n(counts?.custom_lessons),
      library_lessons: n(counts?.library_lessons),
      deleted_decks: n(counts?.deleted_decks),
      deleted_notes: n(counts?.deleted_notes),
    },
    sync: {
      last_opened_at: (user.last_opened_at as string | null) ?? null,
      install_kind: (user.install_kind as string | null) ?? null,
      cached_audio_count: user.cached_audio_count ?? null,
      last_event_sync_at: (sync?.last_event_sync_at as string | null) ?? null,
      last_event_at: (sync?.last_event_at as string | null) ?? null,
      active_sessions: n(sync?.active_sessions),
      last_session_created_at: (sync?.last_session_created_at as string | null) ?? null,
      mcp_tokens: n(sync?.mcp_tokens),
    },
    relationships: (rels.results || []).map((r) => {
      const iAmRequester = r.requester_id === userId;
      const requesterIsTutor = r.requester_role === 'tutor';
      return {
        id: r.id,
        status: r.status,
        created_at: r.created_at,
        // What THIS user is in the pairing.
        my_role: (iAmRequester ? requesterIsTutor : !requesterIsTutor) ? 'tutor' : 'student',
        other: { id: r.other_id, email: r.other_email, name: r.other_name },
      };
    }),
    recent_feature_requests: requests.results || [],
  };
}

export interface DeckShareRow {
  id: string;
  relationship_id: string;
  shared_at: string;
  source_deck_id: string;
  source_name: string | null;
  source_owner: string | null;
  target_deck_id: string;
  target_name: string | null;
  target_owner: string | null;
  /** 1 when the inspected user is the tutor of this share's relationship. */
  user_is_tutor: number;
}

/**
 * Decks for debugging sync: live decks, deleted decks (tombstones, named from a
 * surviving copy when one exists), share rows either way, and shares whose
 * source vanished WITHOUT a tombstone (deleted before migration 0068 — devices
 * only drop those through the `live_deck_ids` reconcile in /api/sync/changes).
 */
export async function inspectUserDecks(db: D1Database, userId: string) {
  const decks = await db
    .prepare(
      `SELECT d.id, d.name, d.created_at, d.updated_at, d.study_priority,
              (SELECT COUNT(*) FROM notes n WHERE n.deck_id = d.id) AS note_count
       FROM decks d WHERE d.user_id = ? ORDER BY d.study_priority DESC, d.created_at DESC`
    )
    .bind(userId)
    .all<{ id: string; name: string; created_at: string; updated_at: string; study_priority: number | null; note_count: number }>();

  const deleted = await db
    .prepare(
      `SELECT di.item_id AS id, di.deleted_at,
              (SELECT t.name FROM shared_decks sd JOIN decks t ON t.id = sd.target_deck_id WHERE sd.source_deck_id = di.item_id LIMIT 1) AS name_from_copy,
              (SELECT COUNT(*) FROM deleted_items dn WHERE dn.user_id = di.user_id AND dn.kind = 'note' AND dn.deleted_at = di.deleted_at) AS notes_deleted_with_it
       FROM deleted_items di WHERE di.user_id = ? AND di.kind = 'deck' ORDER BY di.deleted_at DESC LIMIT 100`
    )
    .bind(userId)
    .all<{ id: string; deleted_at: string; name_from_copy: string | null; notes_deleted_with_it: number }>();

  const shares = await db
    .prepare(
      `SELECT sd.id, sd.relationship_id, sd.shared_at,
              sd.source_deck_id, src.name AS source_name, src.user_id AS source_owner,
              sd.target_deck_id, tgt.name AS target_name, tgt.user_id AS target_owner,
              CASE WHEN (tr.requester_id = ?1) = (tr.requester_role = 'tutor') THEN 1 ELSE 0 END AS user_is_tutor
       FROM shared_decks sd
       JOIN tutor_relationships tr ON tr.id = sd.relationship_id AND (tr.requester_id = ?1 OR tr.recipient_id = ?1)
       LEFT JOIN decks src ON src.id = sd.source_deck_id
       LEFT JOIN decks tgt ON tgt.id = sd.target_deck_id
       ORDER BY sd.shared_at DESC`
    )
    .bind(userId)
    .all<DeckShareRow>();

  const tombstoned = new Set((deleted.results || []).map((d) => d.id));
  const all = shares.results || [];
  const shape = (s: DeckShareRow) => {
    const { user_is_tutor: _role, ...rest } = s;
    return { ...rest, source_exists: s.source_owner != null, target_exists: s.target_owner != null };
  };

  return {
    decks: decks.results || [],
    deleted_decks: (deleted.results || []).map((d) => ({ ...d, name_hint: d.name_from_copy?.replace(/ \(from tutor\)$/, '') ?? null })),
    /** Decks this user (as tutor) copied to students. */
    shares_sent: all.filter((s) => s.user_is_tutor).map(shape),
    /** Copies this user (as student) received. */
    shares_received: all.filter((s) => !s.user_is_tutor).map(shape),
    /** Source decks gone with NO tombstone (deleted before 23 Sep 2026): stale devices kept these until live_deck_ids. */
    untombstoned_deleted_sources: [...new Set(
      all.filter((s) => s.user_is_tutor && s.source_owner == null && !tombstoned.has(s.source_deck_id)).map((s) => s.source_deck_id)
    )],
  };
}
