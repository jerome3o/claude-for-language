import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrequencyList } from '../decks/frequency';
import {
  hskLevel,
  markerRegister,
  parseWordTagLexicon,
  wordTagExplanation,
  wordTagKey,
  wordTags,
  type WordTag,
  type WordTagLexicon,
} from './word-tags';

const data = join(__dirname, '..', 'data');
const lexicon = parseWordTagLexicon(readFileSync(join(data, 'word-tags', 'word-tags.txt'), 'utf8'));
const freq = parseFrequencyList(readFileSync(join(data, 'frequency', 'word-freq.txt'), 'utf8'));
const rankOf = (w: string) => ([...w].length === 1 ? freq.chars.get(w) : freq.words.get(w)) ?? null;

const labels = (hanzi: string, opts: { rank?: boolean } = {}) =>
  wordTags(hanzi, lexicon, opts.rank ? { rank: rankOf(hanzi) } : {}).map((t) => t.label);
const ids = (hanzi: string) => wordTags(hanzi, lexicon).map((t) => t.id);

describe('the shipped word-tag lexicon', () => {
  it('is big enough and parses cleanly', () => {
    expect(lexicon.words.size).toBeGreaterThan(40_000);
    expect(lexicon.markers.length).toBeGreaterThan(40);
    expect(lexicon.markers.some((m) => m.text === '请' && m.clauseStart)).toBe(true);
  });

  it('covers the most common words', () => {
    const top = [...freq.words.keys()].slice(0, 2000);
    const withPos = top.filter((w) => (lexicon.words.get(w)?.pos.length ?? 0) > 0).length;
    expect(withPos / top.length).toBeGreaterThan(0.95);
  });
});

describe('wordTags — real words', () => {
  it.each([
    // nouns, verbs, adjectives, adverbs
    ['书', 'Noun'],
    ['银行', 'Noun'],
    ['电脑', 'Noun'],
    ['老师', 'Noun'],
    ['学习', 'Verb'],
    ['喜欢', 'Verb'],
    ['知道', 'Verb'],
    ['漂亮', 'Adjective'],
    ['高兴', 'Adjective'],
    ['干净', 'Adjective'],
    ['非常', 'Adverb'],
    ['已经', 'Adverb'],
    ['马上', 'Adverb'],
    // function words
    ['个', 'Measure word'],
    ['张', 'Measure word'],
    ['本', 'Measure word'],
    ['我', 'Pronoun'],
    ['他们', 'Pronoun'],
    ['什么', 'Question word'],
    ['怎么', 'Question word'],
    ['在', 'Preposition'],
    ['被', 'Preposition'],
    ['因为', 'Conjunction'],
    ['但是', 'Conjunction'],
    ['了', 'Particle'],
    ['吗', 'Particle'],
    ['的', 'Particle'],
    ['哈哈', 'Sound word'],
    ['一', 'Number'],
    ['今天', 'Time word'],
    ['上面', 'Position word'],
    ['中国', 'Name'],
    ['画蛇添足', 'Idiom 成语'],
    ['一路平安', 'HSK 2'],
  ])('%s → %s', (hanzi, label) => {
    expect(labels(hanzi)).toContain(label);
  });

  it('verbs used as nouns get both, verb first', () => {
    expect(labels('研究').slice(0, 2)).toEqual(['Verb', 'Noun']);
    expect(labels('工作').slice(0, 2)).toEqual(['Verb', 'Noun']);
  });

  it('separable verbs say so, with their split example; no "intransitive" guess (HanLP’s vi is unreliable)', () => {
    expect(labels('睡觉').slice(0, 2)).toEqual(['Verb', 'Separable verb']);
    expect(labels('喜欢')).toEqual(expect.arrayContaining(['Verb']));
    expect(labels('喜欢').join(' ')).not.toMatch(/ntransitive/);
    expect(labels('见面')).toContain('Separable verb');
    expect(labels('帮忙')).toContain('Separable verb');
    expect(labels('毕业')).toContain('Separable verb');
    expect(labels('洗澡')).toContain('Separable verb');
    expect(lexicon.words.get('睡觉')?.separable).toBe('睡了一个好觉');
    // Takes a direct object (担心他): not separable.
    expect(labels('担心')).not.toContain('Separable verb');
    expect(labels('喜欢')).not.toContain('Separable verb');
  });

  it('register: polite, formal, literary, colloquial, informal, slang, rude, regional', () => {
    expect(labels('您')).toContain('Polite');
    expect(labels('请问')).toContain('Polite');
    expect(labels('贵姓')).toContain('Polite');
    expect(labels('光临')).toEqual(expect.arrayContaining(['Polite', 'Formal']));
    expect(labels('予以')).toContain('Formal');
    expect(labels('之')).toContain('Literary');
    expect(labels('老婆')).toContain('Colloquial');
    expect(labels('要是')).toContain('Colloquial');
    expect(labels('啥')).toContain('Informal');
    expect(labels('咋')).toContain('Informal');
    expect(labels('哥们')).toContain('Informal');
    expect(labels('屌丝')).toContain('Slang');
    expect(labels('他妈的')).toContain('Rude');
    expect(labels('网路')).toContain('Taiwan');
  });

  it('register only from a word’s main meaning: no slang cow, no slang airport, no literary 派', () => {
    for (const w of ['牛', '机场', '派', '第', '地区', '吗', '和', '着', '山', '雪']) {
      expect(wordTags(w, lexicon).filter((t) => t.kind === 'register'), w).toEqual([]);
    }
  });

  it('measure words from CC-CEDICT, at most two shown', () => {
    expect(labels('书')).toContain('Measure: 本 běn, 册 cè');
    expect(labels('电脑')).toContain('Measure: 台 tái');
    expect(labels('朋友')).toContain('Measure: 个 gè, 位 wèi');
    // A particle doesn't show its noun reading's measure word.
    expect(ids('地')).not.toContain('measure');
  });

  it('HSK 3.0 levels, 7–9 as one band', () => {
    expect(labels('书')).toContain('HSK 1');
    expect(labels('研究')).toContain('HSK 4');
    expect(labels('画蛇添足')).toContain('HSK 7–9');
    expect(ids('屌丝')).not.toContain('hsk');
  });

  it('frequency tier from the shipped list, only when a rank is given', () => {
    expect(labels('的', { rank: true })).toContain('Top 100');
    expect(labels('银行', { rank: true })).toContain('Top 1,000');
    expect(labels('结账', { rank: true })).toContain('Rare');
    expect(ids('银行')).not.toContain('frequency');
    const tag = wordTags('的', lexicon, { rank: 1 }).find((t) => t.kind === 'frequency');
    expect(tag?.tone).toBe('top100');
  });

  it('an HSK word is never Rare, however low the written-text list ranks it', () => {
    // 画蛇添足 (HSK 7–9) and 一块儿 (HSK 1) rank beyond 10,000; 一下儿 (HSK 1) isn't in the list.
    for (const w of ['画蛇添足', '一块儿', '一下儿']) {
      expect(labels(w, { rank: true })).not.toContain('Rare');
      expect(wordTags(w, lexicon, { rank: null }).map((t) => t.kind)).not.toContain('frequency');
    }
    // A character on the HSK list as a word (拎, HSK 7–9, character rank ~3,700).
    expect(labels('拎', { rank: true })).not.toContain('Rare');
    // Not on the HSK list: still Rare.
    expect(wordTags('结账', lexicon, { rank: null }).map((t) => t.label)).toContain('Rare');
    expect(hskLevel(lexicon, '一块儿')).toBe(1);
    expect(hskLevel(lexicon, ' 画蛇添足。')).toBe(7);
    expect(hskLevel(lexicon, '结账')).toBeNull();
    expect(hskLevel(null, '书')).toBeNull();
  });

  it('traditional form when it differs', () => {
    expect(labels('长得')).toContain('Trad. 長得');
    expect(labels('书')).toContain('Trad. 書');
    expect(ids('您')).not.toContain('trad');
  });

  it('display order: pos · separable · register · measure · HSK · frequency · trad', () => {
    const kinds = wordTags('见面', lexicon, { rank: 1500 }).map((t) => t.kind);
    expect(kinds).toEqual(['pos', 'separable', 'hsk', 'frequency', 'trad']);
    const order = ['pos', 'separable', 'register', 'measure', 'hsk', 'frequency', 'trad'];
    for (const w of ['书', '您', '光临', '朋友', '老婆']) {
      const k = wordTags(w, lexicon, { rank: rankOf(w) }).map((t) => order.indexOf(t.kind));
      expect([...k].sort((a, b) => a - b), w).toEqual(k);
    }
  });

  it('exclude drops a kind (the explorer shows how common a word is itself)', () => {
    expect(wordTags('的', lexicon, { rank: 1, exclude: ['frequency'] }).some((t) => t.kind === 'frequency')).toBe(false);
  });
});

describe('wordTags — phrases and sentences', () => {
  it('trims edge punctuation before the lookup', () => {
    expect(wordTagKey(' 你好！ ')).toBe('你好');
    expect(labels('您！')).toContain('Polite');
  });

  it('a phrase that isn’t a dictionary word is a Phrase', () => {
    expect(labels('喝咖啡')).toEqual(['Phrase']);
  });

  it('a sentence gets only the register words found in it', () => {
    expect(labels('请问，银行在哪儿？')).toEqual(['Polite']);
    expect(labels('您贵姓？')).toEqual(['Polite']);
    expect(labels('你干嘛呢？')).toEqual(['Informal']);
    expect(labels('我今天很忙。')).toEqual([]);
    expect(labels('您贵姓')).toEqual(['Phrase', 'Polite']); // no 。？ — a phrase with a polite word
    expect(labels('喝咖啡吧')).toEqual(['Phrase']);
  });

  it('请 counts only at the start of a clause (请坐, not 申请 / 邀请)', () => {
    expect(markerRegister('请坐。', lexicon.markers)).toEqual(['P']);
    expect(markerRegister('我想申请签证。', lexicon.markers)).toEqual([]);
    expect(markerRegister('他邀请我。', lexicon.markers)).toEqual([]);
    expect(markerRegister('来，请喝茶。', lexicon.markers)).toEqual(['P']);
  });

  it('no lexicon → no tags; empty text → none', () => {
    expect(wordTags('书', null)).toEqual([]);
    expect(wordTags('', lexicon)).toEqual([]);
    expect(wordTags('！', lexicon)).toEqual([]);
  });
});

describe('wordTagExplanation', () => {
  const explain = (hanzi: string, kind: WordTag['kind']) => {
    const tag = wordTags(hanzi, lexicon, { rank: rankOf(hanzi) }).find((t) => t.kind === kind);
    if (!tag) throw new Error(`${hanzi} has no ${kind} tag`);
    return wordTagExplanation(tag, hanzi, lexicon);
  };

  it('every tag has a title and a body', () => {
    for (const w of ['书', '睡觉', '您', '研究', '画蛇添足', '老婆', '喝咖啡', '个', '什么', '在']) {
      for (const tag of wordTags(w, lexicon, { rank: rankOf(w) })) {
        const e = wordTagExplanation(tag, w, lexicon);
        expect(e.title, `${w} ${tag.id}`).not.toBe('');
        expect(e.body, `${w} ${tag.id}`).not.toBe('');
        expect(e.source, `${w} ${tag.id}`).not.toBe('');
      }
    }
  });

  it('the measure example is built from the word; the separable one is the curated split', () => {
    expect(explain('书', 'measure').example).toBe('一本书');
    expect(explain('书', 'measure').body).toContain('本 (běn) or 册 (cè)');
    expect(explain('睡觉', 'separable').example).toBe('睡了一个好觉');
    expect(explain('研究', 'hsk').body).toContain('level 4');
    expect(explain('长得', 'trad').body).toContain('長得');
  });

  it('a tiny hand-made lexicon works the same way', () => {
    const tiny: WordTagLexicon = parseWordTagLexicon(['#words', '试试\tv,n\tC\t次:cì\t3\t試試\t试了试', '#markers', '^请\tP', ''].join('\n'));
    expect(wordTags('试试', tiny).map((t) => t.label)).toEqual(['Verb', 'Noun', 'Separable verb', 'Colloquial', 'Measure: 次 cì', 'HSK 3', 'Trad. 試試']);
  });
});
