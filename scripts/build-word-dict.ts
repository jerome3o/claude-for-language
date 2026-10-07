/**
 * Builds the word dictionary served by `GET /api/words?w=` (docs/LANGUAGE_EXPLORER.md;
 * rules in shared/chars/build.ts `buildWordDict`).
 *
 *   npm run build:word-dict                      # downloads the sources into scripts/.cache
 *   npm run build:word-dict -- --cedict f.txt.gz --wordfreq large_zh.msgpack.gz --max-words 60000
 *
 * Output: worker/char-dict/words/<NNN>.dat — WORD_DICT_SHARDS gzipped JSON objects
 * { hanzi: WordRecord } (shard = wordShard(hanzi)) + words/manifest.json. Deployed with the
 * worker as static assets beside the character shards (the CHAR_DICT binding).
 *
 * Sources: CC-CEDICT (CC BY-SA 4.0), wordfreq large_zh (data CC BY-SA 4.0) — credited under
 * Settings → About → Licences with the character dictionary.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { buildWordDict, parseCedict, parseWordfreq } from '../shared/chars/build';
import { decodeMsgpack } from '../shared/chars/msgpack';
import { WORD_DICT_SHARDS, WORD_DICT_VERSION, wordShard, wordShardFile, type WordRecord } from '../shared/chars/types';

const SOURCES = {
  cedict: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
  wordfreq: 'https://raw.githubusercontent.com/rspeer/wordfreq/master/wordfreq/data/large_zh.msgpack.gz',
} as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = resolve(dirname(process.argv[1] ?? '.'), '..');
const repoRoot = existsSync(join(root, 'shared')) ? root : process.cwd();
const cacheDir = join(repoRoot, 'scripts', '.cache');
const outDir = resolve(arg('out') ?? join(repoRoot, 'worker', 'char-dict'));

async function source(key: keyof typeof SOURCES): Promise<Buffer> {
  const given = arg(key);
  if (given) return readFileSync(given);
  const file = join(cacheDir, SOURCES[key].split('/').pop()!);
  if (!existsSync(file)) {
    mkdirSync(cacheDir, { recursive: true });
    console.log(`downloading ${SOURCES[key]}`);
    const res = await fetch(SOURCES[key]);
    if (!res.ok) throw new Error(`${SOURCES[key]}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(file);
}

const isGz = (buf: Buffer) => buf[0] === 0x1f && buf[1] === 0x8b;

async function main() {
  const cedictBuf = await source('cedict');
  const freqBuf = await source('wordfreq');
  const cedict = parseCedict((isGz(cedictBuf) ? gunzipSync(cedictBuf) : cedictBuf).toString('utf8'));
  const freq = parseWordfreq(decodeMsgpack(isGz(freqBuf) ? gunzipSync(freqBuf) : freqBuf));
  const records = buildWordDict({ cedict, freq }, { maxWords: Number(arg('max-words') ?? 60_000) });

  const shards: Array<Record<string, WordRecord>> = Array.from({ length: WORD_DICT_SHARDS }, () => ({}));
  for (const r of records) shards[wordShard(r.hanzi)][r.hanzi] = r;

  const dir = join(outDir, 'words');
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.dat')) rmSync(join(dir, f));
  let bytes = 0;
  shards.forEach((shard, i) => {
    // Sorted keys + mtime 0: the same input always gives byte-identical shards.
    const sorted = Object.fromEntries(Object.entries(shard).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const gz = gzipSync(Buffer.from(JSON.stringify(sorted)), { level: 9 });
    bytes += gz.length;
    writeFileSync(join(outDir, wordShardFile(i)), gz);
  });
  const manifest = {
    version: WORD_DICT_VERSION,
    shards: WORD_DICT_SHARDS,
    words: records.length,
    ranked: records.filter((r) => r.rank !== null).length,
    gzipped_bytes: bytes,
    sources: [
      { name: 'CC-CEDICT', url: 'https://www.mdbg.net/chinese/dictionary?page=cedict', licence: 'CC BY-SA 4.0', entries: cedict.length },
      { name: 'wordfreq (large_zh)', url: 'https://github.com/rspeer/wordfreq', licence: 'CC BY-SA 4.0 (data)', entries: freq.size },
    ],
  };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${records.length} words, ${(bytes / 1e6).toFixed(2)} MB gzipped → ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
