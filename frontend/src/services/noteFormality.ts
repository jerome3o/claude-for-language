/**
 * "Everyday words before formal ones" (Settings → New cards; shared/decks/formality.ts): each
 * note's class for the study queue, from the shipped word-tag lexicon (services/wordTags.ts, a
 * precached chunk — offline) and the note's AI word tags (`notes.word_tags`, synced). Built for
 * every queue build, so it is memoised per note (hanzi + tags unchanged = the same class).
 * No lexicon (not loaded / failed) → an empty map: every note neutral, the plain order.
 */
import { FORMALITY_NEUTRAL, noteFormalityMap, type Formality } from '@shared/decks';
import type { WordTagLexicon } from '@shared/cards/word-tags';

interface Memo { hanzi: string; tags: unknown; f: Formality }

let memoLexicon: WordTagLexicon | null = null;
const memo = new Map<string, Memo>();

export function noteFormalities(
  notes: Iterable<{ id: string; hanzi?: string | null; word_tags?: string | null }>,
  lexicon: WordTagLexicon | null,
): Map<string, Formality> {
  const out = new Map<string, Formality>();
  if (!lexicon) return out;
  if (memoLexicon !== lexicon) { memo.clear(); memoLexicon = lexicon; }
  for (const n of notes) {
    const hanzi = n.hanzi ?? '';
    const tags = n.word_tags ?? null;
    let m = memo.get(n.id);
    if (!m || m.hanzi !== hanzi || m.tags !== tags) {
      const f = noteFormalityMap([{ id: n.id, hanzi, word_tags: tags }], lexicon).get(n.id) ?? FORMALITY_NEUTRAL;
      m = { hanzi, tags, f };
      memo.set(n.id, m);
    }
    if (m.f !== FORMALITY_NEUTRAL) out.set(n.id, m.f);
  }
  return out;
}
