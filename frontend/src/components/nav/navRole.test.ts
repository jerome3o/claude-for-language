import { describe, it, expect } from 'vitest';
import { deriveNavRole, STUDENT_ROLE } from './navRole';
import { tabsFor, activeTab, isImmersiveRoute } from './tabs';
import type { MyRelationships, TutorRelationshipWithUsers, RelationshipStatus } from '../../types';

function rel(status: RelationshipStatus): TutorRelationshipWithUsers {
  const user = { id: 'u', email: 'u@example.com', name: 'U', picture_url: null };
  return {
    id: `rel-${Math.random()}`,
    requester_id: 'a',
    recipient_id: 'b',
    requester_role: 'tutor',
    status,
    created_at: '',
    accepted_at: null,
    requester: user,
    recipient: user,
  };
}

function relationships(over: Partial<MyRelationships> = {}): MyRelationships {
  return {
    tutors: [],
    students: [],
    pending_incoming: [],
    pending_outgoing: [],
    pending_invitations: [],
    ...over,
  };
}

describe('deriveNavRole', () => {
  it('is the plain student role until relationships load', () => {
    expect(deriveNavRole({ relationships: undefined, deckCount: 3, dueCount: 5 })).toEqual(STUDENT_ROLE);
    expect(deriveNavRole({ relationships: null, deckCount: 0, dueCount: 0 }).loaded).toBe(false);
  });

  it('a student with a tutor: hasTutor, no students', () => {
    const role = deriveNavRole({ relationships: relationships({ tutors: [rel('active')] }), deckCount: 2, dueCount: 9 });
    expect(role).toEqual({ hasStudents: false, hasTutor: true, isTutorOnly: false, loaded: true });
  });

  it('only active relationships count', () => {
    const role = deriveNavRole({
      relationships: relationships({ students: [rel('pending'), rel('removed')], tutors: [rel('pending')] }),
      deckCount: 0,
      dueCount: 0,
    });
    expect(role.hasStudents).toBe(false);
    expect(role.hasTutor).toBe(false);
    expect(role.isTutorOnly).toBe(false);
  });

  it('tutor-only = students, no decks, nothing due', () => {
    const base = relationships({ students: [rel('active')] });
    expect(deriveNavRole({ relationships: base, deckCount: 0, dueCount: 0 }).isTutorOnly).toBe(true);
    expect(deriveNavRole({ relationships: base, deckCount: 1, dueCount: 0 }).isTutorOnly).toBe(false);
    expect(deriveNavRole({ relationships: base, deckCount: 0, dueCount: 4 }).isTutorOnly).toBe(false);
    // not while the counts are still loading — the tab set must not flash
    expect(deriveNavRole({ relationships: base, deckCount: 0, dueCount: 0, countsLoading: true }).isTutorOnly).toBe(false);
  });

  it('a tutor who also studies has both flags', () => {
    const role = deriveNavRole({
      relationships: relationships({ students: [rel('active')], tutors: [rel('active')] }),
      deckCount: 4,
      dueCount: 12,
    });
    expect(role.hasStudents).toBe(true);
    expect(role.hasTutor).toBe(true);
    expect(role.isTutorOnly).toBe(false);
  });
});

describe('tabsFor', () => {
  it('student: Study · Decks · Tutor · Progress · More', () => {
    expect(tabsFor({ hasStudents: false, isTutorOnly: false }).map((t) => t.label))
      .toEqual(['Study', 'Decks', 'Tutor', 'Progress', 'More']);
  });

  it('tutor-only: Students · Decks · Study · More', () => {
    expect(tabsFor({ hasStudents: true, isTutorOnly: true }).map((t) => t.label))
      .toEqual(['Students', 'Decks', 'Study', 'More']);
  });

  it('tutor who also studies gets Progress back', () => {
    expect(tabsFor({ hasStudents: true, isTutorOnly: false }).map((t) => t.label))
      .toEqual(['Students', 'Decks', 'Study', 'Progress', 'More']);
  });
});

describe('activeTab', () => {
  const tabs = tabsFor({ hasStudents: false, isTutorOnly: false });
  it.each([
    ['/', 'study'],
    ['/study/review/abc', 'study'],
    ['/decks', 'decks'],
    ['/decks/123', 'decks'],
    ['/generate', 'decks'],
    ['/connections/1/insights', 'tutor'],
    ['/progress/day/2026-01-01', 'progress'],
    ['/more', 'more'],
    ['/settings/sentences', 'more'],
    ['/coach', 'more'],
    ['/lesson-notes', 'more'],
  ])('%s → %s', (path, id) => {
    expect(activeTab(tabs, path)).toBe(id);
  });

  it('does not light Study up on unrelated routes', () => {
    expect(activeTab(tabs, '/join/xyz')).toBeNull();
  });
});

describe('isImmersiveRoute', () => {
  it.each(['/study', '/study/', '/quests/abc', '/readers/r1', '/readers/r1/edit', '/readers/r1/print',
    '/library/l1/edit', '/lessons/l1/print', '/connections/1/chat/2', '/join/token'])(
    '%s hides the bar', (p) => expect(isImmersiveRoute(p)).toBe(true),
  );
  it.each(['/', '/study/review/abc', '/quests', '/readers', '/readers/generate', '/library', '/library/l1',
    '/lessons', '/connections/1', '/decks', '/more', '/settings'])(
    '%s keeps the bar', (p) => expect(isImmersiveRoute(p)).toBe(false),
  );
});
