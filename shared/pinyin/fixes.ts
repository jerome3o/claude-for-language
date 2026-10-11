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
   * change. `syllable_count`: one syllable was missing and was put back (only when that is clearly
   * safe: the gap fits one place and its character has one reading) — a line is never rebuilt.
   */
  reason: 'reading' | 'syllable_count';
  /** The words that changed; a syllable put back has `from: ''`. */
  words: PinyinWordFix[];
}

/**
 * A hanzi + pinyin pair left AS WRITTEN though something looks wrong — the syllables don't line up
 * with the characters and putting it right would mean guessing. Shown as "needs a look".
 */
export interface PinyinWarning {
  path: string;
  where: string;
  hanzi: string;
  pinyin: string;
  /** What looks wrong ("one syllable missing for 得 in “说得真好” (shuō zhēn hǎo) — left as written"). */
  detail: string;
}

/** "扶梯: fúqī → fútī" — the changed words, else the whole line. */
export function pinyinFixSummary(fix: PinyinFix): string {
  if (fix.words.length) return fix.words.map((w) => (w.from ? `${w.hanzi}: ${w.from} → ${w.to}` : `${w.hanzi}: missing → ${w.to}`)).join('; ');
  return `${fix.hanzi}: ${fix.before} → ${fix.after}`;
}

/** One line per fix, for a tool reply ("" when nothing changed). */
export function pinyinFixesText(fixes: readonly PinyinFix[] | undefined, max = 20): string {
  if (!fixes?.length) return '';
  const lines = fixes.slice(0, max).map((f) => `- ${pinyinFixSummary(f)} (${f.where})`);
  if (fixes.length > max) lines.push(`- …and ${fixes.length - max} more`);
  return `Pinyin corrected automatically (only syllables their character can't have; a reading the character really has is never changed):\n${lines.join('\n')}`;
}

/** One line per warning ("" when none). */
export function pinyinWarningsText(warnings: readonly PinyinWarning[] | undefined, max = 20): string {
  if (!warnings?.length) return '';
  const lines = warnings.slice(0, max).map((w) => `- ${w.where}: ${w.hanzi}\n    ${w.pinyin}\n    ${w.detail}`);
  if (warnings.length > max) lines.push(`- …and ${warnings.length - max} more`);
  return `Needs a look (not changed):\n${lines.join('\n')}`;
}
