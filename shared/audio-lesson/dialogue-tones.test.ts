import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  compileDialogueLesson,
  dialogueToneLines,
  DIALOGUE_TONE_MAX_CHARS,
  PAUSES,
  RATES,
  SAMPLE_DIALOGUE_PLAN,
  transcriptRows,
  uniqueSpeech,
  validateScript,
  wordCharTones,
  type DialoguePlan,
  type SpeechSegment,
} from './index';

const brief = (hanzi: string, pinyin: string) =>
  (wordCharTones(hanzi, pinyin) ?? []).map((t) => `${t.char} ${t.citation} ${t.citationTone}→${t.spoken}${t.change ? ` ${t.change}` : ''}`);
const spoken = (hanzi: string, pinyin: string, said?: Set<string>) =>
  dialogueToneLines({ hanzi, pinyin }, said).map((l) => l.parts.map((p) => (p.lang === 'zh' ? `<${p.text}>` : p.text)).join(' '));
const shown = (hanzi: string, pinyin: string) => dialogueToneLines({ hanzi, pinyin }).map((l) => l.parts.map((p) => p.display ?? p.text).join(' '));

describe('wordCharTones: each character from the point’s own pinyin', () => {
  it('splits joined pinyin where the characters’ readings say (dǎrǎo = dǎ + rǎo, not dǎr + ǎo)', () => {
    expect(brief('打扰了', 'dǎrǎo le')).toEqual(['打 dǎ 3→2 third_tone', '扰 rǎo 3→3', '了 le 5→5']);
  });
  it('a syllable written unmarked: the character’s own tone, said neutral here', () => {
    expect(brief('任务', 'rènwu')).toEqual(['任 rèn 4→4', '务 wù 4→5 neutral']);
    expect(brief('觉得', 'juéde')).toEqual(['觉 jué 2→2', '得 dé 2→5 neutral']);
    expect(brief('姐姐', 'jiějie')).toEqual(['姐 jiě 3→3', '姐 jiě 3→5 neutral']);
  });
  it('third-tone sandhi, never written: every 3rd before a 3rd is said as a 2nd, within a stretch', () => {
    expect(brief('你好', 'nǐ hǎo')).toEqual(['你 nǐ 3→2 third_tone', '好 hǎo 3→3']);
    expect(brief('少放点', 'shǎo fàng diǎn')).toEqual(['少 shǎo 3→3', '放 fàng 4→4', '点 diǎn 3→3']);
    // A comma ends the stretch: 好 before 我 across "，" keeps its third tone.
    expect(brief('你好，我很好', 'nǐ hǎo, wǒ hěn hǎo').map((s) => s.split(' ').slice(0, 1).concat(s.split(' ')[2]).join(' '))).toEqual([
      '你 3→2', '好 3→3', '我 3→2', '很 3→2', '好 3→3',
    ]);
  });
  it('一 / 不: citation yī / bù, the change from applyYiBuToneChanges (written or not)', () => {
    expect(brief('一样', 'yíyàng')).toEqual(['一 yī 1→2 yi_bu', '样 yàng 4→4']);
    expect(brief('一样', 'yīyàng')).toEqual(['一 yī 1→2 yi_bu', '样 yàng 4→4']);
    expect(brief('我敬您一杯', 'wǒ jìng nín yì bēi')[3]).toBe('一 yī 1→4 yi_bu');
    expect(brief('不是', 'bú shì')).toEqual(['不 bù 4→2 yi_bu', '是 shì 4→4']);
    expect(brief('看一看', 'kàn yi kàn')[1]).toBe('一 yī 1→5 neutral');
  });
  it('the reading the word uses, even for a polyphone (行 háng in 银行)', () => {
    const t = wordCharTones('银行', 'yínháng')!;
    expect(t[1]).toMatchObject({ char: '行', citation: 'háng', citationTone: 2, readsAlone: false });
  });
  it('pinyin that does not line up falls back to pinyin-pro; erhua and empty words give nothing', () => {
    expect(brief('吃饱', 'chi bao3')).toEqual(['吃 chī 1→1', '饱 bǎo 3→3']);
    expect(wordCharTones('一点儿', 'yìdiǎnr')).toBeNull();
    expect(wordCharTones('…', 'x')).toBeNull();
  });
});

describe('dialogueToneLines: what the host says', () => {
  it('打扰了: each character, then the sandhi with its reason', () => {
    expect(spoken('打扰了', 'dǎrǎo le')).toEqual([
      '<打> third tone.',
      '<扰> third tone.',
      '<打扰了的了> neutral tone.',
      'In <打扰了> <打> is said with a second tone, before another third tone.',
    ]);
    expect(shown('打扰了', 'dǎrǎo le')).toEqual([
      '打, dǎ, third tone.',
      '扰, rǎo, third tone.',
      '了 (as in 打扰了), le, neutral tone.',
      'In 打扰了, 打 is said with a second tone, before another third tone.',
    ]);
  });
  it('neutral tone, 一 / 不, a repeated character, a polyphone', () => {
    expect(spoken('任务', 'rènwu')).toEqual(['<任> fourth tone.', '<务> fourth tone.', 'In <任务> <务> is neutral tone here.']);
    expect(spoken('一样', 'yíyàng')[2]).toBe('In <一样> <一> is said with a second tone, before a fourth tone.');
    expect(spoken('我敬您一杯', 'wǒ jìng nín yì bēi').at(-1)).toBe('In <我敬您一杯> <一> is said with a fourth tone, before a first tone.');
    expect(spoken('姐姐', 'jiějie')).toEqual(['<姐> third tone.', 'In <姐姐> the second <姐> is neutral tone here.']);
    expect(spoken('银行', 'yínháng')).toEqual(['<银> second tone.', '<银行的行> second tone.']);
    expect(spoken('觉得', 'juéde')).toEqual(['<觉> second tone.', '<得> second tone.', 'In <觉得> <得> is neutral tone here.']);
    // A character the voice would misread alone is said inside the word, and named by place.
    expect(spoken('暖和', 'nuǎnhuo')).toEqual(['<暖> third tone.', '<暖和的和> second tone.', 'In <暖和> the second character is neutral tone here.']);
  });
  it('English pieces never carry Chinese or pinyin; the pinyin is only shown', () => {
    for (const [h, p] of [['打扰了', 'dǎrǎo le'], ['一样', 'yíyàng'], ['姐姐', 'jiějie'], ['觉得', 'juéde']]) {
      for (const line of dialogueToneLines({ hanzi: h, pinyin: p })) {
        for (const part of line.parts) {
          if (part.lang === 'en') expect(part.text).not.toMatch(/[一-鿿āáǎàēéěèīíǐìōóǒòūúǔù]/);
          else expect(part.text).not.toMatch(/[a-z]/i);
        }
      }
    }
  });
  it('a character said in an earlier point is not said again; at most a few per point', () => {
    const said = new Set<string>();
    spoken('我自己来', 'wǒ zìjǐ lái', said);
    expect(spoken('我敬您一杯', 'wǒ jìng nín yì bēi', said)).toEqual([
      '<敬> fourth tone.',
      '<您> second tone.',
      '<一> first tone.',
      '<杯> first tone.',
      'In <我敬您一杯> <一> is said with a fourth tone, before a first tone.',
    ]);
    const long = dialogueToneLines({ hanzi: '粗的还是细的', pinyin: 'cū de háishi xì de' });
    expect(long.filter((l) => l.char).length).toBe(DIALOGUE_TONE_MAX_CHARS);
  });
});

describe('compileDialogueLesson: the tones in each word section', () => {
  const plan: DialoguePlan = {
    ...SAMPLE_DIALOGUE_PLAN,
    points: [
      ...SAMPLE_DIALOGUE_PLAN.points,
      { kind: 'word', status: 'new', hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', explanation_en: 'The greeting.', line: 0 },
    ],
  };
  const script = compileDialogueLesson(plan);
  const chapterOf = (title: string) => script.chapters.findIndex((c) => c.title.startsWith(title));
  const speechIn = (ch: number) => script.segments.filter((s): s is SpeechSegment => s.kind === 'speech' && s.chapter === ch);

  it('word ×2 → its tones → the explanation → the line → the example → the word', () => {
    const texts = speechIn(chapterOf('你好')).map((s) => s.text);
    expect(texts.slice(0, 9)).toEqual([
      '你好', '你好',
      '你', 'third tone.',
      '好', 'third tone.',
      'In', '你好', '你',
    ]);
    expect(texts[9]).toBe('is said with a second tone, before another third tone.');
    expect(texts[10]).toBe('The greeting.');
    expect(texts.indexOf('In the conversation:')).toBeGreaterThan(10);
  });

  it('the Chinese of a tone line is the teacher at the word rate (a one-character word reuses its clip)', () => {
    const segs = speechIn(chapterOf('粗'));
    const tone = segs.find((s) => s.display === '粗, cū,');
    expect(tone).toMatchObject({ lang: 'zh', voice: 'teacher', text: '粗', rate: RATES.word });
    const keys = uniqueSpeech(script).filter((u) => u.text === '粗' && u.voice === 'teacher');
    expect(keys.length).toBe(1);
    expect(segs.find((s) => s.text === 'first tone.')).toMatchObject({ lang: 'en', voice: 'narrator' });
    expect(validateScript(script)).toEqual([]);
  });

  it('the pauses: a beat inside a line, a short one after it, the usual one before the explanation', () => {
    const ch = chapterOf('粗');
    const segs = script.segments.filter((s) => s.chapter === ch);
    const at = segs.findIndex((s) => s.kind === 'speech' && s.display === '粗, cū,');
    expect(segs[at + 1]).toMatchObject({ kind: 'pause', ms: PAUSES.toneInner });
    expect(segs[at + 3]).toMatchObject({ kind: 'pause', ms: PAUSES.wordRepeat });
  });

  it('the sample’s 一个 says the 一 change', () => {
    const texts = speechIn(chapterOf('一个')).map((s) => s.text);
    expect(texts.slice(2, 10)).toEqual(['一', 'first tone.', '个', 'fourth tone.', 'In', '一个', '一', 'is said with a second tone, before a fourth tone.']);
  });

  it('slower dialogue: the plays, line by line and the third play', () => {
    expect(RATES.dialogue).toBeLessThan(0.9);
    expect(RATES.dialogueSlow).toBeLessThan(RATES.dialogue);
    expect(RATES.line).toBeLessThan(0.8);
    const first = speechIn(1).filter((s) => s.lang === 'zh');
    expect(first.every((s) => s.rate === RATES.dialogue)).toBe(true);
    expect(speechIn(3).filter((s) => s.lang === 'zh').every((s) => s.rate === RATES.dialogueSlow)).toBe(true);
  });

  it('the transcript: the word row stays the word; each tone line is one row with its pinyin', () => {
    const frames = new Map(uniqueSpeech(script).map((u) => [u.key, 30]));
    const rows = transcriptRows(buildTimeline(script, frames, 24).transcript);
    expect(rows.find((r) => r.text === '你好' && r.repeat === 2)).toBeTruthy();
    expect(rows.map((r) => r.text)).toEqual(expect.arrayContaining([
      '你, nǐ, third tone.',
      '好, hǎo, third tone.',
      'In 你好, 你 is said with a second tone, before another third tone.',
      'The greeting.',
    ]));
    // The sample's 粗: "粗 ×2", then its tone, then the explanation — three rows, nothing glued on.
    const i = rows.findIndex((r) => r.text === '粗' && r.repeat === 2);
    expect(rows[i + 1].text).toBe('粗, cū, first tone.');
    expect(rows[i + 2].text).toMatch(/^This means thick, for noodles or rope\. Its opposite is 细, thin\./);
  });
});
