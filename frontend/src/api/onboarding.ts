import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { RelationshipRole } from '../types';

/** GET /api/me/onboarding — what a freshly invited student's first screen needs. */
export interface OnboardingState {
  invited: boolean;
  redeemed_at: string | null;
  inviter: { id: string; name: string | null; picture_url: string | null } | null;
  inviter_role: RelationshipRole | null;
  relationship_id: string | null;
  welcome_message: string | null;
  welcome_conversation_id: string | null;
  decks: { id: string; name: string; note_count: number }[];
  has_reviewed: boolean;
  review_count: number;
}

export async function getOnboarding(): Promise<OnboardingState> {
  const response = await fetch(`${API_BASE}/api/me/onboarding`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}
