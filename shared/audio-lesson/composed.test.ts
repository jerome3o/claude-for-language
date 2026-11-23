import { describe, expect, it } from 'vitest';
import {
  autoLinePinyin,
  compileComposedLesson,
  composedPlanLines,
  composedPlanShapeProblems,
  composedRate,
  COMPOSED_DEFAULTS,
  COMPOSED_RATES,
  COMPOSED_SCRIPT_LIMITS,
  RATES,
  SCRIPT_LIMITS,
  COMPOSED_SPEC_DOC,
  DRILL_PATTERN,
  PAUSES,
  previewComposedLesson,
  SAMPLE_COMPOSED_RECAP_PLAN,
  transcriptRows,
  validateComposedPlan,
  validateScript,
  type AudioLessonScript,
  type ComposedBlock,
  type ComposedPlan,
  type SpeechSegment,
} from './index';

const plan = (blocks: unknown[], extra: Partial<ComposedPlan> = {}): ComposedPlan => ({ version: 1, title: 'Test', blocks: blocks as ComposedBlock[], ...extra });
const speech = (s: AudioLessonScript) => s.segments.filter((x): x is SpeechSegment => x.kind === 'speech');
/** What is said, in order: "zh:你好" / "en:Hello." */
const said = (s: AudioLessonScript) => speech(s).map((x) => `${x.lang}:${x.text}`);

describe('composed lessons — low-level blocks', () => {
  it('zh: repeats with gaps, the first play carries pinyin + English for the transcript', () => {
    const s = compileComposedLesson(plan([{ type: 'zh', hanzi: '周末', pinyin: 'zhōumò', english: 'weekend', repeat: 3, gap_ms: 500, after_ms: 2000 }]));
    expect(said(s)).toEqual(['zh:周末', 'zh:周末', 'zh:周末']);
    const sp = speech(s);
    expect(sp[0].pinyin).toBe('zhōumò');
    expect(sp[0].english).toBe('weekend');
    expect(sp[1].pinyin).toBe('zhōumò');
    expect(sp[1].english).toBeUndefined();
    expect(sp.every((x) => x.voice === 'teacher' && x.rate === COMPOSED_RATES.slow)).toBe(true);
    const pauses = s.segments.filter((x) => x.kind === 'pause').map((x) => (x as { ms: number }).ms);
    expect(pauses).toEqual([500, 500, 2000 + 1000]);
    // No chapter block: one chapter named after the lesson.
    expect(s.chapters).toEqual([{ title: 'Test' }]);
    expect(s.format).toBe('composed');
  });

  it('zh: named and numeric rates, voices', () => {
    expect(composedRate('sleep', 'slow')).toBe(0.5);
    expect(composedRate('natural', 'slow')).toBe(COMPOSED_RATES.natural);
    expect(composedRate(0.777, 'slow')).toBe(0.78);
    expect(composedRate(undefined, 'normal')).toBe(COMPOSED_RATES.normal);
    const s = compileComposedLesson(plan([{ type: 'zh', hanzi: '你好', voice: 'speaker_b', rate: 'natural' }]));
    expect(speech(s)[0]).toMatchObject({ voice: 'speaker_b', rate: COMPOSED_RATES.natural });
  });

  it('en: English with Chinese inside is spoken by the host and the teacher voice', () => {
    const s = compileComposedLesson(plan([{ type: 'en', text: 'You talked about hiking, 爬山, with friends.' }]));
    expect(speech(s).map((x) => [x.lang, x.voice, x.text])).toEqual([
      ['en', 'narrator', 'You talked about hiking,'],
      ['zh', 'teacher', '爬山'],
      ['en', 'narrator', ', with friends.'],
    ]);
    const r = compileComposedLesson(plan([{ type: 'en', text: 'Calm.', voice: 'recap' }]));
    expect(speech(r)[0]).toMatchObject({ voice: 'recap', rate: 0.9 });
    const def = compileComposedLesson(plan([{ type: 'en', text: 'Calm too.' }], { english_voice: 'recap' }));
    expect(speech(def)[0].voice).toBe('recap');
  });

  it('chapter + pause; an empty chapter is dropped', () => {
    const s = compileComposedLesson(plan([{ type: 'chapter', title: 'One' }, { type: 'chapter', title: 'Two' }, { type: 'pause', ms: 1500 }, { type: 'zh', hanzi: '好' }]));
    expect(s.chapters).toEqual([{ title: 'Two' }]);
    expect(s.segments[0]).toEqual({ kind: 'pause', ms: 1500, chapter: 0 });
    expect(validateScript(s)).toEqual([]);
  });

  it('sequence: a pattern with explicit pauses and gaps next to the English', () => {
    const s = compileComposedLesson(
      plan([{ type: 'sequence', hanzi: '我去爬山。', english: "I'm going hiking", pattern: ['zh', 'en', 3000, 'zh'], gap_ms: 400, en_gap_ms: 700, after_ms: 100 }]),
    );
    expect(said(s)).toEqual(['zh:我去爬山。', "en:I'm going hiking.", 'zh:我去爬山。']);
    const kinds = s.segments.map((x) => (x.kind === 'pause' ? x.ms : x.lang));
    expect(kinds).toEqual(['zh', 700, 'en', 3000, 'zh', 100 + 1000]);
  });
});

describe('composed lessons — macros', () => {
  it('drill: default pattern zh ×3, en, zh ×2 → one transcript row "×3 +2"', () => {
    const s = compileComposedLesson(plan([{ type: 'drill', hanzi: '我打算去爬山。', english: "I'm planning to go hiking." }]));
    expect(DRILL_PATTERN).toEqual(['zh', 'zh', 'zh', 'en', 'zh', 'zh']);
    expect(said(s)).toEqual([
      'zh:我打算去爬山。', 'zh:我打算去爬山。', 'zh:我打算去爬山。', "en:I'm planning to go hiking.", 'zh:我打算去爬山。', 'zh:我打算去爬山。',
    ]);
    const pauses = s.segments.filter((x) => x.kind === 'pause').map((x) => (x as { ms: number }).ms);
    const D = COMPOSED_DEFAULTS;
    expect(pauses).toEqual([D.drillGap, D.drillGap, D.drillEnGap, D.drillEnGap, D.drillGap, D.drillAfter + 1000]);
    // Automatic pinyin on the first play; two clips only.
    expect(speech(s)[0].pinyin).toBe('wǒ dǎ suàn qù pá shān.');
    const p = previewComposedLesson(plan([{ type: 'drill', hanzi: '我打算去爬山。', english: "I'm planning to go hiking." }]));
    expect(p.clips).toBe(2);
    expect(p.transcript).toEqual([{ at: '0:00', text: '我打算去爬山。', pinyin: 'wǒ dǎ suàn qù pá shān.', english: "I'm planning to go hiking.", repeat: '×3 +2' }]);
  });

  it('drill: every option overridable', () => {
    const s = compileComposedLesson(
      plan([{ type: 'drill', hanzi: '好的。', english: 'OK', pattern: ['en', 'zh'], rate: 'sleep', voice: 'sleep', en_voice: 'recap', en_gap_ms: 250, after_ms: 0 }]),
    );
    expect(speech(s).map((x) => [x.lang, x.voice, x.rate])).toEqual([
      ['en', 'recap', 0.9],
      ['zh', 'sleep', 0.5],
    ]);
  });

  it('word_focus: chapter, word ×3, tones, meaning, English anchor, example drill, the word again', () => {
    const s = compileComposedLesson(
      plan([
        {
          type: 'word_focus',
          hanzi: '打算',
          pinyin: 'dǎsuàn',
          english: 'to plan to',
          meaning_zh: ['你想做，可是还没做。'],
          examples: [{ hanzi: '我打算去爬山。', english: "I'm planning to go hiking." }],
        },
      ]),
    );
    expect(s.chapters).toEqual([{ title: '打算 — to plan to' }]);
    expect(s.words).toEqual([{ hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan to' }]);
    expect(said(s)).toEqual([
      'zh:打算', 'zh:打算', 'zh:打算',
      'zh:打', 'en:third tone.', 'zh:算', 'en:fourth tone.',
      'zh:你想做，可是还没做。',
      'zh:打算', 'en:means to plan to.',
      'zh:我打算去爬山。', 'zh:我打算去爬山。', 'zh:我打算去爬山。', "en:I'm planning to go hiking.", 'zh:我打算去爬山。', 'zh:我打算去爬山。',
      'zh:打算',
    ]);
    // The word is one clip wherever it is said (same text, voice, rate).
    expect(new Set(speech(s).filter((x) => x.text === '打算').map((x) => `${x.voice}|${x.rate}`)).size).toBe(1);
  });

  it('word_focus: tones / chapter / repeat off; a tone line is not said twice in one lesson', () => {
    const s = compileComposedLesson(plan([{ type: 'word_focus', hanzi: '爬山', pinyin: 'páshān', english: 'to hike', tones: false, chapter: false, repeat: 1 }]));
    expect(s.chapters).toEqual([{ title: 'Test' }]);
    expect(said(s)).toEqual(['zh:爬山', 'zh:爬山', 'en:means to hike.', 'zh:爬山']);
    const twice = compileComposedLesson(
      plan([
        { type: 'word_focus', hanzi: '山', pinyin: 'shān', english: 'mountain' },
        { type: 'word_focus', hanzi: '爬山', pinyin: 'páshān', english: 'to hike' },
      ]),
    );
    // ×3, its tone line (the one-character word's own clip), the anchor, once more.
    expect(said(twice).filter((x) => x === 'zh:山')).toHaveLength(6);
    expect(said(twice).filter((x) => x === 'en:first tone.')).toHaveLength(1);
  });

  it('structure: chapter = the pattern (never spoken), the explanation, each example as a drill', () => {
    const s = compileComposedLesson(
      plan([
        {
          type: 'structure',
          pattern: '要是…就…',
          explanation_en: '要是 means if; the result comes after 就.',
          examples: [{ hanzi: '要是下雨，我们就在家。', english: "If it rains, we'll stay home." }],
          drill: { pattern: ['zh', 'en', 'zh'] },
        },
      ]),
    );
    expect(s.chapters).toEqual([{ title: '要是…就…' }]);
    expect(said(s)).toEqual(['zh:要是', 'en:means if; the result comes after', 'zh:就', 'zh:要是下雨，我们就在家。', "en:If it rains, we'll stay home.", 'zh:要是下雨，我们就在家。']);
    expect(said(s).some((x) => x.includes('…'))).toBe(false);
  });

  it('exchange: two voices slow ×2, the gist, natural ×1', () => {
    const lines = [
      { speaker: 'A', hanzi: '你周末做什么？', english: 'What are you doing at the weekend?' },
      { speaker: 'B', hanzi: '我去爬山。', english: "I'm going hiking." },
    ];
    const s = compileComposedLesson(plan([{ type: 'exchange', title: 'The conversation', lines, gist_en: 'Weekend plans.' }]));
    expect(s.chapters).toEqual([{ title: 'The conversation' }]);
    expect(speech(s).map((x) => `${x.voice}@${x.rate}:${x.text}`)).toEqual([
      'speaker_a@0.6:你周末做什么？', 'speaker_b@0.6:我去爬山。',
      'speaker_a@0.6:你周末做什么？', 'speaker_b@0.6:我去爬山。',
      'narrator@1:Weekend plans.',
      'speaker_a@0.85:你周末做什么？', 'speaker_b@0.85:我去爬山。',
    ]);
    expect(s.speakers).toEqual([
      { role: 'speaker_a', name: 'A', gender: 'female' },
      { role: 'speaker_b', name: 'B', gender: 'male' },
    ]);
    // Without a gist, each line's English in turn.
    const noGist = compileComposedLesson(plan([{ type: 'exchange', lines, slow_plays: 1, natural_plays: 0 }]));
    expect(said(noGist)).toEqual(['zh:你周末做什么？', 'zh:我去爬山。', 'en:What are you doing at the weekend?', "en:I'm going hiking."]);
  });

  it('retell: sentence by sentence, no English, the whole paragraph twice; `text` is split', () => {
    const s = compileComposedLesson(plan([{ type: 'retell', text: '我周末去爬山。要是下雨，我就在家。' }]));
    expect(said(s)).toEqual(['zh:我周末去爬山。', 'zh:要是下雨，我就在家。', 'zh:我周末去爬山。', 'zh:要是下雨，我就在家。']);
    expect(speech(s).every((x) => x.lang === 'zh')).toBe(true);
    expect(speech(s)[0].pinyin).toBe('wǒ zhōu mò qù pá shān.');
    const three = compileComposedLesson(plan([{ type: 'retell', sentences: [{ hanzi: '好。' }], repeat: 3, rate: 'sleep' }]));
    expect(said(three)).toEqual(['zh:好。', 'zh:好。', 'zh:好。']);
  });

  it('recall: the prompt, silence to answer, the answer ×2', () => {
    const s = compileComposedLesson(plan([{ type: 'recall', english: 'How do you say: I am going hiking?', hanzi: '我去爬山。', think_ms: 4000 }]));
    expect(s.segments.map((x) => (x.kind === 'pause' ? x.ms : `${x.lang}:${x.text}`))).toEqual([
      'en:How do you say: I am going hiking?', 4000, 'zh:我去爬山。', COMPOSED_DEFAULTS.drillGap, 'zh:我去爬山。', COMPOSED_DEFAULTS.recallAfter + 1000,
    ]);
  });

  it('is deterministic', () => {
    expect(compileComposedLesson(SAMPLE_COMPOSED_RECAP_PLAN)).toEqual(compileComposedLesson(JSON.parse(JSON.stringify(SAMPLE_COMPOSED_RECAP_PLAN))));
  });
});

describe('composed lessons — validation', () => {
  const problems = (blocks: unknown[], extra: Record<string, unknown> = {}) => composedPlanShapeProblems({ version: 1, title: 'T', blocks, ...extra });

  it('the sample recap is valid, ~10 minutes, with its chapters', () => {
    const p = previewComposedLesson(SAMPLE_COMPOSED_RECAP_PLAN);
    expect(p.problems).toEqual([]);
    expect(p.estimate_minutes).toBeGreaterThan(5);
    expect(p.estimate_minutes).toBeLessThan(20);
    expect(p.chapters.map((c) => c.title)).toEqual([
      'What we talked about', 'The conversation', '打算 — to plan to', '爬山 — to go hiking', '要是…就…', 'Your turn', '复述',
    ]);
    expect(p.chapters[0].at).toBe('0:00');
    expect(p.clips).toBeLessThan(80);
    expect(p.transcript.find((r) => r.text === '要是下雨，我们就在家看电影。' && r.repeat === '×3 +2')).toBeTruthy();
    expect(p.script && validateScript(p.script)).toEqual([]);
  });

  it('refuses unknown blocks, the reserved clip, and bad fields with helpful messages', () => {
    expect(problems([{ type: 'song', hanzi: '好' }])[0]).toMatch(/blocks\[0\]: unknown block type "song" — one of chapter, zh, en/);
    expect(problems([{ type: 'clip', call_id: 'x' }])[0]).toMatch(/reserved and not supported yet/);
    expect(problems([{ type: 'zh', hanzi: '' }])).toContain('blocks[0].hanzi: Chinese characters are required');
    expect(problems([{ type: 'zh', hanzi: 'hello' }])).toContain('blocks[0].hanzi: Chinese characters are required');
    expect(problems([{ type: 'zh', hanzi: '你好/您好' }])[0]).toMatch(/no slashes/);
    expect(problems([{ type: 'zh', hanzi: '你好', pinyin: 'ni3 hao3' }])[0]).toMatch(/tone marks/);
    expect(problems([{ type: 'zh', hanzi: '好', repeat: 9 }])[0]).toMatch(/repeat: a whole number 1–6/);
    expect(problems([{ type: 'zh', hanzi: '好', rate: 'fast' }])[0]).toMatch(/rate: "sleep", "slow", "normal", "natural"/);
    expect(problems([{ type: 'zh', hanzi: '好', voice: 'narrator' }])[0]).toMatch(/voice: one of teacher, speaker_a/);
    expect(problems([{ type: 'en', text: 'Say nǐ hǎo.' }])[0]).toMatch(/no pinyin/);
    expect(problems([{ type: 'drill', hanzi: '好' }])).toContain('blocks[0].english: English is required');
    expect(problems([{ type: 'sequence', hanzi: '好', pattern: ['zh', 'en'] }])[0]).toMatch(/has "en" but the line has no english/);
    expect(problems([{ type: 'sequence', hanzi: '好', english: 'ok', pattern: ['en'] }])[0]).toMatch(/say the Chinese at least once/);
    expect(problems([{ type: 'sequence', hanzi: '好', pattern: ['zh', 'loud'] }])[0]).toMatch(/pattern\[1\]/);
    expect(problems([{ type: 'pause', ms: 50000 }])[0]).toMatch(/100–20000/);
    expect(problems([{ type: 'exchange', lines: [{ speaker: 'C', hanzi: '好', english: 'ok' }] }])[0]).toMatch(/2–20 lines/);
    expect(problems([{ type: 'structure', pattern: '要是…就…', explanation_en: 'If.', examples: [] }])[0]).toMatch(/1–4 example lines/);
    expect(problems([{ type: 'retell' }])[0]).toMatch(/"sentences" .* or "text"/);
    expect(problems([{ type: 'chapter', title: 'Only a chapter' }])).toContain('blocks: nothing is said — add a zh / en / drill / … block');
    expect(composedPlanShapeProblems({ title: 'T', blocks: [] })).toContain('blocks: a list of blocks is required');
    expect(composedPlanShapeProblems({ version: 2, title: 'T', blocks: [{ type: 'zh', hanzi: '好' }] })[0]).toMatch(/^version: 1/);
    expect(composedPlanShapeProblems(null)).toEqual(['plan: an object { title, blocks: [...] } is required']);
    expect(problems([{ type: 'zh', hanzi: '好' }], { speakers: { A: { gender: 'robot' } } })[0]).toMatch(/speakers.A.gender/);
  });

  it('caps the estimated length at 45 minutes and the distinct clips at the script limit', () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ type: 'pause', ms: 20_000, after_ms: 0, _i: i }));
    const p = validateComposedPlan({ title: 'Long', blocks: [{ type: 'zh', hanzi: '好' }, ...long, ...long, ...long] });
    expect(p.some((x) => /too long: about \d+ min \(at most 45 min\)/.test(x))).toBe(true);
    const many = Array.from({ length: 270 }, (_, i) => ({ type: 'zh', hanzi: `第${i}个句子。`, after_ms: 0 }));
    expect(validateComposedPlan({ title: 'Many', blocks: many }).some((x) => /different clips/.test(x))).toBe(true);
  });

  it('the dry run needs no TTS: estimate, chapters with starts, transcript rows', () => {
    const p = previewComposedLesson(plan([{ type: 'chapter', title: 'A' }, { type: 'zh', hanzi: '你好', repeat: 2 }, { type: 'chapter', title: 'B' }, { type: 'en', text: 'Hello there.' }]));
    expect(p.problems).toEqual([]);
    expect(p.chapters.map((c) => c.title)).toEqual(['A', 'B']);
    expect(p.chapters[1].start_ms).toBeGreaterThan(0);
    expect(p.transcript.map((r) => r.text)).toEqual(['你好', 'Hello there.']);
    expect(p.transcript[0].repeat).toBe('×2');
    expect(p.segments).toBe(p.script!.segments.length);
    expect(p.tts_chars).toEqual({ zh: 2, en: 'Hello there.'.length });
  });
});

describe('composed lessons — helpers', () => {
  it('autoLinePinyin keeps punctuation and applies the 一 / 不 rule', () => {
    expect(autoLinePinyin('我们一起去吧，不是吗？')).toBe('wǒ men yì qǐ qù ba, bú shì ma?');
    expect(autoLinePinyin('hello')).toBe('');
  });

  it('composedPlanLines lists every Chinese line once (companion lessons, summaries)', () => {
    const lines = composedPlanLines(SAMPLE_COMPOSED_RECAP_PLAN);
    expect(lines.map((l) => l.hanzi)).toContain('要是下雨，我们就在家看电影。');
    expect(new Set(lines.map((l) => l.hanzi)).size).toBe(lines.length);
    expect(lines.every((l) => l.pinyin)).toBe(true);
  });

  it('the dependency-free numbers match the compiler\'s (composed-limits.ts)', () => {
    expect(COMPOSED_RATES.sleep).toBe(RATES.sleep);
    expect(COMPOSED_RATES.slow).toBe(RATES.word);
    expect(COMPOSED_RATES.normal).toBe(RATES.line);
    expect(COMPOSED_SCRIPT_LIMITS).toEqual({ maxUniqueSpeech: SCRIPT_LIMITS.maxUniqueSpeech, maxSegments: SCRIPT_LIMITS.maxSegments, maxChapters: SCRIPT_LIMITS.maxChapters });
  });

  it('the block doc names every block type and the reserved clip', () => {
    for (const t of ['chapter', 'zh', 'en', 'pause', 'sequence', 'drill', 'word_focus', 'structure', 'exchange', 'retell', 'recall', 'clip']) {
      expect(COMPOSED_SPEC_DOC).toContain(`${t}`);
    }
    expect(COMPOSED_SPEC_DOC).toContain('["zh","zh","zh","en","zh","zh"]');
  });

  it('the transcript rows of a compiled plan group repeats like the other formats', () => {
    const s = compileComposedLesson(plan([{ type: 'zh', hanzi: '好', repeat: 3 }]));
    const lines = speech(s).map((x, i) => ({ start_ms: i * 1000, lang: x.lang, voice: x.voice, text: x.text, chapter: x.chapter, ...(x.pinyin ? { pinyin: x.pinyin } : {}) }));
    expect(transcriptRows(lines)).toHaveLength(1);
    expect(PAUSES.wordRepeat).toBeGreaterThan(0);
  });
});
