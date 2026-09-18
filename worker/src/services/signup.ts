/**
 * Invite-only sign-up: decide whether a Google account that has no users row
 * may be created, and apply an invite's side-effects once it is.
 *
 * Resolution order for a new account:
 *   1. invite token carried through the OAuth state (from /join/<token>)
 *   2. a still-valid `invites` row bound to the Google email
 *   3. a pending `pending_invitations` row whose inviter may invite
 *   4. ADMIN_EMAIL — the admin can never be locked out
 * Anything else is denied and recorded as an access request by the caller.
 */
import { User } from '../types';
import type { GoogleUserInfo } from './auth';
import {
  Invite,
  getInviteById,
  isInviteValid,
  isPlausibleInviteToken,
  findValidInviteForEmail,
  findPermittedPendingInvitation,
  normalizeEmail,
  parseShareDeckIds,
  recordRedemption,
} from '../db/invite-queries';
import { shareDeck } from './conversations';

export type SignupResolution =
  | { kind: 'invite'; invite: Invite; source: 'token' | 'email' }
  | { kind: 'pending_invitation'; invitationId: string; inviterId: string }
  | { kind: 'admin' }
  | { kind: 'denied'; reason: 'invite_only' }
  | { kind: 'denied'; reason: 'email_mismatch'; invite: Invite };

export interface ResolveSignupOptions {
  /** Invite token from the OAuth state, if sign-in started on /join/<token>. */
  inviteToken?: string | null;
  adminEmail?: string | null;
  now?: Date;
}

function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && normalizeEmail(a) === normalizeEmail(b);
}

/**
 * Decide whether `googleUser` (who has no users row) may sign up.
 * Only reads; creating the user and redeeming is the caller's job.
 */
export async function resolveSignup(
  db: D1Database,
  googleUser: Pick<GoogleUserInfo, 'email'>,
  opts: ResolveSignupOptions = {}
): Promise<SignupResolution> {
  const now = opts.now ?? new Date();
  const isAdmin = emailsMatch(googleUser.email, opts.adminEmail);

  // 1. Token from the /join link
  if (isPlausibleInviteToken(opts.inviteToken)) {
    const invite = await getInviteById(db, opts.inviteToken);
    if (isInviteValid(invite, now)) {
      if (!invite.email || emailsMatch(invite.email, googleUser.email)) {
        return { kind: 'invite', invite, source: 'token' };
      }
      // Valid link, wrong Google account. The admin is still let in.
      if (isAdmin) return { kind: 'admin' };
      return { kind: 'denied', reason: 'email_mismatch', invite };
    }
    // Expired / revoked / used up: fall through — an email-bound invite may still exist.
  }

  // 2. Email-bound invite
  const emailInvite = await findValidInviteForEmail(db, googleUser.email);
  if (emailInvite) return { kind: 'invite', invite: emailInvite, source: 'email' };

  // 3. Legacy pending email invitation from a permitted inviter
  const pending = await findPermittedPendingInvitation(db, googleUser.email);
  if (pending) {
    return { kind: 'pending_invitation', invitationId: pending.id, inviterId: pending.inviter_id };
  }

  // 4. The admin is permanently invited
  if (isAdmin) return { kind: 'admin' };

  return { kind: 'denied', reason: 'invite_only' };
}

export interface RedeemResult {
  redeemed: boolean;
  relationshipId: string | null;
  sharedDeckIds: string[];
}

/**
 * Apply an invite for `user`: record the redemption, create the relationship
 * the inviter asked for (already active — the inviter chose them) and copy the
 * decks the inviter picked. Idempotent: rerunning for the same user changes
 * nothing, and each side-effect checks for itself before acting.
 */
export async function redeemInvite(db: D1Database, user: User, invite: Invite): Promise<RedeemResult> {
  const result: RedeemResult = { redeemed: false, relationshipId: null, sharedDeckIds: [] };

  if (invite.created_by === user.id) return result; // an inviter opening their own link

  result.redeemed = await recordRedemption(db, invite.id, user.id);

  if (!invite.inviter_role) return result;

  // Relationship: inviter is the requester with the role they picked.
  const existing = await db
    .prepare(`
      SELECT id, status FROM tutor_relationships
      WHERE ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))
      AND status != 'removed'
    `)
    .bind(invite.created_by, user.id, user.id, invite.created_by)
    .first<{ id: string; status: string }>();

  if (existing) {
    result.relationshipId = existing.id;
    if (existing.status === 'pending') {
      await db
        .prepare("UPDATE tutor_relationships SET status = 'active', accepted_at = datetime('now') WHERE id = ?")
        .bind(existing.id)
        .run();
    }
  } else {
    const relId = crypto.randomUUID();
    await db
      .prepare(`
        INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status, accepted_at)
        VALUES (?, ?, ?, ?, 'active', datetime('now'))
      `)
      .bind(relId, invite.created_by, user.id, invite.inviter_role)
      .run();
    result.relationshipId = relId;
  }

  // Decks: only a tutor can copy decks to a student, and only once per invite.
  if (invite.inviter_role !== 'tutor' || !result.relationshipId) return result;

  for (const deckId of parseShareDeckIds(invite)) {
    const already = await db
      .prepare('SELECT id FROM shared_decks WHERE relationship_id = ? AND source_deck_id = ?')
      .bind(result.relationshipId, deckId)
      .first<{ id: string }>();
    if (already) continue;
    try {
      await shareDeck(db, result.relationshipId, invite.created_by, deckId);
      result.sharedDeckIds.push(deckId);
    } catch (err) {
      // A deck deleted since the invite was made must not break sign-up.
      console.error('[Signup] Failed to share deck from invite:', err instanceof Error ? err.message : err);
    }
  }

  return result;
}
