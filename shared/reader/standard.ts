/**
 * How long a graded-reader page should be. One text, read by the story
 * generator, the reader co-editor chat and the MCP tools; a soft check
 * (`readerPageWarnings`) that generation repairs and the tools report.
 *
 * The yardstick is the reader Jerome liked: every page 1–3 short sentences,
 * 18–45 characters, one moment per picture. The daily generator had drifted
 * to 5–7 lines of dialogue per page.
 */
type DifficultyLevel = 'beginner' | 'elementary' | 'intermediate' | 'advanced';

export const READER_STANDARD = `Reader page standard
- A page is ONE picture and ONE moment: 1–2 sentences of Chinese (3 at the very most), about 15–45 characters. Split rather than pack — more short pages beat fewer long ones.
- Dialogue: at most one exchange (one line each) per page. A longer conversation spreads over several pages, each with its own picture.
- No line breaks inside a page; a page reads as one short paragraph.
- Beginner: 1–2 sentences, up to ~40 characters. Elementary: up to ~60. Intermediate / advanced may run longer, but still one moment per page.
- Every page keeps its own image_prompt (English, one scene, consistent characters, no text in the picture) so the picture matches the moment.`;

export const READER_STANDARD_SHORT =
  'Reader page standard: one picture, one moment — 1–2 sentences per page (3 at most, about 15–45 characters), at most one line of dialogue each way, no line breaks; split a long page into more pages rather than packing it.';

/** Character caps per level; a page over the cap, or with more than 3 sentences, gets a warning. */
const CHAR_CAP: Record<DifficultyLevel, number> = {
  beginner: 45,
  elementary: 60,
  intermediate: 90,
  advanced: 120,
};
const MAX_SENTENCES = 3;

/** Sentences in a Chinese page: terminal punctuation, counting a closing quote with it. */
export function countSentences(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const terminals = (t.match(/[。！？!?]+[”"』」]?/g) || []).length;
  // Text with no terminal punctuation at all is one sentence; a trailing
  // clause after the last terminal counts too.
  const tail = t.replace(/[\s”"』」]+$/, '');
  const endsWithTerminal = /[。！？!?][”"』」]?$/.test(tail);
  return Math.max(1, terminals + (endsWithTerminal ? 0 : 1));
}

/** Characters that count toward the page length: everything except whitespace and punctuation. */
function contentLength(text: string): number {
  return text.replace(/[\s。，、！？：；“”‘’"'（）()《》…—\-.,!?;:]/g, '').length;
}

export interface ReaderPageWarning {
  page: number;
  message: string;
}

/**
 * Pages longer than the standard allows (soft: the generator gets one repair
 * round, the tools and editor show it, nothing is refused).
 */
export function readerPageWarnings(spec: { difficulty_level?: string; pages?: Array<{ content_chinese?: string }> }): ReaderPageWarning[] {
  const level = (spec.difficulty_level as DifficultyLevel) || 'beginner';
  const cap = CHAR_CAP[level] ?? CHAR_CAP.beginner;
  const warnings: ReaderPageWarning[] = [];
  (spec.pages || []).forEach((page, i) => {
    const text = page.content_chinese || '';
    const sentences = countSentences(text);
    const length = contentLength(text);
    const lineBreaks = (text.trim().match(/\n/g) || []).length;
    const reasons: string[] = [];
    if (sentences > MAX_SENTENCES) reasons.push(`${sentences} sentences (aim for 1–2, at most ${MAX_SENTENCES})`);
    if (length > cap) reasons.push(`${length} characters (about ${cap} at most for ${level})`);
    if (lineBreaks > 0) reasons.push(`${lineBreaks} line break${lineBreaks === 1 ? '' : 's'} (a page is one short paragraph)`);
    if (reasons.length) {
      warnings.push({ page: i + 1, message: `Page ${i + 1} is too long: ${reasons.join(', ')} — split it into more pages, one moment each` });
    }
  });
  return warnings;
}
