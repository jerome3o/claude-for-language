/**
 * What a freshly invited student's first screen needs, read from the data the
 * join flow already wrote: the redeemed invite (who invited them, the welcome
 * note), the decks that invite copied over, and whether they have reviewed
 * anything yet. No extra state to keep in step — once a review exists the
 * client shows the normal home.
 */
import { RelationshipRole, User } from '../types';
import { findLatestRedemptionForUser } from '../db/invite-queries';

export interface OnboardingDeck {
  id: string;
  name: string;
  note_count: number;
}

export interface OnboardingState {
  /** The user got in through an invite link. */
  invited: boolean;
  redeemed_at: string | null;
  inviter: { id: string; name: string | null; picture_url: string | null } | null;
  inviter_role: RelationshipRole | null;
  relationship_id: string | null;
  welcome_message: string | null;
  /** The conversation the welcome message was posted in (for "Reply"). */
  welcome_conversation_id: string | null;
  /** Decks the invite copied into this account, oldest first. */
  decks: OnboardingDeck[];
  has_reviewed: boolean;
  review_count: number;
}

export async function getOnboardingState(db: D1Database, user: Pick<User, 'id'>): Promise<OnboardingState> {
  const reviews = await db
    .prepare('SELECT COUNT(*) AS n FROM review_events WHERE user_id = ?')
    .bind(user.id)
    .first<{ n: number }>();
  const reviewCount = Number(reviews?.n ?? 0);

  const base: OnboardingState = {
    invited: false,
    redeemed_at: null,
    inviter: null,
    inviter_role: null,
    relationship_id: null,
    welcome_message: null,
    welcome_conversation_id: null,
    decks: [],
    has_reviewed: reviewCount > 0,
    review_count: reviewCount,
  };

  const redemption = await findLatestRedemptionForUser(db, user.id);
  if (!redemption) return base;

  const inviter = await db
    .prepare('SELECT id, name, picture_url FROM users WHERE id = ?')
    .bind(redemption.created_by)
    .first<{ id: string; name: string | null; picture_url: string | null }>();

  const relationship = await db
    .prepare(`
      SELECT id FROM tutor_relationships
      WHERE ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))
      AND status != 'removed'
      ORDER BY created_at DESC LIMIT 1
    `)
    .bind(redemption.created_by, user.id, user.id, redemption.created_by)
    .first<{ id: string }>();

  let decks: OnboardingDeck[] = [];
  let welcomeConversationId: string | null = null;
  if (relationship) {
    const rows = await db
      .prepare(`
        SELECT d.id, d.name, (SELECT COUNT(*) FROM notes n WHERE n.deck_id = d.id) AS note_count
        FROM shared_decks sd
        JOIN decks d ON d.id = sd.target_deck_id
        WHERE sd.relationship_id = ? AND d.user_id = ?
        ORDER BY sd.shared_at ASC
      `)
      .bind(relationship.id, user.id)
      .all<OnboardingDeck>();
    decks = rows.results.map(r => ({ id: r.id, name: r.name, note_count: Number(r.note_count ?? 0) }));

    if (redemption.welcome_message) {
      const conv = await db
        .prepare('SELECT id FROM conversations WHERE relationship_id = ? ORDER BY created_at ASC LIMIT 1')
        .bind(relationship.id)
        .first<{ id: string }>();
      welcomeConversationId = conv?.id ?? null;
    }
  }

  return {
    ...base,
    invited: true,
    redeemed_at: redemption.redeemed_at,
    inviter: inviter ? { id: inviter.id, name: inviter.name, picture_url: inviter.picture_url } : null,
    inviter_role: redemption.inviter_role,
    relationship_id: relationship?.id ?? null,
    welcome_message: redemption.welcome_message,
    welcome_conversation_id: welcomeConversationId,
    decks,
  };
}
