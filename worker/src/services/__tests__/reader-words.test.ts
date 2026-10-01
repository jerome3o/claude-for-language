/**
 * Reader word chips against a real SQLite with a mocked Claude: segmenting a
 * page keeps the concat invariant (repairing what Claude returns), a reply
 * covering too little of the page is retried, the lazy backfill only touches
 * the caller's pages that lack current words (the opened reader first), a page
 * edited while Claude was working is not given stale words, the API parses
 * the column, and "More about this word" is cached.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { backfillReaderWords, explainReaderWord, normalizeExplanation, segmentReader, segmentReaderText } from '../reader-words';
import { getGradedReader, getGradedReadersWithPages } from '../../db/queries';

type Reply = Record<string, unknown> | Error;

function fakeClient(replies: Reply[] | ((params: Record<string, any>) => Reply | Promise<Reply>)) {
  const calls: Array<Record<string, any>> = [];
  const client = {
    messages: {
      create: async (params: Record<string, any>) => {
        calls.push(params);
        const next = typeof replies === 'function' ? await replies(params) : replies.shift();
        if (!next) throw new Error('no more replies');
        if (next instanceof Error) throw next;
        return next;
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
}

const toolReply = (input: unknown) => ({ stop_reason: 'tool_use', usage: { output_tokens: 10 }, content: [{ type: 'tool_use', id: 't', name: 'x', input }] });
const sleep = async () => {};

/** A "Claude" that splits any text one hanzi per word (always covers the page). */
function charSplitter(params: Record<string, any>): Reply {
  const text = String(params.messages[0].content).replace(/^Text:\n/, '');
  return toolReply({ words: Array.from(text).filter((ch) => /\p{Script=Han}/u.test(ch)).map((ch) => ({ text: ch, pinyin: 'x', gloss: `g-${ch}` })) });
}

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

const ME = 'user-1';
const OTHER = 'user-2';

function seed(db: SqliteD1) {
  exec(db, "INSERT INTO users (id, email, name, role) VALUES (?, 'a@example.com', 'A', 'student')", ME);
  exec(db, "INSERT INTO users (id, email, name, role) VALUES (?, 'b@example.com', 'B', 'student')", OTHER);
  const reader = (id: string, user: string, created: string) =>
    exec(db, `INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used, created_at)
      VALUES (?, ?, '故事', 'Story', 'beginner', '[]', '[]', ?)`, id, user, created);
  const page = (id: string, readerId: string, n: number, text: string, words: string | null = null) =>
    exec(db, `INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english, words)
      VALUES (?, ?, ?, ?, '', '', ?)`, id, readerId, n, text, words);
  reader('old', ME, '2026-08-01 00:00:00');
  reader('new', ME, '2026-09-25 00:00:00');
  reader('theirs', OTHER, '2026-09-30 00:00:00');
  page('old-1', 'old', 1, '早上好。', JSON.stringify([{ text: '早上好', pinyin: 'zǎoshang hǎo', gloss: 'good morning' }, { text: '。', pinyin: '', gloss: '' }]));
  page('old-2', 'old', 2, '我叫小徐。', JSON.stringify([{ text: '我叫小王。', pinyin: '', gloss: '' }])); // stale: the text was edited
  page('new-1', 'new', 1, '小徐说："你好！"');
  page('new-2', 'new', 2, '今天我坐火车。');
  page('theirs-1', 'theirs', 1, '他们走了。');
}

const join = (w: Array<{ text: string }> | null | undefined) => (w ?? []).map((x) => x.text).join('');

describe('segmentReaderText', () => {
  it('turns the reply into segments that concatenate to the page, quotes included', async () => {
    const text = '小徐说："你好！"';
    const { client, calls } = fakeClient([toolReply({ words: [
      { text: '小徐', pinyin: 'Xiǎo Xú', gloss: 'Xiao Xu' },
      { text: '说', pinyin: 'shuō', gloss: 'says' },
      { text: '你好！', pinyin: 'nǐ hǎo', gloss: 'hello' },
    ] })]);
    const words = await segmentReaderText('k', text, { client, sleep });
    expect(join(words)).toBe(text);
    expect(words.filter((w) => w.gloss).map((w) => w.text)).toEqual(['小徐', '说', '你好']);
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('claude-haiku-4-5');
    expect(calls[0].thinking).toEqual({ type: 'disabled' });
    expect(calls[0].tool_choice).toEqual({ type: 'tool', name: 'split_words' });
  });

  it('retries a reply that covers too little of the page, and keeps the last one repaired', async () => {
    const text = '今天我坐火车去上班。';
    const poor = toolReply({ words: [{ text: '今天', pinyin: 'jīntiān', gloss: 'today' }] });
    const { client, calls } = fakeClient([poor, poor]);
    const words = await segmentReaderText('k', text, { client, sleep });
    expect(calls).toHaveLength(2);
    expect(join(words)).toBe(text);
    expect(words[0]).toMatchObject({ text: '今天', gloss: 'today' });
    expect(words.slice(1, 3).map((w) => w.text)).toEqual(['我', '坐']); // per-character fallback
  });

  it('throws when Claude cannot be reached', async () => {
    const { client } = fakeClient([new Error('overloaded'), new Error('overloaded')]);
    await expect(segmentReaderText('k', '你好', { client, sleep })).rejects.toThrow();
  });
});

describe('backfillReaderWords', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  const stored = (id: string) => db.rows<{ words: string | null }>('SELECT words FROM reader_pages WHERE id = ?', [id])[0].words;

  it('segments only my pages without current words, the opened reader first', async () => {
    const { client, calls } = fakeClient(charSplitter);
    const res = await backfillReaderWords(db, 'k', ME, { readerId: 'old', limit: 1, client, sleep });
    expect(res.pages.map((p) => p.id)).toEqual(['old-2']); // stale words redone, opened reader first
    expect(join(res.pages[0].words)).toBe('我叫小徐。');
    expect(res.remaining).toBe(2);
    expect(calls).toHaveLength(1);

    const rest = await backfillReaderWords(db, 'k', ME, { client, sleep });
    expect(rest.pages.map((p) => p.id)).toEqual(['new-1', 'new-2']);
    expect(rest.remaining).toBe(0);
    expect(join(JSON.parse(stored('new-1')!))).toBe('小徐说："你好！"');
    expect(stored('theirs-1')).toBeNull(); // someone else's reader is never touched
    // the page that already had good words was not re-made
    expect(JSON.parse(stored('old-1')!)[0].text).toBe('早上好');

    const none = await backfillReaderWords(db, 'k', ME, { client, sleep });
    expect(none).toEqual({ pages: [], remaining: 0 });
  });

  it('leaves a page for later when Claude fails, and counts it as remaining', async () => {
    const { client } = fakeClient(() => new Error('overloaded'));
    const res = await backfillReaderWords(db, 'k', ME, { client, sleep });
    expect(res.pages).toEqual([]);
    expect(res.remaining).toBe(3);
    expect(stored('new-1')).toBeNull();
  });

  it('does not store words for a page whose text changed while Claude was working', async () => {
    const { client } = fakeClient((params) => {
      exec(db, "UPDATE reader_pages SET content_chinese = '今天我坐汽车。' WHERE id = 'new-2'");
      return charSplitter(params);
    });
    await segmentReader(db, 'k', 'new', { client, sleep });
    expect(stored('new-2')).toBeNull();
    expect(stored('new-1')).not.toBeNull();
  });

  it('the API serves parsed words, null when missing or stale', async () => {
    const all = await getGradedReadersWithPages(db, ME);
    const pages = all.flatMap((r) => r.pages);
    expect(pages.find((p) => p.id === 'old-1')?.words?.[0]).toEqual({ text: '早上好', pinyin: 'zǎoshang hǎo', gloss: 'good morning' });
    expect(pages.find((p) => p.id === 'old-2')?.words).toBeNull();
    expect(pages.find((p) => p.id === 'new-1')?.words).toBeNull();
    const one = await getGradedReader(db, 'old', ME);
    expect(one?.pages[0].words).toHaveLength(2);
  });
});

describe('explainReaderWord', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
  });

  const reply = toolReply({
    pinyin: 'huǒchē',
    english: 'train',
    explanation: '火 fire + 车 vehicle: the steam-era name stuck.\n坐火车 = take the train.',
    fun_facts: '火 (huǒ) fire + 车 (chē) vehicle.\n坐火车 zuò huǒchē: take the train.',
    sentence_clue: '我坐火车去上班。',
    sentence_clue_pinyin: 'wǒ zuò huǒchē qù shàngbān',
    sentence_clue_translation: 'I take the train to work.',
  });

  it('asks Haiku once per word + sentence, then serves the cache', async () => {
    const { client, calls } = fakeClient([reply]);
    const first = await explainReaderWord(db, 'k', { word: '火车', sentence: '今天我坐火车去上班。' }, { client, sleep });
    expect(first).toMatchObject({ word: '火车', english: 'train', sentence_clue: '我坐火车去上班。', cached: false });
    const again = await explainReaderWord(db, 'k', { word: '火车', sentence: '今天我坐火车去上班。' }, { client, sleep });
    expect(again).toMatchObject({ english: 'train', cached: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('claude-haiku-4-5');
    expect(calls[0].thinking).toEqual({ type: 'disabled' });
  });

  it('drops a sentence clue that lacks the word or breaks the card standard', () => {
    const base = { pinyin: 'p', english: 'e', explanation: 'x', fun_facts: 'f', sentence_clue_pinyin: 'p', sentence_clue_translation: 't' };
    expect(normalizeExplanation('火车', { ...base, sentence_clue: '我坐汽车。' }).sentence_clue).toBeUndefined();
    expect(normalizeExplanation('火车', { ...base, sentence_clue: '我坐火车/汽车。' }).sentence_clue).toBeUndefined();
    expect(normalizeExplanation('火车', { ...base, sentence_clue: '他说："坐火车。"' }).sentence_clue).toBeUndefined();
    expect(normalizeExplanation('火车', { ...base, sentence_clue: '坐火车很快。' }).sentence_clue).toBe('坐火车很快。');
    expect(() => normalizeExplanation('火车', { ...base, english: '' })).toThrow();
  });
});
