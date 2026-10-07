/**
 * Builds the word-frequency list behind "Most common first" (Settings → New cards →
 * Order new cards by; shared/decks/new-card-order.ts):
 *
 *   npm run build:word-freq                         # downloads wordfreq large_zh into scripts/.cache
 *   npm run build:word-freq -- --wordfreq large_zh.msgpack.gz
 *
 * Output: shared/data/frequency/word-freq.txt (format in shared/decks/frequency.ts). The web
 * app imports it as a lazy chunk (precached for offline), the Lab app reads the same file
 * as a core resource. Deterministic: the same input gives a byte-identical file.
 *
 * Source: wordfreq https://github.com/rspeer/wordfreq (large_zh), data CC BY-SA 4.0 —
 * credited on the app's Licences page (Settings → About → Licences).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseWordfreq } from '../shared/chars/build';
import { decodeMsgpack } from '../shared/chars/msgpack';
import { buildFrequencyList, WORD_FREQ_CHARS, WORD_FREQ_WORDS } from '../shared/decks/frequency';

const SOURCE = 'https://raw.githubusercontent.com/rspeer/wordfreq/master/wordfreq/data/large_zh.msgpack.gz';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = resolve(dirname(process.argv[1] ?? '.'), '..');
const repoRoot = existsSync(join(root, 'shared')) ? root : process.cwd();
const cacheDir = join(repoRoot, 'scripts', '.cache');
const outFile = resolve(arg('out') ?? join(repoRoot, 'shared', 'data', 'frequency', 'word-freq.txt'));

async function source(): Promise<Buffer> {
  const given = arg('wordfreq');
  if (given) return readFileSync(given);
  const file = join(cacheDir, SOURCE.split('/').pop()!);
  if (!existsSync(file)) {
    mkdirSync(cacheDir, { recursive: true });
    console.log(`downloading ${SOURCE}`);
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(file);
}

async function main() {
  const buf = await source();
  const freq = parseWordfreq(decodeMsgpack(buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf));
  const text = buildFrequencyList(freq, {
    words: Number(arg('words') ?? WORD_FREQ_WORDS),
    chars: Number(arg('chars') ?? WORD_FREQ_CHARS),
    header: [
      'Word and character frequency ranks for "Most common first" (shared/decks/new-card-order.ts).',
      'Built by scripts/build-word-freq.ts from wordfreq large_zh (https://github.com/rspeer/wordfreq),',
      'data licence CC BY-SA 4.0. Words: the most frequent all-Han tokens, one per line, most frequent',
      'first. Characters: ranked by summed word frequency, most frequent first.',
    ],
  });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, text);
  console.log(`${(Buffer.byteLength(text) / 1e3).toFixed(0)} kB → ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
