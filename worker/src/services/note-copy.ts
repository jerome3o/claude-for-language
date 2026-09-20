/**
 * Everything a copied note carries over to the student's deck: the word, its
 * audio (the same R2 clip is shared), fun facts, the example sentence with its
 * pinyin / translation / clip, alternative answers and multiple-choice options.
 * Missing columns on an older row become NULL.
 */
export function noteCopyValues(
  newNoteId: string,
  targetDeckId: string,
  note: Record<string, unknown>
): (string | number | null)[] {
  const v = (key: string) => {
    const x = note[key];
    return x === undefined ? null : (x as string | number | null);
  };
  return [
    newNoteId,
    targetDeckId,
    v('hanzi'),
    v('pinyin'),
    v('english'),
    v('audio_url'),
    v('audio_provider'),
    v('fun_facts'),
    v('context'),
    v('sentence_clue'),
    v('sentence_clue_pinyin'),
    v('sentence_clue_translation'),
    v('sentence_clue_audio_url'),
    v('sentence_clue_audio_provider'),
    v('alternatives'),
    v('multiple_choice_options'),
    note['pinyin_only'] === undefined || note['pinyin_only'] === null ? 0 : (note['pinyin_only'] as number),
  ];
}
