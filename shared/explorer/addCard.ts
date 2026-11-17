/**
 * "+ Add as card" in the language explorer (docs/LANGUAGE_EXPLORER.md "Adding before the meaning
 * has loaded"): what a tap does with what the view knows. Adding never fails because a lookup
 * hasn't finished — the apps first WAIT for the in-flight word / character lookups (the button
 * says "Adding…"), then:
 *
 *   - offline                       → the fill sheet (the meaning to type when none is known;
 *                                      Add works once back online) — never a raw network error;
 *   - a meaning                     → add;
 *   - no meaning, not glossed yet   → ask the gloss path (`POST /api/ai/gloss-words`) first;
 *   - no meaning after the gloss    → the fill sheet ("What does 吴侬软语 mean?").
 *
 * Pinyin missing → the device's reading (auto-pinyin + the 一 / 不 rule), passed in as
 * `devicePinyin`. The server refuses a card without English ("english is required"); this is
 * what keeps a fast tap from reaching it. Lab port: core/…/explorer/ExplorerAdd.kt (parity-tested,
 * parity/fixtures/explorer-add.ts).
 */

export interface ExplorerAddInput {
  hanzi: string;
  /** The view's pinyin once its lookups are in ('' = none). */
  pinyin: string;
  /** The view's meaning once its lookups are in ('' = none). */
  english: string;
  /** The device's reading of the word (auto-pinyin + 一 / 不). */
  devicePinyin: string;
  online: boolean;
  /** The gloss path was already asked (or can't be: no network). */
  glossed: boolean;
}

export type ExplorerAddFillReason = 'offline' | 'no_meaning';

export type ExplorerAddStep =
  | { kind: 'add'; hanzi: string; pinyin: string; english: string }
  | { kind: 'gloss'; hanzi: string; pinyin: string }
  | { kind: 'fill'; hanzi: string; pinyin: string; english: string; reason: ExplorerAddFillReason };

/** Whitespace folded, trimmed. */
function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function explorerAddStep(input: ExplorerAddInput): ExplorerAddStep {
  const hanzi = input.hanzi.trim();
  const pinyin = clean(input.pinyin) || clean(input.devicePinyin);
  const english = clean(input.english);
  if (!input.online) return { kind: 'fill', hanzi, pinyin, english, reason: 'offline' };
  if (english) return { kind: 'add', hanzi, pinyin, english };
  if (!input.glossed) return { kind: 'gloss', hanzi, pinyin };
  return { kind: 'fill', hanzi, pinyin, english: '', reason: 'no_meaning' };
}

/** The fill sheet's question. */
export function explorerAddPrompt(hanzi: string): string {
  return `What does ${hanzi.trim()} mean?`;
}

/** The line under the question: why it asks. */
export function explorerAddHint(reason: ExplorerAddFillReason, hasMeaning: boolean): string {
  if (reason === 'offline') {
    return hasMeaning
      ? 'You’re offline — Add works once you’re back online.'
      : 'You’re offline, so the meaning can’t be looked up. Type it — Add works once you’re back online.';
  }
  return 'The dictionary doesn’t have this word. Type what it means to add it.';
}

/** What stops Add on the fill sheet (null = ready). */
export function explorerAddProblem(english: string, online: boolean): string | null {
  if (!clean(english)) return 'Type what it means first.';
  if (!online) return 'Waiting for a connection…';
  return null;
}

/** How long a tap waits for the view's lookups before going on with what it has. */
export const EXPLORER_ADD_WAIT_MS = 8000;
