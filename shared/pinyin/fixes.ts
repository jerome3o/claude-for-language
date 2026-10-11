/**
 * The pinyin check on authored content (worker/src/services/pinyin-check.ts): what one fix looks
 * like and how it is said. Shared so the API replies, the scan endpoint and the MCP tools describe a
 * fix the same way.
 */

/** One word whose pinyin was replaced. */
export interface PinyinWordFix {
  hanzi: string;
  from: string;
  to: string;
}

/** One hanzi + pinyin pair of a spec whose pinyin was corrected. */
export interface PinyinFix {
  /** Where in the spec, as a JSON path ("sections[0].exercises[2].lines[1].pinyin"). */
  path: string;
  /** The same place in words ("section 1 · exercise 3 (conversation) · line 2"). */
  where: string;
  /** The Chinese of that pair, as written. */
  hanzi: string;
  before: string;
  after: string;
  /**
   * `reading`: a syllable no reading of its character allows (扶梯 fúqī → fútī) — only those syllables
   * change. `syllable_count`: the pinyin couldn't be lined up with the characters at all (a syllable
   * missing or extra), so the whole line was rebuilt from the dictionary.
   */
  reason: 'reading' | 'syllable_count';
  /** The words that changed (reason `reading`). */
  words: PinyinWordFix[];
}

/** "扶梯: fúqī → fútī" — the changed words, else the whole line. */
export function pinyinFixSummary(fix: PinyinFix): string {
  if (fix.reason === 'reading' && fix.words.length) return fix.words.map((w) => `${w.hanzi}: ${w.from} → ${w.to}`).join('; ');
  return `${fix.hanzi}: ${fix.before} → ${fix.after}`;
}

/** One line per fix, for a tool reply ("" when nothing changed). */
export function pinyinFixesText(fixes: readonly PinyinFix[] | undefined, max = 20): string {
  if (!fixes?.length) return '';
  const lines = fixes.slice(0, max).map((f) => `- ${pinyinFixSummary(f)} (${f.where})`);
  if (fixes.length > max) lines.push(`- …and ${fixes.length - max} more`);
  return `Pinyin corrected automatically (a syllable its character can't have, or syllables that didn't line up with the characters):\n${lines.join('\n')}`;
}
