import type { NavRole } from './navRole';

export type TabId = 'study' | 'chats' | 'claude' | 'decks' | 'students' | 'library' | 'progress' | 'more';

export interface TabSpec {
  id: TabId;
  label: string;
  to: string;
  /** Route prefixes that light this tab up (exact match for '/'). */
  match: string[];
}

const STUDY: TabSpec = { id: 'study', label: 'Study', to: '/', match: ['/', '/study'] };
const CHATS: TabSpec = { id: 'chats', label: 'Chats', to: '/chats', match: ['/chats'] };
/** Tutor accounts only (Minghui asked for Decks one tap away); everyone else finds Decks first in More. */
const DECKS: TabSpec = { id: 'decks', label: 'Decks', to: '/decks', match: ['/decks', '/generate', '/search'] };
const STUDENTS: TabSpec = { id: 'students', label: 'Students', to: '/connections', match: ['/connections', '/homework-library'] };
const LIBRARY: TabSpec = { id: 'library', label: 'Library', to: '/library', match: ['/library'] };
const PROGRESS: TabSpec = { id: 'progress', label: 'Progress', to: '/progress', match: ['/progress'] };
/**
 * A learner's ✦ Claude tab (Jerome, Nov 2026: "it's not obvious enough that you can just ask any
 * question"): a new chat with Claude, 🎤 listening at once (pages/ClaudeTabPage.tsx). The thread it
 * starts is a normal Claude thread, listed in Chats.
 */
export const CLAUDE_TAB_PATH = '/claude';
const CLAUDE: TabSpec = { id: 'claude', label: 'Claude', to: CLAUDE_TAB_PATH, match: [CLAUDE_TAB_PATH] };
const MORE: TabSpec = {
  id: 'more',
  label: 'More',
  to: '/more',
  match: [
    // Decks moved from the tab bar into More (its first row), so a deck page lights More up —
    // except for a tutor account, whose Decks tab comes first in tabsFor and wins the tie.
    // The learner's Tutor tab is gone (Nov 2026): their tutor page is reached from the chat, and
    // connections from More → "Tutors & connections", so /connections lights More — except where
    // a Students tab comes first in tabsFor and wins the tie.
    '/more', '/connections', '/decks', '/up-next', '/cards/held', '/generate', '/search', '/settings', '/profile', '/coach', '/analyze', '/readers', '/lessons', '/lesson-notes',
    '/quests', '/picture-hunt', '/idioms', '/meme-review', '/clips', '/audio-lessons', '/library', '/duplicate-finder', '/admin',
  ],
};

/**
 * A learner's tabs. The Tutor tab went (Jerome, Nov 2026: "it seems like a dud page" — the tutor
 * page is the chat header's name, connections are More → "Tutors & connections"); its slot is now
 * ✦ Claude — ask anything, by voice, one tap away.
 */
export const LEARNER_TABS: readonly TabSpec[] = [STUDY, CHATS, CLAUDE, PROGRESS, MORE];

/**
 * Tutor account (role):   Students · Chats · Decks · Library · More — no Study tab, whatever its decks
 * Student account:        Study · Chats · ✦ Claude · Progress · More (LEARNER_TABS)
 * Account with students:  Students · Chats · Study · More (+ Progress if they also study)
 * Decks are also the first row of More (and Home's "See all").
 */
export function tabsFor(role: Pick<NavRole, 'hasStudents' | 'isTutorOnly'> & { isTutorAccount?: boolean }): TabSpec[] {
  if (role.isTutorAccount) return [STUDENTS, CHATS, DECKS, LIBRARY, MORE];
  if (!role.hasStudents) return [...LEARNER_TABS];
  return role.isTutorOnly
    ? [STUDENTS, CHATS, STUDY, MORE]
    : [STUDENTS, CHATS, STUDY, PROGRESS, MORE];
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
  /^\/picture-hunt\/[^/]+\/?$/,
  /^\/audio-lessons\/[^/]+\/?$/,
  /^\/readers\/(?!generate$)[^/]+(\/(edit|print|recap))?\/?$/,
  /^\/library\/[^/]+\/(edit|print|try)\/?$/,
  /^\/library\/catalogue\/[^/]+\/?$/,
  /^\/decks\/[^/]+\/try\/?$/,
  /^\/lessons\/[^/]+\/(edit|print|play)\/?$/,
  /^\/coach\/[^/]+\/lesson\/[^/]+\/?$/,
  /^\/connections\/[^/]+\/chat(\/|$)/,
  /^\/connections\/[^/]+\/claude\/[^/]+\/?$/,
  /^\/join\//,
  /^\/calls\/[^/]+\/?$/,
  /^\/group-class\/[^/]+\/?$/,
  /^\/homework\/[^/]+\/?$/,
  /^\/tutor-notes\/practice\/?$/,
  /^\/clips(\/[^/]+)?\/?$/,
  /^\/vr\/?$/,
  /^\/phone\/[^/]+\/?$/,
  /^\/coach\/chat\/[^/]+(\/recap)?\/?$/,
  /^\/chats\/claude\/[^/]+(\/recap)?\/?$/,
];

export function isImmersiveRoute(pathname: string): boolean {
  return IMMERSIVE.some((re) => re.test(pathname));
}
