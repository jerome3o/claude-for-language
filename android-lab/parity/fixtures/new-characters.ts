/**
 * "New characters shimmer" (shared/study/newCharacters.ts): the seen set, a card's never-seen
 * characters, the per-code-point mask and the screen-reader label over seeded random notes, with
 * some cards rated (their characters become seen for the next card).
 * Writes new-characters.json; core NewCharactersParityTest asserts NewCharacters.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  cardNewCharacters,
  markCharactersSeen,
  newCharacterMask,
  newCharactersIn,
  newCharactersLabel,
  seenCharactersOf,
} from '../../../shared/study/newCharacters';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: new-characters <out-dir>');
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(4242);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
// Han characters, plus punctuation, Latin, digits, a supplementary-plane and a compatibility character, 〇 / 々.
const POOL = [...'银行你好谢学生大子人吗们的是不了一个中国'];
const OTHER = ['。', '，', '！', '？', ' ', 'A', 'b', '3', '…', '“', '”', '𠮷', '豈', '〇', '々'];
function text(max: number): string {
  const n = Math.floor(r() * (max + 1));
  let s = '';
  for (let i = 0; i < n; i++) s += r() < 0.75 ? pick(POOL) : pick(OTHER);
  return s;
}

const cases = [] as unknown[];
for (let c = 0; c < 150; c++) {
  const reviewed = Array.from({ length: Math.floor(r() * 6) }, () => text(5));
  const seen = seenCharactersOf(reviewed);
  const initial = [...seen].sort();
  const cards = [] as unknown[];
  for (let k = 0; k < 4; k++) {
    const hanzi = text(8);
    const fresh = newCharactersIn(hanzi, seen);
    const rated = r() < 0.5;
    cards.push({
      hanzi, new: fresh, mask: newCharacterMask(hanzi, seen), label: newCharactersLabel(fresh), rated,
      // cardNewCharacters: in the session = new; outside it (pass / practice) or not loaded = none.
      session: cardNewCharacters(hanzi, seen, true),
      outside: cardNewCharacters(hanzi, seen, false),
      unloaded: cardNewCharacters(hanzi, null, true),
    });
    // Rating it makes its characters seen for the next card.
    if (rated) markCharactersSeen(seen, hanzi);
  }
  cases.push({ reviewed, seen: initial, cards });
}

writeFileSync(join(OUT, 'new-characters.json'), JSON.stringify({ cases }));
