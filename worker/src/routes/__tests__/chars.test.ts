import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { gzipSync } from 'node:zlib';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import chars from '../chars';
import { clearCharDictCache, explainCharacter, explainPrompt, type ShardLoader } from '../../services/char-dict';
import { charShard, charShardFile, type CharRecord } from '@shared/chars/types';
import type { Env } from '../../types';

const XING: CharRecord = {
  char: '行',
  readings: [{ pinyin: 'xíng', english: 'to walk; to go' }, { pinyin: 'háng', english: 'row; line' }],
  meaning: 'to go, to walk, to move; professional',
  radical: '行',
  radical_meaning: null,
  decomposition: '⿰彳亍',
  components: [{ char: '彳', meaning: 'to step with the left foot' }, { char: '亍', meaning: 'to take small steps' }],
  etymology: "To take small steps 亍 with one's feet 彳",
  strokes: 6,
  rank: 46,
  words: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank' }],
};
const YIN: CharRecord = { ...XING, char: '银', readings: [{ pinyin: 'yín', english: 'silver' }], words: [] };

/** The shards as the build writes them (gzipped JSON), served from memory. */
function loader(records: CharRecord[], calls: string[] = []): ShardLoader {
  const files = new Map<string, Record<string, CharRecord>>();
  for (const r of records) {
    const f = charShardFile(charShard(r.char));
    files.set(f, { ...(files.get(f) ?? {}), [r.char]: r });
  }
  return async (file) => {
    calls.push(file);
    const shard = files.get(file);
    return shard ? new Uint8Array(gzipSync(Buffer.from(JSON.stringify(shard)))) : null;
  };
}

function makeApp(db: SqliteD1, user: { id: string } | null, load: ShardLoader, env: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: { charLoader?: ShardLoader } }>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user as never);
    c.set('charLoader', load);
    await next();
  });
  app.route('/api', chars);
  const e = { DB: db, ...env } as unknown as Env;
  return (path: string, init?: RequestInit) => app.request(`/api${path}`, init, e);
}

describe('character dictionary routes', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    clearCharDictCache();
    db = await createSqliteD1();
  });

  it('refuses a signed-out caller', async () => {
    const req = makeApp(db, null, loader([XING]));
    expect((await req(`/chars/${encodeURIComponent('行')}`)).status).toBe(401);
  });

  it('serves one record, and reads each shard once per isolate', async () => {
    const calls: string[] = [];
    const req = makeApp(db, { id: 'u' }, loader([XING], calls));
    const res = await req(`/chars/${encodeURIComponent('行')}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1, record: XING });
    await req(`/chars/${encodeURIComponent('行')}`);
    expect(calls).toEqual([charShardFile(charShard('行'))]);
  });

  it('404 for a character the dictionary lacks, 400 for anything but one character', async () => {
    const req = makeApp(db, { id: 'u' }, loader([XING]));
    const missing = await req(`/chars/${encodeURIComponent('龘')}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ char: '龘' });
    expect((await req(`/chars/${encodeURIComponent('银行')}`)).status).toBe(400);
    expect((await req('/chars/a')).status).toBe(400);
  });

  it('batches: distinct Han characters of c, with the missing ones listed', async () => {
    const req = makeApp(db, { id: 'u' }, loader([XING, YIN]));
    const res = await req(`/chars?c=${encodeURIComponent('银行，行龘!')}`);
    const body = await res.json() as { records: Record<string, CharRecord>; missing: string[] };
    expect(Object.keys(body.records).sort()).toEqual(['行', '银'].sort());
    expect(body.missing).toEqual(['龘']);
    expect((await req('/chars?c=abc')).status).toBe(400);
  });

  it('explains a character once for everyone, from the dictionary only', async () => {
    const prompts: string[] = [];
    const client = {
      messages: {
        create: async (req: { messages: Array<{ content: string }> }) => {
          prompts.push(req.messages[0].content);
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 10 },
            content: [{ type: 'tool_use', name: 'explain_character', input: { explanation: '行 means to walk; 彳 + 亍 are two feet stepping. Common in 银行 yínháng (bank).' } }],
          };
        },
      },
    } as never;
    const first = await explainCharacter(db as never, undefined, '行', XING, { client });
    expect(first).toMatchObject({ char: '行', cached: false });
    const again = await explainCharacter(db as never, undefined, '行', XING, { client });
    expect(again).toEqual({ ...first, cached: true });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe(explainPrompt('行', XING));
    expect(prompts[0]).toContain('Components: 彳');

    // The route serves the cached answer even without an API key; a miss without one is 503.
    const req = makeApp(db, { id: 'u' }, loader([XING, YIN]));
    const cached = await req(`/chars/${encodeURIComponent('行')}/explain`, { method: 'POST' });
    expect(cached.status).toBe(200);
    expect(await cached.json()).toMatchObject({ cached: true });
    expect((await req(`/chars/${encodeURIComponent('银')}/explain`, { method: 'POST' })).status).toBe(503);
  });
});
