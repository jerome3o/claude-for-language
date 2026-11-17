/**
 * The card's own example sentence as one of the note's rows (shared/study/cardSentence.ts, migration 0154):
 * ids and keys (legacy `clue` / `clue:<note>` folded into `<note>-card`), and `withCardSentence` over seeded
 * notes — no note, a removed card sentence, the note's text equal to / newer than the stored card row, set rows
 * repeating it, rows in any order. Writes card-sentence.json; core CardSentenceParityTest asserts CardSentence.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalSentenceKey,
  cardSentenceId,
  isCardSentenceKey,
  withCardSentence,
  type NoteCardSentenceFields,
  type SentenceRowLike,
} from '../../../shared/study/cardSentence';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: card-sentence <out-dir>');
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
const r = rng(152);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const TEXTS = ['我去银行。', ' 我去银行。 ', '银行在哪儿？', '这是银行。', '他在银行工作。', '  ', ''];
const MAYBE = [null, '', '  ', 'Wǒ qù yínháng.', 'I go to the bank.', 'generated/c.mp3'];

const cases = [] as unknown[];
for (let c = 0; c < 300; c++) {
  const noteId = `n${c}`;
  const rows: SentenceRowLike[] = Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({
    id: `s${c}-${i}`, note_id: noteId, position: Math.floor(r() * 6), hanzi: pick(TEXTS.slice(0, 5)),
    pinyin: pick(MAYBE), translation: pick(MAYBE), audio_url: pick(MAYBE), focus: pick(['core', 'contrast', null]),
    focus_note: null, explanation: r() < 0.3 ? '{}' : null, is_card: 0,
  }));
  if (r() < 0.5) {
    rows.splice(Math.floor(r() * (rows.length + 1)), 0, {
      id: cardSentenceId(noteId), note_id: noteId, position: -1, hanzi: pick(TEXTS.slice(0, 5)),
      pinyin: pick(MAYBE), translation: pick(MAYBE), audio_url: pick(MAYBE), focus: null, focus_note: null,
      explanation: r() < 0.5 ? '{"words":[]}' : null, is_card: r() < 0.8 ? 1 : 0,
    });
  }
  const note: NoteCardSentenceFields | null = r() < 0.15 ? null : {
    id: noteId,
    sentence_clue: pick(TEXTS),
    sentence_clue_pinyin: pick(MAYBE),
    sentence_clue_translation: pick(MAYBE),
    sentence_clue_audio_url: pick(MAYBE),
  };
  cases.push({ note, rows, out: withCardSentence(note, rows) });
}

const keys = ['clue', 'clue:n1', 'clue:', 'n1-card', 's1', '-card', 'card'].map((key) => ({
  key, card: isCardSentenceKey(key), canonical: canonicalSentenceKey(key, 'n9'),
}));

writeFileSync(join(OUT, 'card-sentence.json'), JSON.stringify({ cases, keys, id: cardSentenceId('abc') }));
