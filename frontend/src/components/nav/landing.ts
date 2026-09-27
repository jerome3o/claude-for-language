import type { LandingPage } from '../../types';

/** Where each landing choice lives. */
export const LANDING_PATHS: Record<LandingPage, string> = {
  study: '/',
  students: '/connections',
  decks: '/decks',
};

/**
 * Which tab the app opens on.
 *
 * - An explicit preference (Settings → "Start on") always wins.
 * - A tutor account (users.role = 'tutor') opens on Students.
 * - Otherwise: Students when the account has at least one active student AND
 *   nothing is due today, else Study.
 * - While the due counts are still loading we answer Study, so a student
 *   never flashes the Students view before their numbers arrive.
 */
export function resolveLanding(
  pref: LandingPage | null | undefined,
  hasStudents: boolean,
  dueCount: number,
  countsLoading: boolean,
  isTutorAccount = false,
): LandingPage {
  if (pref === 'study' || pref === 'students' || pref === 'decks') return pref;
  // A tutor account always opens on its students — never on a due-card count.
  if (isTutorAccount) return 'students';
  if (countsLoading) return 'study';
  if (hasStudents && dueCount === 0) return 'students';
  return 'study';
}
