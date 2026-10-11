/**
 * Builds the word-tag lexicon behind the tags on a card's answer side (docs/STUDY_SESSION.md
 * "Word tags"; rules in shared/cards/word-tags-build.ts, format in shared/cards/word-tags.ts):
 *
 *   npm run build:word-tags                     # downloads the sources into scripts/.cache
 *   npm run build:word-tags -- --max-rank 40000 # fewer dictionary words
 *
 * Covers the word dictionary's headwords (worker/char-dict/words, CC-CEDICT ∩ wordfreq) up to
 * --max-rank, the frequency list's words and characters (shared/data/frequency/word-freq.txt),
 * every HSK 3.0 word and the curated lists. Writes shared/data/word-tags/word-tags.txt
 * (byte-identical for the same input). Sources and licences: shared/data/word-tags/README.md.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseCedict, type CedictEntry } from '../shared/chars/build';
import type { CharRecord, WordRecord } from '../shared/chars/types';
import { parseFrequencyList } from '../shared/decks/frequency';
import { buildWordTagFile, curatedProblems, hskLevels, parseHanlpDict, parseJiebaDict } from '../shared/cards/word-tags-build';

const SOURCES = {
  cedict: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
  hanlp: 'https://raw.githubusercontent.com/hankcs/HanLP/1.x/data/dictionary/CoreNatureDictionary.txt',
  jieba: 'https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt',
  hsk: 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json',
} as const;
const CACHE_NAMES: Record<keyof typeof SOURCES, string> = {
  cedict: 'cedict.txt.gz',
  hanlp: 'hanlp_core.txt',
  jieba: 'jieba_dict.txt',
  hsk: 'hsk.json',
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = resolve(dirname(process.argv[1] ?? '.'), '..');
const repoRoot = existsSync(join(root, 'shared')) ? root : process.cwd();
const cacheDir = join(repoRoot, 'scripts', '.cache');
const outFile = join(repoRoot, 'shared', 'data', 'word-tags', 'word-tags.txt');

async function source(key: keyof typeof SOURCES): Promise<Buffer> {
  const given = arg(key);
  if (given) return readFileSync(given);
  const file = join(cacheDir, CACHE_NAMES[key]);
  if (!existsSync(file)) {
    mkdirSync(cacheDir, { recursive: true });
    console.log(`downloading ${SOURCES[key]}`);
    const res = await fetch(SOURCES[key]);
    if (!res.ok) throw new Error(`${SOURCES[key]}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(file);
}

const text = (buf: Buffer) => (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');

async function main() {
  const problems = curatedProblems();
  if (problems.length) throw new Error(`curated lists:\n${problems.join('\n')}`);

  const cedict = new Map<string, CedictEntry[]>();
  for (const e of parseCedict(text(await source('cedict')))) {
    const list = cedict.get(e.simp);
    if (list) list.push(e);
    else cedict.set(e.simp, [e]);
  }
  const hanlp = parseHanlpDict(text(await source('hanlp')));
  const jieba = parseJiebaDict(text(await source('jieba')));
  const hsk = hskLevels(JSON.parse(text(await source('hsk'))) as Array<{ simplified: string; level?: string[] }>);

  const maxRank = Number(arg('max-rank') ?? 60_000);
  const words = new Set<string>();
  const dictDir = join(repoRoot, 'worker', 'char-dict', 'words');
  for (const f of readdirSync(dictDir).sort()) {
    if (!f.endsWith('.dat')) continue;
    const shard = JSON.parse(text(readFileSync(join(dictDir, f)))) as Record<string, WordRecord>;
    for (const r of Object.values(shard)) if (r.rank !== null && r.rank <= maxRank) words.add(r.hanzi);
  }
  const freq = parseFrequencyList(readFileSync(join(repoRoot, 'shared', 'data', 'frequency', 'word-freq.txt'), 'utf8'));
  for (const w of freq.words.keys()) if (cedict.has(w) || hanlp.has(w)) words.add(w);
  for (const c of freq.chars.keys()) words.add(c);

  // A character's most used reading picks its main CC-CEDICT entry (着 → zhe5, not zhāo).
  const readings = new Map<string, string>();
  for (const f of readdirSync(join(repoRoot, 'worker', 'char-dict')).sort()) {
    if (!f.endsWith('.dat')) continue;
    const shard = JSON.parse(text(readFileSync(join(repoRoot, 'worker', 'char-dict', f)))) as Record<string, CharRecord>;
    for (const r of Object.values(shard)) if (r.readings[0]) readings.set(r.char, r.readings[0].pinyin);
  }
  // The traditional form only where it earns its bytes: characters, HSK words, the 10,000 most common words.
  const tradWords = new Set<string>([...freq.chars.keys(), ...hsk.keys()]);
  for (const [w, rank] of freq.words) if (rank <= 10_000) tradWords.add(w);

  const { text: out, rows } = buildWordTagFile({ cedict, hanlp, jieba, hsk, words, readings, tradWords }, [
    'Word tags for the answer side of a card (shared/cards/word-tags.ts). Built by scripts/build-word-tags.ts.',
    'Sources: CC-CEDICT (CC BY-SA 4.0) · HanLP 1.x CoreNatureDictionary (Apache-2.0) · jieba dict.txt (MIT) ·',
    'complete-hsk-vocabulary (MIT) · curated lists (shared/cards/word-tags-curated.ts). See README.md here.',
    '#words: hanzi<TAB>pos<TAB>register<TAB>measures<TAB>hsk<TAB>traditional<TAB>separable example (trailing blanks trimmed)',
    '#markers: text<TAB>register — looked for inside sentences ("^" = at the start of a clause)',
  ]);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, out);
  const raw = Buffer.byteLength(out);
  const gz = gzipSync(Buffer.from(out), { level: 9 }).length;
  console.log(`${rows.length} words · ${(raw / 1e3).toFixed(0)} kB (${(gz / 1e3).toFixed(0)} kB gzipped) → ${outFile}`);
  console.log(
    `with pos ${rows.filter((r) => r.pos.length).length} · register ${rows.filter((r) => r.register).length} · measures ${rows.filter((r) => r.measures.length).length} · hsk ${rows.filter((r) => r.hsk !== null).length} · trad ${rows.filter((r) => r.trad).length} · separable ${rows.filter((r) => r.separable).length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
