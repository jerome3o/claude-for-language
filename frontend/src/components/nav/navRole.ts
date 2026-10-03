import type { MyRelationships, UserRole } from '../../types';

/**
 * What the navigation needs to know about the account. Derived, never stored:
 * relationships come from GET /api/relationships (cached for offline boots),
 * deck and due counts from IndexedDB.
 */
export interface NavRole {
  /** At least one active student → Students tab, Lesson Library, tutor landing. */
  hasStudents: boolean;
  /** At least one active tutor → Lesson Notes is worth showing. */
  hasTutor: boolean;
  /**
   * Tutor-only: has students, owns no decks and has nothing due. Such an
   * account never sees the study-side extras (Lesson Notes, Readers, Personal
   * Bio, Offline audio).
   */
  isTutorOnly: boolean;
  /** False until the relationships have been fetched (or read from the cache). */
  loaded: boolean;
  /**
   * The account's role is `tutor` (users.role, set by the admin): the
   * tutor-first app — Students · Chats · Library · More, opens on Students,
   * no study nagging. Known from the signed-in user, so it never waits for
   * relationships.
   */
  isTutorAccount: boolean;
}

export interface NavRoleInputs {
  relationships: MyRelationships | null | undefined;
  deckCount: number;
  dueCount: number;
  /** While the local counts are still loading nobody is "tutor-only" (no tab flash). */
  countsLoading?: boolean;
  /** users.role of the signed-in account. */
  accountRole?: UserRole | null;
}

export const STUDENT_ROLE: NavRole = {
  hasStudents: false,
  hasTutor: false,
  isTutorOnly: false,
  loaded: false,
  isTutorAccount: false,
};

export function deriveNavRole({ relationships, deckCount, dueCount, countsLoading, accountRole }: NavRoleInputs): NavRole {
  const isTutorAccount = accountRole === 'tutor';
  if (!relationships) return { ...STUDENT_ROLE, isTutorAccount };
  const hasStudents = relationships.students.some((r) => r.status === 'active');
  const hasTutor = relationships.tutors.some((r) => r.status === 'active');
  return {
    hasStudents,
    hasTutor,
    // A tutor account is tutor-first whatever its decks: those are homework it writes, not its own study.
    isTutorOnly: isTutorAccount || (hasStudents && !countsLoading && deckCount === 0 && dueCount === 0),
    loaded: true,
    isTutorAccount,
  };
}
