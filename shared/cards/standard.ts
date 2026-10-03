/**
 * The house style for a flashcard — written once, read by every Claude that
 * makes cards (the app's Generate / Ask Claude / coach prompts, the tutor's
 * MCP tools via the server instructions and tool descriptions) and enforced,
 * where a rule is machine-checkable, by the worker's content service.
 *
 * Why it exists: cards written by different Claudes drifted — slashes and
 * parentheses on the card (which TTS reads aloud and pauses at), placeholders
 * instead of real words, fun facts that were trivia instead of an explanation.
 */

export const CARD_STANDARD = `# Card standard

Every card follows these rules whoever writes it. The server refuses a card that breaks a HARD rule and says why.

hanzi — ONE clean form
- The card shows exactly one way of saying it, in simplified characters, and nothing else.
- HARD: no slashes, parentheses, brackets, pipes, ellipses or blanks in hanzi: never 你好/您好, (请)坐, 我…了, ___. TTS reads every symbol aloud and pauses at it.
- A word or phrase carries no punctuation. A full sentence may end with 。？！ and use ，、 inside.
- Alternatives, optional characters, formal / informal variants and traditional forms are explained in fun_facts ("Also 您好 (formal)"; "坐 alone is fine — 请 makes it polite"), never squeezed onto the card. Other accepted typed answers can go in the alternatives field.
- No placeholders (…, X, 某, "sb", "sth"): fill the slot with a real word so the card is a real sentence, and describe the pattern in fun_facts.

pinyin — tone marks (nǐ hǎo), never tone numbers; spaces between words, not syllables (zhège, xǐshǒujiān).
- 一 and 不 carry their tone changes: 一 is yī alone, at the end of a word, as a number, ordinal or in dates (第一 dì yī, 十一, 一月一日); yí before a 4th tone (一个 yí gè, 一样 yíyàng), yì before a 1st / 2nd / 3rd tone (一天 yì tiān, 一年 yì nián, 一起 yìqǐ); neutral yi in reduplicated verbs (看一看 kàn yi kàn). 不 is bú before a 4th tone (不是 búshì, 不对 bú duì), otherwise bù (不好 bù hǎo); neutral bu in A不A questions (要不要 yào bu yào).
- No other tone changes: third tones stay as written (nǐ hǎo, not ní hǎo).
- A character with several readings takes the one this word uses (银行 yínháng, 长大 zhǎngdà, 觉得 juéde).

english — one clear meaning, the one this card teaches. Further senses go in fun_facts after "Also:", not as a slash list in the field.

fun_facts — the explanation (plain text, 3–6 short lines, no trivia)
- For a sentence or multi-word phrase: gloss each word in order — 汉字 (pīnyīn) meaning — then the structure in one line.
- For a single word, character or short saying: explain each character (what it means, how they combine), then how the word is used.
- Then what helps most: the common mistake, the contrast with a look-alike or homophone, register, and the alternatives that were kept off the card.

sentence_clue — one short natural sentence containing the word exactly as written; prefer a single clause (a Chinese comma is fine where the language wants one). HARD: no brackets, slashes, ellipses or blanks. Give sentence_clue_pinyin and sentence_clue_translation with it.`;

/** One paragraph for tool descriptions and short prompts. */
export const CARD_STANDARD_SHORT =
  'Card standard: hanzi is ONE clean form — no slashes, parentheses, brackets, ellipses or blanks (put alternatives and optional characters in fun_facts; the server rejects them); pinyin with tone marks, spaces between words, 一/不 tone changes written (yí gè, bú shì) but no third-tone sandhi; english = one clear meaning; fun_facts explains every word of a sentence (汉字 (pīnyīn) meaning) or every character of a word, then usage / common mistake / contrast; sentence_clue is one short real sentence containing the word, no brackets or slashes.';

export interface CardProblem {
  field: 'hanzi' | 'pinyin' | 'english' | 'sentence_clue';
  message: string;
}

export interface CardTextFields {
  hanzi?: string | null;
  pinyin?: string | null;
  english?: string | null;
  sentence_clue?: string | null;
}

/** Symbols that never belong on the card itself (TTS reads them aloud). */
const FORBIDDEN_ON_CARD = /[\/\\|()\[\]{}（）【】〔〕<>~*=+#@&^`"'_]/;
const ELLIPSIS = /…|\.\.\.|。。。/;
const TONE_NUMBER = /[a-zü]+[1-5](?=\s|$)/i;

function describeSymbol(text: string): string {
  const m = text.match(FORBIDDEN_ON_CARD);
  return m ? `"${m[0]}"` : 'an ellipsis';
}

/**
 * The HARD rules of the card standard, as a list of problems (empty = fine).
 * Only fields that are present are checked, so it works for edits too.
 */
export function cardTextProblems(fields: CardTextFields): CardProblem[] {
  const problems: CardProblem[] = [];
  const hanzi = fields.hanzi ?? undefined;
  if (hanzi !== undefined) {
    if (FORBIDDEN_ON_CARD.test(hanzi) || ELLIPSIS.test(hanzi)) {
      problems.push({
        field: 'hanzi',
        message: `hanzi "${hanzi}" contains ${describeSymbol(hanzi)}: the card shows ONE clean form — move alternatives, optional characters or the pattern to fun_facts`,
      });
    }
  }
  const pinyin = fields.pinyin ?? undefined;
  if (pinyin !== undefined && TONE_NUMBER.test(pinyin)) {
    problems.push({ field: 'pinyin', message: `pinyin "${pinyin}" uses tone numbers — use tone marks (nǐ hǎo)` });
  }
  const clue = fields.sentence_clue ?? undefined;
  if (clue !== undefined && clue !== '') {
    if (FORBIDDEN_ON_CARD.test(clue) || ELLIPSIS.test(clue)) {
      problems.push({
        field: 'sentence_clue',
        message: `sentence_clue "${clue}" contains ${describeSymbol(clue)}: write one real sentence with no brackets, slashes or blanks`,
      });
    }
  }
  return problems;
}
