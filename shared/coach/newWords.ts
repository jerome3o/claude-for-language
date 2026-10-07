/**
 * The Sentence Coach's "➕ Add new words (N)" chip (docs/CHAT.md "Chat ↔ Coach"):
 * which words of the sentence are NOT in any of the learner's decks yet, and the
 * cards the picker adds for the ones he ticks. Pure; the web page
 * (pages/SentenceCoachPage.tsx) and the Lab app (core CoachNewWords.kt,
 * parity-tested through parity/fixtures/coach.ts) both call it with the
 * sentence's word breakdown and the hanzi of their local notes.
 *
 * Rules:
 *   - a word counts when it has a Han character; it is matched like the bump
 *     picker (normalizeHanzi: spaces / punctuation ignored) against every note;
 *   - grammatical particles (的 了 吗 …) are never offered on their own;
 *   - one row per spelling, in sentence order, at most MAX_COACH_NEW_WORDS;
 *   - the picker starts with NOTHING ticked (like the bump picker, #525): one
 *     tap never adds a pile of cards.
 */

import { normalizeHanzi } from '../import/parse';

export const MAX_COACH_NEW_WORDS = 20;

/** Particles / interjections never offered as a card of their own. */
export const COACH_SKIP_WORDS: ReadonlySet<string> = new Set([
  '的', '了', '吗', '呢', '吧', '啊', '呀', '啦', '嘛', '着', '过', '地', '得', '嗯', '哦', '哈',
]);

export interface CoachWord {
  hanzi: string;
  pinyin: string;
  gloss: string;
}

const HAN = /[\p{Script=Han}〇]/u;

/** The words of the sentence that are new to the learner (not in any deck), in sentence order. */
export function newWordsInSentence(
  words: ReadonlyArray<CoachWord>,
  noteHanzi: Iterable<string>,
  max = MAX_COACH_NEW_WORDS,
): CoachWord[] {
  const known = new Set<string>();
  for (const h of noteHanzi) {
    const k = normalizeHanzi(h ?? '');
    if (k) known.add(k);
  }
  const seen = new Set<string>();
  const out: CoachWord[] = [];
  for (const w of words) {
    const key = normalizeHanzi(w.hanzi ?? '');
    if (!key || !HAN.test(key) || COACH_SKIP_WORDS.has(key) || known.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ hanzi: key, pinyin: (w.pinyin ?? '').trim(), gloss: (w.gloss ?? '').trim() });
    if (out.length >= max) break;
  }
  return out;
}

export const COACH_NEW_WORDS_LABEL = (n: number) => `➕ Add new words (${n})`;
export const COACH_SENTENCE_CARD_LABEL = '🃏 Card for this sentence';

/** The picker's primary button. */
export function addNewWordsButton(ticked: number): string {
  if (ticked <= 0) return 'Tick the words to add';
  return ticked === 1 ? '➕ Add 1 word' : `➕ Add ${ticked} words`;
}

export interface CoachWordCard {
  hanzi: string;
  pinyin: string;
  english: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
}

/**
 * The card drafts for the ticked words: hanzi / pinyin / the gloss as the
 * meaning, and the sentence they came from as the example (only when it
 * contains the word exactly and is more than the word). fun_facts (and a
 * shorter example) are written afterwards by the enrich path.
 */
export function newWordCards(
  words: ReadonlyArray<CoachWord>,
  sentence: { hanzi: string; pinyin?: string | null; translation?: string | null },
): CoachWordCard[] {
  const s = (sentence.hanzi ?? '').trim();
  return words
    .filter((w) => w.hanzi.trim())
    .map((w) => {
      const card: CoachWordCard = { hanzi: w.hanzi.trim(), pinyin: w.pinyin.trim(), english: w.gloss.trim() };
      if (s && s !== card.hanzi && s.includes(card.hanzi)) {
        card.sentence_clue = s;
        if (sentence.pinyin?.trim()) card.sentence_clue_pinyin = sentence.pinyin.trim();
        if (sentence.translation?.trim()) card.sentence_clue_translation = sentence.translation.trim();
      }
      return card;
    });
}
