/**
 * "Everyday words before formal ones" (Settings → New cards, new-card-order.ts `everyday_first`):
 * how formal a note's word is, in three classes — everyday < neutral < formal. Inside each tier
 * of "Order new cards by" (and inside a deck in the fallback) the everyday words come before the
 * neutral ones and the formal ones last, BEFORE "Most common first" ranks them: the frequency
 * list counts mostly written text, so it ranks 告知 / 购置 above 搞定 / 买单.
 *
 * Where the class comes from (the same two sources as the word-tag pills, word-tags.ts and
 * word-tags-ai.ts, and the same rule for a conflict: the lexicon wins):
 *  1. the shipped lexicon's register codes (CC-CEDICT labels + the curated lists):
 *     Formal (F) or Literary (L) → formal; Rude (R) or Derogatory (D) → neutral (never pushed
 *     forward); Colloquial (C), Informal (I) or Slang (S) → everyday. Other codes (Polite,
 *     Dated, Regional…) say nothing about it → the AI verdict decides.
 *  2. the note's AI word tags (`notes.word_tags`): its register only when the lexicon has no
 *     register code at all (as wordTagsWithAi) and the verdict isn't low-confidence —
 *     formal / literary → formal, rude → neutral; then "Everyday speech" (`spoken: 'everyday'`
 *     at HIGH spoken_confidence, isEverydaySpeech) → everyday; then informal / slang → everyday.
 *  3. anything else → neutral.
 * Only WORD notes (progress/known.ts `noteKind`: 1–4 Han characters, no sentence punctuation)
 * get a class; sentences and longer phrases are always neutral (kept simple: a sentence's
 * register words don't move it). No lexicon loaded → every note neutral (the plain order).
 *
 * Pure; ported to the Lab app (core/…/Formality.kt) and parity-tested over the SHIPPED lexicon
 * (android-lab/parity/fixtures/new-card-order.ts).
 */
import { noteKind } from '../progress/known';
import { wordTagKey, type WordTagLexicon } from '../cards/word-tags';
import { isEverydaySpeech, parseAiWordTags, visibleAiWordTags, type AiWordTags } from '../cards/word-tags-ai';

export type Formality = 0 | 1 | 2;
export const FORMALITY_EVERYDAY: Formality = 0;
export const FORMALITY_NEUTRAL: Formality = 1;
export const FORMALITY_FORMAL: Formality = 2;

const LEXICON_FORMAL = new Set(['F', 'L']);
const LEXICON_NEVER_FORWARD = new Set(['R', 'D']);
const LEXICON_EVERYDAY = new Set(['C', 'I', 'S']);

/** The lexicon's verdict from a word's register codes; null = it says nothing about formality. */
export function lexiconFormality(codes: readonly string[]): Formality | null {
  if (codes.some(c => LEXICON_FORMAL.has(c))) return FORMALITY_FORMAL;
  if (codes.some(c => LEXICON_NEVER_FORWARD.has(c))) return FORMALITY_NEUTRAL;
  if (codes.some(c => LEXICON_EVERYDAY.has(c))) return FORMALITY_EVERYDAY;
  return null;
}

/** The class of a note's hanzi (rules in the file header). */
export function noteFormality(hanzi: string, lexicon: WordTagLexicon | null | undefined, ai: AiWordTags | null | undefined): Formality {
  if (!lexicon || noteKind(hanzi) !== 'word') return FORMALITY_NEUTRAL;
  const codes = lexicon.words.get(wordTagKey(hanzi))?.register ?? [];
  const fromLexicon = lexiconFormality(codes);
  if (fromLexicon !== null) return fromLexicon;
  const visible = codes.length === 0 ? visibleAiWordTags(ai) : null;
  const register = visible?.register;
  if (register === 'formal' || register === 'literary') return FORMALITY_FORMAL;
  if (register === 'rude') return FORMALITY_NEUTRAL;
  if (isEverydaySpeech(ai)) return FORMALITY_EVERYDAY;
  if (register === 'informal' || register === 'slang') return FORMALITY_EVERYDAY;
  return FORMALITY_NEUTRAL;
}

export interface FormalityNote {
  id: string;
  hanzi: string | null | undefined;
  /** `notes.word_tags` as stored (JSON text) or parsed; null = not tagged. */
  word_tags?: unknown;
}

/**
 * note id → class for the queue (study-queue.ts `QueueNoteText.formality`), built once per
 * queue build. Only notes that aren't neutral are listed (missing = neutral). Empty without a lexicon.
 */
export function noteFormalityMap(notes: Iterable<FormalityNote>, lexicon: WordTagLexicon | null | undefined): Map<string, Formality> {
  const out = new Map<string, Formality>();
  if (!lexicon) return out;
  for (const n of notes) {
    const hanzi = n.hanzi ?? '';
    if (noteKind(hanzi) !== 'word') continue;
    // The AI verdict is parsed only when the lexicon says nothing (most words of a big account).
    const fromLexicon = lexiconFormality(lexicon.words.get(wordTagKey(hanzi))?.register ?? []);
    const f = fromLexicon ?? (n.word_tags ? noteFormality(hanzi, lexicon, parseAiWordTags(n.word_tags)) : FORMALITY_NEUTRAL);
    if (f !== FORMALITY_NEUTRAL) out.set(n.id, f);
  }
  return out;
}
