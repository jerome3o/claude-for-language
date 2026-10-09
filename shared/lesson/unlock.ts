/**
 * Unlockable mini lessons (docs/STUDY_SESSION.md "Unlockable lessons"): a lesson can wait,
 * LOCKED, until the learner has done something real — listened to an audio lesson (the
 * podcast's companion mini lesson) or something they do themselves ("Watch episode 3 of …",
 * "Go to a restaurant and order 打包").
 *
 * - A locked lesson is never offered: not in the study session, not in today's lessons, and
 *   it never takes the daily new-lesson place (`pickTodaysLessons`' `locked`).
 * - Unlocking means "I want this now": an unlocked lesson that is still NEW comes today ON TOP
 *   of the daily place, like a homework lesson (`pickTodaysLessons`' `unlocked`).
 * - Unlocking is an offline-first event (the earliest `unlocked_at` wins, idempotent): by hand
 *   ("✓ I've listened — unlock" / "✓ Done — unlock"), automatically when the linked audio lesson
 *   is listened to (`audioLessonListened`), or from the player's "Mini lesson ready" card.
 *
 * Pure; the Lab app's port (core/…/LessonUnlock.kt) is parity-tested against it.
 */

export type LessonUnlock =
  | { kind: 'audio_lesson'; audio_lesson_id: string }
  | { kind: 'manual'; prompt: string };

export type LessonUnlockKind = LessonUnlock['kind'];
/** How it was unlocked: auto = the listen reached the end; manual = the button; player = the audio player's card. */
export type LessonUnlockVia = 'auto' | 'manual' | 'player';
export const LESSON_UNLOCK_VIAS: readonly LessonUnlockVia[] = ['auto', 'manual', 'player'];

export type LessonLockStatus = 'none' | 'locked' | 'unlocked';

export const UNLOCK_PROMPT_MAX = 200;
/** An audio lesson counts as listened at this share of its length… */
export const LISTENED_FRACTION = 0.85;

/** Validate an unlock condition from an untrusted body. `null` / absent = none. */
export function pickLessonUnlock(raw: unknown): { unlock: LessonUnlock | null; problems: string[] } {
  if (raw === undefined || raw === null) return { unlock: null, problems: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { unlock: null, problems: ['unlock must be an object { kind, … }'] };
  const r = raw as Record<string, unknown>;
  if (r.kind === 'audio_lesson') {
    const id = typeof r.audio_lesson_id === 'string' ? r.audio_lesson_id.trim() : '';
    if (!id || id.length > 100) return { unlock: null, problems: ['unlock.audio_lesson_id is required'] };
    return { unlock: { kind: 'audio_lesson', audio_lesson_id: id }, problems: [] };
  }
  if (r.kind === 'manual') {
    const prompt = typeof r.prompt === 'string' ? r.prompt.replace(/\s+/g, ' ').trim() : '';
    if (!prompt) return { unlock: null, problems: ['unlock.prompt is required: what the learner does to unlock it, e.g. "Watch episode 3 of 家有儿女"'] };
    if (prompt.length > UNLOCK_PROMPT_MAX) return { unlock: null, problems: [`unlock.prompt must be at most ${UNLOCK_PROMPT_MAX} characters`] };
    return { unlock: { kind: 'manual', prompt }, problems: [] };
  }
  return { unlock: null, problems: ['unlock.kind must be "audio_lesson" or "manual"'] };
}

/** The condition from the stored columns (custom_lessons.unlock_kind / unlock_ref / unlock_prompt). */
export function lessonUnlockFromRow(row: { unlock_kind?: string | null; unlock_ref?: string | null; unlock_prompt?: string | null }): LessonUnlock | null {
  if (row.unlock_kind === 'audio_lesson' && row.unlock_ref) return { kind: 'audio_lesson', audio_lesson_id: row.unlock_ref };
  if (row.unlock_kind === 'manual') return { kind: 'manual', prompt: row.unlock_prompt ?? '' };
  return null;
}

/** The columns for a condition. */
export function lessonUnlockColumns(unlock: LessonUnlock | null): { unlock_kind: string | null; unlock_ref: string | null; unlock_prompt: string | null } {
  if (!unlock) return { unlock_kind: null, unlock_ref: null, unlock_prompt: null };
  return unlock.kind === 'audio_lesson'
    ? { unlock_kind: 'audio_lesson', unlock_ref: unlock.audio_lesson_id, unlock_prompt: null }
    : { unlock_kind: 'manual', unlock_ref: null, unlock_prompt: unlock.prompt };
}

/** none = no condition; locked = waiting; unlocked = the condition is met (`unlocked_at` set). */
export function lessonLockStatus(unlock: LessonUnlock | null | undefined, unlockedAt: string | null | undefined): LessonLockStatus {
  if (!unlock) return 'none';
  return unlockedAt ? 'unlocked' : 'locked';
}

/** Two unlock times → the one that counts (the earliest; a missing / garbage one loses). */
export function earlierUnlock(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? b! : null;
  if (!Number.isFinite(tb)) return a!;
  return tb < ta ? b! : a!;
}

/**
 * Whether a listen has reached the end of an audio lesson: ≥ 85 % of its length, or into its
 * LAST chapter (the dialogue's "Final listen") when it has more than one.
 */
export function audioLessonListened(positionMs: number, durationMs: number, chapterStarts: number[] = []): boolean {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0 || positionMs <= 0) return false;
  if (positionMs >= durationMs * LISTENED_FRACTION) return true;
  const starts = chapterStarts.filter(s => Number.isFinite(s));
  if (starts.length < 2) return false;
  const last = Math.max(...starts);
  return last > 0 && positionMs >= last;
}

/**
 * Locked lessons a listen of `audioLessonId` unlocks: those waiting on that audio lesson.
 * (Only at the moment of a listen — a companion made for a podcast already heard waits for a
 * tap, so making several at once never floods today.)
 */
export function lessonsUnlockedByListen<T extends { id: string; unlock?: LessonUnlock | null; unlocked_at?: string | null }>(
  lessons: T[],
  audioLessonId: string,
): string[] {
  return lessons
    .filter(l => l.unlock?.kind === 'audio_lesson' && l.unlock.audio_lesson_id === audioLessonId && !l.unlocked_at)
    .map(l => l.id);
}

/** The ids `pickTodaysLessons` takes: lessons still locked, and lessons with a condition that is met. */
export function lockSets<T extends { id: string; unlock?: LessonUnlock | null; unlocked_at?: string | null }>(
  lessons: T[],
): { locked: Set<string>; unlocked: Set<string> } {
  const locked = new Set<string>();
  const unlocked = new Set<string>();
  for (const l of lessons) {
    const s = lessonLockStatus(l.unlock, l.unlocked_at);
    if (s === 'locked') locked.add(l.id);
    else if (s === 'unlocked') unlocked.add(l.id);
  }
  return { locked, unlocked };
}

// ============ Words ============

const COMPANION_SUFFIX = ' — mini lesson';

/** "去朋友家吃饭 · Dinner at a friend's parents' home — mini lesson": the podcast's title + the suffix. */
export function companionLessonTitle(audioTitle: string): string {
  const t = audioTitle.replace(/\s+/g, ' ').trim() || 'Audio lesson';
  return t.endsWith(COMPANION_SUFFIX.trim()) ? t : `${t}${COMPANION_SUFFIX}`;
}

/** The unlock button. */
export function unlockButtonLabel(unlock: LessonUnlock): string {
  return unlock.kind === 'audio_lesson' ? "✓ I've listened — unlock" : '✓ Done — unlock';
}

/** The line under a locked lesson: what unlocks it. */
export function lockedLessonLine(unlock: LessonUnlock, audioTitle?: string | null): string {
  if (unlock.kind === 'manual') return `🔒 ${unlock.prompt}`;
  const title = (audioTitle ?? '').trim();
  return title ? `🔒 Unlocks when you've listened to “${title}”` : '🔒 Unlocks when you\'ve listened to its audio lesson';
}

/** The audio lesson list / player's line for a podcast with a companion. */
export type CompanionStatus = 'generating' | 'failed' | 'locked' | 'unlocked';

export function companionBadge(status: CompanionStatus): string {
  switch (status) {
    case 'generating': return '✨ Writing its mini lesson…';
    case 'failed': return "⚠ Couldn't write its mini lesson";
    case 'locked': return '🔒 Mini lesson waiting';
    case 'unlocked': return '✓ Mini lesson unlocked';
  }
}

/** The player's card once the listen is done. */
export function companionReadyLine(title: string): string {
  return `Mini lesson ready: ${title}`;
}
