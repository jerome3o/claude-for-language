import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  chapterIndexAt,
  charToneLines,
  compileDialogueLesson,
  compileSleepLesson,
  estimateScriptMs,
  formatClock,
  isCharacterOrigin,
  LESSON_MUSIC,
  MUSIC_DEFAULT_VOLUME,
  musicDefaultOn,
  musicOutputVolume,
  musicShouldPlay,
  musicVolumeLabel,
  parseMusicOn,
  parseMusicVolume,
  PAUSES,
  RATES,
  repeatLabel,
  SLEEP_ZH_PROVIDER_RATE,
  sleepTranslationText,
  previousChapterTarget,
  sleepFadeVolume,
  sleepRecapText,
  speechChars,
  speechKey,
  splitChineseSentences,
  splitMixedText,
  transcriptIndexAt,
  uniqueSpeech,
  validateDialoguePlan,
  validateScript,
  validateSleepPlan,
  type SleepCharTone,
  type SpeechSegment,
  NEW_WORD_INTROS,
  pickVariant,
  RECAP_OPENINGS,
  SENTENCES_INTROS,
  sleepVariationSeed,
} from './index';
import { SAMPLE_DIALOGUE_PLAN, SAMPLE_SLEEP_PLAN, SAMPLE_SLEEP_SOURCE } from './samples';

/** The wordings the sample sleep lesson's word `i` gets (phrases.ts). */
const SEED = sleepVariationSeed(SAMPLE_SLEEP_PLAN);
const introOf = (i: number) => pickVariant(NEW_WORD_INTROS, SEED, 'newWord', i);
const sentencesOf = (i: number) => pickVariant(SENTENCES_INTROS, SEED, 'sentences', i);
const recapOf = (i: number) => pickVariant(RECAP_OPENINGS, SEED, 'recap', i);

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
    // 3 plays + line by line (×3, the English, once more) + final play = 8 (no point uses line 0)
    expect(speech.filter((s) => s.text === first).length).toBe(8);
    expect(script.chapters.map((c) => c.title).slice(0, 5)).toEqual([
      'Introduction', 'First listen', 'Second listen', 'Third listen, a little slower', 'Line by line',
    ]);
    expect(script.chapters[script.chapters.length - 1].title).toBe('Final listen');
  });

  it('line by line: each line three times, its English, then the line once more', () => {
    const ch = script.chapters.findIndex((c) => c.title === 'Line by line');
    const segs = script.segments.filter((s) => s.chapter === ch);
    const said = segs.filter((s): s is SpeechSegment => s.kind === 'speech').slice(1); // after the host's intro
    expect(said).toHaveLength(SAMPLE_DIALOGUE_PLAN.dialogue.length * 5);
    SAMPLE_DIALOGUE_PLAN.dialogue.forEach((line, i) => {
      const [a, b, c, en, d] = said.slice(i * 5, i * 5 + 5);
      const role = line.speaker === 'A' ? 'speaker_a' : 'speaker_b';
      for (const zh of [a, b, c, d]) expect(zh).toMatchObject({ lang: 'zh', voice: role, text: line.hanzi, rate: RATES.line });
      expect(en).toMatchObject({ lang: 'en', voice: 'narrator', text: line.english });
      // Pinyin / English ride on the first play only (one transcript row).
      expect(a.pinyin).toBe(line.pinyin);
      expect(b.pinyin).toBeUndefined();
      expect(d.pinyin).toBeUndefined();
    });
    // The pauses: short between the plays, a beat around the English, then the next line.
    const first = segs.findIndex((s) => s.kind === 'speech' && s.text === SAMPLE_DIALOGUE_PLAN.dialogue[0].hanzi);
    const gaps = segs.slice(first, first + 10).filter((s) => s.kind === 'pause').map((s) => (s as { ms: number }).ms);
    expect(gaps).toEqual([PAUSES.lineRepeat, PAUSES.lineRepeat, PAUSES.lineThenEnglish, PAUSES.englishThenLine, PAUSES.afterLineByLine]);
    // Still one clip per line: the four plays share it.
    const keys = uniqueSpeech(script).filter((u) => u.text === SAMPLE_DIALOGUE_PLAN.dialogue[0].hanzi && u.rate === RATES.line);
    expect(keys).toHaveLength(1);
  });

  it('the lesson stays near its length: line by line is about 20 s a line', () => {
    const ch = script.chapters.findIndex((c) => c.title === 'Line by line');
    const lbl = estimateScriptMs({ ...script, segments: script.segments.filter((s) => s.chapter === ch) });
    expect(lbl / SAMPLE_DIALOGUE_PLAN.dialogue.length).toBeLessThan(22_000);
    expect(estimateScriptMs(script) / 60000).toBeLessThan(12);
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

  it('is Chinese, as slow as the voice allows, with the fixed phrases — English only in the recap voice', () => {
    const zh = speech.filter((s) => s.lang === 'zh');
    expect(zh.every((s) => s.voice === 'sleep' && s.rate === 0.5)).toBe(true);
    expect(SLEEP_ZH_PROVIDER_RATE).toEqual({ minimax: 0.5, azure: 0.6, google: 0.6 });
    expect(speech.filter((s) => s.lang === 'en').every((s) => s.voice === 'recap')).toBe(true);
    expect(speech.filter((s) => s.voice === 'recap').every((s) => s.lang === 'en')).toBe(true);
    expect(speech.filter((s) => s.text === introOf(0)[0]).length).toBe(introOf(0)[0] === introOf(1)[0] ? 2 : 1);
    expect(speech.filter((s) => s.text === introOf(1)[0]).length).toBeGreaterThanOrEqual(1);
    expect(validateScript(script)).toEqual([]);
  });

  it('per word: intro + word ×3, character tones + characters, the meaning, the English recap, then sentences ×3 + translation', () => {
    const ch = script.chapters.findIndex((c) => c.title.startsWith('邮局'));
    const segs = script.segments.filter((s) => s.chapter === ch);
    const texts = segs.map((s) => (s.kind === 'speech' ? s.text : null));
    const at = (t: string) => texts.indexOf(t);
    const repeats = texts.flatMap((t, j) => (t === '邮局' ? [j] : []));
    expect(repeats.length).toBe(4); // ×3, then once inside the recap
    // a) the intro, then the word three times
    expect(at(introOf(0)[0])).toBe(0);
    expect(at(introOf(0)[1])).toBe(2);
    expect(repeats.slice(0, 3)).toEqual([4, 6, 8]);
    // b) the characters, one by one: tone, then that character's line
    const youTone = texts.findIndex((t) => !!t && t.startsWith('邮，'));
    const juTone = texts.findIndex((t) => !!t && t.startsWith('局，'));
    expect(youTone).toBeGreaterThan(repeats[2]);
    expect(at('你学过‘邮件’的‘邮’。')).toBe(youTone + 2);
    expect(juTone).toBe(youTone + 4);
    expect(at('‘局’也在‘结局’里。')).toBe(juTone + 2);
    expect(at('结局，就是最后。')).toBe(juTone + 4);
    // c) the meaning, every sentence of it, in order
    const meaning = SAMPLE_SLEEP_PLAN.words[0].meaning_zh.flatMap(splitChineseSentences);
    const meaningAt = meaning.map(at);
    expect(meaningAt.every((j) => j > at('结局，就是最后。'))).toBe(true);
    expect([...meaningAt].sort((x, y) => x - y)).toEqual(meaningAt);
    // d) the English recap, BEFORE the example sentences
    expect(at(recapOf(0))).toBeGreaterThan(Math.max(...meaningAt));
    expect(at(sentencesOf(0))).toBeGreaterThan(at(recapOf(0)));
    const inRecap = segs[at(recapOf(0)) + 2];
    expect(inRecap).toMatchObject({ lang: 'zh', voice: 'sleep', text: '邮局', rate: RATES.sleepWord });
    expect(speechKey(inRecap as SpeechSegment)).toBe(speechKey(segs[repeats[0]] as SpeechSegment));
    // e) each sentence ×3, then its English once (the recap voice), then the next sentence
    const english = segs.filter((s): s is SpeechSegment => s.kind === 'speech' && s.lang === 'en');
    expect(english.map((s) => s.text)).toEqual([
      recapOf(0),
      ': post office, the place where you send letters and parcels.',
      'The post office is next to the bank.',
      "I'm going to the post office to send a letter.",
      'When does the post office open?',
    ]);
    expect(english.every((s) => s.voice === 'recap' && s.rate === RATES.recap)).toBe(true);
    for (const sentence of SAMPLE_SLEEP_PLAN.words[0].sentences) {
      const idx = texts.flatMap((t, j) => (t === sentence.hanzi ? [j] : []));
      expect(idx.length).toBe(3);
      expect(texts[idx[2] + 2]).toBe(sentence.english);
    }
    expect(at(sentencesOf(0))).toBeLessThan(at(SAMPLE_SLEEP_PLAN.words[0].sentences[0].hanzi));
  });

  it('short pauses around the intro; longer ones where there is something to take in', () => {
    const ch = script.chapters.findIndex((c) => c.title.startsWith('寄'));
    const segs = script.segments.filter((s) => s.chapter === ch);
    const pauseAfter = (text: string, nth = 0) => {
      const i = segs.flatMap((s, j) => (s.kind === 'speech' && s.text === text ? [j] : []))[nth];
      const next = segs[i + 1];
      return next?.kind === 'pause' ? next.ms : 0;
    };
    expect(pauseAfter(introOf(1)[0])).toBe(PAUSES.sleepIntroPhrase);
    expect(pauseAfter(introOf(1)[1])).toBe(PAUSES.sleepAfterIntro);
    expect(pauseAfter('寄', 0)).toBe(PAUSES.sleepWordRepeat);
    expect(pauseAfter('寄', 1)).toBe(PAUSES.sleepWordRepeat);
    expect(pauseAfter('寄', 2)).toBe(PAUSES.sleepAfterWord);
    expect(PAUSES.sleepIntroPhrase).toBeLessThan(1000);
    expect(PAUSES.sleepWordRepeat).toBeLessThan(PAUSES.sleepSentenceRepeat);
    expect(pauseAfter('寄就是送东西给别人。')).toBe(PAUSES.sleepMeaning);
    const first = SAMPLE_SLEEP_PLAN.words[1].sentences[0];
    expect(pauseAfter(first.hanzi, 0)).toBe(PAUSES.sleepSentenceRepeat);
    expect(pauseAfter(first.hanzi, 2)).toBe(PAUSES.sleepBeforeTranslation);
    expect(pauseAfter(first.english)).toBe(PAUSES.sleepAfterTranslation);
    // The last translation of a word: the pause before the next word only.
    expect(pauseAfter(SAMPLE_SLEEP_PLAN.words[0].sentences[2].english)).toBe(0);
    const firstCh = script.segments.filter((s) => s.chapter === ch - 1);
    const last = firstCh[firstCh.length - 1];
    expect(last).toEqual({ kind: 'pause', ms: PAUSES.sleepBetweenWords, chapter: ch - 1 });
  });

  it('sleepTranslationText closes the sentence', () => {
    expect(sleepTranslationText('Mum posted me a book')).toBe('Mum posted me a book.');
    expect(sleepTranslationText(' When does it open? ')).toBe('When does it open?');
  });

  it('sleepRecapText', () => {
    expect(sleepRecapText('银行', 'bank, as in the place where you keep your money, not the bank of a river')).toBe(
      'The word was 银行: bank, as in the place where you keep your money, not the bank of a river.',
    );
    expect(sleepRecapText('银行', 'The word was 银行: bank.')).toBe('The word was 银行: bank.');
    expect(sleepRecapText('银行', 'That word was 银行: bank.', 'Our new word was')).toBe('Our new word was 银行: bank.');
  });

  it('each word ×3 and each sentence ×3 with pauses of at least 1.2 s', () => {
    expect(speech.filter((s) => s.text === '邮局').length).toBe(4); // ×3 + once in the English recap
    expect(speech.filter((s) => s.text === '我去邮局寄信。').length).toBe(3);
    const segs = script.segments;
    segs.forEach((s, i) => {
      if (s.kind === 'speech' && s.text === '我去邮局寄信。') {
        const next = segs[i + 1];
        expect(next.kind).toBe('pause');
        if (next.kind === 'pause') expect(next.ms).toBeGreaterThanOrEqual(1200);
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
    expect(pauses / estimateScriptMs(script)).toBeGreaterThan(0.3);
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
    p.words[0].meaning_zh = ['邮局 means post office.'];
    p.words[0].sentences[1].hanzi = '我去银行。';
    p.words[1].sentences = p.words[1].sentences.slice(0, 2);
    const problems = validateSleepPlan(p);
    expect(problems.some((x) => x.includes('Chinese only'))).toBe(true);
    expect(problems.some((x) => x.includes('must contain "邮局"'))).toBe(true);
    expect(problems.some((x) => x.includes('exactly 3'))).toBe(true);
  });

  it('sleep: every word must say what it MEANS, and have an English recap', () => {
    const p = clone(SAMPLE_SLEEP_PLAN) as unknown as { words: Array<Record<string, unknown>> };
    delete p.words[0].meaning_zh;
    p.words[1].meaning_zh = ['‘寄’是‘寄信’的‘寄’。'];
    delete p.words[1].recap_en;
    const problems = validateSleepPlan(p);
    expect(problems.some((x) => x.startsWith('words[0].meaning_zh') && x.includes('required'))).toBe(true);
    expect(problems.some((x) => x.startsWith('words[1].meaning_zh') && x.includes('char_notes'))).toBe(true);
    expect(problems.some((x) => x.startsWith('words[1].recap_en') && x.includes('required'))).toBe(true);
    const q = clone(SAMPLE_SLEEP_PLAN);
    q.words[0].recap_en = 'yóujú, post office';
    expect(validateSleepPlan(q).some((x) => x.startsWith('words[0].recap_en: no pinyin'))).toBe(true);
  });

  it('sleep: the meaning is 5–8 short sentences that each say something new', () => {
    const p = clone(SAMPLE_SLEEP_PLAN);
    p.words[0].meaning_zh = ['邮局是一个地方。', '在邮局，你可以寄信。'];
    p.words[1].meaning_zh = [...p.words[1].meaning_zh, '寄就是送东西给别人。'];
    const problems = validateSleepPlan(p);
    expect(problems.some((x) => x.startsWith('words[0].meaning_zh: 5–8') && x.includes('(got 2)'))).toBe(true);
    expect(problems.some((x) => x.startsWith('words[1].meaning_zh') && x.includes('twice'))).toBe(true);
    const q = clone(SAMPLE_SLEEP_PLAN);
    q.words[0].meaning_zh = [...q.words[0].meaning_zh.slice(0, 7), '‘邮’是‘邮件’的‘邮’。'];
    q.words[1].meaning_zh = [...q.words[1].meaning_zh.slice(0, 6), '寄'.repeat(31) + '。'];
    const more = validateSleepPlan(q);
    expect(more.some((x) => x.startsWith('words[0].meaning_zh[7]') && x.includes('char_notes'))).toBe(true);
    expect(more.some((x) => x.startsWith('words[1].meaning_zh[6]: too long'))).toBe(true);
    const r = clone(SAMPLE_SLEEP_PLAN);
    r.words[0].meaning_zh = [...r.words[0].meaning_zh, '邮局里有人。', '邮局很近。'];
    expect(validateSleepPlan(r).some((x) => x.startsWith('words[0].meaning_zh: 5–8') && x.includes('(got 9)'))).toBe(true);
  });

  it('sleep: every example sentence has a spoken English translation', () => {
    const p = clone(SAMPLE_SLEEP_PLAN);
    p.words[0].sentences[0].english = '';
    p.words[0].sentences[1].english = '...';
    p.words[0].sentences[2].english = 'When does the yóujú open?';
    p.words[1].sentences[0].english = 'I want to send a letter '.repeat(7);
    const problems = validateSleepPlan(p);
    expect(problems).toContain('words[0].sentences[0].english: required');
    expect(problems.some((x) => x.startsWith('words[0].sentences[1].english: an English translation is required'))).toBe(true);
    expect(problems.some((x) => x.startsWith('words[0].sentences[2].english: no pinyin'))).toBe(true);
    expect(problems.some((x) => x.startsWith('words[1].sentences[0].english: too long'))).toBe(true);
  });

  it('isCharacterOrigin', () => {
    expect(isCharacterOrigin("'银'就是'银行'的'银'。")).toBe(true);
    expect(isCharacterOrigin('‘邮’是‘邮件’的‘邮’。')).toBe(true);
    expect(isCharacterOrigin('邮局是一个地方。')).toBe(false);
    expect(isCharacterOrigin('寄就是送东西给别人。')).toBe(false);
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

describe('music bed', () => {
  it('on for sleep lessons, off for dialogue lessons, a stored choice wins', () => {
    expect(musicDefaultOn('sleep')).toBe(true);
    expect(musicDefaultOn('dialogue')).toBe(false);
    expect(musicDefaultOn(null)).toBe(false);
    expect(parseMusicOn(null, 'sleep')).toBe(true);
    expect(parseMusicOn('0', 'sleep')).toBe(false);
    expect(parseMusicOn('1', 'dialogue')).toBe(true);
    expect(parseMusicOn('x', 'dialogue')).toBe(false);
  });
  it('plays only while the lesson plays and it is on', () => {
    expect(musicShouldPlay({ on: true, lessonPlaying: true })).toBe(true);
    expect(musicShouldPlay({ on: true, lessonPlaying: false })).toBe(false);
    expect(musicShouldPlay({ on: false, lessonPlaying: true })).toBe(false);
  });
  it('volume: clamped, the sleep timer fades it with the voice', () => {
    expect(parseMusicVolume(null)).toBe(MUSIC_DEFAULT_VOLUME);
    expect(parseMusicVolume('0.5')).toBe(0.5);
    expect(parseMusicVolume(0)).toBe(0.05);
    expect(parseMusicVolume(3)).toBe(1);
    expect(parseMusicVolume(0.333)).toBe(0.33);
    expect(musicOutputVolume(0.4, sleepFadeVolume(15_000))).toBe(0.2);
    expect(musicOutputVolume(0.4, 0)).toBe(0);
    expect(musicOutputVolume(2, 2)).toBe(1);
    expect(musicVolumeLabel(0.35)).toBe('35 %');
    expect(LESSON_MUSIC.path).toMatch(/^\/audio\/lesson-music-v\d+\.mp3$/);
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
    // Line by line: the host's translation joins the Chinese line's row instead of repeating it.
    expect(rows.filter((r) => r.text === "I'd like a bowl of beef noodles.")).toEqual([]);
    const lineByLine = rows.filter((r) => r.text === '我要一碗牛肉面。' && r.last > r.first);
    expect(lineByLine.length).toBe(1);
    // …and it is ONE row: ×3, the English, once more ("×3 +1").
    expect(lineByLine[0]).toMatchObject({ repeat: 3, again: 1, english: "I'd like a bowl of beef noodles." });
    expect(lineByLine[0].last - lineByLine[0].first).toBe(4);
    expect(repeatLabel(lineByLine[0])).toEqual({ text: '×3 +1', aria: 'said 3 times, then once more after the English' });
    // The "+1" rows: each line of the line by line (×3 +1), and a point's example (Chinese, English,
    // Chinese again: "+1"); the dialogue's plays stay one row per line.
    const again = rows.filter((r) => r.again);
    expect(again.filter((r) => r.repeat === 3)).toHaveLength(SAMPLE_DIALOGUE_PLAN.dialogue.length);
    const examples = SAMPLE_DIALOGUE_PLAN.points.flatMap((p) => (p.example ? [p.example.hanzi] : []));
    expect(again.filter((r) => !r.repeat).map((r) => r.text)).toEqual(examples);
    expect(repeatLabel(again.find((r) => !r.repeat)!)).toEqual({ text: '+1', aria: 'said once, then once more after the English' });
  });

  it('a sleep lesson recap is one row; the Chinese lines around it stay their own', async () => {
    const { transcriptRows } = await import('./timeline');
    const script = compileSleepLesson(SAMPLE_SLEEP_PLAN);
    const frames = new Map(uniqueSpeech(script).map((u) => [u.key, 30]));
    const rows = transcriptRows(buildTimeline(script, frames, 24).transcript);
    expect(rows.map((r) => r.text)).toContain(`${recapOf(0)} 邮局: post office, the place where you send letters and parcels.`);
    // The word ×3 is one row, "×3", with its pinyin; each sentence ×3 + its spoken translation is one row.
    expect(rows.filter((r) => r.text === '邮局')).toEqual([expect.objectContaining({ repeat: 3, pinyin: 'yóujú', english: 'post office' })]);
    const sentence = rows.find((r) => r.text === '我去邮局寄信。');
    expect(sentence).toMatchObject({ repeat: 3, english: "I'm going to the post office to send a letter." });
    expect(sentence!.last - sentence!.first).toBe(3);
    expect(rows.filter((r) => r.text === "I'm going to the post office to send a letter.")).toEqual([]);
    expect(rows.find((r) => r.text === introOf(0)[0])?.repeat).toBeUndefined();
    expect(rows.find((r) => r.text.startsWith(`${recapOf(1)} 寄`))?.lang).toBe('en');
  });
});

describe('sleep: each character with its tone', () => {
  type W = Parameters<typeof charToneLines>[0];
  const word = (hanzi: string, pinyin: string, char_tones: W['char_tones']): W => ({ hanzi, pinyin, char_tones });

  it('导航: one line per character, the pinyin shown but not spoken', () => {
    const lines = charToneLines(
      word('导航', 'dǎoháng', [
        { char: '导', pinyin: 'dǎo', tone: 3 },
        { char: '航', pinyin: 'háng', tone: 2 },
      ]),
    );
    expect(lines).toEqual([
      { spoken: '导，第三声。', display: '导，dǎo，第三声。', char: '导' },
      { spoken: '航，第二声。', display: '航，háng，第二声。', char: '航' },
    ]);
  });

  it('任务: the citation tone, then a line for the neutral tone in the word', () => {
    const lines = charToneLines(
      word('任务', 'rènwu', [
        { char: '任', pinyin: 'rèn', tone: 4 },
        { char: '务', pinyin: 'wù', tone: 4 },
      ]),
    );
    expect(lines.map((l) => l.display)).toEqual(['任，rèn，第四声。', '务，wù，第四声。', '在‘任务’里，‘务’读轻声。']);
    expect(lines[2].spoken).toBe('在‘任务’里，‘务’读轻声。');
  });

  it('你好: third-tone sandhi is said even though the pinyin never writes it', () => {
    const lines = charToneLines(
      word('你好', 'nǐ hǎo', [
        { char: '你', pinyin: 'nǐ', tone: 3 },
        { char: '好', pinyin: 'hǎo', tone: 3 },
      ]),
    );
    expect(lines.map((l) => l.spoken)).toEqual(['你，第三声。', '好，第三声。', '在‘你好’里，‘你’读第二声。']);
  });

  it('一 / 不 changes, also when the word pinyin forgot them; repeated characters', () => {
    const yiyang = charToneLines(word('一样', 'yīyàng', [{ char: '一', pinyin: 'yī', tone: 1 }, { char: '样', pinyin: 'yàng', tone: 4 }]));
    expect(yiyang.at(-1)?.spoken).toBe('在‘一样’里，‘一’读第二声。');
    const bushi = charToneLines(word('不是', 'bú shì', [{ char: '不', pinyin: 'bù', tone: 4 }, { char: '是', pinyin: 'shì', tone: 4 }]));
    expect(bushi.at(-1)?.spoken).toBe('在‘不是’里，‘不’读第二声。');
    const jiejie = charToneLines(word('姐姐', 'jiějie', [{ char: '姐', pinyin: 'jiě', tone: 3 }, { char: '姐', pinyin: 'jiě', tone: 3 }]));
    expect(jiejie.map((l) => l.spoken)).toEqual(['姐，第三声。', '在‘姐姐’里，第二个‘姐’读轻声。']);
  });

  it('a polyphone is spoken inside the word, so the voice picks the right reading', () => {
    const lines = charToneLines(word('银行', 'yínháng', [{ char: '银', pinyin: 'yín', tone: 2 }, { char: '行', pinyin: 'háng', tone: 2 }]));
    expect(lines[1]).toEqual({ spoken: '银行的行，第二声。', display: '行，háng，第二声。', char: '行' });
  });

  it('plans written before char_tones compile without the lines', () => {
    expect(charToneLines(word('邮局', 'yóujú', undefined))).toEqual([]);
  });

  it('wordings vary with the seed; no seed = the plain line; the display keeps the pinyin', () => {
    const daohang = word('导航', 'dǎoháng', [{ char: '导', pinyin: 'dǎo', tone: 3 }, { char: '航', pinyin: 'háng', tone: 2 }]);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const [dao] = charToneLines(daohang, { seed: 'lesson', index: i });
      expect(dao.spoken).toMatch(/^导，.*第三声。$/);
      expect(dao.display).toMatch(/^导，dǎo，.*第三声。$/);
      seen.add(dao.spoken);
      const next = charToneLines(daohang, { seed: 'lesson', index: i + 1 })[0];
      expect(next.spoken).not.toBe(dao.spoken);
    }
    expect(seen.size).toBeGreaterThan(1);
    const renwu = charToneLines(word('任务', 'rènwu', [{ char: '任', pinyin: 'rèn', tone: 4 }, { char: '务', pinyin: 'wù', tone: 4 }]), { seed: 'x', index: 3 });
    expect(renwu[2].spoken).toMatch(/任务.*‘务’.*读轻声。$/);
  });

  it('compiler: after the word ×3, before the meaning, each with a pause; the transcript shows the pinyin', () => {
    const script = compileSleepLesson(SAMPLE_SLEEP_PLAN);
    const ch = script.chapters.findIndex((c) => c.title.startsWith('邮局'));
    const segs = script.segments.filter((s) => s.chapter === ch);
    const texts = segs.map((s) => (s.kind === 'speech' ? s.text : null));
    const you = texts.findIndex((t) => !!t && /^邮，.*第二声。$/.test(t));
    expect(you).toBeGreaterThan(texts.lastIndexOf('邮局', texts.indexOf(recapOf(0))));
    expect(you).toBeLessThan(texts.indexOf('在邮局，你可以寄信。'));
    expect(texts[you + 4]).toMatch(/^局，.*第二声。$/);
    for (const i of [you, you + 4]) {
      const next = segs[i + 1];
      expect(next.kind === 'pause' && next.ms >= 1500).toBe(true);
    }
    expect(segs[you]).toMatchObject({ kind: 'speech', lang: 'zh', voice: 'sleep', rate: RATES.sleep });
    expect((segs[you] as SpeechSegment).display).toMatch(/^邮，yóu，.*第二声。$/);
    expect(validateScript(script)).toEqual([]);
    const frames = new Map(uniqueSpeech(script).map((u) => [u.key, 30]));
    const transcript = buildTimeline(script, frames, 24).transcript.map((l) => l.text);
    expect(transcript.some((t) => /^邮，yóu，.*第二声。$/.test(t))).toBe(true);
    expect(transcript.some((t) => /^寄，jì，.*第四声。$/.test(t))).toBe(true);
    expect(transcript).not.toContain('邮，第二声。');
  });
});

describe('sleep plan validation: char_tones', () => {
  const plan = (edit: (w: Record<string, unknown>) => void) => {
    const p = clone(SAMPLE_SLEEP_PLAN);
    edit(p.words[0] as unknown as Record<string, unknown>);
    return validateSleepPlan(p).join('\n');
  };
  const swapWord = (hanzi: string, pinyin: string, char_tones: SleepCharTone[]) => {
    const p = clone(SAMPLE_SLEEP_PLAN);
    const w = p.words[0];
    w.sentences.forEach((s) => (s.hanzi = s.hanzi.replace(w.hanzi, hanzi)));
    Object.assign(w, { hanzi, pinyin, char_tones });
    delete w.char_notes;
    return p;
  };

  it('required, one entry per character, in order', () => {
    expect(plan((w) => delete w.char_tones)).toMatch(/char_tones: required/);
    expect(plan((w) => (w.char_tones = [{ char: '邮', pinyin: 'yóu', tone: 2 }]))).toMatch(/2 expected \(邮 局\), got 1/);
    expect(plan((w) => (w.char_tones = [{ char: '局', pinyin: 'jú', tone: 2 }, { char: '邮', pinyin: 'yóu', tone: 2 }]))).toMatch(/char_tones\[0\]\.char: expected "邮"/);
  });

  it('a tone in 1–5 that agrees with the one syllable, written with a tone mark', () => {
    const one = (e: Record<string, unknown>) => plan((w) => (w.char_tones = [e, { char: '局', pinyin: 'jú', tone: 2 }]));
    expect(one({ char: '邮', pinyin: 'yóu', tone: 6 })).toMatch(/tone: 1, 2, 3, 4, or 5/);
    expect(one({ char: '邮', pinyin: 'yóu', tone: 0 })).toMatch(/tone: 1, 2, 3, 4, or 5/);
    expect(one({ char: '邮', pinyin: 'yóu', tone: 3 })).toMatch(/"yóu" is a tone 2 but tone is 3/);
    expect(one({ char: '邮', pinyin: 'you', tone: 2 })).toMatch(/unmarked \(轻声\) but tone is 2/);
    expect(one({ char: '邮', pinyin: 'you2', tone: 2 })).toMatch(/tone mark, not a number/);
    expect(one({ char: '邮', pinyin: 'yóujú', tone: 2 })).toMatch(/ONE syllable/);
    expect(one({ char: '邮', pinyin: 'yōu', tone: 1 })).toMatch(/tone 1 here but "yóu"/);
  });

  it('the reading the word uses; 一 / 不 at their citation tone', () => {
    expect(validateSleepPlan(swapWord('银行', 'yínháng', [{ char: '银', pinyin: 'yín', tone: 2 }, { char: '行', pinyin: 'xíng', tone: 2 }])).join('\n')).toMatch(/"xíng" doesn't match "háng"/);
    expect(validateSleepPlan(swapWord('银行', 'yínháng', [{ char: '银', pinyin: 'yín', tone: 2 }, { char: '行', pinyin: 'háng', tone: 2 }]))).toEqual([]);
    expect(validateSleepPlan(swapWord('一样', 'yíyàng', [{ char: '一', pinyin: 'yí', tone: 2 }, { char: '样', pinyin: 'yàng', tone: 4 }])).join('\n')).toMatch(/give 一 its citation tone, yī/);
    expect(validateSleepPlan(swapWord('一样', 'yíyàng', [{ char: '一', pinyin: 'yī', tone: 1 }, { char: '样', pinyin: 'yàng', tone: 4 }]))).toEqual([]);
  });

  it('a neutral syllable in the word is fine; another tone is a contradiction', () => {
    const tones: SleepCharTone[] = [{ char: '任', pinyin: 'rèn', tone: 4 }, { char: '务', pinyin: 'wù', tone: 4 }];
    expect(validateSleepPlan(swapWord('任务', 'rènwu', tones))).toEqual([]);
    expect(validateSleepPlan(swapWord('任务', 'rènwú', tones)).join('\n')).toMatch(/tone 4 here but "wú"/);
  });

  it('joined pinyin that reads two ways is split where the characters say', () => {
    expect(validateSleepPlan(swapWord('方案', 'fāngàn', [{ char: '方', pinyin: 'fāng', tone: 1 }, { char: '案', pinyin: 'àn', tone: 4 }]))).toEqual([]);
    expect(validateSleepPlan(swapWord('词二', 'cíèr', [{ char: '词', pinyin: 'cí', tone: 2 }, { char: '二', pinyin: 'èr', tone: 4 }]))).toEqual([]);
  });
});
