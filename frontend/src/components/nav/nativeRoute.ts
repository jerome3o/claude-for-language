/**
 * What a route from the Android shell (the widget, a study / homework reminder notification, a
 * chat notification — MainActivity's 'native-navigate' event) does to the page on screen.
 * Same rule as the Lab app (android-lab ui/nav/NavResume.kt):
 *
 * - A "go study" route (`/study…`) never stacks a second Study: Study already open stays.
 * - It also leaves a resumable activity in progress on screen — the one-off homework pass, a
 *   reader, a picture hunt, a quest, a lesson try-out, tutor-notes practice — instead of
 *   pulling the learner away from it (Jerome: "if I click the notification but the last thing
 *   I was doing was my one-off homework, it should leave that up on the screen").
 * - Any other route is explicit (a chat notification) and opens — unless it is exactly the page
 *   already showing, which would only add a duplicate history entry.
 */
export type NativeRouteAction = 'stay' | 'navigate';

const RESUMABLE: RegExp[] = [
  /^\/homework\/[^/]+\/?$/,
  /^\/readers\/(?!generate$|new$)[^/]+\/?$/,
  /^\/picture-hunt\/[^/]+\/?$/,
  /^\/quests\/[^/]+\/?$/,
  /^\/tutor-notes\/practice\/?$/,
  /^\/(library|decks)\/[^/]+\/try\/?$/,
];

const pathnameOf = (path: string) => path.split(/[?#]/)[0] || '/';

export function isStudyPath(path: string): boolean {
  return /^\/study\/?$/.test(pathnameOf(path));
}

export function isResumablePath(path: string): boolean {
  const p = pathnameOf(path);
  return RESUMABLE.some((re) => re.test(p));
}

/** [current] = pathname + search of the page on screen; [route] = what the shell asked for. */
export function nativeRouteAction(current: string, route: string): NativeRouteAction {
  if (isStudyPath(route) && (isStudyPath(current) || isResumablePath(current))) return 'stay';
  if (current === route) return 'stay';
  return 'navigate';
}
