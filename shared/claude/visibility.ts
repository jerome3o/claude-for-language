/**
 * Which of a learner's Claude chats his tutor can read (docs/CHAT.md "Claude threads" → "What your
 * tutor sees"; the unified-Claude-chats plan §6.6). Privacy first:
 *
 *   users.claude_tutor_visibility  the account's choice — 'card_only' (default, NULL): the questions
 *                                  he asks Claude on a study card, as tutors always saw them; 'all':
 *                                  every chat; 'none': nothing
 *   coach_conversations.tutor_visible  one chat's own choice (thread ⋯ → Share with my tutor / Hide
 *                                  from my tutor): 1 / 0 wins over the account; NULL = follow it
 *
 * So a practice role-play or a plain chat is private unless he shares it (or picks "All"). The tutor
 * reads a shared chat read-only; his private profile of the student is never in it (the tutor view
 * returns the chat's own messages only).
 *
 * Pure; the worker filters with the same rule in SQL (`tutorVisibleSql`), both apps show it — Lab
 * port `core/…/claude/TutorVisibility.kt`, parity-tested (parity/fixtures/claude-tutor-visibility.ts).
 */
import type { ClaudeContextKind } from './context';

export type ClaudeTutorVisibility = 'card_only' | 'all' | 'none';

export const CLAUDE_TUTOR_VISIBILITIES: readonly ClaudeTutorVisibility[] = ['card_only', 'all', 'none'];

export const DEFAULT_CLAUDE_TUTOR_VISIBILITY: ClaudeTutorVisibility = 'card_only';

/** A stored / sent value; NULL, unknown → the default ('card_only'). */
export function parseTutorVisibility(v: unknown): ClaudeTutorVisibility {
  return typeof v === 'string' && (CLAUDE_TUTOR_VISIBILITIES as readonly string[]).includes(v) ? (v as ClaudeTutorVisibility) : DEFAULT_CLAUDE_TUTOR_VISIBILITY;
}

/** A value sent to PUT /api/profile/claude-tutor-visibility: one of the three, or null (= the default); anything else → undefined (400). */
export function pickTutorVisibility(v: unknown): ClaudeTutorVisibility | null | undefined {
  if (v === null) return null;
  return typeof v === 'string' && (CLAUDE_TUTOR_VISIBILITIES as readonly string[]).includes(v) ? (v as ClaudeTutorVisibility) : undefined;
}

/** What the account's choice alone says about a chat in this context. */
export function visibleByDefault(kind: ClaudeContextKind | string | null | undefined, setting: ClaudeTutorVisibility): boolean {
  if (setting === 'all') return true;
  if (setting === 'none') return false;
  return kind === 'card';
}

export interface TutorVisibilityThread {
  /** null = general (an older Coach chat). */
  context_kind: ClaudeContextKind | string | null;
  /** The chat's own choice; null = the account's. */
  tutor_visible: boolean | null;
}

/** THE rule: can the tutor read this chat? */
export function tutorCanSee(thread: TutorVisibilityThread, setting: ClaudeTutorVisibility): boolean {
  if (thread.tutor_visible === true) return true;
  if (thread.tutor_visible === false) return false;
  return visibleByDefault(thread.context_kind ?? 'general', setting);
}

/**
 * The thread ⋯ toggle: the value to store when he flips it. Back to what the account says → null
 * (so a later change of the account's choice applies to it again); otherwise the explicit choice.
 */
export function nextTutorVisible(thread: TutorVisibilityThread, setting: ClaudeTutorVisibility): boolean | null {
  const want = !tutorCanSee(thread, setting);
  return want === visibleByDefault(thread.context_kind ?? 'general', setting) ? null : want;
}

/** The thread ⋯ menu item. */
export function shareMenuLabel(thread: TutorVisibilityThread, setting: ClaudeTutorVisibility): string {
  return tutorCanSee(thread, setting) ? '🙈 Hide from my tutor' : '👁 Share with my tutor';
}

/** The quiet line under a thread's header while the tutor can read it ('' = she can't). */
export function sharedLine(thread: TutorVisibilityThread, setting: ClaudeTutorVisibility, tutorName?: string | null): string {
  if (!tutorCanSee(thread, setting)) return '';
  return `👁 ${tutorName?.trim() || 'Your tutor'} can read this chat`;
}

/** Settings → Chat → "Your tutor can see": the three choices. */
export const TUTOR_VISIBILITY_OPTIONS: ReadonlyArray<{ id: ClaudeTutorVisibility; label: string; hint: string }> = [
  { id: 'card_only', label: 'Card questions', hint: 'What you ask Claude on a study card. Your other chats with Claude stay private.' },
  { id: 'all', label: 'All Claude chats', hint: 'Every chat with Claude — card questions, practice role-plays, readers, exercises and plain chats.' },
  { id: 'none', label: 'None', hint: 'Nothing, unless you share one chat (⋯ → Share with my tutor).' },
];

/** Settings → Chat: the heading's explanation. */
export const TUTOR_VISIBILITY_EXPLAINER =
  'Your tutor can read the chats you share, never write in them. A single chat can be shared or hidden from its ⋯ menu.';

/** The tutor's Students row / dashboard card: "✦ Asked Claude 3× today" ('' for none). */
export function askedClaudeTodayLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return `✦ Asked Claude ${Math.floor(count)}× today`;
}

/** The tutor's read-only thread view: the line where the composer would be. */
export function tutorReadOnlyLine(studentName?: string | null): string {
  const who = studentName?.trim() || 'Your student';
  return `Read only · ${who}’s chat with Claude — only ${who} can write in it.`;
}

/** The tutor's empty "Asked Claude" list: what the student shares — never what he keeps. */
export function tutorEmptyText(studentName: string | null | undefined, visibility: ClaudeTutorVisibility | undefined): string {
  const who = studentName?.trim() || 'The student';
  if (visibility === 'all') return `${who} has not chatted with Claude yet.`;
  if (visibility === 'none') return `${who} keeps their chats with Claude private. They can share a chat with you from its ⋯ menu.`;
  return `${who} has not asked Claude about a card yet. Other chats with Claude are private unless they share them.`;
}
