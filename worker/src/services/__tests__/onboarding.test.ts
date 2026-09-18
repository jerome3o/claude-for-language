import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1, MockD1Database } from './d1-mock';
import { getOnboardingState } from '../onboarding';

const Q_REVIEWS = 'SELECT COUNT(*) AS n FROM review_events WHERE user_id = ?';
const Q_REDEMPTION = 'FROM invite_redemptions r';
const Q_INVITER = 'SELECT id, name, picture_url FROM users WHERE id = ?';
const Q_REL = 'SELECT id FROM tutor_relationships';
const Q_DECKS = 'FROM shared_decks sd';
const Q_CONV = 'SELECT id FROM conversations WHERE relationship_id = ?';

const TOKEN = 'a'.repeat(43);
const redemption = {
  id: TOKEN,
  created_by: 'tutor-1',
  email: null,
  inviter_role: 'tutor',
  share_deck_ids: '["src-1"]',
  max_uses: 1,
  use_count: 1,
  expires_at: null,
  revoked_at: null,
  created_at: '2026-09-01T00:00:00Z',
  note: null,
  welcome_message: '欢迎！',
  opened_at: '2026-09-02T00:00:00Z',
  redeemed_at: '2026-09-03T00:00:00Z',
};

describe('getOnboardingState', () => {
  let db: MockD1Database;

  beforeEach(() => {
    db = createMockD1();
  });

  it('is empty (not invited) for a user with no redemption', async () => {
    db.addResult(Q_REVIEWS, { n: 3 });
    const s = await getOnboardingState(db, { id: 'u-1' });
    expect(s).toEqual({
      invited: false,
      redeemed_at: null,
      inviter: null,
      inviter_role: null,
      relationship_id: null,
      welcome_message: null,
      welcome_conversation_id: null,
      decks: [],
      has_reviewed: true,
      review_count: 3,
    });
    expect(db.getQueries().some(q => q.sql.includes('FROM users'))).toBe(false);
  });

  it('assembles inviter, copied decks and the welcome conversation for an invitee', async () => {
    db.addResult(Q_REVIEWS, { n: 0 });
    db.addResult(Q_REDEMPTION, redemption);
    db.addResult(Q_INVITER, { id: 'tutor-1', name: 'Wang Laoshi', picture_url: null });
    db.addResult(Q_REL, { id: 'rel-1' });
    db.addAllResult(Q_DECKS, [{ id: 'deck-copy', name: '第三周作业：天气 (from tutor)', note_count: 6 }]);
    db.addResult(Q_CONV, { id: 'conv-1' });

    const s = await getOnboardingState(db, { id: 'student-1' });
    expect(s.invited).toBe(true);
    expect(s.has_reviewed).toBe(false);
    expect(s.inviter).toEqual({ id: 'tutor-1', name: 'Wang Laoshi', picture_url: null });
    expect(s.inviter_role).toBe('tutor');
    expect(s.relationship_id).toBe('rel-1');
    expect(s.welcome_message).toBe('欢迎！');
    expect(s.welcome_conversation_id).toBe('conv-1');
    expect(s.decks).toEqual([{ id: 'deck-copy', name: '第三周作业：天气 (from tutor)', note_count: 6 }]);
    expect(s.redeemed_at).toBe('2026-09-03T00:00:00Z');

    // decks are scoped to the relationship AND the student's own account
    const deckQuery = db.getQueries().find(q => q.sql.includes(Q_DECKS));
    expect(deckQuery?.params).toEqual(['rel-1', 'student-1']);
  });

  it('does not look up a conversation when there was no welcome message', async () => {
    db.addResult(Q_REVIEWS, { n: 0 });
    db.addResult(Q_REDEMPTION, { ...redemption, welcome_message: null });
    db.addResult(Q_REL, { id: 'rel-1' });
    const s = await getOnboardingState(db, { id: 'student-1' });
    expect(s.welcome_conversation_id).toBeNull();
    expect(db.getQueries().some(q => q.sql.includes(Q_CONV))).toBe(false);
  });

  it('copes with a relationship that no longer exists', async () => {
    db.addResult(Q_REVIEWS, { n: 0 });
    db.addResult(Q_REDEMPTION, redemption);
    db.addResult(Q_INVITER, { id: 'tutor-1', name: null, picture_url: null });
    const s = await getOnboardingState(db, { id: 'student-1' });
    expect(s.invited).toBe(true);
    expect(s.relationship_id).toBeNull();
    expect(s.decks).toEqual([]);
    expect(s.welcome_conversation_id).toBeNull();
  });
});
