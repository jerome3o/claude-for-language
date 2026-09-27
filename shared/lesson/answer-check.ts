/**
 * Answer checking for written-Chinese exercises (write_typed, dictation,
 * translate's "exact match" nudge). Pure, so the web app, the worker and the
 * Lab app's parity tests all agree on what counts as right.
 */

/** Punctuation, symbols and whitespace are never part of the answer. */
const IGNORED = /[\s\p{P}\p{S}]/gu;

/** The characters that count: no whitespace or punctuation (CJK or ASCII). */
export function normalizeHanziAnswer(s: string): string {
  return s.normalize('NFKC').replace(IGNORED, '');
}

/** True when the answer equals the expected text (or an alternative),
 * ignoring whitespace and punctuation. */
export function isHanziAnswerCorrect(answer: string, expected: string, alternatives: string[] = []): boolean {
  const a = normalizeHanziAnswer(answer);
  if (!a) return false;
  return [expected, ...alternatives].some(e => normalizeHanziAnswer(e) === a);
}

export interface CharMark {
  ch: string;
  /** In the other string at this aligned position. */
  hit: boolean;
}

export interface HanziDiff {
  correct: boolean;
  /** Share of expected characters the answer got, 0-1. */
  accuracy: number;
  /** The expected characters, each marked found / missed. */
  expected: CharMark[];
  /** The typed characters, each marked right / extra-or-wrong. */
  typed: CharMark[];
}

/**
 * Character-level comparison by longest common subsequence: which expected
 * characters the learner got and which typed characters are wrong. Used to
 * highlight a dictation / typed-writing answer rather than just "wrong".
 */
export function diffHanzi(answer: string, expected: string, alternatives: string[] = []): HanziDiff {
  // Diff against the closest accepted form.
  const forms = [expected, ...alternatives].map(normalizeHanziAnswer).filter(Boolean);
  const a = Array.from(normalizeHanziAnswer(answer));
  let best: { e: string[]; lcs: boolean[][] } | null = null;
  let bestLen = -1;
  for (const form of forms.length ? forms : ['']) {
    const e = Array.from(form);
    const table = lcsTable(a, e);
    const len = table[a.length][e.length];
    if (len > bestLen) {
      bestLen = len;
      best = { e, lcs: backtrack(table, a, e) };
    }
  }
  const e = best!.e;
  const [typedHits, expectedHits] = [best!.lcs[0], best!.lcs[1]];
  const correct = isHanziAnswerCorrect(answer, expected, alternatives);
  return {
    correct,
    accuracy: e.length === 0 ? 0 : bestLen / e.length,
    expected: e.map((ch, i) => ({ ch, hit: expectedHits[i] })),
    typed: a.map((ch, i) => ({ ch, hit: typedHits[i] })),
  };
}

function lcsTable(a: string[], b: string[]): number[][] {
  const t: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
    }
  }
  return t;
}

/** [hits in a, hits in b] along one longest common subsequence. */
function backtrack(t: number[][], a: string[], b: string[]): [boolean[], boolean[]] {
  const ha = new Array<boolean>(a.length).fill(false);
  const hb = new Array<boolean>(b.length).fill(false);
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ha[i - 1] = true;
      hb[j - 1] = true;
      i--;
      j--;
    } else if (t[i - 1][j] >= t[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return [ha, hb];
}

/** Does a learner's sentence contain the target word (punctuation-blind)? */
export function sentenceUsesWord(sentence: string, word: string): boolean {
  const w = normalizeHanziAnswer(word);
  return w.length > 0 && normalizeHanziAnswer(sentence).includes(w);
}
