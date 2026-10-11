/**
 * Golden vectors for the Kotlin port of shared/cards/word-tags-ai.ts (core/…/cards/WordTagsAi.kt),
 * over the SHIPPED lexicon: parsing stored verdicts (incl. junk), the merge with the lexicon's tags
 * (with / without a rank, with an exclude) and every tag's explanation. Writes word-tags-ai.json;
 * checked by WordTagsAiParityTest.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseWordTagLexicon } from '../../../shared/cards/word-tags';
import { cleanRegisterNote, explainWordTag, parseAiWordTags, wordTagsWithAi } from '../../../shared/cards/word-tags-ai';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
let root = OUT;
while (!existsSync(join(root, 'android-lab', 'parity')) && dirname(root) !== root) root = dirname(root);
if (!existsSync(join(root, 'android-lab', 'parity'))) throw new Error(`repo root not found above ${OUT}`);
const lexicon = parseWordTagLexicon(readFileSync(join(root, 'shared/data/word-tags/word-tags.txt'), 'utf8'));

const RAW: Array<string | null> = [
  null,
  '',
  'not json',
  '[]',
  '{"transitivity":"transitive"}',
  '{"confidence":"sure"}',
  '{"v":0,"confidence":"high"}',
  '{"v":null,"confidence":"high"}',
  '{"v":2,"confidence":"medium","transitivity":"both"}',
  '{"confidence":"high"}',
  '{"v":1,"transitivity":"transitive","register":"neutral","confidence":"high"}',
  '{"v":1,"transitivity":"intransitive","separable":true,"register":"informal","register_note":"casual speech","confidence":"medium"}',
  '{"v":1,"transitivity":"transitive","register":"formal","register_note":"  formal   written;\\n in speech use 告诉  ","confidence":"high"}',
  '{"v":1,"transitivity":"both","register":"slang","confidence":"low"}',
  '{"v":1,"transitivity":"n/a","register":"polite","register_note":"' + 'x'.repeat(75) + '","confidence":"high"}',
  '{"v":1,"transitivity":"sideways","separable":"yes","register":"posh","register_note":42,"confidence":"high"}',
  '{"v":1,"separable":1,"register":"rude","confidence":"medium"}',
  '{"v":1,"register":"literary","confidence":"high"}',
  '{"v":1.0,"transitivity":"transitive","separable":false,"confidence":"high"}',
];

const HANZI = [
  '告诉', '告知', '休息', '吃', '见面', '睡觉', '游泳', '散步', '书', '漂亮', '您', '打扰', '请问', '喝咖啡', '看一下',
  '我今天很忙。', '您慢走。', '画蛇添足', 'hello', '', '老婆', '研究', '学习', '他邀请我。', '帮忙', '一路平安', ' 告诉！ ',
];

const parsed = RAW.map((raw) => ({ raw, ai: parseAiWordTags(raw) }));
const cases: unknown[] = [];
for (const hanzi of HANZI) {
  for (const { raw, ai } of parsed) {
    if (!ai) continue;
    const tags = wordTagsWithAi(hanzi, lexicon, ai);
    cases.push({
      hanzi,
      raw,
      tags,
      with_rank: wordTagsWithAi(hanzi, lexicon, ai, { rank: 500 }),
      excluded: wordTagsWithAi(hanzi, lexicon, ai, { rank: null, exclude: ['frequency', 'transitivity', 'trad'] }),
      explanations: tags.map((t) => explainWordTag(t, hanzi, lexicon, ai)),
    });
  }
}

writeFileSync(
  join(OUT, 'word-tags-ai.json'),
  JSON.stringify(
    {
      parsed,
      notes: ['', '  a  b ', 'x'.repeat(70), ' 正式\t书面 '].map((s) => ({ input: s, out: cleanRegisterNote(s) })),
      no_lexicon: wordTagsWithAi('告诉', null, parseAiWordTags(RAW[10])),
      cases,
    },
    null,
    1,
  ),
);
