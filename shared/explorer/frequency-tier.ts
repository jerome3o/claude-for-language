/**
 * The frequency decal (docs/LANGUAGE_EXPLORER.md "Frequency decals"): a thin outline around a
 * word tile ("Words with 字", "Related words") or a character tile (the Word view's character
 * chips, "Built from" components, the Character view's glyph) saying at a glance how common it
 * is. The rank is the item's place in the shipped word-freq list (shared/decks/frequency.ts —
 * words for a word, characters for a character), looked up in the already-loaded index.
 *
 *   top 100  → purple · top 1,000 → green · top 2,000 → yellow · in between → no outline
 *   rare     → grey: not in the list, or ranked beyond RARE_WORD_RANK (words) /
 *              RARE_CHAR_RANK (characters)
 *
 * Pure; ported to the Lab app (core/…/explorer/FrequencyDecal.kt, parity-tested).
 */

export type FrequencyDecal = 'top100' | 'top1000' | 'top2000' | 'rare';

/** Words ranked beyond this are "rare" (grey). 2,001–10,000 get no outline. */
export const RARE_WORD_RANK = 10_000;
/**
 * Characters ranked beyond this are "rare": 3,500 is the size of the national list of
 * common characters (现代汉语常用字表), which covers ~99.5 % of modern text.
 */
export const RARE_CHAR_RANK = 3_500;

/**
 * The decal for a rank (1 = most frequent). `null` / `undefined` / < 1 / not finite = not in
 * the list → 'rare'. `kind` picks the rare cutoff. Returns null for the unmarked middle band
 * (2,001 … the cutoff).
 */
export function frequencyTier(rank: number | null | undefined, kind: 'word' | 'char' = 'word'): FrequencyDecal | null {
  if (rank == null || !Number.isFinite(rank) || rank < 1) return 'rare';
  if (rank <= 100) return 'top100';
  if (rank <= 1000) return 'top1000';
  if (rank <= 2000) return 'top2000';
  return rank > (kind === 'char' ? RARE_CHAR_RANK : RARE_WORD_RANK) ? 'rare' : null;
}

/** The legend behind the ⓘ next to a list header: one entry per decal, in order. */
export const FREQUENCY_DECAL_KEY: ReadonlyArray<{ tier: FrequencyDecal; colour: string; label: string }> = [
  { tier: 'top100', colour: 'purple', label: 'top 100' },
  { tier: 'top1000', colour: 'green', label: 'top 1,000' },
  { tier: 'top2000', colour: 'yellow', label: 'top 2,000' },
  { tier: 'rare', colour: 'grey', label: 'rare' },
];

/** "purple top 100 · green top 1,000 · yellow top 2,000 · grey rare" — the key as one line (screen readers). */
export function frequencyKeyLine(): string {
  return FREQUENCY_DECAL_KEY.map((k) => `${k.colour} ${k.label}`).join(' · ');
}
