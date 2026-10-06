import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  chapterIndexAt,
  compileDialogueLesson,
  compileSleepLesson,
  estimateScriptMs,
  formatClock,
  previousChapterTarget,
  sleepFadeVolume,
  speechChars,
  speechKey,
  splitChineseSentences,
  splitMixedText,
  transcriptIndexAt,
  uniqueSpeech,
  validateDialoguePlan,
  validateScript,
  validateSleepPlan,
  type SpeechSegment,
} from './index';
import { SAMPLE_DIALOGUE_PLAN, SAMPLE_SLEEP_PLAN, SAMPLE_SLEEP_SOURCE } from './samples';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('splitMixedText', () => {
  it('splits English narration around Chinese', () => {
    expect(splitMixedText('You already know 银行, the bank.')).toEqual([
      { lang: 'en', text: 'You already know' },
      { lang: 'zh', text: '银行' },
      { lang: 'en', text: ', the bank.' },
    ]);
  });
  it('drops quotes around the Chinese and keeps Chinese punctuation inside a run', () => {
    expect(splitMixedText('Say “粗的还是细的？” to ask.')).toEqual([
      { lang: 'en', text: 'Say' },
      { lang: 'zh', text: '粗的还是细的' },
      { lang: 'en', text: 'to ask.' },
    ]);
  });
  it('English only stays one piece', () => {
    expect(splitMixedText('Just English.')).toEqual([{ lang: 'en', text: 'Just English.' }]);
  });
});

it('splitChineseSentences keeps the marks', () => {
  expect(splitChineseSentences('你好。今天学三个词！好吗？')).toEqual(['你好。', '今天学三个词！', '好吗？']);
});

describe('format A (dialogue)', () => {
  const script = compileDialogueLesson(SAMPLE_DIALOGUE_PLAN);
  const speech = script.segments.filter((s): s is SpeechSegment => s.kind === 'speech');

  it('plays the dialogue three times, then line by line, then once more', () => {
    const first = SAMPLE_DIALOGUE_PLAN.dialogue[0].hanzi;
    // 3 plays + line by line + final play = 5 (no point uses line 0)
    expect(speech.filter((s) => s.text === first).length).toBe(5);
    expect(script.chapters.map((c) => c.title).slice(0, 5)).toEqual([
      'Introduction', 'First listen', 'Second listen', 'Third listen, a little slower', 'Line by line',
    ]);
    expect(script.chapters[script.chapters.length - 1].title).toBe('Final listen');
  });

  it('the third play is slower and each speaker keeps a voice', () => {
    const third = speech.filter((s) => s.chapter === 3 && s.lang === 'zh');
    expect(third.every((s) => s.rate < 0.9)).toBe(true);
    const cookLines = speech.filter((s) => s.text === '你好，吃什么？');
    expect(new Set(cookLines.map((s) => s.voice))).toEqual(new Set(['speaker_b']));
  });

  it('a new word is said slowly at least three times in its chapter', () => {
    const ch = script.chapters.findIndex((c) => c.title.startsWith('粗'));
    const said = speech.filter((s) => s.chapter === ch && s.text === '粗');
    expect(said.length).toBeGreaterThanOrEqual(3);
    expect(said.every((s) => s.rate <= 0.6)).toBe(true);
  });

  it('English narration never carries Chinese characters', () => {
    expect(speech.filter((s) => s.lang === 'en').some((s) => /[一-鿿]/.test(s.text))).toBe(false);
    expect(validateScript(script)).toEqual([]);
  });

  it('repeats are made once', () => {
    const unique = uniqueSpeech(script);
    expect(unique.length).toBeLessThan(speech.length);
    expect(new Set(unique.map((u) => u.key)).size).toBe(unique.length);
    expect(speechChars(script).clips).toBe(unique.length);
  });
});

describe('format B (sleep)', () => {
  const script = compileSleepLesson(SAMPLE_SLEEP_PLAN, { sourceText: SAMPLE_SLEEP_SOURCE });
  const speech = script.segments.filter((s): s is SpeechSegment => s.kind === 'speech');

  it('is Chinese only, slow, with the fixed phrases', () => {
    expect(speech.every((s) => s.lang === 'zh' && s.voice === 'sleep' && s.rate <= 0.6)).toBe(true);
    expect(speech.filter((s) => s.text === '这是一个新词。').length).toBe(2);
    expect(validateScript(script)).toEqual([]);
  });

  it('each word ×3 and each sentence ×3 with pauses of at least 1.5 s', () => {
    expect(speech.filter((s) => s.text === '邮局').length).toBe(3);
    expect(speech.filter((s) => s.text === '我去邮局寄信。').length).toBe(3);
    const segs = script.segments;
    segs.forEach((s, i) => {
      if (s.kind === 'speech' && s.text === '我去邮局寄信。') {
        const next = segs[i + 1];
        expect(next.kind).toBe('pause');
        if (next.kind === 'pause') expect(next.ms).toBeGreaterThanOrEqual(1500);
      }
    });
  });

  it('reads a short source text at the end, not a long one', () => {
    expect(script.chapters.map((c) => c.title)).toContain('原文');
    const long = compileSleepLesson(SAMPLE_SLEEP_PLAN, { sourceText: '我'.repeat(700) + '。' });
    expect(long.chapters.map((c) => c.title)).not.toContain('原文');
  });

  it('is long and calm: mostly pauses', () => {
    const pauses = script.segments.reduce((n, s) => n + (s.kind === 'pause' ? s.ms : 0), 0);
    expect(pauses / estimateScriptMs(script)).toBeGreaterThan(0.4);
  });
});

describe('plan validation', () => {
  it('accepts the samples', () => {
    expect(validateDialoguePlan(SAMPLE_DIALOGUE_PLAN)).toEqual([]);
    expect(validateSleepPlan(SAMPLE_SLEEP_PLAN)).toEqual([]);
  });

  it('refuses pinyin in English narration, a point not in its line, missing speakers', () => {
    const p = clone(SAMPLE_DIALOGUE_PLAN);
    p.intro_en = 'Listen for cū de, thick ones.';
    p.points[0].line = 0;
    p.speakers = [p.speakers[0]];
    const problems = validateDialoguePlan(p);
    expect(problems.some((x) => x.startsWith('intro_en: no pinyin'))).toBe(true);
    expect(problems.some((x) => x.includes('does not contain "粗"'))).toBe(true);
    expect(problems.some((x) => x.startsWith('speakers'))).toBe(true);
  });

  it('sleep: English in the Chinese, a sentence without the word, the wrong count', () => {
    const p = clone(SAMPLE_SLEEP_PLAN);
    p.words[0].explanation_zh = ['邮局 means post office.'];
    p.words[0].sentences[1].hanzi = '我去银行。';
    p.words[1].sentences = p.words[1].sentences.slice(0, 2);
    const problems = validateSleepPlan(p);
    expect(problems.some((x) => x.includes('Chinese only'))).toBe(true);
    expect(problems.some((x) => x.includes('must contain "邮局"'))).toBe(true);
    expect(problems.some((x) => x.includes('exactly 3'))).toBe(true);
  });

  it('sleep sentences must stay simple (short)', () => {
    const p = clone(SAMPLE_SLEEP_PLAN);
    p.words[0].sentences[0].hanzi = '邮局在银行旁边但是因为今天是星期天所以邮局不开门我们明天再来吧。';
    expect(validateSleepPlan(p).some((x) => x.includes('too long'))).toBe(true);
  });
});

describe('timeline', () => {
  const script = compileSleepLesson(SAMPLE_SLEEP_PLAN);
  const frames = new Map(uniqueSpeech(script).map((u, i) => [u.key, 40 + i]));

  it('chapters start where their first segment starts, in whole frames', () => {
    const t = buildTimeline(script, frames, 24, 1);
    expect(t.chapters[0].start_ms).toBe(24);
    expect(t.chapters.every((c) => c.start_ms % 24 === 0)).toBe(true);
    for (let i = 1; i < t.chapters.length; i++) expect(t.chapters[i].start_ms).toBeGreaterThan(t.chapters[i - 1].start_ms);
    expect(t.transcript.length).toBe(script.segments.filter((s) => s.kind === 'speech').length);
    expect(t.duration_ms).toBeGreaterThan(t.transcript[t.transcript.length - 1].start_ms);
  });

  it('a missing clip is an error', () => {
    const partial = new Map(frames);
    partial.delete(speechKey(script.segments.find((s) => s.kind === 'speech') as SpeechSegment));
    expect(() => buildTimeline(script, partial, 24)).toThrow();
  });

  it('player helpers', () => {
    const chapters = [{ title: 'a', start_ms: 0 }, { title: 'b', start_ms: 10_000 }, { title: 'c', start_ms: 20_000 }];
    expect(chapterIndexAt(chapters, 15_000)).toBe(1);
    expect(previousChapterTarget(chapters, 21_000)).toBe(10_000);
    expect(previousChapterTarget(chapters, 25_000)).toBe(20_000);
    const lines = buildTimeline(script, frames, 24).transcript;
    expect(transcriptIndexAt(lines, -5)).toBe(-1);
    expect(transcriptIndexAt(lines, lines[3].start_ms + 5)).toBe(3);
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(sleepFadeVolume(60_000)).toBe(1);
    expect(sleepFadeVolume(15_000)).toBeCloseTo(0.5);
  });
});

describe('transcriptRows', () => {
  it('joins an English sentence with Chinese inside into one row', async () => {
    const { transcriptRows } = await import('./timeline');
    const script = compileDialogueLesson(SAMPLE_DIALOGUE_PLAN);
    const frames = new Map(uniqueSpeech(script).map((u) => [u.key, 30]));
    const rows = transcriptRows(buildTimeline(script, frames, 24).transcript);
    expect(rows[0].text).toBe("You're at a busy Lanzhou beef noodle shop, a 兰州拉面 place. You order at the counter: the kind of noodle, how spicy, and whether you want an egg. Listen for how the staff ask about thickness.");
    expect(rows[1].text).toBe('First, just listen to the conversation.');
    expect(rows[2]).toMatchObject({ text: '你好，吃什么？', pinyin: 'nǐ hǎo, chī shénme?' });
  });
});
