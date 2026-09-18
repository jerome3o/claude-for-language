/**
 * Invite-only sign-up: invites, redemptions, access requests, can_invite.
 *
 * An invite's id is the bearer token in `/join/<id>` — it is never logged and
 * the public lookup endpoint never returns the bound email.
 */
import { User, RelationshipRole } from '../types';

export interface Invite {
  id: string;
  created_by: string;
  /** If set, only this Google email may redeem the invite. */
  email: string | null;
  /** The relationship the inviter wants with the invitee; null = none. */
  inviter_role: RelationshipRole | null;
  /** JSON array of the inviter's deck ids to copy to the new user on join. */
  share_deck_ids: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  note: string | null;
  /** Optional note from the inviter, posted as the first chat message on redemption. */
  welcome_message: string | null;
  /** When the /join link was first opened (before any sign-in). */
  opened_at: string | null;
}

export interface InviteRedemption {
  invite_id: string;
  user_id: string;
  redeemed_at: string;
  user_name: string | null;
  user_email: string | null;
}

export type InviteStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface InviteWithMeta extends Invite {
  status: InviteStatus;
  creator_name: string | null;
  creator_email: string | null;
  redemptions: InviteRedemption[];
}

export type AccessRequestStatus = 'pending' | 'approved' | 'dismissed';

export interface AccessRequest {
  id: string;
  email: string;
  name: string | null;
  picture_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
  attempts: number;
  status: AccessRequestStatus;
}

export const MAX_INVITE_USES = 1000;
export const MAX_INVITE_EXPIRY_DAYS = 365;

/** 32 random bytes as base64url (43 chars) — long enough that guessing is hopeless. */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Shape check for a token that came from a URL, before it touches the DB. */
export function isPlausibleInviteToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

export function userMayInvite(user: Pick<User, 'is_admin' | 'can_invite'> | null | undefined): boolean {
  return !!user && (!!user.is_admin || !!user.can_invite);
}

export function parseShareDeckIds(invite: Pick<Invite, 'share_deck_ids'>): string[] {
  if (!invite.share_deck_ids) return [];
  try {
    const parsed = JSON.parse(invite.share_deck_ids);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function inviteStatus(invite: Invite, now: Date = new Date()): InviteStatus {
  if (invite.revoked_at) return 'revoked';
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= now.getTime()) return 'expired';
  if (invite.use_count >= invite.max_uses) return 'used';
  return 'active';
}

export function isInviteValid(invite: Invite | null | undefined, now: Date = new Date()): invite is Invite {
  return !!invite && inviteStatus(invite, now) === 'active';
}

export interface CreateInviteInput {
  created_by: string;
  email?: string | null;
  inviter_role?: RelationshipRole | null;
  share_deck_ids?: string[] | null;
  max_uses?: number | null;
  expires_in_days?: number | null;
  note?: string | null;
  welcome_message?: string | null;
}

export const MAX_WELCOME_MESSAGE_LENGTH = 1000;

export async function createInvite(db: D1Database, input: CreateInviteInput): Promise<Invite> {
  const id = generateInviteToken();
  const maxUses = Math.min(Math.max(Math.floor(input.max_uses ?? 1), 1), MAX_INVITE_USES);
  const days = input.expires_in_days != null
    ? Math.min(Math.max(Math.floor(input.expires_in_days), 1), MAX_INVITE_EXPIRY_DAYS)
    : null;
  const expiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
  const email = input.email ? normalizeEmail(input.email) : null;
  const shareDeckIds = input.share_deck_ids && input.share_deck_ids.length > 0
    ? JSON.stringify(input.share_deck_ids)
    : null;
  const welcome = input.welcome_message?.trim()
    ? input.welcome_message.trim().slice(0, MAX_WELCOME_MESSAGE_LENGTH)
    : null;

  await db
    .prepare(`
      INSERT INTO invites (id, created_by, email, inviter_role, share_deck_ids, max_uses, expires_at, note, welcome_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(id, input.created_by, email, input.inviter_role ?? null, shareDeckIds, maxUses, expiresAt, input.note ?? null, welcome)
    .run();

  const invite = await getInviteById(db, id);
  if (!invite) throw new Error('Failed to create invite');
  return invite;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getInviteById(db: D1Database, id: string): Promise<Invite | null> {
  return db.prepare('SELECT * FROM invites WHERE id = ?').bind(id).first<Invite>();
}

/** The newest still-valid invite bound to this email, if any. */
export async function findValidInviteForEmail(db: D1Database, email: string): Promise<Invite | null> {
  const rows = await db
    .prepare(`
      SELECT * FROM invites
      WHERE email = ? AND revoked_at IS NULL
      ORDER BY created_at DESC
    `)
    .bind(normalizeEmail(email))
    .all<Invite>();
  const now = new Date();
  return rows.results.find(inv => isInviteValid(inv, now)) ?? null;
}

/**
 * A pending email invitation (the pre-existing `pending_invitations` table)
 * counts as a valid invite only if its inviter is allowed to invite.
 */
export async function findPermittedPendingInvitation(
  db: D1Database,
  email: string
): Promise<{ id: string; inviter_id: string; inviter_role: RelationshipRole } | null> {
  return db
    .prepare(`
      SELECT pi.id, pi.inviter_id, pi.inviter_role
      FROM pending_invitations pi
      JOIN users u ON u.id = pi.inviter_id
      WHERE pi.recipient_email = ? AND pi.status = 'pending'
        AND pi.expires_at > datetime('now')
        AND (u.can_invite = 1 OR u.is_admin = 1)
      ORDER BY pi.created_at DESC
      LIMIT 1
    `)
    .bind(email)
    .first<{ id: string; inviter_id: string; inviter_role: RelationshipRole }>();
}

/**
 * Record that `userId` redeemed `inviteId`. Idempotent: a second call for the
 * same pair is a no-op and does not bump use_count.
 * Returns true if this call recorded a new redemption.
 */
export async function recordRedemption(db: D1Database, inviteId: string, userId: string): Promise<boolean> {
  const existing = await db
    .prepare('SELECT invite_id FROM invite_redemptions WHERE invite_id = ? AND user_id = ?')
    .bind(inviteId, userId)
    .first<{ invite_id: string }>();
  if (existing) return false;

  await db
    .prepare('INSERT OR IGNORE INTO invite_redemptions (invite_id, user_id) VALUES (?, ?)')
    .bind(inviteId, userId)
    .run();
  await db
    .prepare('UPDATE invites SET use_count = use_count + 1 WHERE id = ?')
    .bind(inviteId)
    .run();
  return true;
}

/**
 * Record the first time the /join link was opened. Only the first open counts,
 * so the tutor's list can say "opened, not signed in" without churn.
 */
export async function markInviteOpened(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE invites SET opened_at = datetime('now') WHERE id = ? AND opened_at IS NULL")
    .bind(id)
    .run();
}

/** The most recent invite this user redeemed, with the invite itself. */
export async function findLatestRedemptionForUser(
  db: D1Database,
  userId: string
): Promise<(Invite & { redeemed_at: string }) | null> {
  return db
    .prepare(`
      SELECT i.*, r.redeemed_at
      FROM invite_redemptions r
      JOIN invites i ON i.id = r.invite_id
      WHERE r.user_id = ?
      ORDER BY r.redeemed_at DESC
      LIMIT 1
    `)
    .bind(userId)
    .first<Invite & { redeemed_at: string }>();
}

export async function revokeInvite(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE invites SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL")
    .bind(id)
    .run();
}

interface InviteRow extends Invite {
  creator_name: string | null;
  creator_email: string | null;
}

async function attachMeta(db: D1Database, rows: InviteRow[]): Promise<InviteWithMeta[]> {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(',');
  const redemptions = await db
    .prepare(`
      SELECT r.invite_id, r.user_id, r.redeemed_at, u.name AS user_name, u.email AS user_email
      FROM invite_redemptions r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.invite_id IN (${placeholders})
      ORDER BY r.redeemed_at DESC
    `)
    .bind(...rows.map(r => r.id))
    .all<InviteRedemption>();

  const byInvite = new Map<string, InviteRedemption[]>();
  for (const r of redemptions.results) {
    const list = byInvite.get(r.invite_id) ?? [];
    list.push(r);
    byInvite.set(r.invite_id, list);
  }
  const now = new Date();
  return rows.map(row => ({
    ...row,
    status: inviteStatus(row, now),
    redemptions: byInvite.get(row.id) ?? [],
  }));
}

const INVITE_SELECT = `
  SELECT i.*, u.name AS creator_name, u.email AS creator_email
  FROM invites i
  LEFT JOIN users u ON u.id = i.created_by
`;

export async function listInvitesByUser(db: D1Database, userId: string): Promise<InviteWithMeta[]> {
  const rows = await db
    .prepare(`${INVITE_SELECT} WHERE i.created_by = ? ORDER BY i.created_at DESC`)
    .bind(userId)
    .all<InviteRow>();
  return attachMeta(db, rows.results);
}

export async function listAllInvites(db: D1Database): Promise<InviteWithMeta[]> {
  const rows = await db
    .prepare(`${INVITE_SELECT} ORDER BY i.created_at DESC LIMIT 500`)
    .all<InviteRow>();
  return attachMeta(db, rows.results);
}

// ============ Access requests ============

/**
 * Record an uninvited sign-in attempt. One row per email; repeat attempts bump
 * `attempts` and `last_seen_at`. An 'approved' row whose invite evidently no
 * longer works goes back to 'pending'; a dismissed one stays dismissed.
 * Returns whether this was the first time we saw the email (for the ntfy ping).
 */
export async function recordAccessRequest(
  db: D1Database,
  person: { email: string; name?: string | null; picture_url?: string | null }
): Promise<{ request: AccessRequest; isFirst: boolean }> {
  const email = normalizeEmail(person.email);
  const existing = await db
    .prepare('SELECT * FROM access_requests WHERE email = ?')
    .bind(email)
    .first<AccessRequest>();

  if (existing) {
    const nextStatus: AccessRequestStatus = existing.status === 'approved' ? 'pending' : existing.status;
    await db
      .prepare(`
        UPDATE access_requests
        SET attempts = attempts + 1, last_seen_at = datetime('now'), name = ?, picture_url = ?, status = ?
        WHERE id = ?
      `)
      .bind(person.name ?? existing.name, person.picture_url ?? existing.picture_url, nextStatus, existing.id)
      .run();
    const request = await db
      .prepare('SELECT * FROM access_requests WHERE id = ?')
      .bind(existing.id)
      .first<AccessRequest>();
    return { request: request ?? { ...existing, status: nextStatus }, isFirst: false };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(`
      INSERT INTO access_requests (id, email, name, picture_url)
      VALUES (?, ?, ?, ?)
    `)
    .bind(id, email, person.name ?? null, person.picture_url ?? null)
    .run();
  const request = await db
    .prepare('SELECT * FROM access_requests WHERE id = ?')
    .bind(id)
    .first<AccessRequest>();
  return {
    request: request ?? {
      id, email, name: person.name ?? null, picture_url: person.picture_url ?? null,
      first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
      attempts: 1, status: 'pending',
    },
    isFirst: true,
  };
}

export async function listAccessRequests(
  db: D1Database,
  status: AccessRequestStatus | 'all' = 'pending'
): Promise<AccessRequest[]> {
  const rows = status === 'all'
    ? await db.prepare('SELECT * FROM access_requests ORDER BY last_seen_at DESC LIMIT 200').all<AccessRequest>()
    : await db
        .prepare('SELECT * FROM access_requests WHERE status = ? ORDER BY last_seen_at DESC LIMIT 200')
        .bind(status)
        .all<AccessRequest>();
  return rows.results;
}

export async function getAccessRequestById(db: D1Database, id: string): Promise<AccessRequest | null> {
  return db.prepare('SELECT * FROM access_requests WHERE id = ?').bind(id).first<AccessRequest>();
}

export async function setAccessRequestStatus(
  db: D1Database,
  id: string,
  status: AccessRequestStatus
): Promise<void> {
  await db.prepare('UPDATE access_requests SET status = ? WHERE id = ?').bind(status, id).run();
}

/** Mark the access request for this email approved (used when the person is admitted). */
export async function markAccessRequestApprovedByEmail(db: D1Database, email: string): Promise<void> {
  await db
    .prepare("UPDATE access_requests SET status = 'approved' WHERE email = ? AND status = 'pending'")
    .bind(normalizeEmail(email))
    .run();
}

// ============ can_invite ============

export async function setUserCanInvite(db: D1Database, userId: string, canInvite: boolean): Promise<void> {
  await db
    .prepare('UPDATE users SET can_invite = ? WHERE id = ?')
    .bind(canInvite ? 1 : 0, userId)
    .run();
}
