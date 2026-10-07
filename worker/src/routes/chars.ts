/**
 * The character dictionary (services/char-dict.ts, shared/chars; docs/STUDY_SESSION.md
 * "Character sheet"). Mounted under /api after the auth middleware.
 *
 *   GET  /chars/:char          → { version, record } (404 { error, char } when the dictionary
 *                                doesn't have it)
 *   GET  /chars?c=行银好        → { version, records: { char: record }, missing: [char] }
 *                                (the distinct Han characters of `c`, at most 100)
 *   POST /chars/:char/explain  → { char, explanation, cached } — "More about 字": Haiku's
 *                                short card-independent explanation, cached for everyone
 *                                (503 without an API key and no cached answer, 502 failed)
 *   GET  /words?w=银行,学生     → { version, records: { hanzi: WordRecord }, missing: [hanzi] }
 *                                — the word dictionary of the language explorer
 *                                (docs/LANGUAGE_EXPLORER.md; 2–6 Han characters each, ≤ 50)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { CHAR_DICT_VERSION, WORD_DICT_VERSION } from '@shared/chars/types';
import {
  assetsShardLoader,
  charsOf,
  explainCharacter,
  getCharRecord,
  getCharRecords,
  getWordRecords,
  isDictChar,
  wordsOf,
  type ShardLoader,
} from '../services/char-dict';

type Variables = { charLoader?: ShardLoader };

const chars = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Tests set `charLoader` on the context; production reads the static assets. */
function loaderFor(c: { get: (k: 'charLoader') => ShardLoader | undefined; env: Env }): { loader: ShardLoader; key: string } {
  const injected = c.get('charLoader');
  return injected ? { loader: injected, key: 'injected' } : { loader: assetsShardLoader(c.env.CHAR_DICT), key: 'assets' };
}

function paramChar(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

chars.get('/chars', async (c) => {
  if (!c.get('user')) return c.json({ error: 'Not signed in' }, 401);
  const list = charsOf(c.req.query('c') ?? '');
  if (list.length === 0) return c.json({ error: 'c must contain Chinese characters' }, 400);
  const { loader, key } = loaderFor(c);
  try {
    const { records, missing } = await getCharRecords(loader, list, key);
    c.header('Cache-Control', 'private, max-age=86400');
    return c.json({ version: CHAR_DICT_VERSION, records, missing });
  } catch (error) {
    console.error('[chars] batch lookup failed:', error);
    return c.json({ error: 'The dictionary is unavailable just now' }, 502);
  }
});

chars.get('/words', async (c) => {
  if (!c.get('user')) return c.json({ error: 'Not signed in' }, 401);
  const list = wordsOf(c.req.query('w') ?? '');
  if (list.length === 0) return c.json({ error: 'w must list Chinese words (2–6 characters)' }, 400);
  const { loader, key } = loaderFor(c);
  try {
    const { records, missing } = await getWordRecords(loader, list, key);
    c.header('Cache-Control', 'private, max-age=86400');
    return c.json({ version: WORD_DICT_VERSION, records, missing });
  } catch (error) {
    console.error('[words] lookup failed:', error);
    return c.json({ error: 'The dictionary is unavailable just now' }, 502);
  }
});

chars.get('/chars/:char', async (c) => {
  if (!c.get('user')) return c.json({ error: 'Not signed in' }, 401);
  const ch = paramChar(c.req.param('char'));
  if (!isDictChar(ch)) return c.json({ error: 'One Chinese character, please' }, 400);
  const { loader, key } = loaderFor(c);
  try {
    const record = await getCharRecord(loader, ch, key);
    if (!record) return c.json({ error: 'Not in the dictionary', char: ch }, 404);
    c.header('Cache-Control', 'private, max-age=86400');
    return c.json({ version: CHAR_DICT_VERSION, record });
  } catch (error) {
    console.error('[chars] lookup failed:', error);
    return c.json({ error: 'The dictionary is unavailable just now' }, 502);
  }
});

chars.post('/chars/:char/explain', async (c) => {
  if (!c.get('user')) return c.json({ error: 'Not signed in' }, 401);
  const ch = paramChar(c.req.param('char'));
  if (!isDictChar(ch)) return c.json({ error: 'One Chinese character, please' }, 400);
  const { loader, key } = loaderFor(c);
  try {
    const record = await getCharRecord(loader, ch, key).catch(() => null);
    return c.json(await explainCharacter(c.env.DB, c.env.ANTHROPIC_API_KEY, ch, record));
  } catch (error) {
    if (error instanceof Error && error.message === 'AI is not configured') return c.json({ error: error.message, retryable: false }, 503);
    console.error('[chars] explain failed:', error);
    return c.json({ error: 'Claude could not explain this character just now — try again', retryable: true }, 502);
  }
});

export default chars;
