/**
 * Multiple-choice options for the typing cards (meaning→hanzi, audio→hanzi):
 * the rules every side shares — the worker when it stores generated options,
 * the web app and the native Lab app (android-lab/core McOptions.kt, parity
 * fixture parity/fixtures/multiple-choice.ts) when they read them.
 *
 * A row is one character of the answer: `correct` plus the options offered.
 * Punctuation rows carry a single option; English-text rows carry no hanzi.
 */

export interface McRow {
  correct: string;
  options: string[];
}

/** Han ideographs (CJK Unified + Extension A) — the same ranges `isEnglishEntry` uses. */
const HAN_ANY = /[一-鿿㐀-䶿]/;
const HAN_ONLY = /^[一-鿿㐀-䶿]+$/;

/** Number of Unicode code points (what the learner sees as characters). */
function charCount(s: string): number {
  return [...s].length;
}

/**
 * A distractor the grid may show: Chinese characters only, as many as the
 * answer character it stands in for. Pinyin syllables ("xi"), latin letters,
 * digits, punctuation, whitespace and empty strings are never options.
 */
export function isHanziOption(option: string, correct: string): boolean {
  return HAN_ONLY.test(option) && charCount(option) === charCount(correct);
}

/**
 * Clean one row: for a character row keep only real character options (see
 * `isHanziOption`), drop duplicates, and make sure the correct one is offered.
 * Punctuation (a single option) and English-text rows pass through unchanged.
 * A row left with no distractor becomes a single-option row (shown as given).
 */
export function sanitizeMcRow(row: McRow): McRow {
  const correct = row.correct;
  if (row.options.length <= 1 || !HAN_ANY.test(correct)) return { correct, options: [...row.options] };
  const seen = new Set<string>();
  const options: string[] = [];
  for (const raw of row.options) {
    const opt = raw.trim();
    if (seen.has(opt)) continue;
    if (opt !== correct && !isHanziOption(opt, correct)) continue;
    seen.add(opt);
    options.push(opt);
  }
  if (!seen.has(correct)) options.push(correct);
  return { correct, options };
}

/** A row the learner picks in (not punctuation, not an English text row). */
function isPickRow(row: McRow): boolean {
  return row.options.length > 1 && !(/[a-zA-Z]/.test(row.correct) && !HAN_ANY.test(row.correct));
}

/** Rows the learner has to pick in. */
export function mcChoiceRowCount(rows: McRow[]): number {
  return rows.filter(isPickRow).length;
}

/**
 * Past this many rows to pick, the grid goes compact (smaller tiles and gaps,
 * still ≥ 44 px / dp touch targets) so a sentence fits on a folded phone.
 * Long answers keep multiple choice (pinyin-only notes have no other way to
 * answer); the grid scrolls with the prompt and the submit button kept on screen.
 */
export const MC_COMPACT_AFTER_ROWS = 6;

export function isMcCompact(rows: McRow[]): boolean {
  return mcChoiceRowCount(rows) > MC_COMPACT_AFTER_ROWS;
}

/**
 * After a pick in `picked`, the row to bring into view: the next row (after
 * it, wrapping round) that is still unanswered, or null when every pick row
 * has an answer.
 */
export function nextUnansweredRow(rows: McRow[], selections: (string | null)[], picked: number): number | null {
  const n = rows.length;
  for (let step = 1; step <= n; step++) {
    const i = (picked + step) % n;
    if (isPickRow(rows[i]) && selections[i] == null) return i;
  }
  return null;
}
