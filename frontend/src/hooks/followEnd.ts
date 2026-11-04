/**
 * "Follow the end" for a chat thread (the Claude thread view; the Lab app's ui/claude
 * FollowThreadEnd): new text keeps the end on screen only while the reader is there; once they
 * scroll up themselves the view stays put; my own new message brings it back to the end.
 * Pure, so the rule is unit-tested without a browser layout.
 */
export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** How close to the very end still counts as "at the end" (a last line half off screen, rounding). */
export const FOLLOW_SLACK_PX = 80;

export function isNearEnd(m: ScrollMetrics, slack = FOLLOW_SLACK_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= slack;
}

/**
 * After a scroll event: back near the end → follow again; moved UP → the reader took over, stop
 * following; moving down (our own smooth scroll on its way, or the reader) → unchanged.
 */
export function nextFollow(follow: boolean, prevTop: number, m: ScrollMetrics): boolean {
  if (isNearEnd(m)) return true;
  if (m.scrollTop < prevTop - 1) return false;
  return follow;
}
