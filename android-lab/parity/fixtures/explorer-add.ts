/**
 * "+ Add as card" in the explorer (shared/explorer/addCard.ts): explorerAddStep over every
 * combination of pinyin / meaning / device reading / online / glossed, plus the copy.
 * Writes explorer-add.json; core ExplorerAddParityTest asserts the Kotlin port
 * (core/…/explorer/ExplorerAdd.kt) matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXPLORER_ADD_WAIT_MS, explorerAddHint, explorerAddProblem, explorerAddPrompt, explorerAddStep } from '../../../shared/explorer/addCard';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: explorer-add <out-dir>');
mkdirSync(OUT, { recursive: true });

const HANZI = ['银行', ' 吴侬软语 ', '好'];
const PINYIN = ['', 'yínháng', '  wú  nóng ', '\t'];
const ENGLISH = ['', 'bank', '  soft   Wu dialect  ', ' '];
const DEVICE = ['', 'yínháng', 'wúnóngruǎnyǔ'];

const steps: unknown[] = [];
for (const hanzi of HANZI)
  for (const pinyin of PINYIN)
    for (const english of ENGLISH)
      for (const devicePinyin of DEVICE)
        for (const online of [true, false])
          for (const glossed of [true, false]) {
            const input = { hanzi, pinyin, english, devicePinyin, online, glossed };
            steps.push({ input, out: explorerAddStep(input) });
          }

const copy = {
  prompts: HANZI.map((h) => ({ hanzi: h, out: explorerAddPrompt(h) })),
  hints: (['offline', 'no_meaning'] as const).flatMap((reason) => [true, false].map((has) => ({ reason, has, out: explorerAddHint(reason, has) }))),
  problems: ['', ' ', 'bank'].flatMap((english) => [true, false].map((online) => ({ english, online, out: explorerAddProblem(english, online) }))),
  wait_ms: EXPLORER_ADD_WAIT_MS,
};

writeFileSync(join(OUT, 'explorer-add.json'), JSON.stringify({ steps, copy }));
