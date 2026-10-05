/**
 * Mix-ups: characters a learner confuses with each other (买 ↔ 卖), derived from the
 * wrong characters they typed and the wrong tiles they picked in multiple choice
 * (a multiple-choice review's user_answer is its picks in row order, skipped rows left
 * out — so both look the same here).
 *
 * The answer is aligned to the card's hanzi along a longest common subsequence; between
 * two aligned characters, an unmatched stretch of the SAME length on both sides is read as
 * substitutions, character by character (only Han characters count). A stretch of different
 * lengths (a missing or extra character) says nothing about which character was confused.
 * A pair is counted once per review and is unordered (买 → 卖 and 卖 → 买 both count for 买 ↔ 卖).
 */

export interface MixUpRow {
  hanzi: string;
  user_answer: string | null;
  reviewed_at: string;
  note_id?: string;
}

export interface MixUpExample {
  expected: string;
  answer: string;
  reviewed_at: string;
}

export interface MixUp {
  /** The two characters, in the order first seen as (expected, typed). */
  a: string;
  b: string;
  count: number;
  last_at: string;
  /** Words it happened in, newest first (max 3, one per word). */
  examples: MixUpExample[];
}

const HAN = /^[㐀-䶿一-鿿豈-﫿]$/u;
const STRIP = /[\s。，、！？．·….,!?;:；：“”‘’"'()（）【】[\]《》<>「」-]/gu;

function chars(s: string): string[] {
  return Array.from(s.replace(STRIP, ''));
}

/** Substituted (expected, typed) character pairs in one answer. */
export function substitutions(expected: string, answer: string): Array<[string, string]> {
  const e = chars(expected);
  const a = chars(answer);
  if (!e.length || !a.length) return [];
  const t: number[][] = Array.from({ length: e.length + 1 }, () => new Array<number>(a.length + 1).fill(0));
  for (let i = 1; i <= e.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      t[i][j] = e[i - 1] === a[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
    }
  }
  // Matched index pairs, in order.
  const matches: Array<[number, number]> = [];
  let i = e.length;
  let j = a.length;
  while (i > 0 && j > 0) {
    if (e[i - 1] === a[j - 1]) {
      matches.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (t[i - 1][j] >= t[i][j - 1]) i--;
    else j--;
  }
  const out: Array<[string, string]> = [];
  let pe = 0;
  let pa = 0;
  for (const [mi, mj] of [...matches, [e.length, a.length] as [number, number]]) {
    const ge = e.slice(pe, mi);
    const ga = a.slice(pa, mj);
    if (ge.length > 0 && ge.length === ga.length) {
      for (let k = 0; k < ge.length; k++) {
        if (HAN.test(ge[k]) && HAN.test(ga[k]) && ge[k] !== ga[k]) out.push([ge[k], ga[k]]);
      }
    }
    pe = mi + 1;
    pa = mj + 1;
  }
  return out;
}

export function deriveMixUps(rows: MixUpRow[], limit = 20): MixUp[] {
  const byKey = new Map<string, MixUp & { words: Set<string> }>();
  const newestFirst = [...rows].sort((x, y) => (x.reviewed_at < y.reviewed_at ? 1 : x.reviewed_at > y.reviewed_at ? -1 : 0));
  for (const r of newestFirst) {
    const answer = r.user_answer?.trim();
    if (!answer) continue;
    const seen = new Set<string>();
    for (const [exp, typed] of substitutions(r.hanzi, answer)) {
      const key = [exp, typed].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      let m = byKey.get(key);
      if (!m) {
        m = { a: exp, b: typed, count: 0, last_at: r.reviewed_at, examples: [], words: new Set() };
        byKey.set(key, m);
      }
      m.count++;
      if (!m.words.has(r.hanzi) && m.examples.length < 3) {
        m.words.add(r.hanzi);
        m.examples.push({ expected: r.hanzi, answer, reviewed_at: r.reviewed_at });
      }
    }
  }
  return [...byKey.values()]
    .map(({ words: _w, ...m }) => m)
    .sort((x, y) => y.count - x.count || (x.last_at < y.last_at ? 1 : x.last_at > y.last_at ? -1 : 0))
    .slice(0, limit);
}
