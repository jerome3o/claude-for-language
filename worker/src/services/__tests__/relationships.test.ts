import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockD1,
  createTestUser,
  createTestRelationship,
  MockD1Database,
} from './d1-mock';

// Mock crypto.randomUUID for deterministic IDs
let idCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++idCounter}`,
});

import {
  getUserByEmail,
  createRelationship,
  getPendingInvitationById,
  cancelPendingInvitation,
  processPendingInvitations,
  getRelationshipById,
  getMyRelationships,
  acceptRelationship,
  removeRelationship,
  verifyRelationshipAccess,
  getOtherUserId,
  getMyRole,
  ensureClaudeRelationship,
} from '../relationships';

describe('relationships service', () => {
  let db: MockD1Database;

  const tutorUser = createTestUser({ id: 'tutor-1', email: 'tutor@test.com', name: 'Tutor' });
  const studentUser = createTestUser({ id: 'student-1', email: 'student@test.com', name: 'Student' });

  beforeEach(() => {
    db = createMockD1();
    idCounter = 0;
  });

  // ==================== Pure functions ====================

  describe('getOtherUserId', () => {
    it('returns recipient_id when I am the requester', () => {
      const rel = createTestRelationship({ requester_id: 'a', recipient_id: 'b' });
      expect(getOtherUserId(rel as any, 'a')).toBe('b');
    });

    it('returns requester_id when I am the recipient', () => {
      const rel = createTestRelationship({ requester_id: 'a', recipient_id: 'b' });
      expect(getOtherUserId(rel as any, 'b')).toBe('a');
    });
  });

  describe('getMyRole', () => {
    it('returns requester_role when I am the requester', () => {
      const rel = createTestRelationship({ requester_id: 'a', recipient_id: 'b', requester_role: 'tutor' });
      expect(getMyRole(rel as any, 'a')).toBe('tutor');
    });

    it('returns opposite role when I am the recipient and requester is tutor', () => {
      const rel = createTestRelationship({ requester_id: 'a', recipient_id: 'b', requester_role: 'tutor' });
      expect(getMyRole(rel as any, 'b')).toBe('student');
    });

    it('returns opposite role when I am the recipient and requester is student', () => {
      const rel = createTestRelationship({ requester_id: 'a', recipient_id: 'b', requester_role: 'student' });
      expect(getMyRole(rel as any, 'b')).toBe('tutor');
    });
  });

  // ==================== getUserByEmail ====================

  describe('getUserByEmail', () => {
    it('returns user when found', async () => {
      db.addResult('SELECT * FROM users WHERE email', tutorUser);

      const result = await getUserByEmail(db as any, 'tutor@test.com');
      expect(result).toEqual(tutorUser);
    });

    it('returns null when not found', async () => {
      const result = await getUserByEmail(db as any, 'nonexistent@test.com');
      expect(result).toBeNull();
    });
  });

  // ==================== verifyRelationshipAccess ====================

  describe('verifyRelationshipAccess', () => {
    it('returns relationship when user has access and it is active', async () => {
      const rel = createTestRelationship({ id: 'rel-1', status: 'active' });
      db.addResult('SELECT * FROM tutor_relationships', rel);

      const result = await verifyRelationshipAccess(db as any, 'rel-1', 'tutor-1');
      expect(result).toEqual(rel);
    });

    it('throws when relationship is not found', async () => {
      await expect(verifyRelationshipAccess(db as any, 'nonexistent', 'user-1'))
        .rejects.toThrow('Relationship not found or not active');
    });

    it('throws when relationship is not active', async () => {
      // The query filters by status = 'active', so pending/removed will return null
      await expect(verifyRelationshipAccess(db as any, 'rel-pending', 'user-1'))
        .rejects.toThrow('Relationship not found or not active');
    });
  });

  // ==================== createRelationship ====================

  describe('createRelationship', () => {
    it('creates a pending relationship between existing users', async () => {
      // getUserByEmail returns the recipient
      db.addResult('SELECT * FROM users WHERE email', studentUser);
      // No existing relationship
      // getRelationshipById lookups after INSERT
      const newRel = createTestRelationship({
        id: 'uuid-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
        requester_role: 'tutor',
        status: 'pending',
      });
      db.addResult('SELECT * FROM tutor_relationships WHERE id', newRel);
      // getUserSummary for requester and recipient
      db.addResult('SELECT id, email, name, picture_url FROM users', {
        id: tutorUser.id, email: tutorUser.email, name: tutorUser.name, picture_url: null,
      });
      db.addResult('SELECT id, email, name, picture_url FROM users', {
        id: studentUser.id, email: studentUser.email, name: studentUser.name, picture_url: null,
      });

      const result = await createRelationship(db as any, tutorUser.id, 'student@test.com', 'tutor');

      expect(result.type).toBe('relationship');
      expect(result.data).toBeDefined();

      // Verify INSERT was called with pending status
      const queries = db.getQueries();
      const insertQuery = queries.find(q => q.sql.includes('INSERT INTO tutor_relationships'));
      expect(insertQuery).toBeDefined();
      expect(insertQuery!.params).toContain(tutorUser.id);
      expect(insertQuery!.params).toContain(studentUser.id);
      expect(insertQuery!.params).toContain('tutor');
    });

    it('throws when trying to create relationship with yourself', async () => {
      db.addResult('SELECT * FROM users WHERE email', tutorUser);

      await expect(createRelationship(db as any, tutorUser.id, tutorUser.email!, 'tutor'))
        .rejects.toThrow('Cannot create a relationship with yourself');
    });

    it('throws when relationship already exists', async () => {
      db.addResult('SELECT * FROM users WHERE email', studentUser);
      // Existing non-removed relationship
      db.addResult('SELECT * FROM tutor_relationships', createTestRelationship());

      await expect(createRelationship(db as any, tutorUser.id, 'student@test.com', 'tutor'))
        .rejects.toThrow('A relationship already exists between these users');
    });

    it('creates a pending invitation when recipient email is not registered', async () => {
      // getUserByEmail returns null (user doesn't exist) — called twice:
      // once in createRelationship, once in createPendingInvitation
      // No existing pending invitation
      // After INSERT, SELECT returns the invitation
      const invitation = {
        id: 'uuid-1',
        inviter_id: tutorUser.id,
        recipient_email: 'new@test.com',
        inviter_role: 'tutor',
        status: 'pending',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-31T00:00:00Z',
        accepted_at: null,
      };
      db.addResult('SELECT * FROM pending_invitations WHERE id', invitation);
      // getUserSummary for inviter
      db.addResult('SELECT id, email, name, picture_url FROM users', {
        id: tutorUser.id, email: tutorUser.email, name: tutorUser.name, picture_url: null,
      });

      const result = await createRelationship(db as any, tutorUser.id, 'new@test.com', 'tutor');

      expect(result.type).toBe('invitation');
      if (result.type === 'invitation') {
        expect(result.data.recipient_email).toBe('new@test.com');
        expect(result.data.inviter.id).toBe(tutorUser.id);
      }
    });

    it('returns existing invitation idempotently', async () => {
      // getUserByEmail returns null (not registered)
      // Existing pending invitation found
      const existingInvitation = {
        id: 'inv-existing',
        inviter_id: tutorUser.id,
        recipient_email: 'new@test.com',
        inviter_role: 'tutor',
        status: 'pending',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-31T00:00:00Z',
        accepted_at: null,
      };
      db.addResult('SELECT * FROM pending_invitations', existingInvitation);
      db.addResult('SELECT id, email, name, picture_url FROM users', {
        id: tutorUser.id, email: tutorUser.email, name: tutorUser.name, picture_url: null,
      });

      const result = await createRelationship(db as any, tutorUser.id, 'new@test.com', 'tutor');

      expect(result.type).toBe('invitation');
      expect(result.data.id).toBe('inv-existing');

      // Should NOT have created a new invitation
      const queries = db.getQueries();
      const insertQueries = queries.filter(q => q.sql.includes('INSERT INTO pending_invitations'));
      expect(insertQueries).toHaveLength(0);
    });
  });

  // ==================== getPendingInvitationById ====================

  describe('getPendingInvitationById', () => {
    it('returns invitation with inviter when found', async () => {
      const invitation = {
        id: 'inv-1',
        inviter_id: tutorUser.id,
        recipient_email: 'new@test.com',
        inviter_role: 'tutor',
        status: 'pending',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-31T00:00:00Z',
        accepted_at: null,
      };
      db.addResult('SELECT * FROM pending_invitations WHERE id', invitation);
      db.addResult('SELECT id, email, name, picture_url FROM users', {
        id: tutorUser.id, email: tutorUser.email, name: tutorUser.name, picture_url: null,
      });

      const result = await getPendingInvitationById(db as any, 'inv-1');

      expect(result).toBeDefined();
      expect(result!.id).toBe('inv-1');
      expect(result!.inviter.id).toBe(tutorUser.id);
    });

    it('returns null when invitation not found', async () => {
      const result = await getPendingInvitationById(db as any, 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when inviter not found', async () => {
      const invitation = {
        id: 'inv-1',
        inviter_id: 'deleted-user',
        recipient_email: 'new@test.com',
        inviter_role: 'tutor',
        status: 'pending',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-31T00:00:00Z',
        accepted_at: null,
      };
      db.addResult('SELECT * FROM pending_invitations WHERE id', invitation);
      // No user summary result → returns null

      const result = await getPendingInvitationById(db as any, 'inv-1');
      expect(result).toBeNull();
    });
  });

  // ==================== cancelPendingInvitation ====================

  describe('cancelPendingInvitation', () => {
    it('cancels a pending invitation', async () => {
      const invitation = {
        id: 'inv-1',
        inviter_id: tutorUser.id,
        recipient_email: 'new@test.com',
        inviter_role: 'tutor',
        status: 'pending',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-31T00:00:00Z',
        accepted_at: null,
      };
      db.addResult('SELECT * FROM pending_invitations WHERE id', invitation);

      await cancelPendingInvitation(db as any, 'inv-1', tutorUser.id);

      const queries = db.getQueries();
      expect(queries.some(q =>
        q.sql.includes("UPDATE pending_invitations SET status = 'cancelled'")
      )).toBe(true);
    });

    it('throws when invitation not found', async () => {
      await expect(cancelPendingInvitation(db as any, 'nonexistent', tutorUser.id))
        .rejects.toThrow('Invitation not found');
    });

    it('throws when user is not the inviter', async () => {
      const invitation = {
        id: 'inv-1',
        inviter_id: tutorUser.id,
        recipient_email: 'new@test.com',
        inviter_role: 'tutor',
        status: 'pending',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-31T00:00:00Z',
        accepted_at: null,
      };
      db.addResult('SELECT * FROM pending_invitations WHERE id', invitation);

      await expect(cancelPendingInvitation(db as any, 'inv-1', 'other-user'))
        .rejects.toThrow('Not authorized to cancel this invitation');
    });

    it('throws when invitation is not pending', async () => {
      const invitation = {
        id: 'inv-1',
        inviter_id: tutorUser.id,
        recipient_email: 'new@test.com',
        inviter_role: 'tutor',
        status: 'accepted', // Not pending
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-31T00:00:00Z',
        accepted_at: '2026-01-02T00:00:00Z',
      };
      db.addResult('SELECT * FROM pending_invitations WHERE id', invitation);

      await expect(cancelPendingInvitation(db as any, 'inv-1', tutorUser.id))
        .rejects.toThrow('Invitation is not pending');
    });
  });

  // ==================== processPendingInvitations ====================

  describe('processPendingInvitations', () => {
    it('creates relationships from pending invitations for new user', async () => {
      const newUser = createTestUser({ id: 'new-1', email: 'new@test.com' });

      db.addAllResult('FROM pending_invitations', [
        {
          id: 'inv-1',
          inviter_id: tutorUser.id,
          recipient_email: 'new@test.com',
          inviter_role: 'tutor',
          status: 'pending',
          created_at: '2026-01-01T00:00:00Z',
          expires_at: '2026-01-31T00:00:00Z',
          accepted_at: null,
        },
      ]);

      const count = await processPendingInvitations(db as any, newUser as any);

      expect(count).toBe(1);

      const queries = db.getQueries();
      // Should have inserted into tutor_relationships with 'active' status
      const relInsert = queries.find(q =>
        q.sql.includes('INSERT INTO tutor_relationships') && q.sql.includes("'active'")
      );
      expect(relInsert).toBeDefined();
      expect(relInsert!.params).toContain(tutorUser.id);
      expect(relInsert!.params).toContain(newUser.id);

      // Should have marked invitation as accepted
      const invUpdate = queries.find(q =>
        q.sql.includes("SET status = 'accepted'")
      );
      expect(invUpdate).toBeDefined();
    });

    it('returns 0 when user has no email', async () => {
      const newUser = createTestUser({ id: 'new-1', email: undefined as any });
      const count = await processPendingInvitations(db as any, { ...newUser, email: null } as any);
      expect(count).toBe(0);
    });

    it('returns 0 when no pending invitations exist', async () => {
      const newUser = createTestUser({ id: 'new-1', email: 'nobody@test.com' });
      db.addAllResult('FROM pending_invitations', []);

      const count = await processPendingInvitations(db as any, newUser as any);
      expect(count).toBe(0);
    });

    it('processes multiple invitations', async () => {
      const newUser = createTestUser({ id: 'new-1', email: 'new@test.com' });

      db.addAllResult('FROM pending_invitations', [
        {
          id: 'inv-1',
          inviter_id: 'tutor-a',
          recipient_email: 'new@test.com',
          inviter_role: 'tutor',
          status: 'pending',
          created_at: '2026-01-01T00:00:00Z',
          expires_at: '2026-01-31T00:00:00Z',
          accepted_at: null,
        },
        {
          id: 'inv-2',
          inviter_id: 'tutor-b',
          recipient_email: 'new@test.com',
          inviter_role: 'student',
          status: 'pending',
          created_at: '2026-01-02T00:00:00Z',
          expires_at: '2026-02-01T00:00:00Z',
          accepted_at: null,
        },
      ]);

      const count = await processPendingInvitations(db as any, newUser as any);
      expect(count).toBe(2);
    });
  });

  // ==================== getRelationshipById ====================

  describe('getRelationshipById', () => {
    it('returns relationship with user details', async () => {
      const rel = createTestRelationship({
        id: 'rel-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
      });
      db.addResult('SELECT * FROM tutor_relationships WHERE id', rel);
      // Use addResultOnce so the first getUserSummary gets tutor, second gets student
      db.addResultOnce('SELECT id, email, name, picture_url FROM users', {
        id: tutorUser.id, email: tutorUser.email, name: tutorUser.name, picture_url: null,
      });
      db.addResultOnce('SELECT id, email, name, picture_url FROM users', {
        id: studentUser.id, email: studentUser.email, name: studentUser.name, picture_url: null,
      });

      const result = await getRelationshipById(db as any, 'rel-1');

      expect(result).toBeDefined();
      expect(result!.id).toBe('rel-1');
      expect(result!.requester.name).toBe('Tutor');
      expect(result!.recipient.name).toBe('Student');
    });

    it('returns null when relationship not found', async () => {
      const result = await getRelationshipById(db as any, 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when requester user not found', async () => {
      const rel = createTestRelationship({ id: 'rel-1' });
      db.addResult('SELECT * FROM tutor_relationships WHERE id', rel);
      // No user summaries → returns null

      const result = await getRelationshipById(db as any, 'rel-1');
      expect(result).toBeNull();
    });
  });

  // ==================== acceptRelationship ====================

  describe('acceptRelationship', () => {
    it('accepts a pending relationship', async () => {
      const pendingRel = createTestRelationship({
        id: 'rel-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
        status: 'pending',
        accepted_at: null,
      });
      db.addResult('SELECT * FROM tutor_relationships WHERE id', pendingRel);

      // After UPDATE, getRelationshipById is called
      // We need the tutor_relationships query to return the updated rel
      // (the mock returns same result for same pattern, but second call returns the active one)
      const activeRel = createTestRelationship({
        id: 'rel-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
        status: 'active',
        accepted_at: '2026-01-02T00:00:00Z',
      });
      // The second SELECT * FROM tutor_relationships will also match this pattern
      // Since we already added one, we need a separate mechanism.
      // Actually, the mock returns the first match each time, so let's rely on that.
      // getRelationshipById calls same query and gets the (still configured) result.

      db.addResult('SELECT id, email, name, picture_url FROM users', {
        id: tutorUser.id, email: tutorUser.email, name: tutorUser.name, picture_url: null,
      });
      db.addResult('SELECT id, email, name, picture_url FROM users', {
        id: studentUser.id, email: studentUser.email, name: studentUser.name, picture_url: null,
      });

      const result = await acceptRelationship(db as any, 'rel-1', studentUser.id);

      expect(result).toBeDefined();

      const queries = db.getQueries();
      expect(queries.some(q =>
        q.sql.includes("SET status = 'active'")
      )).toBe(true);
    });

    it('throws when relationship not found', async () => {
      await expect(acceptRelationship(db as any, 'nonexistent', studentUser.id))
        .rejects.toThrow('Relationship not found');
    });

    it('throws when user is not the recipient', async () => {
      const rel = createTestRelationship({
        id: 'rel-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
        status: 'pending',
      });
      db.addResult('SELECT * FROM tutor_relationships WHERE id', rel);

      await expect(acceptRelationship(db as any, 'rel-1', tutorUser.id))
        .rejects.toThrow('Only the recipient can accept this request');
    });

    it('throws when relationship is already processed', async () => {
      const rel = createTestRelationship({
        id: 'rel-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
        status: 'active',
      });
      db.addResult('SELECT * FROM tutor_relationships WHERE id', rel);

      await expect(acceptRelationship(db as any, 'rel-1', studentUser.id))
        .rejects.toThrow('This request has already been processed');
    });
  });

  // ==================== removeRelationship ====================

  describe('removeRelationship', () => {
    it('removes a relationship by the requester', async () => {
      const rel = createTestRelationship({
        id: 'rel-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
      });
      db.addResult('SELECT * FROM tutor_relationships WHERE id', rel);

      await removeRelationship(db as any, 'rel-1', tutorUser.id);

      const queries = db.getQueries();
      expect(queries.some(q =>
        q.sql.includes("SET status = 'removed'")
      )).toBe(true);
    });

    it('removes a relationship by the recipient', async () => {
      const rel = createTestRelationship({
        id: 'rel-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
      });
      db.addResult('SELECT * FROM tutor_relationships WHERE id', rel);

      await removeRelationship(db as any, 'rel-1', studentUser.id);

      const queries = db.getQueries();
      expect(queries.some(q =>
        q.sql.includes("SET status = 'removed'")
      )).toBe(true);
    });

    it('throws when relationship not found', async () => {
      await expect(removeRelationship(db as any, 'nonexistent', tutorUser.id))
        .rejects.toThrow('Relationship not found');
    });

    it('throws when user is not part of the relationship', async () => {
      const rel = createTestRelationship({
        id: 'rel-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
      });
      db.addResult('SELECT * FROM tutor_relationships WHERE id', rel);

      await expect(removeRelationship(db as any, 'rel-1', 'stranger'))
        .rejects.toThrow('Not authorized to remove this relationship');
    });
  });

  // ==================== getMyRelationships ====================

  describe('getMyRelationships', () => {
    it('categorizes relationships correctly', async () => {
      const activeAsTutor = createTestRelationship({
        id: 'rel-1',
        requester_id: tutorUser.id,
        recipient_id: studentUser.id,
        requester_role: 'tutor',
        status: 'active',
      });
      const activeAsStudent = createTestRelationship({
        id: 'rel-2',
        requester_id: 'other-tutor',
        recipient_id: tutorUser.id,
        requester_role: 'tutor',
        status: 'active',
      });
      const pendingOutgoing = createTestRelationship({
        id: 'rel-3',
        requester_id: tutorUser.id,
        recipient_id: 'someone',
        requester_role: 'tutor',
        status: 'pending',
      });
      const pendingIncoming = createTestRelationship({
        id: 'rel-4',
        requester_id: 'another-person',
        recipient_id: tutorUser.id,
        requester_role: 'student',
        status: 'pending',
      });

      db.addAllResult('FROM tutor_relationships', [
        activeAsTutor,
        activeAsStudent,
        pendingOutgoing,
        pendingIncoming,
      ]);

      // getUserSummary for each unique user
      const users: Record<string, any> = {
        [tutorUser.id]: { id: tutorUser.id, email: tutorUser.email, name: tutorUser.name, picture_url: null },
        [studentUser.id]: { id: studentUser.id, email: studentUser.email, name: studentUser.name, picture_url: null },
        'other-tutor': { id: 'other-tutor', email: 'ot@test.com', name: 'Other Tutor', picture_url: null },
        'someone': { id: 'someone', email: 's@test.com', name: 'Someone', picture_url: null },
        'another-person': { id: 'another-person', email: 'ap@test.com', name: 'Another', picture_url: null },
      };

      // getUserSummary is called for each unique user ID
      // The mock matches on pattern, so all "SELECT id, email, name, picture_url FROM users WHERE id" will match
      // We need to configure them in order they'll be requested
      // User IDs collected: tutor-1, student-1, other-tutor, someone, another-person
      // Then tutor-1 again for inviter
      for (const uid of [tutorUser.id, studentUser.id, 'other-tutor', 'someone', 'another-person', tutorUser.id]) {
        db.addResult('SELECT id, email, name, picture_url FROM users WHERE id', users[uid]);
      }

      // Pending invitations
      db.addAllResult('FROM pending_invitations', []);

      const result = await getMyRelationships(db as any, tutorUser.id);

      // rel-1: tutor is requester with role 'tutor', status active → goes to students list
      expect(result.students).toHaveLength(1);
      expect(result.students[0].id).toBe('rel-1');

      // rel-2: other-tutor is requester with role 'tutor', tutor-1 is recipient → myRole = 'student' → goes to tutors list
      expect(result.tutors).toHaveLength(1);
      expect(result.tutors[0].id).toBe('rel-2');

      // rel-3: tutor-1 is requester, status pending → outgoing
      expect(result.pending_outgoing).toHaveLength(1);
      expect(result.pending_outgoing[0].id).toBe('rel-3');

      // rel-4: another-person is requester, tutor-1 is recipient, status pending → incoming
      expect(result.pending_incoming).toHaveLength(1);
      expect(result.pending_incoming[0].id).toBe('rel-4');

      expect(result.pending_invitations).toHaveLength(0);
    });

    it('returns empty categories when no relationships exist', async () => {
      db.addAllResult('FROM tutor_relationships', []);
      db.addAllResult('FROM pending_invitations', []);
      // getUserSummary for the inviter (self)
      db.addResult('SELECT id, email, name, picture_url FROM users WHERE id', {
        id: tutorUser.id, email: tutorUser.email, name: tutorUser.name, picture_url: null,
      });

      const result = await getMyRelationships(db as any, tutorUser.id);

      expect(result.tutors).toEqual([]);
      expect(result.students).toEqual([]);
      expect(result.pending_incoming).toEqual([]);
      expect(result.pending_outgoing).toEqual([]);
      expect(result.pending_invitations).toEqual([]);
    });

    it('includes pending invitations for non-users', async () => {
      db.addAllResult('FROM tutor_relationships', []);
      db.addAllResult('FROM pending_invitations', [{
        id: 'inv-1',
        inviter_id: tutorUser.id,
        recipient_email: 'notyet@test.com',
        inviter_role: 'tutor',
        status: 'pending',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-31T00:00:00Z',
        accepted_at: null,
      }]);
      db.addResult('SELECT id, email, name, picture_url FROM users WHERE id', {
        id: tutorUser.id, email: tutorUser.email, name: tutorUser.name, picture_url: null,
      });

      const result = await getMyRelationships(db as any, tutorUser.id);

      expect(result.pending_invitations).toHaveLength(1);
      expect(result.pending_invitations[0].recipient_email).toBe('notyet@test.com');
      expect(result.pending_invitations[0].inviter.id).toBe(tutorUser.id);
    });
  });

  // ==================== ensureClaudeRelationship ====================

  describe('ensureClaudeRelationship', () => {
    it('returns existing relationship ID when one exists', async () => {
      db.addResult('SELECT id FROM tutor_relationships', { id: 'rel-claude' });

      const result = await ensureClaudeRelationship(db as any, 'user-1');

      expect(result).toBe('rel-claude');

      // Should NOT have inserted a new relationship
      const queries = db.getQueries();
      expect(queries.filter(q => q.sql.includes('INSERT')).length).toBe(0);
    });

    it('creates a new Claude relationship when none exists', async () => {
      // No existing relationship → SELECT returns null (default)

      const result = await ensureClaudeRelationship(db as any, 'user-1');

      expect(result).toBe('uuid-1');

      const queries = db.getQueries();
      const insertQuery = queries.find(q => q.sql.includes('INSERT INTO tutor_relationships'));
      expect(insertQuery).toBeDefined();
      // The user is the student, Claude is the tutor
      expect(insertQuery!.params).toContain('user-1');
      expect(insertQuery!.params).toContain('claude-ai');
      expect(insertQuery!.sql).toContain("'student'");
      expect(insertQuery!.sql).toContain("'active'");
    });

    it('throws when called for Claude itself', async () => {
      await expect(ensureClaudeRelationship(db as any, 'claude-ai'))
        .rejects.toThrow('Cannot create Claude relationship for Claude');
    });
  });
});
