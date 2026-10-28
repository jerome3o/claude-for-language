/**
 * Signed-out state + account switching golden vectors (shared/auth/session.ts, CLAUDE.md
 * "Sign-in & sessions"): where a 401 came from, which requests count, the unsynced summaries and
 * warnings, the account-switch decision and the copy. Writes session.json; core SessionParityTest
 * asserts auth/SessionRules.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  accountSwitchFor,
  countsForSignedOut,
  provesSignedIn,
  signedOutBanner,
  signedOutWhere,
  signOutWarning,
  switchAccountWarning,
  unsyncedSummary,
  SIGNED_OUT_TRANSCRIPTION,
  SIGNED_OUT_TRANSCRIPTION_NOTE,
  type UnsyncedCounts,
} from '../../../shared/auth/session';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: session <out-dir>');
mkdirSync(OUT, { recursive: true });

const paths = [
  '/api/sync/changes?since=1', '/api/reviews', '/api/reviews?since=x&limit=5', '/api/decks', '/api/decks/d1', '/api/notes/n1',
  '/api/notes/n1/ask', '/api/notes/n1/history', '/api/sentences/changes', '/api/sentences/s1/explain', '/api/custom-lessons',
  '/api/readers', '/api/me/homework', '/api/me/homework/events', '/api/me/bumps', '/api/me/up-next', '/api/me/card-holds',
  '/api/me/study-time', '/api/transcribe', '/api/transcribe/live', '/api/me/usage-events', '/api/analytics/events',
  '/api/feedback', '/api/auth/me', '/api/profile', '/api/profile/study-budget', '/api/audio/recordings/a.webm',
  '/api/chat-media/m1', '/api/media/token', '/api/conversations/c1/messages', '/api/messages/m1', '/api/me/chats',
  '/api/me/chat-inbox', '/api/live/ticket', '/api/ai/gloss-words', '/api/coach/conversations', '/api/sentence/coach',
  '/api/lessons/answer-check', '/api/lessons/sentence-feedback', '/api/note-questions/q1', '/api/reader-words/explain',
  '/api/practice/tts', '/api/quests', '/api/calls', '/api/auth/logout', '/api/auth/logout-all', '/api/auth/exchange',
  '/api/auth/login', 'https://chinese-learning-api.example.workers.dev/api/transcribe/live', '', '/', '/api/transcriber',
];

const counts: UnsyncedCounts[] = [];
for (const r of [0, 1, 2, 1234]) for (const rec of [0, 1, 3]) for (const o of [0, 1, 5]) counts.push({ reviews: r, recordings: rec, other: o });

const refs = [null, { id: null, email: null }, { id: 'u1', email: 'jerome@example.com' }, { id: null, email: 'Jerome@Example.com ' }, { id: 'u2', email: null }];
const nexts = [{ id: 'u1', email: 'jerome@example.com' }, { id: 'u2', email: 'minghui@example.com' }, { id: 'u3', email: null }];
const switches: Array<{ previous: unknown; next: unknown; unsynced: UnsyncedCounts; out: string }> = [];
for (const p of refs) for (const n of nexts) for (const u of [counts[0], counts[1], counts[13]]) {
  switches.push({ previous: p, next: n, unsynced: u, out: accountSwitchFor(p, n, u) });
}

writeFileSync(join(OUT, 'session.json'), JSON.stringify({
  where: paths.map((p) => ({ path: p, where: signedOutWhere(p), counts: countsForSignedOut(p), proves: provesSignedIn(p) })),
  summaries: counts.map((c) => ({ c, summary: unsyncedSummary(c), signOut: signOutWarning(c), switchTo: switchAccountWarning(c, 'jerome@example.com'), switchNull: switchAccountWarning(c, null) })),
  switches,
  copy: { lab: signedOutBanner('lab'), web: signedOutBanner('web'), transcription: SIGNED_OUT_TRANSCRIPTION, note: SIGNED_OUT_TRANSCRIPTION_NOTE },
}));
