/**
 * The character sheet's "Words with 字" golden vectors, from the web app's own TypeScript
 * (shared/chars/status.ts): each word's status (known / in_decks / none), the learner's
 * note ids with that spelling, the card-on-screen highlight and order, and the summary
 * line — over hand-picked cases and seeded random notes / cards (punctuation, the same word
 * in two decks, mature / familiar / relearning cards, cards of unrelated notes).
 * Writes char-words.json; core CharWordsParityTest asserts CharWords.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { charWordRows, charWordsSummary, wordInCard, CHAR_STATUS_LABEL } from '../../../shared/chars/status';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: char-words <out-dir>');
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
const rand = rng(20261004);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const WORDS = ['银行', '进行', '行业', '银行卡', '行为', '不行', '自行车', '一行', '行', '流行', '旅行', '执行'];
const DECOR = ['', '', '', '。', ' ', '！', '“'];

type W = { hanzi: string; pinyin: string; english: string };
type N = { id: string; hanzi: string };
type C = { note_id: string; queue: number; stability: number };
const w = (hanzi: string): W => ({ hanzi, pinyin: '', english: '' });

const cases: Array<{ words: W[]; notes: N[]; cards: C[]; card_hanzi: string | null }> = [
  {
    words: ['进行', '银行', '行业', '银行卡'].map(w),
    notes: [{ id: 'n1', hanzi: '进行' }, { id: 'n2', hanzi: '银行。' }, { id: 'n3', hanzi: '银行' }, { id: 'n4', hanzi: '咖啡' }],
    cards: [
      { note_id: 'n1', queue: 2, stability: 30 },
      { note_id: 'n2', queue: 2, stability: 10 },
      { note_id: 'n3', queue: 0, stability: 0 },
      { note_id: 'n4', queue: 2, stability: 99 },
    ],
    card_hanzi: '我去银行',
  },
  { words: [w('进行')], notes: [{ id: 'a', hanzi: '进行' }], cards: [{ note_id: 'a', queue: 2, stability: 21 }, { note_id: 'a', queue: 3, stability: 50 }], card_hanzi: null },
  { words: [w('银行'), w('银行')], notes: [], cards: [], card_hanzi: '银行卡' },
  { words: [], notes: [{ id: 'x', hanzi: '行' }], cards: [], card_hanzi: '行' },
];
for (let i = 0; i < 300; i++) {
  const words = Array.from({ length: int(0, 10) }, () => w(pick(WORDS)));
  const notes: N[] = Array.from({ length: int(0, 10) }, (_, j) => ({ id: `r${i}-${j}`, hanzi: pick(DECOR) + pick(WORDS) + pick(DECOR) }));
  const cards: C[] = [];
  for (const n of notes) {
    for (let k = int(0, 3); k > 0; k--) {
      cards.push({ note_id: rand() < 0.1 ? `ghost-${i}` : n.id, queue: int(0, 3), stability: pick([0, 3, 7, 7.5, 21, 21.01, 40]) });
    }
  }
  cases.push({ words, notes, cards, card_hanzi: rand() < 0.7 ? pick(DECOR) + pick(WORDS) + pick(['', '很好', '吗']) : null });
}

const out = cases.map((c) => {
  const rows = charWordRows(c.words, c.notes, c.cards, c.card_hanzi);
  return {
    ...c,
    rows: rows.map((r) => ({ hanzi: r.word.hanzi, status: r.status, note_ids: r.note_ids, current: r.current })),
    summary: charWordsSummary(rows),
  };
});
const inCard = [['银行', '我去银行'], ['银行卡', '银行'], ['', '银行'], ['银行', null], ['行', '“行！”']].map(([word, card]) => ({ word, card, result: wordInCard(word as string, card) }));

writeFileSync(join(OUT, 'char-words.json'), JSON.stringify({ cases: out, in_card: inCard, labels: CHAR_STATUS_LABEL }));
console.log(`char-words: ${out.length} cases`);
