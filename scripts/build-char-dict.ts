/**
 * Builds the character dictionary served by `GET /api/chars/:char` (docs/STUDY_SESSION.md
 * "Character sheet"; shared/chars/build.ts has the rules).
 *
 *   npm run build:char-dict                       # downloads the sources into scripts/.cache
 *   npm run build:char-dict -- --cedict f.txt.gz --hanzi dictionary.txt --wordfreq large_zh.msgpack.gz
 *
 * Output: worker/char-dict/<NNN>.dat — CHAR_DICT_SHARDS gzipped JSON objects { char: CharRecord }
 * (shard = code point % shards) — plus manifest.json (version, counts, sources, licences).
 * The worker reads them through its static-assets binding (CHAR_DICT); nothing is uploaded
 * anywhere by hand, the files deploy with the worker.
 *
 * Sources (licences in the app under Settings → About → Licences):
 *   CC-CEDICT        https://www.mdbg.net/chinese/dictionary?page=cedict   CC BY-SA 4.0
 *   Make Me a Hanzi  https://github.com/skishore/makemeahanzi (dictionary.txt)  LGPL-3.0
 *   wordfreq         https://github.com/rspeer/wordfreq (large_zh)  data CC BY-SA 4.0
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { buildCharDict, parseCedict, parseMakeMeAHanzi, parseWordfreq } from '../shared/chars/build';
import { decodeMsgpack } from '../shared/chars/msgpack';
import { CHAR_DICT_SHARDS, CHAR_DICT_VERSION, charShard, charShardFile, type CharRecord } from '../shared/chars/types';

const SOURCES = {
  cedict: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
  hanzi: 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt',
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

const text = (buf: Buffer, gz: boolean) => (gz ? gunzipSync(buf) : buf).toString('utf8');
const isGz = (buf: Buffer) => buf[0] === 0x1f && buf[1] === 0x8b;

async function main() {
  const cedictBuf = await source('cedict');
  const hanziBuf = await source('hanzi');
  const freqBuf = await source('wordfreq');
  const cedict = parseCedict(text(cedictBuf, isGz(cedictBuf)));
  const hanzi = parseMakeMeAHanzi(text(hanziBuf, isGz(hanziBuf)));
  const freq = parseWordfreq(decodeMsgpack(isGz(freqBuf) ? gunzipSync(freqBuf) : freqBuf));
  const maxRank = Number(arg('max-rank') ?? 8000);
  const records = buildCharDict({ cedict, hanzi, freq }, { maxRank });

  const shards: Array<Record<string, CharRecord>> = Array.from({ length: CHAR_DICT_SHARDS }, () => ({}));
  for (const r of records) shards[charShard(r.char)][r.char] = r;

  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith('.dat')) rmSync(join(outDir, f));
  let bytes = 0;
  shards.forEach((shard, i) => {
    // mtime 0 + no file name: the same input always gives byte-identical shards.
    const gz = gzipSync(Buffer.from(JSON.stringify(shard)), { level: 9 });
    bytes += gz.length;
    writeFileSync(join(outDir, charShardFile(i)), gz);
  });
  const manifest = {
    version: CHAR_DICT_VERSION,
    shards: CHAR_DICT_SHARDS,
    characters: records.length,
    ranked_top_5000: records.filter((r) => r.rank !== null && r.rank <= 5000).length,
    with_words: records.filter((r) => r.words.length > 0).length,
    words: records.reduce((n, r) => n + r.words.length, 0),
    gzipped_bytes: bytes,
    sources: [
      { name: 'CC-CEDICT', url: 'https://www.mdbg.net/chinese/dictionary?page=cedict', licence: 'CC BY-SA 4.0', entries: cedict.length },
      { name: 'Make Me a Hanzi (dictionary.txt)', url: 'https://github.com/skishore/makemeahanzi', licence: 'LGPL-3.0-or-later', entries: hanzi.size },
      { name: 'wordfreq (large_zh)', url: 'https://github.com/rspeer/wordfreq', licence: 'CC BY-SA 4.0 (data)', entries: freq.size },
    ],
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${records.length} characters, ${manifest.words} words, ${(bytes / 1e6).toFixed(2)} MB gzipped → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
