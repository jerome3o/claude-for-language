/** A tiny slice of the three sources for build.test.ts (same formats as the real files). */
export const TINY_CEDICT = `# CC-CEDICT tiny fixture
行 行 [hang2] /(bound form) row; line/(bound form) line of business; trade; profession/
行 行 [heng2] /used in 道行[dao4 heng2]/
行 行 [xing2] /(bound form) to walk; to go; to travel/capable; competent/
銀 银 [yin2] /silver/
銀行 银行 [yin2 hang2] /bank/CL:家[jia1],個|个[ge4]/
進行 进行 [jin4 xing2] /to proceed; to be in progress/
行業 行业 [hang2 ye4] /trade; profession; industry/
銀 银 [Yin2] /surname Yin/
一樣 一样 [yi1 yang4] /same/like/
一 一 [yi1] /one/single/
樣 样 [yang4] /manner; pattern; way/
西安 西安 [Xi1 an1] /Xi'an, capital of Shaanxi/
一點兒 一点儿 [yi1 dian3 r5] /a little/
不了 不了 [bu4 liao3] /unable to/without end/
`;

export const TINY_HANZI = [
  { character: '行', definition: 'to go, to walk, to move; professional', pinyin: ['xíng'], decomposition: '⿰彳亍', etymology: { type: 'ideographic', hint: "To take small steps 亍 with one's feet 彳" }, radical: '行', matches: [[0], [0], [0], [1], [1], [1]] },
  { character: '彳', definition: 'to step with the left foot', pinyin: ['chì'], decomposition: '？', radical: '彳', matches: [[0], [0], [0]] },
  { character: '亍', definition: 'to take small steps', pinyin: ['chù'], decomposition: '？', radical: '二', matches: [[0], [0], [0]] },
  { character: '银', definition: 'silver; cash, money, wealth', pinyin: ['yín'], decomposition: '⿰钅艮', etymology: { type: 'pictophonetic', phonetic: '艮', semantic: '钅', hint: 'money' }, radical: '钅', matches: [[0], [0], [0], [0], [0], [1], [1], [1], [1], [1], [1]] },
  { character: '钅', definition: 'gold, metal', pinyin: ['jīn'], decomposition: '？', radical: '钅', matches: [[0], [0], [0], [0], [0]] },
  { character: '一', definition: 'one; a, an; alone', pinyin: ['yī'], decomposition: '？', radical: '一', matches: [[0]] },
].map((r) => JSON.stringify(r)).join('\n');

/** wordfreq cBpack, already decoded: header, then buckets of words at −i centibels. */
export const TINY_WORDFREQ: unknown[] = [
  { format: 'cB', version: 1 },
  ['一'],
  [],
  ['进行', '行'],
  ['一样', '银行'],
  ['行业'],
  ['一点儿', '不了', '西安'],
];
