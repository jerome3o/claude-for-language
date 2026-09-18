import type { RelationshipRole } from '../types';

export type InviteStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface InviteRedemption {
  invite_id: string;
  user_id: string;
  redeemed_at: string;
  user_name: string | null;
  user_email: string | null;
}

export interface Invite {
  id: string;
  created_by: string;
  email: string | null;
  inviter_role: RelationshipRole | null;
  share_deck_ids: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  note: string | null;
  /** Optional note from the inviter, posted as their first chat message on redemption. */
  welcome_message: string | null;
  /** When the /join link was first opened — set even if nobody signed in yet. */
  opened_at: string | null;
  status: InviteStatus;
  creator_name: string | null;
  creator_email: string | null;
  redemptions: InviteRedemption[];
  /** Full /join link on the frontend origin. */
  url: string;
}

export interface CreateInviteInput {
  email?: string | null;
  inviter_role?: RelationshipRole | null;
  share_deck_ids?: string[];
  max_uses?: number | null;
  expires_in_days?: number | null;
  note?: string | null;
  welcome_message?: string | null;
}

/** POST /api/decks/starter — the tutor's built-in "Starter Chinese" deck. */
export interface StarterDeckResult {
  deck: { id: string; name: string };
  created: boolean;
  word_count: number;
}

/** What /join/<token> may see before signing in — no emails. */
export interface PublicInvite {
  status: InviteStatus;
  valid: boolean;
  inviter_name: string;
  inviter_picture_url: string | null;
  inviter_role: RelationshipRole | null;
  email_bound: boolean;
  shares_decks: boolean;
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

export interface RedeemResult {
  redeemed: boolean;
  relationshipId: string | null;
  sharedDeckIds: string[];
  welcomeConversationId: string | null;
}
