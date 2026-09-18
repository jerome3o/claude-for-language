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
): LandingPage {
  if (pref === 'study' || pref === 'students' || pref === 'decks') return pref;
  if (countsLoading) return 'study';
  if (hasStudents && dueCount === 0) return 'students';
  return 'study';
}
