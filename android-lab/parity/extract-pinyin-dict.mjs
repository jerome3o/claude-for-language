#!/usr/bin/env node
/**
 * Extracts pinyin-pro's dictionaries into the Lab app's resource
 * android-lab/core/src/main/resources/pinyin/pinyin-dict.txt, read by core/Pinyin.kt.
 *
 * pinyin-pro keeps its dictionaries private, so this loads the package's dist source,
 * appends an export of the internals and imports that copy. What is written is the
 * FINAL state the library runs with (later duplicates already applied):
 *
 *   #chars                        DICT1: one line per pinyin value
 *   <pinyin>\t<chars…>            every character whose DICT1 entry is exactly <pinyin>
 *   #words                        the AC-automaton patterns pinyin() can match
 *   <zh>\t<pinyin>\t<D|R>         with surname 'off': per word the pattern `find` returns
 *                                 (highest priority / probability, ties = last inserted);
 *                                 D = Probability.DICT (2e-8), R = Probability.Rule (1e-12)
 *
 * Regenerate after a pinyin-pro upgrade (then run `./gradlew :core:test`, whose
 * PinyinParityTest compares the Kotlin port against the real library):
 *
 *   node android-lab/parity/extract-pinyin-dict.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const pkgDir = join(root, 'node_modules', 'pinyin-pro');
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const src = readFileSync(join(pkgDir, 'dist', 'index.mjs'), 'utf8');

const tmp = mkdtempSync(join(tmpdir(), 'pinyin-extract-'));
const file = join(tmp, 'pinyin-pro-internals.mjs');
writeFileSync(file, `${src}\nexport { DICT1 as __DICT1, acTree as __acTree, Priority as __Priority };\n`);
const lib = await import(pathToFileURL(file).href);
rmSync(tmp, { recursive: true, force: true });

const { __DICT1: DICT1, __acTree: acTree, __Priority: Priority } = lib;
const cpLen = (s) => [...s].length;
const fail = (msg) => { throw new Error(`extract-pinyin-dict: ${msg}`); };

// ---- DICT1 ----
const byPinyin = new Map();
const addChar = (ch, py) => {
  if (typeof py !== 'string' || py === '') fail(`empty pinyin for ${ch}`);
  if (py.includes('\t') || py.includes('\n')) fail(`bad pinyin ${JSON.stringify(py)}`);
  if (cpLen(ch) !== 1) fail(`DICT1 key is not one code point: ${JSON.stringify(ch)}`);
  if (!byPinyin.has(py)) byPinyin.set(py, []);
  byPinyin.get(py).push(ch);
};
DICT1.NumberDICT.forEach((py, code) => { if (py !== undefined) addChar(String.fromCharCode(code), py); });
for (const [ch, py] of DICT1.StringDICT) addChar(ch, py);
let charCount = 0;
const charLines = [];
for (const [py, chars] of byPinyin) {
  charCount += chars.length;
  charLines.push(`${py}\t${chars.join('')}`);
}

// ---- word patterns: walk the automaton's trie ----
const wordLines = [];
const stack = [[acTree.root, '']];
while (stack.length) {
  const [node, prefix] = stack.pop();
  for (const [key, child] of node.children) stack.push([child, prefix + key]);
  // AC.match with surname 'off': cur.patterns.find(p => p.priority !== Priority.Surname)
  const p = node.patterns.find((item) => item.priority !== Priority.Surname);
  if (!p) continue;
  if (p.zh !== prefix) fail(`pattern ${p.zh} at node ${prefix}`);
  if (p.priority !== Priority.Normal) fail(`unexpected priority ${p.priority} for ${p.zh}`);
  if (p.length !== cpLen(p.zh)) fail(`length ${p.length} != code points of ${p.zh}`);
  if (p.length < 2) fail(`single-character pattern ${p.zh}`);
  const flag = p.probability === 2e-8 ? 'D' : p.probability === 1e-12 ? 'R' : fail(`probability ${p.probability} for ${p.zh}`);
  if (/[\t\n]/.test(p.zh + p.pinyin)) fail(`bad word ${p.zh}`);
  wordLines.push(`${p.zh}\t${p.pinyin}\t${flag}`);
}
wordLines.sort();

const out = join(root, 'android-lab', 'core', 'src', 'main', 'resources', 'pinyin', 'pinyin-dict.txt');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, [`#pinyin-pro ${version}`, '#chars', ...charLines, '#words', ...wordLines, ''].join('\n'));
console.log(`pinyin-pro ${version}: ${charCount} characters (${charLines.length} pinyin values), ${wordLines.length} words -> ${out}`);
