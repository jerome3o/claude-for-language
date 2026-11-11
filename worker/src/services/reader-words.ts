import type Anthropic from '@anthropic-ai/sdk';
import { structuredCall } from './structured-call';
import { alignReaderWords, parseReaderWords, type ReaderWord, type ReaderWordExplanation } from '@shared/reader/words';
import { CARD_STANDARD, cardTextProblems } from '@shared/cards/standard';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import { checkAuthoredPinyin, type PinyinReadingSources } from './pinyin-check';

/**
 * Reader word chips (shared/reader/words.ts): every graded-reader page gets
 * its Chinese split into words with pinyin + a short gloss, stored on the
 * page row (`reader_pages.words`) so the reading views show tappable chips —
 * offline too, since the words travel with the readers in sync.
 *
 * Made with Haiku through `structuredCall` (forced tool, thinking off):
 * - when a story is generated (queue consumer, after the pages are written),
 * - after a page's text changes (reader editor save, import) — in the
 *   background; stale words are never served because `parseReaderWords`
 *   refuses words that don't concatenate to the page's current text,
 * - lazily for any page still without them: the clients call
 *   `POST /api/reader-words/backfill` when a reader opens and during sync.
 * A shared reader's copy keeps the source's words (same text).
 *
 * The concat invariant is enforced by `alignReaderWords`: whatever Claude
 * proposes is aligned to the text, unmatched stretches fall back to one
 * character per segment, and an answer covering too little of the page is
 * retried before it is accepted.
 *
 * Every segment's pinyin then goes through the deterministic pinyin check
 * (`fixReaderWordsPinyin`: services/pinyin-check.ts — only a syllable no
 * reading of its character allows is replaced, 吴侬软语 "wúnóngkuǎnyǔ" →
 * "wúnóngruǎnyǔ") and the 一 / 不 rule over the whole page. Words stored
 * before this (Nov 2026) are corrected lazily by the backfill
 * (`reader_pages.words_checked`, migration 0148) and come back to the devices
 * in its `pages`; a shared copy is checked as it is copied.
 */

export const READER_WORDS_MODEL = 'claude-haiku-4-5';
/** Below this share of the page's hanzi matched, the answer is retried (the last one is kept). */
export const MIN_COVERAGE = 0.85;
const ATTEMPTS = 2;
/** Pages segmented per backfill call; the client calls again while `remaining` > 0. */
export const BACKFILL_LIMIT = 12;
const CONCURRENCY = 4;
/** Version of the pinyin check stored with a page's words (`reader_pages.words_checked`). */
export const WORDS_PINYIN_CHECK_VERSION = 1;
/** Pages with older words whose pinyin one backfill call checks. */
export const PINYIN_REPAIR_LIMIT = 200;

/** One chip whose pinyin was corrected. */
export interface ReaderWordPinyinFix {
  index: number;
  text: string;
  before: string;
  after: string;
}

const HAN = /\p{Script=Han}/u;

/**
 * Every chip's pinyin checked against its characters: `checkAuthoredPinyin` replaces only a
 * syllable no reading of its character allows (软 is never kuǎn), keeping the rest byte for byte;
 * then the 一 / 不 tone changes over the whole page (a chip alone doesn't know the next word).
 * Never throws on odd pinyin (it is left as written).
 */
export async function fixReaderWordsPinyin(
  words: readonly ReaderWord[],
  sources: PinyinReadingSources = {},
): Promise<{ words: ReaderWord[]; fixes: ReaderWordPinyinFix[] }> {
  const out = words.map((w) => ({ ...w }));
  for (const w of out) {
    if (!w.pinyin?.trim() || !HAN.test(w.text)) continue;
    const r = await checkAuthoredPinyin(w.text, w.pinyin, sources).catch(() => null);
    if (r?.reason && r.pinyin !== w.pinyin) w.pinyin = r.pinyin;
  }
  // 一 / 不 over the page: the chips' pinyin lined up with the page's text as one line.
  const page = out.map((w) => w.text).join('');
  const han = out.flatMap((w, i) => (HAN.test(w.text) ? [i] : []));
  if (/[一不]/.test(page) && han.every((i) => out[i].pinyin?.trim() && !out[i].pinyin.includes('|'))) {
    const parts = han.map((i) => out[i].pinyin.trim().normalize('NFC'));
    const joined = parts.join(' | ');
    const changed = applyYiBuToneChanges(page, joined);
    if (changed !== joined) {
      const back = changed.split(' | ');
      if (back.length === parts.length) {
        back.forEach((p, k) => {
          if (p !== parts[k]) out[han[k]].pinyin = p;
        });
      }
    }
  }
  const fixes = out.flatMap((w, index) => (w.pinyin !== words[index].pinyin ? [{ index, text: w.text, before: words[index].pinyin, after: w.pinyin }] : []));
  return { words: out, fixes };
}

/** A page's stored words (JSON) with their pinyin checked; the same string when nothing needed fixing or they don't parse. */
export async function checkedWordsJson(words: string | null, text: string, sources: PinyinReadingSources = {}): Promise<string | null> {
  const parsed = parseReaderWords(words, text);
  if (!parsed) return words;
  const { fixes, words: fixed } = await fixReaderWordsPinyin(parsed, sources);
  return fixes.length ? JSON.stringify(fixed) : words;
}

const SEGMENT_SYSTEM = `You split Chinese text from a graded reader into words for a learner who taps a word to look it up.

Return every word of the text, in order, via the split_words tool:
- text: the word EXACTLY as written in the text (same characters, simplified as given). Cover every Chinese character; never skip, change, merge across punctuation or add words.
- Split the way a dictionary would: 我 / 叫 / 小徐 / 三十五 / 岁; 今天 / 我 / 坐 / 火车 / 去 / 上班. Names, numbers and set phrases (早上好 may be 早上 + 好) stay together; particles (了 的 吗 呢 吧) are their own words unless part of a fixed word.
- pinyin: tone marks (zǎoshang, not zao3shang), the reading used HERE, no spaces inside a word.
- gloss: 1–4 English words — what the word means in THIS sentence.
- Punctuation and quotes may be left out (they are added back automatically).`;

const SEGMENT_TOOL = {
  name: 'split_words',
  description: 'The text split into words, in order, each with pinyin and a short gloss.',
  input_schema: {
    type: 'object' as const,
    properties: {
      words: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The word exactly as written in the text' },
            pinyin: { type: 'string', description: 'Tone-marked pinyin for this reading' },
            gloss: { type: 'string', description: '1–4 English words, the meaning in this sentence' },
          },
          required: ['text', 'pinyin', 'gloss'],
        },
      },
    },
    required: ['words'],
  },
};

type Client = Pick<Anthropic, 'messages'>;

/**
 * One page's text → segments that satisfy the invariant. Throws when Claude
 * could not be reached at all (the caller leaves the page for a later try).
 */
export async function segmentReaderText(
  apiKey: string,
  text: string,
  opts: { client?: Client; sleep?: (ms: number) => Promise<void>; pinyin?: PinyinReadingSources } = {},
): Promise<ReaderWord[]> {
  let tries = 0;
  const words = await structuredCall({
    apiKey,
    model: READER_WORDS_MODEL,
    fallbackModel: null,
    system: SEGMENT_SYSTEM,
    user: `Text:\n${text}`,
    tool: SEGMENT_TOOL,
    // ~25 tokens a word; a 130-character page is ~70 words. Doubled on a cut-off reply.
    maxTokens: Math.min(8000, 600 + text.length * 25),
    attempts: ATTEMPTS,
    timeoutMs: 30_000,
    client: opts.client,
    sleep: opts.sleep,
    validate: (input) => {
      tries++;
      const proposed = (input as { words?: unknown })?.words;
      if (!Array.isArray(proposed)) throw new Error('No words in the reply');
      const { words, coverage } = alignReaderWords(text, proposed);
      if (coverage < MIN_COVERAGE && tries < ATTEMPTS) {
        throw new Error(`The words covered only ${Math.round(coverage * 100)}% of the page`);
      }
      return words;
    },
  });
  return (await fixReaderWordsPinyin(words, opts.pinyin)).words;
}

interface PageRow {
  id: string;
  reader_id: string;
  content_chinese: string;
  words: string | null;
  words_checked?: number | null;
}

type SegmentOpts = { client?: Client; sleep?: (ms: number) => Promise<void>; pinyin?: PinyinReadingSources };

export interface PageWords {
  id: string;
  reader_id: string;
  words: ReaderWord[];
}

/** Store segments for a page — only if its text is still the one they were made from. */
async function storeWords(db: D1Database, page: PageRow, words: ReaderWord[]): Promise<void> {
  await db
    .prepare('UPDATE reader_pages SET words = ?, words_checked = ? WHERE id = ? AND content_chinese = ?')
    .bind(JSON.stringify(words), WORDS_PINYIN_CHECK_VERSION, page.id, page.content_chinese)
    .run();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Segment and store the given pages (those that need it); failures are logged and skipped. */
export async function segmentPages(
  db: D1Database,
  apiKey: string | undefined,
  pages: PageRow[],
  opts: SegmentOpts = {},
): Promise<PageWords[]> {
  if (!apiKey && !opts.client) return [];
  const todo = pages.filter((p) => p.content_chinese.trim() && !parseReaderWords(p.words, p.content_chinese));
  const done = await mapLimit(todo, CONCURRENCY, async (page) => {
    try {
      const words = await segmentReaderText(apiKey ?? '', page.content_chinese, opts);
      await storeWords(db, page, words);
      return { id: page.id, reader_id: page.reader_id, words };
    } catch (err) {
      console.error('[reader-words] segmenting page failed:', page.id, err instanceof Error ? err.message : err);
      return null;
    }
  });
  return done.filter((x): x is PageWords => x !== null);
}

/** Segment every page of one reader that needs it (story generation, editor save, import). */
export async function segmentReader(
  db: D1Database,
  apiKey: string | undefined,
  readerId: string,
  opts: SegmentOpts = {},
): Promise<PageWords[]> {
  const rows = await db
    .prepare('SELECT id, reader_id, content_chinese, words FROM reader_pages WHERE reader_id = ? ORDER BY page_number ASC')
    .bind(readerId)
    .all<PageRow>();
  return segmentPages(db, apiKey, rows.results ?? [], opts);
}

/**
 * Words stored before their pinyin was checked (`words_checked` below the current version):
 * checked now, the corrected ones stored (only while the page and its words are unchanged) and
 * returned so the devices replace their copies; every checked page is marked. At most
 * `PINYIN_REPAIR_LIMIT` pages a call.
 */
async function repairStoredWordsPinyin(db: D1Database, rows: PageRow[], sources: PinyinReadingSources | undefined): Promise<{ pages: PageWords[]; left: number }> {
  const stale = rows.filter((p) => p.words && (p.words_checked ?? 0) < WORDS_PINYIN_CHECK_VERSION && parseReaderWords(p.words, p.content_chinese));
  const batch = stale.slice(0, PINYIN_REPAIR_LIMIT);
  const pages: PageWords[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const page of batch) {
    const words = parseReaderWords(page.words, page.content_chinese)!;
    const { words: fixed, fixes } = await fixReaderWordsPinyin(words, sources);
    if (fixes.length) {
      pages.push({ id: page.id, reader_id: page.reader_id, words: fixed });
      stmts.push(
        db
          .prepare('UPDATE reader_pages SET words = ?, words_checked = ? WHERE id = ? AND content_chinese = ? AND words = ?')
          .bind(JSON.stringify(fixed), WORDS_PINYIN_CHECK_VERSION, page.id, page.content_chinese, page.words),
      );
    } else {
      stmts.push(db.prepare('UPDATE reader_pages SET words_checked = ? WHERE id = ? AND words = ?').bind(WORDS_PINYIN_CHECK_VERSION, page.id, page.words));
    }
  }
  if (stmts.length) await db.batch(stmts);
  if (pages.length) console.log(`[reader-words] pinyin corrected on ${pages.length} stored page(s)`);
  return { pages, left: stale.length - batch.length };
}

/**
 * The lazy backfill behind `POST /api/reader-words/backfill`: up to `limit`
 * of the user's pages without (current) words — the given reader's first,
 * then the newest readers' — segmented and stored. Stored words whose pinyin
 * was never checked are checked too (`repairStoredWordsPinyin`); pages it
 * corrected come back in `pages` as well, so the devices replace their copies.
 * `remaining` counts the pages still without words after this call (plus
 * stored words still to be checked), so a client can keep going.
 */
export async function backfillReaderWords(
  db: D1Database,
  apiKey: string | undefined,
  userId: string,
  opts: { readerId?: string; limit?: number } & SegmentOpts = {},
): Promise<{ pages: PageWords[]; remaining: number }> {
  const limit = Math.max(1, Math.min(BACKFILL_LIMIT, opts.limit ?? BACKFILL_LIMIT));
  const rows = await db
    .prepare(`
      SELECT p.id, p.reader_id, p.content_chinese, p.words, p.words_checked
      FROM reader_pages p JOIN graded_readers r ON r.id = p.reader_id
      WHERE r.user_id = ?
      ORDER BY (r.id = ?) DESC, r.created_at DESC, p.page_number ASC
    `)
    .bind(userId, opts.readerId ?? '')
    .all<PageRow>();
  const all = rows.results ?? [];
  const repaired = await repairStoredWordsPinyin(db, all, opts.pinyin).catch((err) => {
    console.error('[reader-words] pinyin repair failed:', err instanceof Error ? err.message : err);
    return { pages: [] as PageWords[], left: 0 };
  });
  const missing = all.filter((p) => p.content_chinese.trim() && !parseReaderWords(p.words, p.content_chinese));
  const batch = missing.slice(0, limit);
  const pages = await segmentPages(db, apiKey, batch, opts);
  return { pages: [...repaired.pages, ...pages], remaining: missing.length - pages.length + repaired.left };
}

// ------------------------------------------------------------------
// "More about this word"
// ------------------------------------------------------------------

const EXPLAIN_SYSTEM = `A Chinese learner is reading a graded story and tapped one word. Explain that word as it is used in the sentence, briefly, and write what a flashcard for it would hold.

Return via the explain_word tool:
- pinyin: tone marks, the reading in this sentence.
- english: ONE clear meaning — the one this sentence uses (a flashcard's English field).
- explanation: 2–4 short plain-text lines for the learner: what it means here, how the characters build it, one usage note (a common pairing, register, or a look-alike to not confuse it with). No trivia.
- fun_facts: the flashcard explanation, following the card standard below.
- sentence_clue: ONE short real sentence that contains the word exactly — the story's sentence when it is short and clean, else a simpler one; no quotes, brackets, slashes, ellipses or blanks. With its pinyin (tone marks, spaces between words) and an English translation.

${CARD_STANDARD}`;

const EXPLAIN_TOOL = {
  name: 'explain_word',
  description: 'The word explained in this sentence, plus its flashcard fields.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pinyin: { type: 'string' },
      english: { type: 'string' },
      explanation: { type: 'string' },
      fun_facts: { type: 'string' },
      sentence_clue: { type: 'string' },
      sentence_clue_pinyin: { type: 'string' },
      sentence_clue_translation: { type: 'string' },
    },
    required: ['pinyin', 'english', 'explanation', 'fun_facts', 'sentence_clue', 'sentence_clue_pinyin', 'sentence_clue_translation'],
  },
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Claude's answer → a clean explanation; a sentence clue that breaks the card standard or lacks the word is dropped. */
export function normalizeExplanation(word: string, input: unknown): ReaderWordExplanation {
  const o = (input ?? {}) as Record<string, unknown>;
  const english = str(o.english);
  const explanation = str(o.explanation);
  if (!english || !explanation) throw new Error('The explanation came back empty');
  const result: ReaderWordExplanation = {
    word,
    pinyin: str(o.pinyin),
    english,
    explanation,
    fun_facts: str(o.fun_facts),
  };
  const clue = str(o.sentence_clue);
  if (clue && clue.includes(word) && cardTextProblems({ sentence_clue: clue }).length === 0 && !/["“”「」『』]/.test(clue)) {
    result.sentence_clue = clue;
    result.sentence_clue_pinyin = str(o.sentence_clue_pinyin);
    result.sentence_clue_translation = str(o.sentence_clue_translation);
  }
  return result;
}

async function explanationKey(word: string, sentence: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${word}\u0000${sentence}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The cached explanation of a word in a sentence, written by Haiku the first time anyone asks. */
export async function explainReaderWord(
  db: D1Database,
  apiKey: string | undefined,
  input: { word: string; sentence: string; pinyin?: string; gloss?: string },
  opts: { client?: Client; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ReaderWordExplanation & { cached: boolean }> {
  const word = input.word.trim();
  const sentence = input.sentence.trim();
  const id = await explanationKey(word, sentence);
  const hit = await db.prepare('SELECT result FROM reader_word_explanations WHERE id = ?').bind(id).first<{ result: string }>();
  if (hit) {
    try {
      return { ...(JSON.parse(hit.result) as ReaderWordExplanation), cached: true };
    } catch {
      // fall through and rewrite it
    }
  }
  if (!apiKey && !opts.client) throw new Error('AI is not configured');
  const hint = [input.pinyin && `pinyin given: ${input.pinyin}`, input.gloss && `gloss given: ${input.gloss}`].filter(Boolean).join('; ');
  const result = await structuredCall({
    apiKey: apiKey ?? '',
    model: READER_WORDS_MODEL,
    fallbackModel: null,
    system: EXPLAIN_SYSTEM,
    user: `Word: ${word}\nSentence: ${sentence}${hint ? `\n(${hint})` : ''}`,
    tool: EXPLAIN_TOOL,
    maxTokens: 1200,
    attempts: 2,
    timeoutMs: 30_000,
    client: opts.client,
    sleep: opts.sleep,
    validate: (raw) => normalizeExplanation(word, raw),
  });
  await db
    .prepare('INSERT OR REPLACE INTO reader_word_explanations (id, word, sentence, result) VALUES (?, ?, ?, ?)')
    .bind(id, word, sentence, JSON.stringify(result))
    .run();
  return { ...result, cached: false };
}
