/**
 * How often the Coach looks again while a reply is being written in the background (docs/CHAT.md
 * "Chat ↔ Coach"): every second at first — most replies land within a few seconds — then every
 * 2.5 s once the reply has been pending for 15 s (a mini lesson, a slow model). `pendingForMs` =
 * how long THIS screen has seen a reply pending (the device's clock, never the server's).
 * Lab port: core CoachActions.replyPollMs (parity-tested by parity/fixtures/coach.ts).
 */
export const COACH_POLL_FAST_MS = 1000;
export const COACH_POLL_SLOW_MS = 2500;
/** After this long pending, polling slows down. */
export const COACH_POLL_FAST_FOR_MS = 15_000;

export function coachReplyPollMs(pendingForMs: number): number {
  return Number.isFinite(pendingForMs) && pendingForMs < COACH_POLL_FAST_FOR_MS ? COACH_POLL_FAST_MS : COACH_POLL_SLOW_MS;
}
