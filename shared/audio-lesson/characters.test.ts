import { describe, expect, it } from 'vitest';
import {
  charNoteProblems,
  charReadings,
  compileSleepLesson,
  defaultCharNote,
  hasHan,
  NEW_CHARACTER_LINES,
  NEW_WORD_INTROS,
  pickCharLinks,
  pickVariant,
  RECAP_OPENINGS,
  SENTENCES_INTROS,
  SLEEP_PHRASE_POOLS,
  sleepVariationSeed,
  stampCharNotes,
  TONE_CHANGE_LINES,
  TONE_LINES,
  fillPhrase,
  validateScript,
  validateSleepPlan,
  variantIndex,
  type CharLink,
  type CommonCharWord,
  type LearnerCharWord,
  type SleepPlan,
  type SpeechSegment,
} from './index';
import { SAMPLE_SLEEP_CHAR_LINKS, SAMPLE_SLEEP_PLAN } from './samples';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** A learner + dictionary for the picker. */
function picker(learner: LearnerCharWord[], common: CommonCharWord[], met: string[] = []) {
  const has = (c: string) => (w: { hanzi: string }) => w.hanzi.includes(c);
  const metChars = new Set([...met, ...learner.filter((w) => w.tier >= 1).flatMap((w) => [...w.hanzi])]);
  return (word: string, pinyin?: string) =>
    pickCharLinks({ word, pinyin, learnerWords: (c) => learner.filter(has(c)), commonWords: (c) => common.filter(has(c)), metChars });
}

const L = (hanzi: string, pinyin: string, tier: number, rank: number | null = null): LearnerCharWord => ({ hanzi, pinyin, english: hanzi, tier, rank });
const C = (hanzi: string, pinyin: string, rank: number | null): CommonCharWord => ({ hanzi, pinyin, english: `${hanzi}!`, rank });

describe('pickCharLinks: which words each character is tied to', () => {
  const pick = picker(
    [
      L('导游', 'dǎoyóu', 1, 10013),
      L('指导', 'zhǐdǎo', 2, 1262),
      L('导演', 'dǎoyǎn', 2, 1691),
      L('领导', 'lǐngdǎo', 2, 900),
      L('导航', 'dǎoháng', 1), // the word being taught
      L('不行', 'bùxíng', 2, 800),
      L('报告', 'bàogào', 0, 1500), // never studied
    ],
    [C('航空', 'hángkōng', 2006), C('航班', 'hángbān', 4507), C('航天', 'hángtiān', 5200), C('银行', 'yínháng', 570), C('行业', 'hángyè', 1800), C('驾驶', 'jiàshǐ', 2688), C('行驶', 'xíngshǐ', 6461)],
  );

  it('known words first: mature before learning, then the most frequent; never the word itself', () => {
    const [dao, hang] = pick('导航', 'dǎoháng');
    expect(dao.kind).toBe('known');
    expect(dao.words.map((w) => w.hanzi)).toEqual(['领导', '指导', '导演']);
    expect(dao.words.map((w) => w.hanzi)).not.toContain('导航');
    // 航: no word of his → common words, the most frequent first, within the rank limit.
    expect(hang).toMatchObject({ char: '航', kind: 'common' });
    expect(hang.words.map((w) => w.hanzi)).toEqual(['航空', '航班']);
  });

  it('a word he has never studied is not "known"', () => {
    const [bao] = picker([L('报告', 'bàogào', 0)], [C('报纸', 'bàozhǐ', 1200)])('报道', 'bàodào');
    expect(bao).toMatchObject({ kind: 'common', words: [expect.objectContaining({ hanzi: '报纸' })] });
  });

  it('common words read the character as the word does (银行 háng, not 不行 xíng)', () => {
    const [, hang] = pick('银行', 'yínháng');
    expect(hang.kind).toBe('common');
    expect(hang.words.map((w) => w.hanzi)).toEqual(['行业']);
  });

  it('only a different reading of his → other_reading', () => {
    const p = picker([L('不行', 'bùxíng', 2)], []);
    const [, hang] = p('银行', 'yínháng');
    expect(hang).toMatchObject({ kind: 'other_reading', words: [expect.objectContaining({ hanzi: '不行' })] });
  });

  it('nothing of his and nothing common → a new character; met only in a sentence → none', () => {
    const p = picker([], [C('驾驶', 'jiàshǐ', 2688), C('行驶', 'xíngshǐ', 6461), C('驶入', 'shǐrù', 30000)]);
    expect(p('驶向', 'shǐxiàng')[0]).toMatchObject({ char: '驶', kind: 'common' });
    const rare = picker([], [C('驶入', 'shǐrù', 30000), C('驶离', 'shǐlí', null)]);
    expect(rare('驶向', 'shǐxiàng')[0]).toEqual({ char: '驶', kind: 'new', words: [] });
    const metInSentence = picker([], [], ['驶']);
    expect(metInSentence('驶向', 'shǐxiàng')[0]).toEqual({ char: '驶', kind: 'none', words: [] });
  });

  it('a single-character word: the step once, never the word itself', () => {
    const p = picker([L('寄', 'jì', 2), L('寄信', 'jìxìn', 1)], [C('邮寄', 'yóujì', 18530)]);
    const links = p('寄', 'jì');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: 'known', words: [expect.objectContaining({ hanzi: '寄信' })] });
    expect(links[0].words.map((w) => w.hanzi)).not.toContain('寄');
  });

  it('a repeated character is one step (姐姐)', () => {
    const links = picker([L('姐妹', 'jiěmèi', 2)], [])('姐姐', 'jiějie');
    expect(links.map((l) => l.char)).toEqual(['姐']);
  });

  it('charReadings: from the pinyin when it lines up, else a guess', () => {
    expect(charReadings('银行', 'yínháng')).toEqual(['yin', 'hang']);
    expect(charReadings('银行')).toEqual(['yin', 'hang']);
    expect(charReadings('绿色', 'lǜsè')).toEqual(['lü', 'se']);
  });
});

describe('char_notes validation against the facts', () => {
  const links = SAMPLE_SLEEP_CHAR_LINKS;
  const withNotes = (edit: (p: SleepPlan) => void) => {
    const p = clone(SAMPLE_SLEEP_PLAN);
    edit(p);
    return validateSleepPlan(p, { charLinks: links }).join('\n');
  };

  it('the sample passes, with and without the facts', () => {
    expect(validateSleepPlan(SAMPLE_SLEEP_PLAN, { charLinks: links })).toEqual([]);
    expect(validateSleepPlan(SAMPLE_SLEEP_PLAN)).toEqual([]);
  });

  it('required with the facts, one per distinct character, in order', () => {
    expect(withNotes((p) => delete p.words[0].char_notes)).toMatch(/char_notes: required.*邮: he has LEARNED 邮件/);
    expect(withNotes((p) => (p.words[0].char_notes = p.words[0].char_notes!.slice(0, 1)))).toMatch(/2 expected \(邮 局\), got 1/);
    expect(withNotes((p) => p.words[0].char_notes!.reverse())).toMatch(/char_notes\[0\]\.char: expected "邮"/);
  });

  it('names only the words given — no invented words, nothing claimed that he has not learned', () => {
    // A word not in the facts.
    expect(withNotes((p) => (p.words[0].char_notes![0] = { char: '邮', words: ['邮票'], zh: '你学过‘邮票’的‘邮’。' }))).toMatch(/"邮票" not among the words given/);
    // A quoted word not listed in words.
    expect(withNotes((p) => (p.words[0].char_notes![0] = { char: '邮', words: ['邮件'], zh: '你学过‘邮件’和‘邮票’。' }))).toMatch(/names ‘邮票’/);
    // Common words: he hasn't learned them.
    expect(withNotes((p) => (p.words[0].char_notes![1] = { char: '局', words: ['结局'], zh: '你学过‘结局’的‘局’。' }))).toMatch(/hasn't learned these words/);
    // Too many, none, said but not listed.
    expect(withNotes((p) => (p.words[0].char_notes![1] = { char: '局', words: [], zh: '‘局’是一个字。' }))).toMatch(/name at least one/);
    expect(withNotes((p) => (p.words[0].char_notes![0] = { char: '邮', words: ['邮件'], zh: '你学过这个字。' }))).toMatch(/"邮件" is in words but not said/);
    // A known character is not new.
    expect(withNotes((p) => (p.words[0].char_notes![0] = { char: '邮', words: ['邮件'], zh: '‘邮’是新字，你学过‘邮件’。' }))).toMatch(/not new to him/);
    // A new character names no words.
    expect(withNotes((p) => (p.words[1].char_notes![0] = { char: '寄', words: ['寄信'], zh: '' }))).toMatch(/new character for him/);
    // Chinese only, short.
    expect(withNotes((p) => (p.words[0].char_notes![0] = { char: '邮', words: ['邮件'], zh: '你学过‘邮件’ (email) 的‘邮’。' }))).toMatch(/Chinese only/);
  });

  it('the plain wording of every kind passes', () => {
    const kinds: CharLink[] = [
      { char: '导', kind: 'known', words: [{ hanzi: '指导', pinyin: 'zhǐdǎo', english: 'guide' }, { hanzi: '导游', pinyin: 'dǎoyóu', english: 'tour guide' }] },
      { char: '航', kind: 'common', words: [{ hanzi: '航空', pinyin: 'hángkōng', english: 'aviation' }] },
    ];
    const notes = kinds.map(defaultCharNote);
    expect(notes.map((n) => n.zh)).toEqual(['你学过‘指导’和‘导游’，里面都有‘导’。', '‘航’也在‘航空’里。']);
    expect(charNoteProblems('w', { hanzi: '导航', char_notes: notes }, kinds)).toEqual([]);
    expect(defaultCharNote({ char: '驶', kind: 'new', words: [] })).toEqual({ char: '驶', words: [], zh: '', kind: 'new' });
    // He knows the character as a word of its own (附近: he has 近).
    const jin: CharLink[] = [
      { char: '附', kind: 'new', words: [] },
      { char: '近', kind: 'known', words: [{ hanzi: '近', pinyin: 'jìn', english: 'near' }] },
    ];
    const jinNotes = jin.map(defaultCharNote);
    expect(jinNotes[1].zh).toBe('你学过‘近’这个字。');
    expect(charNoteProblems('w', { hanzi: '附近', char_notes: jinNotes }, jin)).toEqual([]);
  });

  it('stampCharNotes takes the kind from the facts, never from the model', () => {
    const p = clone(SAMPLE_SLEEP_PLAN);
    p.words[0].char_notes![0].kind = 'new'; // the model can't make a known character "new"
    p.words[1].char_notes![0] = { char: '寄', words: [], zh: '随便说的话。' };
    const stamped = stampCharNotes(p, SAMPLE_SLEEP_CHAR_LINKS);
    expect(stamped.words[0].char_notes!.map((n) => n.kind)).toEqual(['known', 'common']);
    expect(stamped.words[1].char_notes![0]).toEqual({ char: '寄', words: [], zh: '', kind: 'new' });
    expect(p.words[1].char_notes![0].zh).toBe('随便说的话。'); // a copy
  });
});

describe('compile: each character, in order', () => {
  const script = compileSleepLesson(SAMPLE_SLEEP_PLAN);
  const seed = sleepVariationSeed(SAMPLE_SLEEP_PLAN);
  const textsOf = (prefix: string) => {
    const ch = script.chapters.findIndex((c) => c.title.startsWith(prefix));
    return script.segments.filter((s): s is SpeechSegment => s.chapter === ch && s.kind === 'speech').map((s) => s.text);
  };

  it('tone, its line; next character; then the meaning', () => {
    const t = textsOf('邮局');
    const you = t.findIndex((x) => x.startsWith('邮，'));
    expect(t.slice(you, you + 5).map((x, i) => (i === 0 || i === 2 ? x.slice(0, 2) : x))).toEqual(['邮，', '你学过‘邮件’的‘邮’。', '局，', '‘局’也在‘结局’里。', '结局，就是最后。']);
    expect(t[you + 5]).toBe(SAMPLE_SLEEP_PLAN.words[0].meaning_zh[0]);
  });

  it('a new character: the app says it, in one of its wordings', () => {
    const t = textsOf('寄');
    const tone = t.findIndex((x) => x.startsWith('寄，'));
    expect(t[tone + 1]).toBe(fillPhrase(pickVariant(NEW_CHARACTER_LINES, seed, 'newCharacter', 0), { c: '寄' }));
    expect(t[tone + 2]).toBe(SAMPLE_SLEEP_PLAN.words[1].meaning_zh[0]);
  });

  it('a pause after each character line; the script is valid; same plan → same script', () => {
    const segs = script.segments;
    segs.forEach((s, i) => {
      if (s.kind === 'speech' && s.text === '你学过‘邮件’的‘邮’。') expect(segs[i + 1]).toMatchObject({ kind: 'pause', ms: 1800 });
    });
    expect(validateScript(script)).toEqual([]);
    expect(compileSleepLesson(clone(SAMPLE_SLEEP_PLAN))).toEqual(script);
  });

  it('plans written before char_notes keep their characters_zh', () => {
    const old = clone(SAMPLE_SLEEP_PLAN);
    delete old.words[0].char_notes;
    old.words[0].characters_zh = ['‘邮’是‘邮件’的‘邮’。'];
    const t = compileSleepLesson(old).segments.filter((s): s is SpeechSegment => s.kind === 'speech').map((s) => s.text);
    expect(t).toContain('‘邮’是‘邮件’的‘邮’。');
    expect(t).not.toContain('你学过‘邮件’的‘邮’。');
  });
});

describe('the fixed lines vary (phrases.ts)', () => {
  const fills = { x: '导', tone: '第三声', w: '任务', c: '‘务’' };
  const chinesePools = Object.entries(SLEEP_PHRASE_POOLS);

  it('every pool has 4–6 wordings, all different', () => {
    for (const [name, pool] of [...chinesePools, ['recap', RECAP_OPENINGS] as const]) {
      expect(pool.length, name).toBeGreaterThanOrEqual(4);
      expect(pool.length, name).toBeLessThanOrEqual(6);
      expect(new Set(pool).size, name).toBe(pool.length);
    }
  });

  it('every Chinese wording passes the same checks as any spoken line: Chinese only, short, closed, nothing read aloud as a symbol', () => {
    for (const [name, pool] of chinesePools) {
      for (const raw of pool) {
        const text = fillPhrase(raw, { ...fills, c: name === 'newCharacter' ? '驶' : fills.c });
        expect(hasHan(text), text).toBe(true);
        expect(/[A-Za-z{}]/.test(text), text).toBe(false);
        expect(/[\/()（）\[\]|_…]|\.\.\./.test(text), text).toBe(false);
        expect([...text].length, text).toBeLessThanOrEqual(20);
        expect(text.endsWith('。'), text).toBe(true);
      }
    }
    for (const raw of NEW_CHARACTER_LINES) expect(raw).toContain('{c}');
    for (const raw of TONE_LINES) expect(raw).toMatch(/\{x\}.*\{tone\}/);
    for (const raw of TONE_CHANGE_LINES) expect(raw).toMatch(/\{w\}.*\{c\}.*\{tone\}/);
    for (const o of RECAP_OPENINGS) expect(o).toMatch(/^[A-Z][a-z ]+$/);
  });

  it('deterministic per lesson + index, never the same wording twice in a row', () => {
    for (const seed of ['安静的周末|附近,旁边', '自驾游', 'a', 'b', 'c', '银行和邮局|邮局,寄']) {
      for (const n of [4, 5, 6]) {
        for (let i = 0; i < 20; i++) {
          const v = variantIndex(n, seed, 'pool', i);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(n);
          expect(variantIndex(n, seed, 'pool', i + 1)).not.toBe(v);
          expect(variantIndex(n, seed, 'pool', i)).toBe(v);
        }
      }
    }
    expect(variantIndex(5, undefined, 'pool', 3)).toBe(0);
  });

  it('in a compiled lesson, consecutive word blocks open, introduce the sentences and recap differently', () => {
    const p = clone(SAMPLE_SLEEP_PLAN);
    const base = p.words[1];
    for (const h of ['信', '送', '给', '书']) {
      const w = clone(base);
      w.hanzi = h;
      w.pinyin = 'xìn';
      w.char_tones = [{ char: h, pinyin: 'xìn', tone: 4 }];
      w.char_notes = [{ char: h, words: [], zh: '', kind: 'new' }];
      w.sentences = w.sentences.map((s) => ({ ...s, hanzi: s.hanzi.replace('寄', h) }));
      p.words.push(w);
    }
    const script = compileSleepLesson(p);
    const firstOf = (ch: number, pool: readonly string[]) =>
      script.segments.find((s): s is SpeechSegment => s.kind === 'speech' && s.chapter === ch && pool.includes(s.text))?.text;
    const blocks = p.words.map((_, i) => i + 1); // chapter 0 is the hello
    const intros = blocks.map((ch) => firstOf(ch, NEW_WORD_INTROS.map((x) => x[0])));
    const sentenceIntros = blocks.map((ch) => firstOf(ch, SENTENCES_INTROS));
    const recaps = blocks.map((ch) => firstOf(ch, RECAP_OPENINGS));
    for (const list of [intros, sentenceIntros, recaps]) {
      expect(list.every(Boolean)).toBe(true);
      for (let i = 1; i < list.length; i++) expect(list[i]).not.toBe(list[i - 1]);
    }
    // The new-character lines of consecutive new characters differ too.
    const newLines = script.segments.filter((s): s is SpeechSegment => s.kind === 'speech' && NEW_CHARACTER_LINES.some((t) => fillPhrase(t, { c: s.text.match(/‘(.)’/)?.[1] ?? '' }) === s.text)).map((s) => s.text.replace(/‘.’/, '‘X’'));
    expect(newLines.length).toBe(5);
    for (let i = 1; i < newLines.length; i++) expect(newLines[i]).not.toBe(newLines[i - 1]);
    expect(validateScript(script)).toEqual([]);
  });
});
