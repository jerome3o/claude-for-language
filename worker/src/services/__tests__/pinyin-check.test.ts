import { describe, expect, it, vi } from 'vitest';
import { pinyinFixesText, pinyinFixSummary, pinyinWarningsText } from '@shared/pinyin/fixes';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCharRecords, getWordRecords } from '../char-dict';
import { checkAuthoredPinyin, checkSpecPinyin, fixSpecPinyin, type PinyinReadingSources } from '../pinyin-check';
import { validateLessonSpec, type CustomLessonSpec } from '@shared/lesson';
import { validateReaderSpec, type ReaderSpec } from '@shared/reader';

describe('checkAuthoredPinyin', () => {
  it('fixes a syllable its character never has (扶梯 fúqī → fútī), keeping the rest as written', async () => {
    const r = await checkAuthoredPinyin('我们坐扶梯上去吧。', 'Wǒmen zuò fúqī shàngqù ba.');
    expect(r.reason).toBe('reading');
    expect(r.pinyin).toBe('Wǒmen zuò fútī shàngqù ba.');
    expect(r.words).toEqual([{ hanzi: '扶梯', from: 'fúqī', to: 'fútī' }]);
  });

  it('only changes the impossible syllable inside a word', async () => {
    // 们 is never mēn; 我 stays as written.
    const r = await checkAuthoredPinyin('我们', 'Wǒmēn');
    expect(r.pinyin).toBe('Wǒmen');
  });

  it('uses the word dictionary when there is one', async () => {
    const wordPinyin = vi.fn(async (words: string[]): Promise<Record<string, string>> => (words.includes('扶梯') ? { 扶梯: 'fú tī' } : {}));
    const r = await checkAuthoredPinyin('扶梯', 'fúqī', { wordPinyin });
    expect(r.pinyin).toBe('fútī');
    expect(wordPinyin).toHaveBeenCalledWith(['扶梯']);
  });

  it('accepts a reading the character dictionary knows even when pinyin-pro does not', async () => {
    const charReadings = vi.fn(async () => ({ 梯: ['qī'] }));
    const r = await checkAuthoredPinyin('扶梯', 'fúqī', { charReadings });
    expect(r.reason).toBeNull();
    expect(r.pinyin).toBe('fúqī');
  });

  it('never "corrects" a reading the character really has (还 / 得 / 长 / 行 / 了)', async () => {
    for (const [hz, py] of [
      ['我还书', 'wǒ hái shū'], // should be huán, but hái is a real reading of 还
      ['我得走了', 'wǒ dé zǒu le'],
      ['他长大了', 'tā chángdà le'],
      ['银行', 'yínxíng'],
      ['我们走了', 'wǒmen zǒu liǎo'],
    ]) {
      expect(await checkAuthoredPinyin(hz, py), hz).toEqual({ pinyin: py, reason: null, words: [] });
    }
  });

  it('leaves 一 / 不 alone whatever tone they carry', async () => {
    for (const [hz, py] of [
      ['一个人', 'yī gè rén'],
      ['一个人', 'yí gè rén'],
      ['不是', 'bù shì'],
      ['看一看', 'kàn yi kàn'],
    ]) {
      expect((await checkAuthoredPinyin(hz, py)).pinyin, hz).toBe(py);
    }
  });

  it('handles 儿 folded into the syllable before it, and fixes inside such a word', async () => {
    expect((await checkAuthoredPinyin('一点儿', 'yìdiǎnr')).reason).toBeNull();
    expect((await checkAuthoredPinyin('哪儿', 'nǎr')).reason).toBeNull();
    expect((await checkAuthoredPinyin('哪儿', 'nǎ ér')).reason).toBeNull();
    const r = await checkAuthoredPinyin('在哪儿', 'zài nǒr');
    expect(r.pinyin).toBe('zài nǎr');
  });

  it('accepts neutral tones and toneless syllables the character has', async () => {
    for (const [hz, py] of [['东西', 'dōngxi'], ['觉得', 'juéde'], ['你好', 'ni hao'], ['西安', "Xī'ān"]]) {
      expect((await checkAuthoredPinyin(hz, py)).reason, hz).toBeNull();
    }
  });

  it('never rebuilds a line whose syllables cannot be lined up: a warning, the text as written', async () => {
    // 大 has several readings (dà / dài / tài): putting the missing one back would be a guess.
    const r = await checkAuthoredPinyin('他长大了。', 'Tā zhǎng le.');
    expect(r.reason).toBeNull();
    expect(r.pinyin).toBe('Tā zhǎng le.');
    expect(r.warnings).toEqual(['one syllable missing for 大 in “他长大了” (Tā zhǎng le) — left as written']);
  });

  it('puts ONE missing syllable back when it is clearly safe (one place, one reading), keeping the rest as written', async () => {
    const r = await checkAuthoredPinyin('我很喜欢你。', 'Wǒ xǐhuan nǐ.');
    expect(r).toEqual({ pinyin: 'Wǒ hěn xǐhuan nǐ.', reason: 'syllable_count', words: [{ hanzi: '很', from: '', to: 'hěn' }] });
  });

  it('skips mixed English / digits, empty pinyin and empty hanzi', async () => {
    expect(await checkAuthoredPinyin('A：你好', 'A: nǐ hǎo ma')).toEqual({ pinyin: 'A: nǐ hǎo ma', reason: null, words: [] });
    expect((await checkAuthoredPinyin('3个人', 'sān gè rén')).reason).toBeNull();
    expect((await checkAuthoredPinyin('扶梯', '')).reason).toBeNull();
    expect((await checkAuthoredPinyin('', 'fúqī')).reason).toBeNull();
    expect((await checkAuthoredPinyin('OK', 'ōukèi')).reason).toBeNull();
  });

  it('keeps everyday readings, interjections, IPA ɡ and differently cut syllables (seen in real lessons)', async () => {
    for (const [hz, py] of [
      ['在中国，报警打一一零。', 'Zài Zhōngguó, bàojǐng dǎ yāo yāo líng.'],
      ['喂，你好，我是滴滴司机。', 'Wéi, nǐ hǎo, wǒ shì Dīdī sījī.'],
      ['嗯，真好吃。', 'Ǹg, zhēn hǎochī.'],
      ['人工智能', 'réngōng zhìnéng'],
      ['回锅肉', 'huíguōròu'],
      ['人工', 'rénɡōnɡ'],
      ['西安', 'Xīān'],
      ['你出来没得？', 'nǐ chūlái méi de?'],
    ]) {
      expect(await checkAuthoredPinyin(hz, py), hz).toEqual({ pinyin: py, reason: null, words: [] });
    }
  });

  it('keeps correct pinyin byte for byte (spacing, punctuation, capitals)', async () => {
    for (const [hz, py] of [
      ['你好，我叫小明。', 'Nǐ hǎo, wǒ jiào Xiǎo Míng.'],
      ['我想喝咖啡', 'wǒ xiǎng hē kāfēi'],
      ['“你去哪儿？”', '“Nǐ qù nǎr?”'],
    ]) {
      expect(await checkAuthoredPinyin(hz, py), hz).toEqual({ pinyin: py, reason: null, words: [] });
    }
  });
});

const lesson = (): CustomLessonSpec => ({
  title: 'At the mall',
  sections: [
    {
      title: 'Words',
      exercises: [
        { type: 'note', title: '扶梯', body: 'Escalator.', sentences: [{ hanzi: '我们坐扶梯上去吧。', pinyin: 'Wǒmen zuò fúqī shàngqù ba.', english: "Let's take the escalator up." }] },
        {
          type: 'conversation',
          situation: 'In a mall',
          speakers: [{ name: 'A', voice: 'female' }, { name: 'B', voice: 'male' }],
          lines: [
            { speaker: 0, hanzi: '扶梯在哪儿？', pinyin: 'Fúqī zài nǎr?', english: 'Where is the escalator?' },
            { speaker: 1, hanzi: '我还没还书。', pinyin: 'Wǒ hái méi hái shū.', english: "I haven't returned the book yet." },
          ],
          questions: [{ question: 'What is A looking for?', options: ['an escalator', 'a lift'], correct: 0 }],
        },
        { type: 'translate', english: 'The escalator', reference_hanzi: '扶梯', reference_pinyin: 'fúqī' },
        { type: 'choice', question: 'Which?', options: [{ hanzi: '扶梯', pinyin: 'fútī' }, { hanzi: '电梯', pinyin: 'diàntī' }], correct: 0 },
        { type: 'oral_expression', prompt: 'Say where', hints: [{ hanzi: '扶梯', pinyin: 'fúqī', english: 'escalator' }, { hanzi: '楼上', english: 'upstairs' }] },
        { type: 'scramble', english: 'Take the escalator', tiles: ['坐', '扶梯'], correct_order: ['坐', '扶梯'] },
      ],
    },
  ],
});

describe('fixSpecPinyin', () => {
  it('walks a lesson: note sentences, conversation lines, references, options, hints', async () => {
    const spec = lesson();
    expect(validateLessonSpec(spec)).toEqual([]);
    const fixes = await fixSpecPinyin(spec);
    expect(fixes.map((f) => f.path)).toEqual([
      'sections[0].exercises[0].sentences[0].pinyin',
      'sections[0].exercises[1].lines[0].pinyin',
      'sections[0].exercises[2].reference_pinyin',
      'sections[0].exercises[4].hints[0].pinyin',
    ]);
    expect(fixes[1]).toMatchObject({
      where: 'section 1 · exercise 2 (conversation) · line 1',
      hanzi: '扶梯在哪儿？',
      before: 'Fúqī zài nǎr?',
      after: 'Fútī zài nǎr?',
      reason: 'reading',
      words: [{ hanzi: '扶梯', from: 'Fúqī', to: 'Fútī' }],
    });
    const ex = spec.sections[0].exercises;
    expect((ex[1] as { lines: Array<{ pinyin: string }> }).lines[1].pinyin).toBe('Wǒ hái méi hái shū.'); // 还 hái is a real reading
    expect((ex[2] as { reference_pinyin: string }).reference_pinyin).toBe('fútī');
    expect(validateLessonSpec(spec)).toEqual([]);
    expect(pinyinFixesText(fixes)).toContain('扶梯: fúqī → fútī (section 1 · exercise 1 (note) · sentence 1)');
  });

  it('leaves the wrong options of a multiple-choice exercise alone (tone distractors on purpose)', async () => {
    const spec = {
      title: 'Deposit',
      sections: [{ exercises: [{
        type: 'listen_choice',
        audio: { hanzi: '押金', pinyin: 'yājīn', english: 'deposit' },
        options: [
          { hanzi: '现金', pinyin: 'xiànjīn', english: 'cash' },
          { hanzi: '押金', pinyin: 'yàjīn', english: 'deposit' },
          { hanzi: '押金', pinyin: 'yàjǐn', english: '(incorrect tones)' },
        ],
        correct: 1,
      }] }],
    };
    const fixes = await fixSpecPinyin(spec);
    expect(fixes.map((f) => [f.path, f.after])).toEqual([['sections[0].exercises[0].options[1].pinyin', 'yājīn']]);
    expect(spec.sections[0].exercises[0].options[2].pinyin).toBe('yàjǐn');
  });

  it('checks a gap sentence with the answer in the gap; leaves a judge exercise\'s wrong sentence alone', async () => {
    const spec = {
      title: 'Escalators',
      sections: [{ exercises: [
        {
          type: 'gap_choice',
          options: ['扶梯', '电梯'],
          items: [
            { sentence: '我坐___上楼。', answer: '扶梯', pinyin: 'Wǒ zuò fúqī shàng lóu.' },
            { sentence: '我坐___下楼。', answer: '电梯', pinyin: 'Wǒ zuò diàntī xià lóu.' },
          ],
        },
        {
          type: 'judge',
          sentences: [
            { hanzi: '我坐扶梯。', pinyin: 'Wǒ zuò fúqī.', correct: true },
            { hanzi: '我扶梯坐。', pinyin: 'Wǒ fúqī zuò.', correct: false, correction: { hanzi: '我坐扶梯。', pinyin: 'Wǒ zuò fúqī.' }, explanation: 'Verb first.' },
            { hanzi: '我坐电梯。', pinyin: 'Wǒ zuò diàntī.', correct: true },
          ],
        },
      ] }],
    };
    expect(validateLessonSpec(spec)).toEqual([]);
    const fixes = await fixSpecPinyin(spec);
    expect(fixes.map((f) => [f.path, f.hanzi, f.after])).toEqual([
      ['sections[0].exercises[0].items[0].pinyin', '我坐扶梯上楼。', 'Wǒ zuò fútī shàng lóu.'],
      ['sections[0].exercises[1].sentences[0].pinyin', '我坐扶梯。', 'Wǒ zuò fútī.'],
      ['sections[0].exercises[1].sentences[1].correction.pinyin', '我坐扶梯。', 'Wǒ zuò fútī.'],
    ]);
    expect(spec.sections[0].exercises[1].sentences![1].pinyin).toBe('Wǒ fúqī zuò.');
    expect(fixes[0].where).toBe('section 1 · exercise 1 (gap_choice) · item 1');
  });

  it('walks a reader: page content and vocabulary', async () => {
    const spec: ReaderSpec = {
      title_chinese: '商场',
      title_english: 'The mall',
      difficulty_level: 'beginner',
      vocabulary_used: [{ hanzi: '扶梯', pinyin: 'fúqī', english: 'escalator' }],
      pages: [
        { id: 'p1', content_chinese: '小明坐扶梯。', content_pinyin: 'Xiǎo Míng zuò fúqī.', content_english: 'Xiao Ming takes the escalator.' },
        { id: 'p2', content_chinese: '他很高兴。', content_pinyin: '', content_english: 'He is happy.' },
      ],
    };
    expect(validateReaderSpec(spec)).toEqual([]);
    const fixes = await fixSpecPinyin(spec);
    expect(fixes.map((f) => [f.where, f.after])).toEqual([
      ['vocabulary 1', 'fútī'],
      ['page 1', 'Xiǎo Míng zuò fútī.'],
    ]);
    expect(spec.pages[0].id).toBe('p1');
    expect(spec.pages[1].content_pinyin).toBe('');
  });

  it('changes nothing in a correct spec', async () => {
    const spec = lesson();
    await fixSpecPinyin(spec);
    expect(await fixSpecPinyin(spec)).toEqual([]);
  });
});

// The worker's real dictionaries (worker/char-dict, committed), read from disk the way the CHAR_DICT
// binding serves them — so these cases run exactly as in production.
const dictDir = path.resolve(__dirname, '../../../char-dict');
const fsLoader = async (file: string) => {
  const p = path.join(dictDir, file);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
};
const real: PinyinReadingSources = {
  charReadings: async (chars) => {
    const { records } = await getCharRecords(fsLoader, chars, 'test-fs');
    return Object.fromEntries(Object.entries(records).map(([c, r]) => [c, r.readings.map((x) => x.pinyin)]));
  },
  wordPinyin: async (words) => {
    const { records } = await getWordRecords(fsLoader, words, 'test-fs');
    return Object.fromEntries(Object.entries(records).map(([w, r]) => [w, r.pinyin]));
  },
};
const same = (pinyin: string) => ({ pinyin, reason: null, words: [] });

describe('checkAuthoredPinyin on real content (the first scan of Jerome\'s lessons and readers)', () => {
  it('still makes the good fixes: only the impossible syllable changes', async () => {
    for (const [hz, py, to] of [
      ['粢饭团', 'cífàntuán', 'zīfàntuán'],
      ['混血', 'hùnxuě', 'hùnxuè'],
      ['她是瑞士、英国和德国混血。', 'Tā shì Ruìshì, Yīngguó hé Déguó hùnxuě.', 'Tā shì Ruìshì, Yīngguó hé Déguó hùnxuè.'],
      ['为什么', 'wèishéme', 'wèishénme'],
      ['休息', 'xiūxí', 'xiūxi'],
      ['我今天休息，所以不去公司。', 'Wǒ jīntiān xiūxí, suǒyǐ bù qù gōngsī.', 'Wǒ jīntiān xiūxi, suǒyǐ bù qù gōngsī.'],
      ['裙子', 'qúnzì', 'qúnzi'],
      ['突然', 'Túrán', 'Tūrán'],
      ['小小', 'xiǎxiǎo', 'xiǎoxiǎo'],
    ]) {
      const r = await checkAuthoredPinyin(hz, py, real);
      expect(r.pinyin, hz).toBe(to);
      expect(r.reason, hz).toBe('reading');
    }
  });

  it('checks alternatives listed on purpose one by one and never collapses them', async () => {
    for (const py of ['piāo / piào']) expect(await checkAuthoredPinyin('漂', py, real)).toEqual(same(py));
    expect(await checkAuthoredPinyin('数', 'shù / shǔ', real)).toEqual(same('shù / shǔ'));
    expect(await checkAuthoredPinyin('乐', 'yuè / lè', real)).toEqual(same('yuè / lè'));
    expect(await checkAuthoredPinyin('这个', 'zhè ge / zhèi ge', real)).toEqual(same('zhè ge / zhèi ge'));
    expect(await checkAuthoredPinyin('那个', 'nà ge / nèi ge', real)).toEqual(same('nà ge / nèi ge'));
    expect(await checkAuthoredPinyin('那', 'nà / nèi', real)).toEqual(same('nà / nèi'));
    expect(await checkAuthoredPinyin('这个', 'zhè ge, zhèi ge', real)).toEqual(same('zhè ge, zhèi ge'));
    // An impossible syllable inside one alternative is fixed; the other stays.
    expect(await checkAuthoredPinyin('血', 'xuě / xiě', real)).toEqual({ pinyin: 'xuè / xiě', reason: 'reading', words: [{ hanzi: '血', from: 'xuě', to: 'xuè' }] });
    expect((await checkAuthoredPinyin('血', 'xuě; xiě', real)).pinyin).toBe('xuè; xiě');
    // Alternatives on both sides line up as they are.
    for (const [hz, py] of [['星期/周/礼拜', 'xīngqī / zhōu / lǐbài'], ['总是 / 总 / 老是 / 老', 'zǒng shì / zǒng / lǎoshì / lǎo'], ['没事儿 / 别客气', 'méishìr / bié kèqi']]) {
      expect(await checkAuthoredPinyin(hz, py, real), hz).toEqual(same(py));
    }
  });

  it('never rebuilds a reader page that is a syllable short: unchanged, and the warning names the place', async () => {
    const hz = '朱先生说：「我有点忙。我的公司很多人失业了。我担心。」\n李友说：「没关系。你的中文说得真好！」\n朱先生笑了：「我还不流利。」';
    const py = 'Zhū xiānsheng shuō: "Wǒ yǒudiǎn máng. Wǒ de gōngsī hěn duō rén shīyè le. Wǒ dān xīn."\nLǐ Yǒu shuō: "Méi guānxi. Nǐ Zhōngwén shuō de zhēn hǎo!"\nZhū xiānsheng xiào le: "Wǒ hái bù liú lì."';
    expect(await checkAuthoredPinyin(hz, py, real)).toEqual({
      ...same(py),
      warnings: ['one syllable missing for 的 in “你的中文说得真好” (Nǐ Zhōngwén shuō de zhēn hǎo) — left as written'],
    });
    // The same line missing the de of 得: 得 has several readings, so it isn't guessed (pinyin-pro would say dé).
    const short = 'Zhū xiānsheng shuō: "Wǒ yǒudiǎn máng."\nLǐ Yǒu shuō: "Méi guānxi. Nǐ de Zhōngwén shuō zhēn hǎo!"';
    const r = await checkAuthoredPinyin('朱先生说：「我有点忙。」\n李友说：「没关系。你的中文说得真好！」', short, real);
    expect(r.pinyin).toBe(short);
    expect(r.warnings).toEqual(['one syllable missing for 得 in “你的中文说得真好” (Nǐ de Zhōngwén shuō zhēn hǎo) — left as written']);
  });

  it('an extra syllable is reported, not removed', async () => {
    const r = await checkAuthoredPinyin('我去加拿大玩，不是工作', 'wǒ qù jiānádà wán le! bù shì gōngzuò', real);
    expect(r).toEqual({ ...same('wǒ qù jiānádà wán le! bù shì gōngzuò'), warnings: ['an extra syllable “le” in “我去加拿大玩” (wǒ qù jiānádà wán le) — left as written'] });
  });

  it('a syllable that IS a reading of its character is never changed, whatever the word dictionary says', async () => {
    expect(await checkAuthoredPinyin('大人', 'dàrén', real)).toEqual(same('dàrén')); // the dictionary says dàren
    expect(await checkAuthoredPinyin('我们今天逛逛，找找吃的。', 'Wǒmen jīntiān guàng guàng, zhǎo zhǎo chī de.', real)).toEqual(same('Wǒmen jīntiān guàng guàng, zhǎo zhǎo chī de.'));
    // 哎 is only āi in both dictionaries, so àiya IS impossible — fixed; with ài known it would stay.
    expect((await checkAuthoredPinyin('哎呀', 'àiya', real)).pinyin).toBe('āiya');
    expect(await checkAuthoredPinyin('哎呀', 'àiya', { charReadings: async () => ({ 哎: ['āi', 'ài'] }) })).toEqual(same('àiya'));
  });

  it('leaves colloquial reduplication alone (好好 hǎohāo, 慢慢 mànmān)', async () => {
    for (const [hz, py] of [['好好', 'hǎohāo'], ['好好学习', 'hǎohāo xuéxí'], ['好好儿', 'hǎohāor'], ['慢慢走', 'mànmān zǒu'], ['我只好好学了三年。', 'Wǒ zhǐ hǎohǎo xué le sān nián.']]) {
      expect(await checkAuthoredPinyin(hz, py, real), hz).toEqual(same(py));
    }
  });

  it('does not "fix" pinyin that is out of step with its characters syllable by syllable', async () => {
    const r = await checkAuthoredPinyin('你好吗', 'wǒ shì shéi', real);
    expect(r.reason).toBeNull();
    expect(r.pinyin).toBe('wǒ shì shéi');
    expect(r.warnings?.[0]).toMatch(/3 of 3 syllables aren't readings of their characters/);
  });

  it('checkSpecPinyin returns the fixes and the lines that need a look; the warnings change nothing', async () => {
    const spec = {
      vocabulary_used: [
        { hanzi: '漂', pinyin: 'piāo / piào' },
        { hanzi: '混血', pinyin: 'hùnxuě' },
      ],
      pages: [{ content_chinese: '他长大了。', content_pinyin: 'Tā zhǎng le.' }],
    };
    const { fixes, warnings } = await checkSpecPinyin(spec, real);
    expect(fixes.map((f) => [f.where, f.after])).toEqual([['vocabulary 2', 'hùnxuè']]);
    expect(warnings).toEqual([{ path: 'pages[0].content_pinyin', where: 'page 1', hanzi: '他长大了。', pinyin: 'Tā zhǎng le.', detail: 'one syllable missing for 大 in “他长大了” (Tā zhǎng le) — left as written' }]);
    expect(spec.pages[0].content_pinyin).toBe('Tā zhǎng le.');
    expect(spec.vocabulary_used[0].pinyin).toBe('piāo / piào');
    expect(pinyinWarningsText(warnings)).toContain('Needs a look (not changed)');
    expect(pinyinFixSummary({ path: '', where: '', hanzi: '我很喜欢你。', before: '', after: '', reason: 'syllable_count', words: [{ hanzi: '很', from: '', to: 'hěn' }] })).toBe('很: missing → hěn');
  });
});
