/**
 * The character dictionary (docs/STUDY_SESSION.md "Character sheet"; data built by
 * scripts/build-char-dict.ts from CC-CEDICT, Make Me a Hanzi and wordfreq). The records are
 * static assets of this worker (`worker/char-dict/NNN.dat`, gzipped JSON per shard) read
 * through the CHAR_DICT binding and kept in memory per isolate — no D1 rows, no R2 objects,
 * and a new build deploys with the worker.
 *
 * "More about 字" (`explainCharacter`) is Haiku's short card-independent explanation,
 * generated once per character and cached for everyone in `char_explanations`.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { structuredCall, StructuredCallError } from './structured-call';
import { isHanCodePoint } from '@shared/progress/known';
import {
  CHAR_BATCH_MAX,
  CHAR_DICT_VERSION,
  charShard,
  charShardFile,
  type CharRecord,
} from '@shared/chars/types';

export const CHAR_EXPLAIN_MODEL = 'claude-haiku-4-5';

/** Returns a shard's bytes, or null when it doesn't exist. */
export type ShardLoader = (file: string) => Promise<Uint8Array | null>;

type Shard = Record<string, CharRecord>;
const shardCache = new Map<string, Promise<Shard>>();

/** Reads the shards through the worker's static-assets binding. */
export function assetsShardLoader(assets: Fetcher | undefined): ShardLoader {
  return async (file) => {
    if (!assets) return null;
    const res = await assets.fetch(new Request(`https://char-dict.assets/${file}`));
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  };
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readShard(loader: ShardLoader, file: string): Promise<Shard> {
  const bytes = await loader(file);
  if (!bytes) return {};
  // The files are gzip; should anything on the way have decoded them already, use them as is.
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(bytes) : bytes;
  return JSON.parse(new TextDecoder().decode(raw)) as Shard;
}

/** Test hook: forget the shards kept in memory. */
export function clearCharDictCache(): void {
  shardCache.clear();
}

function loadShard(loader: ShardLoader, shard: number, cacheKey: string): Promise<Shard> {
  const key = `${cacheKey}:${shard}`;
  let p = shardCache.get(key);
  if (!p) {
    p = readShard(loader, charShardFile(shard)).catch((err) => {
      shardCache.delete(key);
      throw err;
    });
    shardCache.set(key, p);
  }
  return p;
}

/** True for a single Han character (the only thing the dictionary has records for). */
export function isDictChar(text: string): boolean {
  const chars = [...text];
  return chars.length === 1 && isHanCodePoint(chars[0].codePointAt(0)!);
}

/** The distinct Han characters of `text`, in order, at most CHAR_BATCH_MAX. */
export function charsOf(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (!isHanCodePoint(ch.codePointAt(0)!) || out.includes(ch)) continue;
    out.push(ch);
    if (out.length === CHAR_BATCH_MAX) break;
  }
  return out;
}

export async function getCharRecords(
  loader: ShardLoader,
  chars: readonly string[],
  cacheKey = 'assets',
): Promise<{ records: Record<string, CharRecord>; missing: string[] }> {
  const records: Record<string, CharRecord> = {};
  const missing: string[] = [];
  for (const ch of chars) {
    const shard = await loadShard(loader, charShard(ch), cacheKey);
    const r = shard[ch];
    if (r) records[ch] = r;
    else missing.push(ch);
  }
  return { records, missing };
}

export async function getCharRecord(loader: ShardLoader, char: string, cacheKey = 'assets'): Promise<CharRecord | null> {
  const { records } = await getCharRecords(loader, [char], cacheKey);
  return records[char] ?? null;
}

// ── "More about 字" ───────────────────────────────────────────────────────

export interface CharExplanation {
  char: string;
  explanation: string;
  cached: boolean;
}

const EXPLAIN_SYSTEM = `You explain ONE Chinese character to an adult English-speaking learner, in 2–3 short lines of plain text (no markdown, no lists, at most ~60 words):
1. what the character means and the idea behind it;
2. how it is built (its components and what they contribute), if that helps remember it;
3. how it is commonly used (the kind of words it appears in, one or two examples with pinyin).
It is a general explanation of the character, not of any particular word or sentence. Simplified Chinese, pinyin with tone marks.`;

const EXPLAIN_TOOL = {
  name: 'explain_character',
  description: 'The short explanation of the character.',
  input_schema: {
    type: 'object' as const,
    properties: { explanation: { type: 'string', description: '2–3 short lines, plain text.' } },
    required: ['explanation'],
  },
};

type Client = Pick<Anthropic, 'messages'>;

/** The prompt's facts: the dictionary record only — never a card. */
export function explainPrompt(char: string, record: CharRecord | null): string {
  if (!record) return `Character: ${char}`;
  const lines = [`Character: ${char}`];
  if (record.readings.length) lines.push(`Readings: ${record.readings.map((r) => `${r.pinyin} (${r.english})`).join('; ')}`);
  if (record.meaning) lines.push(`Dictionary meaning: ${record.meaning}`);
  if (record.components.length) lines.push(`Components: ${record.components.map((c) => `${c.char}${c.meaning ? ` (${c.meaning})` : ''}`).join(', ')}`);
  if (record.etymology) lines.push(`Etymology hint: ${record.etymology}`);
  if (record.words.length) lines.push(`Frequent words: ${record.words.slice(0, 6).map((w) => `${w.hanzi} ${w.pinyin} ${w.english}`).join('; ')}`);
  return lines.join('\n');
}

export async function explainCharacter(
  db: D1Database,
  apiKey: string | undefined,
  char: string,
  record: CharRecord | null,
  opts: { client?: Client; sleep?: (ms: number) => Promise<void> } = {},
): Promise<CharExplanation> {
  const hit = await db.prepare('SELECT explanation FROM char_explanations WHERE char = ?').bind(char).first<{ explanation: string }>();
  if (hit?.explanation) return { char, explanation: hit.explanation, cached: true };
  if (!apiKey && !opts.client) throw new Error('AI is not configured');
  const result = await structuredCall({
    apiKey: apiKey ?? '',
    model: CHAR_EXPLAIN_MODEL,
    fallbackModel: null,
    system: EXPLAIN_SYSTEM,
    user: explainPrompt(char, record),
    tool: EXPLAIN_TOOL,
    maxTokens: 600,
    attempts: 2,
    timeoutMs: 30_000,
    client: opts.client,
    sleep: opts.sleep,
    validate: (raw) => {
      const text = typeof (raw as { explanation?: unknown })?.explanation === 'string'
        ? (raw as { explanation: string }).explanation.trim()
        : '';
      if (!text) throw new Error('empty explanation');
      return text.slice(0, 600);
    },
  });
  await db
    .prepare('INSERT OR REPLACE INTO char_explanations (char, explanation, model, dict_version) VALUES (?, ?, ?, ?)')
    .bind(char, result, CHAR_EXPLAIN_MODEL, CHAR_DICT_VERSION)
    .run();
  return { char, explanation: result, cached: false };
}

export { StructuredCallError };
