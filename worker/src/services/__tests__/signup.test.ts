import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, createTestUser, MockD1Database } from './d1-mock';

vi.stubGlobal('crypto', {
  randomUUID: () => 'uuid-1',
  getRandomValues: (arr: Uint8Array) => { for (let i = 0; i < arr.length; i++) arr[i] = i; return arr; },
});

const shareDeckMock = vi.fn();
vi.mock('../conversations', () => ({
  shareDeck: (...args: unknown[]) => shareDeckMock(...args),
}));

import { resolveSignup, redeemInvite } from '../signup';
import {
  Invite,
  inviteStatus,
  isInviteValid,
  generateInviteToken,
  isPlausibleInviteToken,
  parseShareDeckIds,
  userMayInvite,
} from '../../db/invite-queries';

const TOKEN = 'a'.repeat(43);
const NOW = new Date('2026-09-18T12:00:00Z');

function makeInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: TOKEN,
    created_by: 'tutor-1',
    email: null,
    inviter_role: 'tutor',
    share_deck_ids: null,
    max_uses: 1,
    use_count: 0,
    expires_at: null,
    revoked_at: null,
    created_at: '2026-09-01T00:00:00Z',
    note: null,
    ...overrides,
  };
}

// Query patterns (substring-matched by the mock, whitespace-normalised)
const Q_INVITE_BY_ID = 'SELECT * FROM invites WHERE id = ?';
const Q_INVITE_BY_EMAIL = 'WHERE email = ? AND revoked_at IS NULL';
const Q_PENDING = 'FROM pending_invitations pi';
const Q_REDEMPTION = 'FROM invite_redemptions WHERE invite_id = ? AND user_id = ?';
const Q_REL = 'SELECT id, status FROM tutor_relationships';
const Q_SHARED = 'FROM shared_decks WHERE relationship_id = ? AND source_deck_id = ?';

describe('invite validity', () => {
  it('is active when unused, unexpired and not revoked', () => {
    expect(inviteStatus(makeInvite(), NOW)).toBe('active');
    expect(isInviteValid(makeInvite(), NOW)).toBe(true);
  });

  it('is expired once expires_at has passed (and not before)', () => {
    expect(inviteStatus(makeInvite({ expires_at: '2026-09-18T11:59:59Z' }), NOW)).toBe('expired');
    expect(inviteStatus(makeInvite({ expires_at: '2026-09-18T12:00:01Z' }), NOW)).toBe('active');
  });

  it('is revoked when revoked_at is set, even if otherwise fine', () => {
    expect(inviteStatus(makeInvite({ revoked_at: '2026-09-10T00:00:00Z' }), NOW)).toBe('revoked');
  });

  it('is used up when use_count reaches max_uses', () => {
    expect(inviteStatus(makeInvite({ max_uses: 1, use_count: 1 }), NOW)).toBe('used');
    expect(inviteStatus(makeInvite({ max_uses: 5, use_count: 4 }), NOW)).toBe('active');
    expect(inviteStatus(makeInvite({ max_uses: 5, use_count: 5 }), NOW)).toBe('used');
  });

  it('revoked wins over expired wins over used', () => {
    const inv = makeInvite({ revoked_at: 'x', expires_at: '2000-01-01', use_count: 9 });
    expect(inviteStatus(inv, NOW)).toBe('revoked');
    expect(inviteStatus(makeInvite({ expires_at: '2000-01-01', use_count: 9 }), NOW)).toBe('expired');
  });

  it('null/undefined is never valid', () => {
    expect(isInviteValid(null, NOW)).toBe(false);
    expect(isInviteValid(undefined, NOW)).toBe(false);
  });

  it('generates long base64url tokens and recognises their shape', () => {
    const t = generateInviteToken();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(isPlausibleInviteToken(t)).toBe(true);
    expect(isPlausibleInviteToken('short')).toBe(false);
    expect(isPlausibleInviteToken('a'.repeat(40) + '/')).toBe(false);
    expect(isPlausibleInviteToken(null)).toBe(false);
  });

  it('parses share_deck_ids defensively', () => {
    expect(parseShareDeckIds({ share_deck_ids: null })).toEqual([]);
    expect(parseShareDeckIds({ share_deck_ids: '["d1","d2"]' })).toEqual(['d1', 'd2']);
    expect(parseShareDeckIds({ share_deck_ids: 'not json' })).toEqual([]);
    expect(parseShareDeckIds({ share_deck_ids: '{"a":1}' })).toEqual([]);
  });

  it('userMayInvite: admins always, others only with can_invite', () => {
    expect(userMayInvite({ is_admin: 1, can_invite: 0 })).toBe(true);
    expect(userMayInvite({ is_admin: 0, can_invite: 1 })).toBe(true);
    expect(userMayInvite({ is_admin: 0, can_invite: 0 })).toBe(false);
    expect(userMayInvite(null)).toBe(false);
  });
});

describe('resolveSignup', () => {
  let db: MockD1Database;
  const google = { email: 'New.Student@Example.com' };

  beforeEach(() => {
    db = createMockD1();
    shareDeckMock.mockReset();
  });

  it('denies with invite_only when there is no invite of any kind', async () => {
    const r = await resolveSignup(db, google, { adminEmail: 'admin@example.com', now: NOW });
    expect(r).toEqual({ kind: 'denied', reason: 'invite_only' });
  });

  it('always admits ADMIN_EMAIL (case-insensitively) when nothing else matches', async () => {
    const r = await resolveSignup(db, { email: 'Admin@Example.com' }, { adminEmail: 'admin@example.com', now: NOW });
    expect(r).toEqual({ kind: 'admin' });
  });

  it('1. uses the token from the OAuth state first', async () => {
    db.addResult(Q_INVITE_BY_ID, makeInvite());
    db.addAllResult(Q_INVITE_BY_EMAIL, [makeInvite({ id: 'b'.repeat(43), email: 'new.student@example.com' })]);
    const r = await resolveSignup(db, google, { inviteToken: TOKEN, now: NOW });
    expect(r.kind).toBe('invite');
    if (r.kind === 'invite') {
      expect(r.source).toBe('token');
      expect(r.invite.id).toBe(TOKEN);
    }
  });

  it('accepts a token invite bound to the same email in different case', async () => {
    db.addResult(Q_INVITE_BY_ID, makeInvite({ email: 'new.student@example.com' }));
    const r = await resolveSignup(db, google, { inviteToken: TOKEN, now: NOW });
    expect(r.kind).toBe('invite');
  });

  it('denies with email_mismatch when the token is bound to another email — even if an email invite exists', async () => {
    db.addResult(Q_INVITE_BY_ID, makeInvite({ email: 'someone.else@example.com' }));
    db.addAllResult(Q_INVITE_BY_EMAIL, [makeInvite({ id: 'b'.repeat(43), email: 'new.student@example.com' })]);
    const r = await resolveSignup(db, google, { inviteToken: TOKEN, now: NOW });
    expect(r.kind).toBe('denied');
    if (r.kind === 'denied') {
      expect(r.reason).toBe('email_mismatch');
      if (r.reason === 'email_mismatch') expect(r.invite.created_by).toBe('tutor-1');
    }
  });

  it('a mismatched token never locks the admin out', async () => {
    db.addResult(Q_INVITE_BY_ID, makeInvite({ email: 'someone.else@example.com' }));
    const r = await resolveSignup(db, { email: 'admin@example.com' }, { inviteToken: TOKEN, adminEmail: 'admin@example.com', now: NOW });
    expect(r).toEqual({ kind: 'admin' });
  });

  it('ignores an expired / revoked / used-up token and falls through', async () => {
    for (const bad of [
      makeInvite({ expires_at: '2020-01-01T00:00:00Z' }),
      makeInvite({ revoked_at: '2026-09-02T00:00:00Z' }),
      makeInvite({ max_uses: 1, use_count: 1 }),
    ]) {
      db.reset();
      db.addResult(Q_INVITE_BY_ID, bad);
      const r = await resolveSignup(db, google, { inviteToken: TOKEN, now: NOW });
      expect(r).toEqual({ kind: 'denied', reason: 'invite_only' });
    }
  });

  it('ignores a token of the wrong shape without querying for it', async () => {
    db.addResult(Q_INVITE_BY_ID, makeInvite());
    const r = await resolveSignup(db, google, { inviteToken: 'nope', now: NOW });
    expect(r).toEqual({ kind: 'denied', reason: 'invite_only' });
    expect(db.getQueries().some(q => q.sql.includes('FROM invites WHERE id'))).toBe(false);
  });

  it('2. falls back to an email-bound invite, skipping invalid ones', async () => {
    db.addAllResult(Q_INVITE_BY_EMAIL, [
      makeInvite({ id: 'c'.repeat(43), email: 'new.student@example.com', use_count: 1 }),
      makeInvite({ id: 'd'.repeat(43), email: 'new.student@example.com' }),
    ]);
    const r = await resolveSignup(db, google, { now: NOW });
    expect(r.kind).toBe('invite');
    if (r.kind === 'invite') {
      expect(r.source).toBe('email');
      expect(r.invite.id).toBe('d'.repeat(43));
    }
    // looked up by the normalised email
    const q = db.getQueries().find(q => q.sql.includes('revoked_at IS NULL'));
    expect(q?.params[0]).toBe('new.student@example.com');
  });

  it('3. falls back to a pending email invitation from a permitted inviter', async () => {
    db.addResult(Q_PENDING, { id: 'pi-1', inviter_id: 'tutor-1', inviter_role: 'tutor' });
    const r = await resolveSignup(db, google, { now: NOW });
    expect(r).toEqual({ kind: 'pending_invitation', invitationId: 'pi-1', inviterId: 'tutor-1' });
  });

  it('token beats email invite beats pending invitation', async () => {
    db.addResult(Q_INVITE_BY_ID, makeInvite());
    db.addAllResult(Q_INVITE_BY_EMAIL, [makeInvite({ id: 'e'.repeat(43), email: 'new.student@example.com' })]);
    db.addResult(Q_PENDING, { id: 'pi-1', inviter_id: 'tutor-1', inviter_role: 'tutor' });

    const withToken = await resolveSignup(db, google, { inviteToken: TOKEN, now: NOW });
    expect(withToken.kind === 'invite' && withToken.source).toBe('token');

    const withoutToken = await resolveSignup(db, google, { now: NOW });
    expect(withoutToken.kind === 'invite' && withoutToken.source).toBe('email');
  });
});

describe('redeemInvite', () => {
  let db: MockD1Database;
  const student = createTestUser({ id: 'student-1', email: 'new.student@example.com', name: 'Student' });

  beforeEach(() => {
    db = createMockD1();
    shareDeckMock.mockReset();
    shareDeckMock.mockResolvedValue({});
  });

  it('records the redemption, creates an active relationship and shares the decks', async () => {
    const r = await redeemInvite(db, student as any, makeInvite({ share_deck_ids: '["deck-a","deck-b"]' }));
    expect(r.redeemed).toBe(true);
    expect(r.relationshipId).toBe('uuid-1');
    expect(r.sharedDeckIds).toEqual(['deck-a', 'deck-b']);

    const sqls = db.getQueries().map(q => q.sql.replace(/\s+/g, ' '));
    expect(sqls.some(s => s.includes('INSERT OR IGNORE INTO invite_redemptions'))).toBe(true);
    expect(sqls.some(s => s.includes('UPDATE invites SET use_count = use_count + 1'))).toBe(true);
    const rel = db.getQueries().find(q => q.sql.includes('INSERT INTO tutor_relationships'));
    expect(rel?.params).toEqual(['uuid-1', 'tutor-1', 'student-1', 'tutor']);
    expect(rel?.sql).toContain("'active'");
    expect(shareDeckMock).toHaveBeenCalledTimes(2);
    expect(shareDeckMock).toHaveBeenCalledWith(db, 'uuid-1', 'tutor-1', 'deck-a');
  });

  it('is idempotent: a second run does nothing new', async () => {
    db.addResult(Q_REDEMPTION, { invite_id: TOKEN });
    db.addResult(Q_REL, { id: 'rel-1', status: 'active' });
    db.addResult(Q_SHARED, { id: 'share-1' });
    const r = await redeemInvite(db, student as any, makeInvite({ share_deck_ids: '["deck-a"]' }));
    expect(r.redeemed).toBe(false);
    expect(r.relationshipId).toBe('rel-1');
    expect(r.sharedDeckIds).toEqual([]);
    expect(shareDeckMock).not.toHaveBeenCalled();
    expect(db.getQueries().some(q => q.sql.includes('INSERT INTO tutor_relationships'))).toBe(false);
    expect(db.getQueries().some(q => q.sql.includes('use_count + 1'))).toBe(false);
  });

  it('activates a relationship that was still pending', async () => {
    db.addResult(Q_REL, { id: 'rel-1', status: 'pending' });
    await redeemInvite(db, student as any, makeInvite());
    expect(db.getQueries().some(q => q.sql.includes("SET status = 'active'"))).toBe(true);
  });

  it('creates no relationship when the invite has no role', async () => {
    const r = await redeemInvite(db, student as any, makeInvite({ inviter_role: null }));
    expect(r.redeemed).toBe(true);
    expect(r.relationshipId).toBeNull();
    expect(db.getQueries().some(q => q.sql.includes('tutor_relationships'))).toBe(false);
  });

  it('does not copy decks when the inviter is the student', async () => {
    const r = await redeemInvite(db, student as any, makeInvite({ inviter_role: 'student', share_deck_ids: '["deck-a"]' }));
    expect(r.relationshipId).toBe('uuid-1');
    expect(shareDeckMock).not.toHaveBeenCalled();
  });

  it('a deck that fails to share does not break the rest', async () => {
    shareDeckMock.mockRejectedValueOnce(new Error('Deck not found')).mockResolvedValueOnce({});
    const r = await redeemInvite(db, student as any, makeInvite({ share_deck_ids: '["gone","deck-b"]' }));
    expect(r.sharedDeckIds).toEqual(['deck-b']);
  });

  it('ignores the inviter opening their own link', async () => {
    const tutor = createTestUser({ id: 'tutor-1', email: 'tutor@example.com' });
    const r = await redeemInvite(db, tutor as any, makeInvite());
    expect(r.redeemed).toBe(false);
    expect(db.getQueries()).toHaveLength(0);
  });
});
