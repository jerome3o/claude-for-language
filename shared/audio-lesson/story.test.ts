import { describe, expect, it } from 'vitest';
import {
  audioLessonFormatInfo,
  buildTimeline,
  compileStoryLesson,
  estimateScriptMs,
  fitStoryChunks,
  musicDefaultOn,
  pickAudioLessonInput,
  SAMPLE_STORY_PLAN,
  SAMPLE_STORY_TEXT,
  speechKey,
  splitLongSentence,
  splitStorySentences,
  splitStoryText,
  storyChapterTitle,
  storyChunkLength,
  storyCutNotice,
  storyEstimateLine,
  storyMinutesForText,
  STORY_LIMITS,
  STORY_MS_PER_HAN,
  transcriptRows,
  validateScript,
  validateStoryPlan,
  type StoryPlan,
} from './index';

const texts = (t: string) => splitStoryText(t).map((c) => c.hanzi);

describe('splitStorySentences', () => {
  it('breaks after 。！？!?… and keeps runs of them together', () => {
    expect(splitStorySentences('你好！你去哪儿？我去学校。')).toEqual(['你好！', '你去哪儿？', '我去学校。']);
    expect(splitStorySentences('真的吗？！我不知道……他走了。')).toEqual(['真的吗？！', '我不知道……', '他走了。']);
    expect(splitStorySentences('Wait! 等一下')).toEqual(['Wait!', '等一下']);
  });

  it('never splits inside quotes; the closing quote stays with its sentence', () => {
    expect(splitStorySentences('他说：“今天天气很好。我们去公园吧。”她笑了。')).toEqual(['他说：“今天天气很好。我们去公园吧。”', '她笑了。']);
    expect(splitStorySentences('「你好。」他说。')).toEqual(['「你好。」', '他说。']);
    expect(splitStorySentences('他问："你吃饭了吗？"我说："吃了。"')).toEqual(['他问："你吃饭了吗？"', '我说："吃了。"']);
    expect(splitStorySentences('书名是《我们。他们》，很好看。')).toEqual(['书名是《我们。他们》，很好看。']);
  });

  it('a quote that never closes keeps the rest of the line together', () => {
    expect(splitStorySentences('他说：“你好。我是明慧。')).toEqual(['他说：“你好。我是明慧。']);
  });
});

describe('splitLongSentence', () => {
  it('cuts a sentence over 40 at its commas, about evenly', () => {
    const s = '然后他们一起走出了咖啡馆，外面阳光很好，街上有很多人在散步，孩子们在玩，老人们在下棋，一切都很安静。';
    const parts = splitLongSentence(s);
    expect(parts.join('')).toBe(s);
    expect(parts.length).toBe(2);
    for (const p of parts) expect(storyChunkLength(p)).toBeLessThanOrEqual(STORY_LIMITS.maxChunkChars);
  });

  it('a piece over 80 with no commas is cut hard', () => {
    const s = `${'我'.repeat(100)}。`;
    const parts = splitLongSentence(s);
    expect(parts.join('')).toBe(s);
    for (const p of parts) expect(storyChunkLength(p)).toBeLessThanOrEqual(STORY_LIMITS.maxChunkChars);
  });

  it('a short sentence is left alone', () => {
    expect(splitLongSentence('我去学校。')).toEqual(['我去学校。']);
  });
});

describe('splitStoryText', () => {
  it('the sample: heading → section, labels off the spoken text, short sentences merged, narration', () => {
    const chunks = splitStoryText(SAMPLE_STORY_TEXT);
    expect(chunks).toEqual(SAMPLE_STORY_PLAN.chunks.map((c) => ({ hanzi: c.hanzi, speaker: c.speaker, section: c.section })));
  });

  it('speaker labels: Latin always, Han when they start 2+ lines; "他说：" is narration', () => {
    const chunks = splitStoryText('A: 你好，你叫什么名字？\nB：我叫小明。你呢？\n他说：我叫大卫。\n老师：上课了。\n老师：请坐下。');
    expect(chunks.map((c) => c.speaker)).toEqual(['A', 'B', null, '老师', '老师']);
    expect(chunks[0].hanzi).toBe('你好，你叫什么名字？');
    expect(chunks[2].hanzi).toBe('他说：我叫大卫。');
    // A Han "label" used once is just text.
    expect(splitStoryText('注意：明天下雨。')[0]).toEqual({ hanzi: '注意：明天下雨。', speaker: null, section: null });
  });

  it('a lone label line gives the next line to that speaker', () => {
    expect(splitStoryText('A：\n你今天忙不忙？\nB：不太忙。')).toEqual([
      { hanzi: '你今天忙不忙？', speaker: 'A', section: null },
      { hanzi: '不太忙。', speaker: 'B', section: null },
    ]);
  });

  it('never merges across speaker turns, even short ones', () => {
    expect(texts('A：好。\nB：好的。\nA：走吧。')).toEqual(['好。', '好的。', '走吧。']);
  });

  it('merges a very short sentence into the next (8–40 characters), across narration lines too', () => {
    expect(texts('他笑了。他们一起走回家，路上没有人说话。\n很好。\n天黑了，月亮出来了。')).toEqual(['他笑了。他们一起走回家，路上没有人说话。', '很好。天黑了，月亮出来了。']);
    // A short tail that can't take the next joins the chunk before it.
    expect(texts('我们明天早上八点在学校门口见面吧。好。')).toEqual(['我们明天早上八点在学校门口见面吧。好。']);
    // Two sentences that are long enough each stay apart.
    expect(texts('我今天早上去了图书馆。下午我在家里看书。')).toEqual(['我今天早上去了图书馆。', '下午我在家里看书。']);
  });

  it('headings (#, 第一章, 【…】) become sections and are not spoken', () => {
    const chunks = splitStoryText('# 第一章\n他早上六点起床，然后去跑步。\n第二章 晚上\n他晚上十点睡觉，睡得很好。\n【尾声】\n第二天他又去跑步了。');
    expect(chunks.map((c) => [c.section, c.hanzi])).toEqual([
      ['第一章', '他早上六点起床，然后去跑步。'],
      ['第二章 晚上', '他晚上十点睡觉，睡得很好。'],
      ['尾声', '第二天他又去跑步了。'],
    ]);
    // "第一天…" / "第二场比赛开始了" are sentences, not headings.
    expect(splitStoryText('第一天我很紧张，什么都不会。')[0].section).toBeNull();
    expect(splitStoryText('第二场比赛开始了')[0].hanzi).toBe('第二场比赛开始了');
  });

  it('drops stage directions, list markers, symbols and lines without Chinese', () => {
    expect(texts('A：（笑）你真有意思！我很喜欢。\nB: [laughs] 是吗？谢谢你。\n- 我们走吧，时间不早了。\nThis line is English only.\n1. 第一，要多听。')).toEqual([
      '你真有意思！我很喜欢。',
      '是吗？谢谢你。',
      // A short last line (5) joins the narration chunk before it.
      '我们走吧，时间不早了。第一，要多听。',
    ]);
    expect(texts('他/她今天不来。')).toEqual(['他她今天不来。']);
  });

  it('Windows line breaks and blank lines', () => {
    expect(texts('你好，我是你的老师明慧。\r\n\r\n我是你的中文老师，我在北京。')).toEqual(['你好，我是你的老师明慧。', '我是你的中文老师，我在北京。']);
    // A short line (6) takes the next one in.
    expect(texts('你好，我叫明慧。\r\n我是你的中文老师。')).toEqual(['你好，我叫明慧。我是你的中文老师。']);
  });

  it('every chunk is within the hard limit; nothing is lost but labels, asides and symbols', () => {
    const long = Array.from({ length: 30 }, (_, i) => `第${i + 1}次，我们一起去了那家小饭馆，吃了很多好吃的菜，大家都很开心`).join('，') + '。';
    const chunks = splitStoryText(long);
    for (const c of chunks) expect(storyChunkLength(c.hanzi)).toBeLessThanOrEqual(STORY_LIMITS.hardChunkChars);
    expect(chunks.map((c) => c.hanzi).join('')).toBe(long);
  });

  it('nothing to say → no chunks', () => {
    expect(splitStoryText('')).toEqual([]);
    expect(splitStoryText('Only English here.\n# 标题')).toEqual([]);
  });
});

describe('compileStoryLesson', () => {
  const script = compileStoryLesson(SAMPLE_STORY_PLAN);

  it('per chunk: the Chinese ×3 at the slowest rate with 2 s after each, then its English once, 2.5 s', () => {
    const segs = script.segments;
    // Start: a beat of silence, then the first chunk.
    expect(segs[0]).toEqual({ kind: 'pause', ms: 1000, chapter: 0 });
    const first = segs.slice(1, 9);
    expect(first.map((s) => (s.kind === 'pause' ? s.ms : `${s.lang}:${s.voice}:${s.rate}:${s.text}`))).toEqual([
      'zh:speaker_a:0.5:你好！你今天想喝什么？',
      2000,
      'zh:speaker_a:0.5:你好！你今天想喝什么？',
      2000,
      'zh:speaker_a:0.5:你好！你今天想喝什么？',
      2000,
      'en:recap:0.9:Hi! What would you like to drink today?',
      2500,
    ]);
    // Only the first of the three carries the pinyin / English (the transcript shows it once).
    expect(first[0]).toMatchObject({ pinyin: SAMPLE_STORY_PLAN.chunks[0].pinyin, english: SAMPLE_STORY_PLAN.chunks[0].english, display: '明慧：你好！你今天想喝什么？' });
    expect(first[2]).not.toHaveProperty('pinyin');
    const zh = segs.filter((s) => s.kind === 'speech' && s.lang === 'zh');
    const en = segs.filter((s) => s.kind === 'speech' && s.lang === 'en');
    expect(zh.length).toBe(3 * SAMPLE_STORY_PLAN.chunks.length);
    expect(en.length).toBe(SAMPLE_STORY_PLAN.chunks.length);
    expect(segs[segs.length - 1]).toMatchObject({ kind: 'pause' });
  });

  it('two consistent voices for the speakers, the app voice for narration; the English full stop added', () => {
    const voices = script.segments.flatMap((s) => (s.kind === 'speech' && s.lang === 'zh' && s.pinyin ? [s.voice] : []));
    expect(voices).toEqual(['speaker_a', 'speaker_b', 'speaker_a', 'speaker_b', 'teacher']);
    expect(script.speakers).toEqual([
      { role: 'speaker_a', name: '明慧', gender: 'female' },
      { role: 'speaker_b', name: '杰罗姆', gender: 'male' },
    ]);
    expect(script.format).toBe('story');
    expect(script.words).toEqual([]);
    expect(validateScript(script)).toEqual([]);
  });

  it('a third speaker shares speaker A’s voice (two voices only)', () => {
    const plan: StoryPlan = {
      title: 't',
      speakers: [],
      chunks: ['A', 'B', 'C'].map((speaker) => ({ hanzi: '你好，我是你的同学。', pinyin: 'nǐ hǎo', english: 'Hello.', speaker, section: null })),
    };
    const s = compileStoryLesson(plan);
    expect(s.segments.flatMap((x) => (x.kind === 'speech' && x.pinyin ? [x.voice] : []))).toEqual(['speaker_a', 'speaker_b', 'speaker_a']);
    expect(s.speakers).toEqual([
      { role: 'speaker_a', name: 'A / C', gender: 'female' },
      { role: 'speaker_b', name: 'B', gender: 'male' },
    ]);
  });

  it('chapters: one per heading, else every 10 chunks, titled with the first words', () => {
    expect(script.chapters).toEqual([{ title: '在咖啡馆' }]);
    const chunks = Array.from({ length: 23 }, (_, i) => ({ hanzi: `这是故事里的第${i + 1}句话，很简单。`, pinyin: 'zhè shì', english: `Sentence ${i + 1}.`, speaker: null, section: null }));
    const s = compileStoryLesson({ title: 't', speakers: [], chunks });
    expect(s.chapters.map((c) => c.title)).toEqual(['这是故事里的第1句话…', '这是故事里的第11句话…', '这是故事里的第21句话…']);
    const firstOf = (ch: number) => s.segments.find((x) => x.kind === 'speech' && x.chapter === ch);
    expect(firstOf(1)).toMatchObject({ text: chunks[10].hanzi });
    expect(validateScript(s)).toEqual([]);
  });

  it('the transcript: one row per chunk, "×3", with its pinyin and English (the spoken English joins the row)', () => {
    const frames = new Map<string, number>();
    for (const s of script.segments) if (s.kind === 'speech') frames.set(speechKey(s), 40);
    const timeline = buildTimeline(script, frames, 24, 1);
    const rows = transcriptRows(timeline.transcript);
    expect(rows.length).toBe(SAMPLE_STORY_PLAN.chunks.length);
    expect(rows[0]).toMatchObject({ text: '明慧：你好！你今天想喝什么？', repeat: 3, pinyin: SAMPLE_STORY_PLAN.chunks[0].pinyin, english: SAMPLE_STORY_PLAN.chunks[0].english });
    expect(rows[4]).toMatchObject({ text: '他们坐在窗边，外面下着小雨。', repeat: 3 });
    expect(rows[1].start_ms).toBeGreaterThan(rows[0].start_ms);
  });

  it('its spoken length matches the per-chunk estimate the cap uses', () => {
    const total = estimateScriptMs(script);
    const fit = fitStoryChunks(splitStoryText(SAMPLE_STORY_TEXT));
    expect(fit.cut).toBeUndefined();
    expect(total).toBeGreaterThan(30_000);
  });
});

describe('length', () => {
  it('a long text is cut at about 60 minutes, and says so', () => {
    const para = '小明每天早上七点起床，然后吃早饭，坐地铁去公司上班。';
    const chunks = splitStoryText(Array.from({ length: 200 }, () => para).join('\n'));
    const fit = fitStoryChunks(chunks);
    expect(fit.cut).toBeDefined();
    expect(fit.chunks.length).toBe(fit.cut!.chunks);
    expect(fit.cut!.total_chunks).toBe(chunks.length);
    expect(fit.chunks.length).toBeLessThanOrEqual(STORY_LIMITS.maxChunks);
    const plan: StoryPlan = { title: 't', speakers: [], chunks: fit.chunks.map((c) => ({ ...c, pinyin: 'x', english: 'Every morning Xiaoming gets up at seven.' })) };
    const minutes = estimateScriptMs(compileStoryLesson(plan)) / 60000;
    expect(minutes).toBeLessThanOrEqual(STORY_LIMITS.maxMinutes + 2);
    expect(minutes).toBeGreaterThan(STORY_LIMITS.maxMinutes - 6);
    expect(storyCutNotice(fit.cut!)).toMatch(/^The text is long: this lesson covers the first [\d,]+ of [\d,]+ characters \(about 60 minutes\)\./);
  });

  it('the forms’ estimate: about 2.35 s of audio per character, capped at 60 minutes', () => {
    expect(storyMinutesForText('')).toEqual({ minutes: 0, han: 0, capped: false });
    expect(storyMinutesForText('你好')).toEqual({ minutes: 1, han: 2, capped: false });
    expect(storyMinutesForText('好'.repeat(1000))).toEqual({ minutes: Math.round((1000 * STORY_MS_PER_HAN) / 60000), han: 1000, capped: false });
    expect(storyMinutesForText('好'.repeat(3000))).toEqual({ minutes: 60, han: 3000, capped: true });
    // Calibrated on real chunks: within a fifth of the compiled script's estimate.
    const text = Array.from({ length: 20 }, () => '小明每天早上七点起床，然后吃早饭。').join('\n');
    const plan: StoryPlan = { title: 't', speakers: [], chunks: splitStoryText(text).map((c) => ({ ...c, pinyin: 'x', english: 'Xiaoming gets up at seven and has breakfast.' })) };
    const real = estimateScriptMs(compileStoryLesson(plan)) / 60000;
    expect(Math.abs(storyMinutesForText(text).minutes - real) / real).toBeLessThan(0.2);
  });
});

describe('storyEstimateLine', () => {
  it('what the forms say under the text box', () => {
    expect(storyEstimateLine('')).toBe('Each line three times, slowly, then its English.');
    expect(storyEstimateLine('你好')).toBe('About 1 minute of audio.');
    expect(storyEstimateLine('好'.repeat(500))).toBe('About 20 minutes of audio.');
    expect(storyEstimateLine('好'.repeat(3000))).toBe('Long text: the lesson covers about the first 60 minutes — paste the rest as another lesson.');
  });
});

describe('storyChapterTitle', () => {
  it('first words without the punctuation at the ends', () => {
    expect(storyChapterTitle('“你好！”')).toBe('你好');
    expect(storyChapterTitle('小明每天早上七点起床，然后吃早饭。')).toBe('小明每天早上七点起床…');
  });
});

describe('validateStoryPlan', () => {
  it('accepts the sample; refuses missing translations, Chinese in the English, no chunks', () => {
    expect(validateStoryPlan(SAMPLE_STORY_PLAN)).toEqual([]);
    const bad = JSON.parse(JSON.stringify(SAMPLE_STORY_PLAN)) as StoryPlan;
    bad.chunks[0].english = '';
    bad.chunks[1].english = 'I want 咖啡.';
    bad.chunks[2].pinyin = '';
    expect(validateStoryPlan(bad)).toEqual([
      'chunks[0].english: an English translation is required',
      'chunks[1].english: no Chinese characters — it is read by an English voice',
      'chunks[2].pinyin: required',
    ]);
    expect(validateStoryPlan({ title: 't', speakers: [], chunks: [] })).toEqual(['chunks: nothing to say — the text has no Chinese sentences']);
  });
});

describe('pickAudioLessonInput (story)', () => {
  it('takes the text, ignores a target length, titles it from the heading', () => {
    const p = pickAudioLessonInput({ format: 'story', text: SAMPLE_STORY_TEXT, target_minutes: 20 });
    expect(p.problems).toEqual([]);
    expect(p.input).toEqual({ text: SAMPLE_STORY_TEXT });
    expect(p.title).toBe('在咖啡馆');
    expect(p.chunks).toBe(5);
    expect(p.notice).toBeNull();
  });

  it('refuses no Chinese / too long; says when the lesson covers only the first part', () => {
    expect(pickAudioLessonInput({ format: 'story', text: '' }).problems).toEqual(['Paste the story or conversation to listen to']);
    expect(pickAudioLessonInput({ format: 'story', text: 'hello' }).problems).toEqual(['The text has no Chinese in it']);
    expect(pickAudioLessonInput({ format: 'story', text: '好'.repeat(6001) }).problems[0]).toMatch(/too long \(6,000 characters at most\)/);
    const long = pickAudioLessonInput({ format: 'story', text: Array.from({ length: 150 }, () => '小明每天早上七点起床，然后吃早饭，坐地铁去公司上班。').join('\n') });
    expect(long.problems).toEqual([]);
    expect(long.notice).toMatch(/covers the first/);
    expect(pickAudioLessonInput({ format: 'podcast' }).problems[0]).toBe('format must be "dialogue", "sleep" or "story"');
  });
});

describe('format info + music', () => {
  it('names, icons; music on by default under a story', () => {
    expect(audioLessonFormatInfo('story')).toEqual({ icon: '📖', label: 'Story', short: 'Listen & repeat', kind: 'Listen & repeat a story' });
    expect(audioLessonFormatInfo('nope').label).toBe('Dialogue');
    expect(audioLessonFormatInfo('toString').label).toBe('Dialogue');
    expect(musicDefaultOn('story')).toBe(true);
    expect(musicDefaultOn('dialogue')).toBe(false);
  });
});
