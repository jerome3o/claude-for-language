/**
 * Tab-complete on the call's text board (shared/calls/gloss.ts decides when and how it looks):
 * - Chinese the typist just wrote → { pinyin, english }, offered as ` - pīnyīn - meaning`;
 * - English (a word or short phrase) → { chinese, pinyin }, offered as ` - 中文 - pīnyīn`.
 *
 * The pinyin is what people rely on, and Haiku often got it wrong (Jerome and his tutor, Oct
 * 2026), so this is Sonnet now: one forced tool call with thinking off, a small max_tokens, an 8 s
 * timeout and a single retry (on Haiku — an answer beats none). Its pinyin then goes through
 * checkGlossPinyin (gloss-pinyin.ts): a syllable the character never has is replaced with the
 * dictionary's reading of that word, and the 一 / 不 rule is applied. Results are cached per
 * rules version + direction + text in this isolate (a lesson repeats words), and each user is
 * rate-limited here too, so a stuck client can't run up a bill.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  cleanChineseGloss,
  cleanGloss,
  glossCacheKey,
  glossStoreKey,
  isHanChar,
  isLatinLetter,
  GLOSS_MAX_EN_CHARS,
  GLOSS_MAX_SEGMENT,
  GLOSS_MIN_EN_LETTERS,
  type ChineseGloss,
  type Gloss,
  type GlossDirection,
} from '@shared/calls';
import { YI_BU_CONVENTION } from '@shared/pinyin/toneChange';
import { structuredCall } from '../structured-call';
import { checkGlossPinyin, type GlossReadingSources } from './gloss-pinyin';

/** Better pinyin than Haiku for a second or so more; the ghost shows after a pause anyway. */
export const BOARD_GLOSS_MODEL = 'claude-sonnet-5';
/** The retry's model: quick, and its pinyin is checked like any other. */
export const BOARD_GLOSS_FALLBACK_MODEL = 'claude-haiku-4-5';
export const BOARD_GLOSS_TIMEOUT_MS = 8_000;
/** A 40-character sentence's pinyin + its whole translation fit with room to spare (200 cut long ones off). */
export const BOARD_GLOSS_MAX_TOKENS = 500;
/** Requests per user per minute (a pause after typing → one request; 30/min is far above real use). */
export const BOARD_GLOSS_RATE_PER_MIN = 30;
const CACHE_SIZE = 2_000;

const PINYIN_RULES = `PINYIN — this is what the learner relies on, get every syllable right:
- Hanyu Pinyin with TONE MARKS on the right vowel (nǐ hǎo, lǜ, xué), never tone numbers. No characters.
- Exactly one syllable per Chinese character, in order: never leave one out or add one (a word + 儿 may be one syllable: nǎr, yìdiǎnr).
- Spaces between WORDS, the syllables of one word joined: wǒ xiǎng hē kāfēi, zhège, xǐshǒujiān, yínháng.
- The reading THIS context uses for a character with several readings. Decide each one from the word it is in:
  长 cháng "long" / zhǎng "grow, head" (长大 zhǎngdà, 校长 xiàozhǎng); 行 xíng "go, OK" (不行 bù xíng, 自行车 zìxíngchē) / háng "row, trade" (银行 yínháng, 行业 hángyè);
  得 de after a verb (跑得快 pǎo de kuài, 觉得 juéde) / dé "obtain" (得到 dédào) / děi "must" (我得走了 wǒ děi zǒu le);
  了 le particle / liǎo (了解 liǎojiě, 受不了 shòu bu liǎo); 还 hái "still, also" / huán "give back" (还书 huán shū); 都 dōu "all" / dū (首都 shǒudū);
  觉 jué (觉得 juéde) / jiào (睡觉 shuìjiào); 地 de after an adverb (慢慢地 mànmàn de) / dì (地方 dìfang); 着 zhe / zháo (睡着 shuìzháo) / zhuó;
  好 hǎo / hào (爱好 àihào); 便 biàn / pián (便宜 piányi); 重 zhòng / chóng (重新 chóngxīn); 乐 lè / yuè (音乐 yīnyuè); 为 wèi / wéi (认为 rènwéi);
  发 fā / fà (头发 tóufa); 和 hé / huo (暖和 nuǎnhuo); 少 shǎo / shào; 差 chà / chā / chāi; 教 jiāo / jiào (教室 jiàoshì); 看 kàn / kān; 只 zhǐ / zhī (一只猫 yì zhī māo); 数 shù / shǔ; 种 zhǒng / zhòng.
- Neutral tones written with NO mark where standard Mandarin has them: particles (的 de, 了 le, 吗 ma, 呢 ne, 吧 ba, 啊 a, 着 zhe, 过 guo after a verb, 地 de, 得 de), suffixes (们 men, 子 zi, 头 tou in 木头 mùtou), doubled kin words (māma, bàba, gēge, jiějie), and common words (xièxie, dōngxi, péngyou, zhīdao, piàoliang, shìqing, rènshi, míngzi, shēnghuo, yīfu, xiānsheng, shūfu, kèqi, dìfang).
- ${YI_BU_CONVENTION}
- Proper nouns start with a capital (Běijīng, Xiǎo Míng). Chinese punctuation becomes plain (，→ ,  ？→ ?  ！→ !  。→ nothing).
- One line: never a line break.`;

const SYSTEM_ZH = `You gloss Chinese that a tutor or student just typed on a shared lesson whiteboard.
Return the pinyin and the English meaning of EXACTLY the text given, via the gloss tool.

${PINYIN_RULES}

ENGLISH: for a word or phrase, one short natural meaning (at most 8 words); for a sentence, its COMPLETE natural translation — never cut it short. No alternatives, no slashes, no explanation, no trailing full stop. One line.`;

const SYSTEM_EN = `A tutor or student just typed English on the shared whiteboard of a Chinese lesson. Give the Chinese for it and that Chinese's pinyin, via the gloss tool.

CHINESE: the most natural everyday Mandarin in simplified characters, the way a teacher would write it on the board. A word → the common word for it (a noun without a measure word, a verb in its plain form: "to take a shower" → 洗澡). A phrase or sentence → all of it, naturally (not word for word). ONE answer — no alternatives, no slashes, no brackets, no explanation, no Latin letters; Chinese punctuation only where a sentence needs it, no final 。. A name or abbreviation with a usual Chinese form gets that form (OK → 好的, TV → 电视).

${PINYIN_RULES}`;

const TOOL_ZH = {
  name: 'gloss',
  description: 'The pinyin and short English meaning of the text.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pinyin: { type: 'string', description: 'Tone marks, one syllable per character, words spaced, one line' },
      english: { type: 'string', description: 'A word / phrase: at most 8 words. A sentence: its whole translation. One line.' },
    },
    required: ['pinyin', 'english'],
  },
};

const TOOL_EN = {
  name: 'gloss',
  description: 'The Chinese for the English text, and its pinyin.',
  input_schema: {
    type: 'object' as const,
    properties: {
      chinese: { type: 'string', description: 'Simplified Chinese, one answer, one line' },
      pinyin: { type: 'string', description: 'Pinyin of that Chinese: tone marks, one syllable per character, words spaced' },
    },
    required: ['chinese', 'pinyin'],
  },
};

/**
 * What the board may send, or null. 'zh': 1–GLOSS_MAX_SEGMENT (+ slack) characters with at least
 * one Chinese character. 'en': no Chinese, at least GLOSS_MIN_EN_LETTERS Latin letters, at most
 * GLOSS_MAX_EN_CHARS (+ slack) characters. Never a line break.
 */
export function validBoardGlossText(text: unknown, direction: GlossDirection = 'zh'): string | null {
  if (typeof text !== 'string') return null;
  const t = glossCacheKey(text);
  const chars = Array.from(t);
  if (chars.length === 0 || /[\r\n]/.test(t)) return null;
  if (direction === 'zh') {
    if (chars.length > GLOSS_MAX_SEGMENT + 10 || !chars.some(isHanChar)) return null;
  } else {
    if (chars.length > GLOSS_MAX_EN_CHARS + 20 || chars.some(isHanChar)) return null;
    if (chars.filter(isLatinLetter).length < GLOSS_MIN_EN_LETTERS) return null;
  }
  return t;
}

// ---------- caches (per isolate; a miss only costs one model call)

const cache = new Map<string, Gloss | ChineseGloss>();

export function cachedGloss(text: string, direction: GlossDirection = 'zh'): Gloss | ChineseGloss | null {
  const key = glossStoreKey(text, direction);
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit); // most recently used last
  return hit;
}

export function rememberGloss(text: string, gloss: Gloss | ChineseGloss, direction: GlossDirection = 'zh'): void {
  cache.set(glossStoreKey(text, direction), gloss);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

const hits = new Map<string, number[]>();

/** Sliding one-minute window per user; true = allowed (and counted). */
export function takeGlossToken(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= BOARD_GLOSS_RATE_PER_MIN) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5_000) hits.delete(hits.keys().next().value as string);
  return true;
}

/** Test seam. */
export function resetBoardGlossState(): void {
  cache.clear();
  hits.clear();
}

export interface BoardGlossOptions {
  /** Test seam: the Anthropic client. */
  client?: Pick<Anthropic, 'messages'>;
  /** The character / word dictionary for the pinyin check (pinyin-pro alone without it). */
  sources?: GlossReadingSources;
}

/** How often the safety net fires (counts only — board text stays out of the logs). */
function logFixes(fixes: readonly unknown[]): void {
  if (fixes.length) console.log(`[call-gloss] pinyin: ${fixes.length} word(s) replaced with the dictionary reading`);
}

/** Chinese → { pinyin, english }, the pinyin checked against the dictionary. */
export async function glossBoardText(apiKey: string, text: string, opts: BoardGlossOptions = {}): Promise<Gloss> {
  const gloss = await structuredCall<Gloss>({
    apiKey,
    model: BOARD_GLOSS_MODEL,
    fallbackModel: BOARD_GLOSS_FALLBACK_MODEL,
    attempts: 2,
    timeoutMs: BOARD_GLOSS_TIMEOUT_MS,
    system: SYSTEM_ZH,
    user: text,
    tool: TOOL_ZH,
    maxTokens: BOARD_GLOSS_MAX_TOKENS,
    client: opts.client,
    sleep: async () => {},
    validate: (input) => {
      const g = cleanGloss(input);
      if (!g) throw new Error('Unusable gloss');
      return g;
    },
  });
  const checked = await checkGlossPinyin(text, gloss.pinyin, opts.sources);
  logFixes(checked.fixes);
  return { ...gloss, pinyin: checked.pinyin };
}

/** English → { chinese, pinyin }, the pinyin checked against the Chinese with the dictionary. */
export async function glossEnglishText(apiKey: string, text: string, opts: BoardGlossOptions = {}): Promise<ChineseGloss> {
  const gloss = await structuredCall<ChineseGloss>({
    apiKey,
    model: BOARD_GLOSS_MODEL,
    fallbackModel: BOARD_GLOSS_FALLBACK_MODEL,
    attempts: 2,
    timeoutMs: BOARD_GLOSS_TIMEOUT_MS,
    system: SYSTEM_EN,
    user: text,
    tool: TOOL_EN,
    maxTokens: BOARD_GLOSS_MAX_TOKENS,
    client: opts.client,
    sleep: async () => {},
    validate: (input) => {
      const g = cleanChineseGloss(input);
      if (!g) throw new Error('Unusable translation');
      return g;
    },
  });
  const checked = await checkGlossPinyin(gloss.chinese, gloss.pinyin, opts.sources);
  logFixes(checked.fixes);
  return { ...gloss, pinyin: checked.pinyin };
}
