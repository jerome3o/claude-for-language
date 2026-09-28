/**
 * Multiple-choice options for typing cards (meaning→hanzi, audio→hanzi):
 * the pure parts of loading, shuffling and falling back, kept out of the
 * StudyPage so they can be unit-tested.
 *
 * Rules (UX review G2):
 * - A generation request times out after MC_TIMEOUT_MS and the card falls
 *   back to typing with a one-line note. Nothing hangs.
 * - Offline (auto or forced), options already cached on the note are fine;
 *   a generation request is never started — straight to typing.
 * - The mode is per card: nothing here persists between cards.
 */

import { sanitizeMcRow, type McRow } from '@shared/cards/multipleChoice';

export type McOptionRow = McRow;
export { isMcCompact, nextUnansweredRow, mcChoiceRowCount, MC_COMPACT_AFTER_ROWS } from '@shared/cards/multipleChoice';

export const MC_TIMEOUT_MS = 8000;

export type McFallbackReason = 'offline' | 'timeout' | 'error' | 'empty';

export type McLoadResult =
  | { status: 'ready'; options: McOptionRow[]; generated: boolean }
  | { status: 'fallback'; reason: McFallbackReason; message: string };

export const MC_FALLBACK_MESSAGES: Record<McFallbackReason, string> = {
  offline: 'No connection — type your answer instead.',
  timeout: 'Options took too long — type your answer instead.',
  error: "Couldn't build options — type your answer instead.",
  empty: 'No options for this word — type your answer instead.',
};

/**
 * Parse the JSON stored on the note; null when missing or malformed. Every row
 * goes through `sanitizeMcRow`, so options cached before the worker filtered
 * them (a pinyin "xi" among the characters) are cleaned on the device too.
 */
export function parseMcOptions(raw: string | null | undefined): McOptionRow[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const rows = parsed.filter(
      (r): r is McOptionRow =>
        !!r && typeof r === 'object' && typeof (r as McOptionRow).correct === 'string' && Array.isArray((r as McOptionRow).options)
    ).map(r => sanitizeMcRow({ correct: r.correct, options: r.options.filter((o): o is string => typeof o === 'string') }));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

/** Shuffle each row's options so positions can't be memorised. */
export function shuffleMcOptions(rows: McOptionRow[], random: () => number = Math.random): McOptionRow[] {
  return rows.map(row => {
    const shuffled = [...row.options];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return { correct: row.correct, options: shuffled };
  });
}

/** English (no hanzi) rows are shown as text rather than choices. */
export function isEnglishEntry(correct: string): boolean {
  return /[a-zA-Z]/.test(correct) && !/[一-鿿㐀-䶿]/.test(correct);
}

/** Pre-select punctuation (single option) and English rows; the rest are the learner's. */
export function initialMcSelections(rows: McOptionRow[]): (string | null)[] {
  return rows.map(row => (row.options.length === 1 || isEnglishEntry(row.correct) ? row.correct : null));
}

/** A row the learner picks in (not punctuation, not an English text row). */
export function isChoiceRow(row: McOptionRow): boolean {
  return row.options.length > 1 && !isEnglishEntry(row.correct);
}

/** Has the learner picked anything yet? (Pre-selected rows don't count.) */
export function hasMcPick(rows: McOptionRow[], selections: (string | null)[]): boolean {
  return rows.some((row, i) => isChoiceRow(row) && selections[i] != null);
}

/**
 * One submit, any time (Jerome, 2026-09): the grid never waits for every row.
 * With nothing picked the button just shows the answer ("give up and move on");
 * once something is picked it submits what there is.
 */
export function mcSubmitLabel(rows: McOptionRow[], selections: (string | null)[]): 'Show answer' | 'Submit' {
  return hasMcPick(rows, selections) ? 'Submit' : 'Show answer';
}

/**
 * The answer a submit records (the review event's user_answer): the selections
 * in row order, unselected rows skipped. Nothing picked → '' — exactly like
 * revealing a typed card with the box left empty (pre-selected punctuation /
 * English rows alone are not an answer).
 */
export function mcSubmittedAnswer(rows: McOptionRow[], selections: (string | null)[]): string {
  if (!hasMcPick(rows, selections)) return '';
  return selections.filter((s): s is string => s != null).join('');
}

export type McSlotStatus = 'right' | 'wrong' | 'skipped' | 'given';

export interface McAnswerSlot {
  correct: string;
  chosen: string | null;
  status: McSlotStatus;
}

/**
 * Row-by-row result for the answer side. A partial answer can't be diffed
 * position by position (a skipped row shifts everything after it), so the
 * back shows each row's pick against that row's answer: right, wrong,
 * skipped, or given (punctuation / English rows the learner never chose).
 */
export function mcAnswerSlots(rows: McOptionRow[], selections: (string | null)[]): McAnswerSlot[] {
  return rows.map((row, i) => {
    const chosen = selections[i] ?? null;
    if (!isChoiceRow(row)) return { correct: row.correct, chosen: row.correct, status: 'given' as const };
    if (chosen == null) return { correct: row.correct, chosen: null, status: 'skipped' as const };
    return { correct: row.correct, chosen, status: chosen === row.correct ? ('right' as const) : ('wrong' as const) };
  });
}

/** Reject after `ms` — the pending promise itself is left to settle on its own. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Generation timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Decide what a card gets: cached options, freshly generated ones, or the
 * typing fallback. `generate` is only called when online and nothing is cached.
 */
export async function loadMultipleChoice(input: {
  cachedOptions: string | null | undefined;
  online: boolean;
  generate: () => Promise<string | null | undefined>;
  timeoutMs?: number;
}): Promise<McLoadResult> {
  const cached = parseMcOptions(input.cachedOptions);
  if (cached) return { status: 'ready', options: cached, generated: false };

  if (!input.online) {
    return { status: 'fallback', reason: 'offline', message: MC_FALLBACK_MESSAGES.offline };
  }

  try {
    const raw = await withTimeout(input.generate(), input.timeoutMs ?? MC_TIMEOUT_MS);
    const rows = parseMcOptions(raw);
    if (!rows) return { status: 'fallback', reason: 'empty', message: MC_FALLBACK_MESSAGES.empty };
    return { status: 'ready', options: rows, generated: true };
  } catch (err) {
    const timedOut = err instanceof Error && err.message === 'Generation timed out';
    const reason: McFallbackReason = timedOut ? 'timeout' : 'error';
    return { status: 'fallback', reason, message: MC_FALLBACK_MESSAGES[reason] };
  }
}
