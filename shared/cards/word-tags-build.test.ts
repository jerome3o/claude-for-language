import { describe, expect, it } from 'vitest';
import { parseCedict, type CedictEntry } from '../chars/build';
import {
  buildWordTagFile,
  curatedProblems,
  entriesRegister,
  formatWordTagRow,
  hskLevels,
  mainEntry,
  measuresFromGlosses,
  parseHanlpDict,
  parseJiebaDict,
  posCodesForTag,
  posFromCounts,
  registerFromGlosses,
  registerInGloss,
  wordTagRow,
} from './word-tags-build';
import { parseWordTagLexicon } from './word-tags';

const CEDICT = parseCedict(
  [
    '書 书 [Shu1] /abbr. for 書經|书经[Shu1 jing1]/',
    '書 书 [shu1] /book/letter/document/CL:本[ben3],冊|册[ce4],部[bu4]/to write/',
    '您 您 [nin2] /you (courteous, as opposed to informal 你[ni3])/',
    '嗎 吗 [ma2] /(coll.) what?/',
    '嗎 吗 [ma5] /(question particle for "yes-no" questions)/',
    '機場 机场 [ji1 chang3] /airport; airfield/(slang) service provider for Shadowsocks/CL:家[jia1],處|处[chu4]/',
    '地區 地区 [di4 qu1] /region; area (informal or geographical term)/prefecture/',
    '和 和 [he2] /(joining two nouns) and; together with; with (Taiwan pr. [han4])/(math.) sum/',
    '老婆 老婆 [lao3 po5] /(coll.) wife/',
    '屌絲 屌丝 [diao3 si1] /loser (Internet slang)/',
    '他媽的 他妈的 [ta1 ma1 de5] /(taboo curse) damn it!/fucking/',
    '博士 博士 [bo2 shi4] /doctor (as an academic degree)/(old) person specialized in a skill or trade/(old) court academician/',
    '畫蛇添足 画蛇添足 [hua4 she2 tian1 zu2] /lit. draw legs on a snake (idiom); fig. to ruin the effect by adding sth superfluous/',
    '本 本 [ben3] /(bound form) root; stem/this; the current/classifier for books, periodicals, files etc/',
    '水 水 [shui3] /water/classifier for washings of a garment/',
    '睡覺 睡觉 [shui4 jiao4] /to go to bed/to sleep/',
    '網路 网路 [wang3 lu4] /(Tw) network/',
    '一路平安 一路平安 [yi1 lu4 ping2 an1] /to have a pleasant journey/Bon voyage!/',
  ].join('\n'),
);
const byWord = new Map<string, CedictEntry[]>();
for (const e of CEDICT) byWord.set(e.simp, [...(byWord.get(e.simp) ?? []), e]);

const hanlp = parseHanlpDict(['书\tn\t1984', '研究\tvn\t7526\tv\t1011', '帮忙\tvi\t863\tvn\t144', '本\trz\t4326', '水\tn\t4513', '一路平安\tnz\t5', '中国\tns\t39573', '喜欢\tvi\t3369\tvn\t258', '吗\ty\t4859'].join('\n'));
const jieba = parseJiebaDict(['一 217830 m', '行 1000 zg', '啥 3651 r'].join('\n'));
const inputs = { cedict: byWord, hanlp, jieba, hsk: new Map([['书', 1], ['研究', 4]]) };

describe('part of speech', () => {
  it('maps HanLP / jieba tags to our codes', () => {
    expect(posCodesForTag('vn')).toEqual(['v', 'n']);
    expect(posCodesForTag('vi')).toEqual(['v']);
    expect(posCodesForTag('nis')).toEqual(['n']);
    expect(posCodesForTag('ns')).toEqual(['nr']);
    expect(posCodesForTag('ryv')).toEqual(['ry']);
    expect(posCodesForTag('rzs')).toEqual(['r']);
    expect(posCodesForTag('ude1')).toEqual(['u']);
    expect(posCodesForTag('pba')).toEqual(['p']);
    expect(posCodesForTag('ad')).toEqual(['a', 'd']);
    expect(posCodesForTag('ng')).toEqual([]);
    expect(posCodesForTag('zg')).toEqual([]);
  });

  it('ranks by count, a second one only with ≥ 20 % of the first', () => {
    expect(posFromCounts([['vn', 7526], ['v', 1011]])).toEqual(['v', 'n']);
    expect(posFromCounts([['vi', 863], ['vn', 144]])).toEqual(['v']);
    expect(posFromCounts([['n', 100], ['v', 30]])).toEqual(['n', 'v']);
    expect(posFromCounts([['n', 100], ['v', 10]])).toEqual(['n']);
    expect(posFromCounts([['nz', 5]], false)).toEqual([]);
    expect(posFromCounts([])).toEqual([]);
  });
});

describe('register from CC-CEDICT', () => {
  it('reads the first register word of each parenthetical note', () => {
    expect(registerInGloss('you (courteous, as opposed to informal 你[ni3])')).toEqual(['P']);
    expect(registerInGloss('loser (Internet slang)')).toEqual(['S']);
    expect(registerInGloss('(taboo curse) damn it!')).toEqual(['R']);
    expect(registerInGloss('(coll.) wife')).toEqual(['C']);
    expect(registerInGloss('dialectal equivalent of 怎麼|怎么[zen3 me5]')).toEqual(['G']);
    expect(registerInGloss('(Tw) network')).toEqual(['T']);
  });

  it('ignores "literally", pronunciation notes, hedges and descriptions', () => {
    expect(registerInGloss('(lit.) to eat vinegar')).toEqual([]);
    expect(registerInGloss('and; with (Taiwan pr. [han4])')).toEqual([]);
    expect(registerInGloss('region; area (informal or geographical term)')).toEqual([]);
    expect(registerInGloss('(of an old person) frail')).toEqual([]);
  });

  it('uses the first sense only', () => {
    expect(registerFromGlosses(['airport', '(slang) a VPN provider'])).toEqual([]);
    expect(registerFromGlosses(['doctor', '(old) specialist', '(old) academician'])).toEqual([]);
    expect(registerFromGlosses(['CL:位[wei4]', '(coll.) wife'])).toEqual(['C']);
  });

  it('keeps only what every common reading shares (吗: the particle is neutral)', () => {
    const entries = byWord.get('吗')!;
    expect(entriesRegister(entries[0], entries)).toEqual([]);
    expect(entriesRegister(byWord.get('老婆')![0], byWord.get('老婆')!)).toEqual(['C']);
  });
});

describe('main entry, measure words, HSK', () => {
  it('picks the first plain entry, or the preferred reading', () => {
    expect(mainEntry(byWord.get('书')!)?.pinyin).toBe('shu1');
    expect(mainEntry(byWord.get('吗')!)?.pinyin).toBe('ma2');
    expect(mainEntry(byWord.get('吗')!, 'ma')?.pinyin).toBe('ma5');
  });

  it('parses CL: lines into simplified measure words with tone marks', () => {
    expect(measuresFromGlosses(['book', 'CL:本[ben3],冊|册[ce4],部[bu4]'])).toEqual([
      { char: '本', pinyin: 'běn' },
      { char: '册', pinyin: 'cè' },
      { char: '部', pinyin: 'bù' },
    ]);
    expect(measuresFromGlosses(['CL:個|个[ge4]'])).toEqual([{ char: '个', pinyin: 'gè' }]);
    expect(measuresFromGlosses(['water'])).toEqual([]);
  });

  it('takes the lowest HSK 3.0 level and ignores the old HSK', () => {
    const levels = hskLevels([
      { simplified: '书', level: ['newest-1', 'new-1', 'old-1'] },
      { simplified: '只', level: ['new-2', 'new-3', 'old-3'] },
      { simplified: '旧', level: ['old-4'] },
      { simplified: '难', level: ['new-7'] },
    ]);
    expect([...levels]).toEqual([['书', 1], ['只', 2], ['难', 7]]);
  });
});

describe('rows and the file', () => {
  it('a full row', () => {
    expect(wordTagRow('书', inputs)).toEqual({ hanzi: '书', pos: ['n'], register: '', measures: [{ char: '本', pinyin: 'běn' }, { char: '册', pinyin: 'cè' }, { char: '部', pinyin: 'bù' }], hsk: 1, trad: '書', separable: null });
    expect(formatWordTagRow(wordTagRow('书', inputs)!)).toBe('书\tn\t\t本:běn,册:cè,部:bù\t1\t書');
  });

  it('separable verbs (curated) are verbs with their example', () => {
    const row = wordTagRow('睡觉', inputs)!;
    expect(row.pos).toEqual(['v']);
    expect(row.separable).toBe('睡了一个好觉');
  });

  it('idioms from CC-CEDICT; 本 is a measure word first, 水 is not', () => {
    expect(wordTagRow('画蛇添足', inputs)!.pos).toEqual(['i']);
    expect(wordTagRow('本', inputs)!.pos).toEqual(['q', 'r']);
    expect(wordTagRow('水', inputs)!.pos).toEqual(['n']);
  });

  it('a name tag only when CC-CEDICT has no common entry', () => {
    expect(wordTagRow('一路平安', inputs)).toBeNull();
    expect(wordTagRow('中国', inputs)!.pos).toEqual(['nr']);
  });

  it('jieba fills in when HanLP has nothing; curated register replaces the dictionary’s', () => {
    expect(wordTagRow('一', inputs)!.pos).toEqual(['m']);
    expect(wordTagRow('啥', inputs)).toMatchObject({ pos: ['r'], register: 'I' });
    expect(wordTagRow('您', inputs)!.register).toBe('P');
    expect(wordTagRow('他妈的', inputs)!.register).toBe('R');
    expect(wordTagRow('网路', inputs)!.register).toBe('T');
  });

  it('a single character takes no register from the dictionary', () => {
    expect(wordTagRow('吗', inputs)!.register).toBe('');
  });

  it('the built file round-trips through the app’s parser', () => {
    const { text, rows } = buildWordTagFile({ ...inputs, words: ['书', '研究', '帮忙', '老婆'] }, ['test']);
    const lex = parseWordTagLexicon(text);
    expect(lex.words.size).toBe(rows.length);
    expect(lex.words.get('研究')).toEqual({ pos: ['v', 'n'], register: [], measures: [], hsk: 4, trad: null, separable: null });
    expect(lex.words.get('帮忙')?.separable).toBe('帮我一个忙');
    expect(lex.markers.find((m) => m.text === '请')).toEqual({ text: '请', register: 'P', clauseStart: true });
    expect(text.startsWith('# test\n#words\n')).toBe(true);
  });

  it('the curated lists are clean', () => {
    expect(curatedProblems()).toEqual([]);
  });
});
