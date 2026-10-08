/**
 * The fixed lines of a sleep lesson's word block, in a few plain wordings each
 * (docs/AUDIO_LESSONS.md "Variation"). Jerome hears them every word; the same sentence
 * every time sounds like a machine. Each pool holds 4–6 equivalent, simple (HSK 1–3)
 * phrasings a calm Mandarin teacher would use — written by hand here, never by the model.
 *
 * Which wording a word gets is deterministic (`pickVariant`): a seed from the lesson and the
 * word's index, so a plan always compiles to the same script, and two consecutive word
 * blocks never use the same wording of a line. Variant 0 of each pool is the original line.
 */

/** "这是一个新词。" + "我说三遍。" — the start of every word block (said as two phrases). */
export const NEW_WORD_INTROS: ReadonlyArray<readonly [string, string]> = [
  ['这是一个新词。', '我说三遍。'],
  ['我们来学一个新词。', '我念三遍。'],
  ['下面是一个新词。', '请听三遍。'],
  ['现在，我们学一个新词。', '你听三遍。'],
  ['这是一个新的词。', '我们听三遍。'],
];

/** Before the example sentences. */
export const SENTENCES_INTROS: readonly string[] = ['我们听三个句子。', '我们来听三个句子。', '现在听三个句子。', '下面，我们听三个句子。', '听一听这三个句子。'];

/** A character's tone line: `{x}` = the character (or "银行的行"), `{tone}` = 第三声. */
export const TONE_LINES: readonly string[] = ['{x}，{tone}。', '{x}，是{tone}。', '{x}，读{tone}。', '{x}，它是{tone}。'];

/** Where the word says a character with another tone: `{w}` the word, `{c}` the character (with 第二个 when repeated), `{tone}`. */
export const TONE_CHANGE_LINES: readonly string[] = ['在‘{w}’里，{c}读{tone}。', '‘{w}’里的{c}，读{tone}。', '在‘{w}’这个词里，{c}读{tone}。', '说‘{w}’的时候，{c}读{tone}。'];

/** A character the learner has never met: `{c}` = the character. */
export const NEW_CHARACTER_LINES: readonly string[] = [
  '‘{c}’是一个新字，你以前没见过。',
  '‘{c}’是一个新字，你还没见过。',
  '‘{c}’这个字，你以前没见过。',
  '‘{c}’是新字，你以前没学过。',
  '这个‘{c}’字是新的，你还没见过。',
];

/** The English recap's opening (before "<the word>: <recap_en>"). */
export const RECAP_OPENINGS: readonly string[] = ['The word was', 'That word was', 'Our new word was', 'The new word was'];

/** Every Chinese pool, for checks. */
export const SLEEP_PHRASE_POOLS: Record<string, readonly string[]> = {
  newWord: NEW_WORD_INTROS.map((p) => p[0]),
  sayThree: NEW_WORD_INTROS.map((p) => p[1]),
  sentences: SENTENCES_INTROS,
  toneLine: TONE_LINES,
  toneChange: TONE_CHANGE_LINES,
  newCharacter: NEW_CHARACTER_LINES,
};

/** FNV-1a, 32 bit. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Which variant (0 … n−1) slot `index` of a lesson uses for a pool. Without a seed: 0 (the
 * original line). With one: an offset and a step from the seed + the pool's name; the step is
 * never a multiple of n, so slots i and i + 1 always differ.
 */
export function variantIndex(n: number, seed: string | undefined, pool: string, index: number): number {
  if (n <= 1 || seed === undefined) return 0;
  const h = hash(`${seed}\u0000${pool}`);
  const offset = h % n;
  const step = 1 + ((h >>> 8) % (n - 1));
  return (offset + Math.max(0, index) * step) % n;
}

export function pickVariant<T>(list: readonly T[], seed: string | undefined, pool: string, index: number): T {
  return list[variantIndex(list.length, seed, pool, index)];
}

export function fillPhrase(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
}
