/**
 * Builds the extra word data behind the word segmenter (shared/chinese/segment.ts):
 *
 *   npm run build:segment-words
 *
 * Reads the word dictionary already in the repo (worker/char-dict/words/*.dat, built by
 * scripts/build-word-dict.ts from CC-CEDICT + wordfreq) and writes
 * shared/data/frequency/segment-words.txt (format in shared/chinese/segment.ts
 * `buildSegmentWords`): every headword that is NOT in shared/data/frequency/word-freq.txt with
 * its wordfreq rank (the same ranking as the word-freq list's line numbers), and the list's
 * words that are not headwords (jieba compounds). Deterministic: the same input gives a
 * byte-identical file.
 *
 * Sources: CC-CEDICT (CC BY-SA 4.0), wordfreq large_zh (data CC BY-SA 4.0) — credited under
 * Settings → About → Licences with the character dictionary.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseFrequencyList } from '../shared/decks/frequency';
import { buildSegmentWords } from '../shared/chinese/segment';
import type { WordRecord } from '../shared/chars/types';

const root = resolve(dirname(process.argv[1] ?? '.'), '..');
const repoRoot = existsSync(join(root, 'shared')) ? root : process.cwd();
const dictDir = join(repoRoot, 'worker', 'char-dict', 'words');
const freqFile = join(repoRoot, 'shared', 'data', 'frequency', 'word-freq.txt');
const outFile = join(repoRoot, 'shared', 'data', 'frequency', 'segment-words.txt');

const ranks = new Map<string, number>();
for (const f of readdirSync(dictDir).sort()) {
  if (!f.endsWith('.dat')) continue;
  const buf = readFileSync(join(dictDir, f));
  const shard = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8')) as Record<string, WordRecord>;
  for (const r of Object.values(shard)) if (r.rank !== null) ranks.set(r.hanzi, r.rank);
}
const listed = parseFrequencyList(readFileSync(freqFile, 'utf8')).words;
const text = buildSegmentWords(ranks, listed, [
  'Words for the word segmenter (shared/chinese/segment.ts), beside word-freq.txt. Built by',
  'scripts/build-segment-words.ts from the word dictionary (CC-CEDICT + wordfreq large_zh, CC BY-SA 4.0).',
  '#ranked: dictionary words not in word-freq.txt, in rank order; each line is "word<TAB>step" =',
  'its wordfreq rank (the scale of word-freq.txt line numbers) minus the previous line\'s rank.',
  '#compounds: word-freq.txt words that are not dictionary headwords (jieba tokens such as 这是).',
]);
writeFileSync(outFile, text);
console.log(`${(Buffer.byteLength(text) / 1e3).toFixed(0)} kB → ${outFile}`);
