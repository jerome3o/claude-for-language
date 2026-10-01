/**
 * Reader word chips (services/reader-words.ts, shared/reader/words.ts).
 * Mounted under /api after the auth middleware.
 *
 *   POST /reader-words/backfill  { reader_id?, limit? }
 *        → { pages: [{ id, reader_id, words }], remaining }
 *        Segments up to `limit` (≤ 12) of the caller's pages that have no
 *        current words — `reader_id`'s first — and stores them. The clients
 *        call it when a reader opens and during sync until `remaining` is 0.
 *   POST /reader-words/explain   { word, sentence, pinyin?, gloss? }
 *        → ReaderWordExplanation (+ cached): Haiku's explanation of the word
 *        in that sentence and the card fields for "+ Add as card"; cached for
 *        everyone by word + sentence.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { backfillReaderWords, explainReaderWord } from '../services/reader-words';

const readerWords = new Hono<{ Bindings: Env }>();

readerWords.post('/reader-words/backfill', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ reader_id?: unknown; limit?: unknown }>().catch(() => ({} as { reader_id?: unknown; limit?: unknown }));
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured', pages: [], remaining: 0 }, 503);
  const readerId = typeof body.reader_id === 'string' && body.reader_id ? body.reader_id : undefined;
  const limit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.floor(body.limit) : undefined;
  try {
    return c.json(await backfillReaderWords(c.env.DB, c.env.ANTHROPIC_API_KEY, user.id, { readerId, limit }));
  } catch (error) {
    console.error('[reader-words] backfill failed:', error);
    return c.json({ error: 'Could not split the pages into words just now' }, 502);
  }
});

readerWords.post('/reader-words/explain', async (c) => {
  const body = await c.req.json<{ word?: unknown; sentence?: unknown; pinyin?: unknown; gloss?: unknown }>().catch(() => ({} as Record<string, unknown>));
  const word = typeof body.word === 'string' ? body.word.trim() : '';
  const sentence = typeof body.sentence === 'string' ? body.sentence.trim() : '';
  if (!word || word.length > 40) return c.json({ error: 'word is required' }, 400);
  if (!sentence || sentence.length > 400) return c.json({ error: 'sentence is required' }, 400);
  try {
    // Cached answers are served even without an API key; a miss then says so (503).
    const result = await explainReaderWord(c.env.DB, c.env.ANTHROPIC_API_KEY, {
      word,
      sentence,
      pinyin: typeof body.pinyin === 'string' ? body.pinyin : undefined,
      gloss: typeof body.gloss === 'string' ? body.gloss : undefined,
    });
    return c.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'AI is not configured') return c.json({ error: error.message }, 503);
    console.error('[reader-words] explain failed:', error);
    return c.json({ error: 'Claude could not explain this word just now — try again' }, 502);
  }
});

export default readerWords;
