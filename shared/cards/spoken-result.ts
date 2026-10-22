/**
 * The spoken answer's result on the back of a typing card (meaning → hanzi, audio → hanzi) and
 * of 🎤 Say it practice: ONE compact "You said" row under the answer (docs/STUDY_SESSION.md
 * "Say the answer"). The card's answer is shown once, big, with its own pinyin and meaning; the
 * row carries only what was said, marked character by character, and one verdict chip:
 *
 *   ( ▶ )  You said 朗 lǎng  [≈ Close — tones off]  ( ✎ )
 *
 * This file is the presentational rule both apps follow: which verdict state, the chip's words
 * and icon, which characters of the transcript are marked, whether ✎ (Open in Coach) shows, and
 * the sentence a screen reader reads for the whole row. Pure; Lab port
 * `core/…/SpokenAnswerResult.kt`, parity-tested (parity/fixtures/spoken-answer.ts).
 *
 * Marks (never colour alone — each has a shape too, see the apps' styles):
 * - `right`: a character the answer has too (lined up by longest common subsequence);
 * - `differs`: "Sounded right" — said right but written with other characters (由 heard as 油):
 *   YELLOW (the partial token) with a dotted underline, the chip still ✓;
 * - `wrong`: close / didn't match — a character not in the answer: red, solid underline;
 * - `plain`: punctuation and spaces, and in "Contains the answer" the words around the answer.
 */
import type { AnswerVerdict } from './answer';

export type SpokenResultState = 'match' | 'sound' | 'contains' | 'close' | 'wrong';
export type SpokenResultIcon = 'check' | 'approx' | 'close';
export type SpokenCharMark = 'right' | 'differs' | 'wrong' | 'plain';

export interface SpokenResultChar {
  char: string;
  mark: SpokenCharMark;
}

export interface SpokenResult {
  state: SpokenResultState;
  /** The verdict counts as right (the card's border, the rating sound). */
  accepted: boolean;
  /** The chip's words (with `icon`, never colour alone). */
  chip: string;
  icon: SpokenResultIcon;
  /** ✎ Open in Coach: everything but a plain match. */
  coach: boolean;
  /** The transcript (trimmed), one entry per code point. */
  chars: SpokenResultChar[];
}

/** The chip's words per state. */
export const SPOKEN_RESULT_CHIP: Record<SpokenResultState, string> = {
  match: 'Match',
  sound: 'Sounded right — written differently',
  contains: 'Contains the answer',
  close: 'Close — tones off',
  wrong: 'Didn’t match',
};

/** The chip's icon per state: ✓ right, ≈ partly (contains / close), ✕ didn't match. */
export const SPOKEN_RESULT_ICON: Record<SpokenResultState, SpokenResultIcon> = {
  match: 'check',
  sound: 'check',
  contains: 'approx',
  close: 'approx',
  wrong: 'close',
};

/** The verdict as one of the row's five states. */
export function spokenResultState(verdict: AnswerVerdict): SpokenResultState {
  switch (verdict) {
    case 'sound': return 'sound';
    case 'contains': return 'contains';
    case 'close': return 'close';
    case 'wrong': return 'wrong';
    default: return 'match'; // exact, punctuation_only, equivalent, alternative
  }
}

/** A character that can be right or wrong (a letter of any script, a digit); the rest is `plain`. */
const MARKABLE = /[\p{L}\p{Nd}]/u;

/** Which characters of the transcript the answer has too (longest common subsequence, by code point). */
function commonWithAnswer(said: string[], answer: string[]): boolean[] {
  const n = said.length;
  const m = answer.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = said[i] === answer[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const hit = new Array<boolean>(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (said[i] === answer[j]) { hit[i] = true; i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return hit;
}

/** The transcript's characters, each marked for its state (see the file comment). */
export function spokenResultMarks(transcript: string, correct: string, state: SpokenResultState): SpokenResultChar[] {
  const said = [...transcript.trim()];
  const hit = commonWithAnswer(said, [...correct.trim()]);
  return said.map((char, k) => {
    if (!MARKABLE.test(char)) return { char, mark: 'plain' };
    if (state === 'match' || hit[k]) return { char, mark: 'right' };
    if (state === 'sound') return { char, mark: 'differs' };
    if (state === 'contains') return { char, mark: 'plain' };
    return { char, mark: 'wrong' };
  });
}

/** Everything the "You said" row shows for a spoken answer with this verdict. */
export function spokenResult(transcript: string, correct: string, verdict: AnswerVerdict): SpokenResult {
  const state = spokenResultState(verdict);
  return {
    state,
    accepted: verdict !== 'wrong' && verdict !== 'close',
    chip: SPOKEN_RESULT_CHIP[state],
    icon: SPOKEN_RESULT_ICON[state],
    coach: state !== 'match',
    chars: spokenResultMarks(transcript, correct, state),
  };
}

/**
 * The whole row as one sentence for a screen reader: what was said (with its pinyin when given),
 * the full verdict and the marked characters — "You said 朗 (lǎng). Close — the tones are off.
 * Not in the answer: 朗."
 */
export function spokenResultLabel(result: SpokenResult, correct: string, pinyin = ''): string {
  const said = result.chars.map((c) => c.char).join('') || '…';
  const py = pinyin.trim();
  const head = `You said ${said}${py ? ` (${py})` : ''}.`;
  const marked = (mark: SpokenCharMark) => result.chars.filter((c) => c.mark === mark).map((c) => c.char).join('');
  const answer = correct.trim();
  switch (result.state) {
    case 'match': return `${head} Match.`;
    case 'contains': return `${head} Contains the answer, ${answer}.`;
    case 'sound': {
      const differs = marked('differs');
      return `${head} Sounded right — written differently${differs ? ` (${differs})` : ''}; the card writes ${answer}.`;
    }
    case 'close':
    case 'wrong': {
      const wrong = marked('wrong');
      const verdict = result.state === 'close' ? 'Close — the tones are off.' : 'Didn’t match.';
      return `${head} ${verdict}${wrong ? ` Not in the answer: ${wrong}.` : ''}`;
    }
  }
}
