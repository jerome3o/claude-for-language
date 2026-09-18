import type { NavRole } from './navRole';

export type TabId = 'study' | 'decks' | 'tutor' | 'students' | 'progress' | 'more';

export interface TabSpec {
  id: TabId;
  label: string;
  to: string;
  /** Route prefixes that light this tab up (exact match for '/'). */
  match: string[];
}

const STUDY: TabSpec = { id: 'study', label: 'Study', to: '/', match: ['/', '/study'] };
const DECKS: TabSpec = { id: 'decks', label: 'Decks', to: '/decks', match: ['/decks', '/generate', '/search'] };
const TUTOR: TabSpec = { id: 'tutor', label: 'Tutor', to: '/connections', match: ['/connections'] };
const STUDENTS: TabSpec = { id: 'students', label: 'Students', to: '/connections', match: ['/connections'] };
const PROGRESS: TabSpec = { id: 'progress', label: 'Progress', to: '/progress', match: ['/progress'] };
const MORE: TabSpec = {
  id: 'more',
  label: 'More',
  to: '/more',
  match: [
    '/more', '/settings', '/coach', '/analyze', '/readers', '/lessons', '/lesson-notes',
    '/quests', '/library', '/duplicate-finder', '/admin',
  ],
};

/**
 * Student account:        Study · Decks · Tutor · Progress · More
 * Account with students:  Students · Decks · Study · More (+ Progress if they also study)
 */
export function tabsFor(role: Pick<NavRole, 'hasStudents' | 'isTutorOnly'>): TabSpec[] {
  if (!role.hasStudents) return [STUDY, DECKS, TUTOR, PROGRESS, MORE];
  return role.isTutorOnly
    ? [STUDENTS, DECKS, STUDY, MORE]
    : [STUDENTS, DECKS, STUDY, PROGRESS, MORE];
}

/** Which tab is active for a pathname (the longest matching prefix wins). */
export function activeTab(tabs: TabSpec[], pathname: string): TabId | null {
  let best: { id: TabId; len: number } | null = null;
  for (const tab of tabs) {
    for (const prefix of tab.match) {
      const hit = prefix === '/'
        ? pathname === '/'
        : pathname === prefix || pathname.startsWith(prefix + '/');
      if (hit && (!best || prefix.length > best.len)) best = { id: tab.id, len: prefix.length };
    }
  }
  return best?.id ?? null;
}

/**
 * Routes that take over the whole screen: no header, no tab bar. `/study`
 * itself is immersive (a session is running); `/study/review/:id` is a normal
 * page.
 */
const IMMERSIVE = [
  /^\/study\/?$/,
  /^\/quests\/[^/]+\/?$/,
  /^\/readers\/(?!generate$)[^/]+(\/(edit|print))?\/?$/,
  /^\/library\/[^/]+\/(edit|print)\/?$/,
  /^\/lessons\/[^/]+\/(edit|print)\/?$/,
  /^\/connections\/[^/]+\/chat\//,
  /^\/join\//,
];

export function isImmersiveRoute(pathname: string): boolean {
  return IMMERSIVE.some((re) => re.test(pathname));
}
