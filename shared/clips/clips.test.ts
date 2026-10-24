import { describe, expect, it } from 'vitest';
import {
  CLIP_VOICE_IDS,
  SAMPLE_CLIP,
  SAMPLE_STORY_CLIP,
  clipAudioClips,
  clipDurationMs,
  clipImagePrompts,
  clipProgressSegments,
  clipTimeline,
  clipTopic,
  clipTtsText,
  clipUtterances,
  formatClipDuration,
  learnMoreOffers,
  learnMoreTitle,
  parseStoredClipSpec,
  rankClipFeed,
  sceneUtterances,
  storyCast,
  validateClipSpec,
  CLIP_SPEC_DOC,
  SAMPLE_INTERACTIVE_CLIP,
  CLIP_SKIP_AFTER_MS,
  CLIP_MUSIC_DUCKED,
  CLIP_MUSIC_VOLUME,
  clipAnswerOption,
  clipAnswerOrder,
  clipContinue,
  clipFlip,
  clipHash,
  clipInteractValue,
  clipMusicFor,
  clipMusicShouldPlay,
  clipMusicStep,
  clipMusicTarget,
  clipOrderRight,
  clipOrderShuffle,
  clipQuizRight,
  clipSkip,
  clipSkipShown,
  clipSpeakResult,
  clipWaiting,
  karaokeActive,
  karaokePieces,
  karaokeStates,
  karaokeSyllables,
  karaokeTimeline,
  sceneRevealUtterances,
  clipSceneFill,
  clipStart,
  clipTick,
  storyLinesShown,
  type ClipSpec,
  type RankableClip,
} from './index';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('validateClipSpec', () => {
  it('accepts the samples', () => {
    expect(validateClipSpec(SAMPLE_CLIP)).toEqual([]);
    expect(validateClipSpec(SAMPLE_STORY_CLIP)).toEqual([]);
    expect(validateClipSpec(SAMPLE_INTERACTIVE_CLIP)).toEqual([]);
  });

  it('checks the interactive layouts', () => {
    const s = clone(SAMPLE_INTERACTIVE_CLIP) as unknown as { scenes: Array<Record<string, Record<string, unknown>>> };
    s.scenes[3].listen.answer_index = 5;
    s.scenes[3].listen.options = ['a', 'a', 'b'];
    s.scenes[4].order.tiles = ['我', '我'];
    s.scenes[5].reveal.prompt_en = '';
    s.scenes[5].reveal.pinyin = 'ni3';
    s.scenes[6].speak.hanzi = '这是一个非常非常长的句子，长得没有人可以一口气说完，真的太长了太长了。';
    const p = validateClipSpec(s);
    expect(p).toContain('scenes[3].listen.options must all be different');
    expect(p).toContain('scenes[3].listen.answer_index must be 0–2');
    expect(p).toContain('scenes[4].order.tiles must be 3–7 non-empty pieces, in the right order');
    expect(p).toContain('scenes[5].reveal.prompt_en is required (the English side of the card)');
    expect(p.some((x) => x.startsWith('scenes[5].reveal.pinyin uses tone numbers'))).toBe(true);
    expect(p.some((x) => x.startsWith('scenes[6].speak.hanzi is '))).toBe(true);
    const same = clone(SAMPLE_INTERACTIVE_CLIP) as unknown as { scenes: Array<Record<string, Record<string, unknown>>> };
    same.scenes[4].order.tiles = ['好', '好', '好'];
    same.scenes[4].order.english = '';
    expect(validateClipSpec(same)).toEqual(['scenes[4].order.tiles must not all be the same', 'scenes[4].order.english is required']);
  });

  it('the doc carries the spec example, which is valid', () => {
    const json = CLIP_SPEC_DOC.split('```jsonc')[1].split('```')[0].replace(/\/\/.*$/gm, '').replace('"…"', '"a desk clock, vertical, no text"');
    const spec = JSON.parse(json) as ClipSpec;
    expect(validateClipSpec(spec)).toEqual([]);
  });

  it('refuses the wrong shape with readable problems', () => {
    expect(validateClipSpec(null)).toEqual(['The clip must be a JSON object']);
    const bad = clone(SAMPLE_CLIP) as unknown as Record<string, unknown>;
    bad.v = 2;
    bad.title = 'x'.repeat(61);
    bad.style = { theme: 'vaporwave', accent: 'red' };
    bad.words = [];
    bad.tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const p = validateClipSpec(bad);
    expect(p).toContain('v must be 1');
    expect(p.some((x) => x.startsWith('title is 61 characters'))).toBe(true);
    expect(p.some((x) => x.startsWith('style.theme must be one of'))).toBe(true);
    expect(p).toContain('style.accent must be a hex colour like "#FF3B6B"');
    expect(p).toContain('words must have 1–6 focus words');
    expect(p).toContain('tags: 6 at most');
  });

  it('checks scenes, durations and the layouts', () => {
    const s = clone(SAMPLE_CLIP);
    s.scenes[0].duration_ms = 900;
    (s.scenes[1] as { big_word: { pinyin: string } }).big_word.pinyin = 'gang1cai2';
    (s.scenes[2] as { sentence: { highlight: string } }).sentence.highlight = '刚刚';
    (s.scenes[4] as { quiz: { options: string[]; answer_index: number } }).quiz.answer_index = 2;
    (s.scenes[6] as { list: { items: unknown[] } }).list.items = Array.from({ length: 7 }, () => ({ hanzi: '刚刚', pinyin: 'gānggāng', english: 'just' }));
    (s.scenes[3] as unknown as { compare: Record<string, unknown> }).compare.middle = { hanzi: '才' };
    s.scenes[0].voice = { text: '刚（gāng）和刚才', lang: 'zh' };
    const p = validateClipSpec(s);
    expect(p).toContain('scenes[0].duration_ms must be 1500–9000');
    expect(p.some((x) => x.includes('tone numbers'))).toBe(true);
    expect(p).toContain('scenes[2].sentence.highlight "刚刚" does not occur in the sentence');
    expect(p).toContain('scenes[4].quiz.answer_index must be 0–1');
    expect(p).toContain('scenes[6].list.items must have 1–6 items');
    expect(p.some((x) => x.startsWith('scenes[3].compare has exactly two sides'))).toBe(true);
    expect(p.some((x) => x.startsWith('scenes[0].voice.text is read aloud'))).toBe(true);
  });

  it('counts scenes, total length and pictures', () => {
    const few = clone(SAMPLE_CLIP);
    few.scenes = few.scenes.slice(0, 3);
    expect(validateClipSpec(few)).toContain('scenes must have 4–10 scenes');
    const short = clone(SAMPLE_CLIP);
    short.scenes = short.scenes.slice(0, 4).map((x) => ({ ...x, duration_ms: 2000 }));
    expect(validateClipSpec(short).some((x) => x.startsWith('the scenes add up to 8.0 s'))).toBe(true);
    const pics = clone(SAMPLE_CLIP);
    pics.scenes.forEach((x) => (x.image_prompt = 'a cat, vertical, no text'));
    expect(validateClipSpec(pics)).toContain('8 scenes have an image_prompt; 3 at most per clip');
    const missing = clone(SAMPLE_CLIP) as unknown as { scenes: Array<Record<string, unknown>> };
    delete missing.scenes[5].story;
    expect(validateClipSpec(missing)).toContain('scenes[5] has layout "story" but no "story" object');
  });

  it('lets Latin + hanzi and " / " through in voice lines', () => {
    const s = clone(SAMPLE_CLIP);
    s.scenes[0].voice = { text: '你是i人 / e人？', lang: 'zh' };
    expect(validateClipSpec(s)).toEqual([]);
    expect(clipTtsText('你是i人 / e人？')).toBe('你是i人，e人？');
  });

  it('parses stored specs', () => {
    expect(parseStoredClipSpec(JSON.stringify(SAMPLE_CLIP))?.title).toBe(SAMPLE_CLIP.title);
    expect(parseStoredClipSpec('{')).toBeNull();
    expect(parseStoredClipSpec({ v: 1 })).toBeNull();
  });
});

describe('timeline', () => {
  it('lays the scenes end to end', () => {
    const t = clipTimeline(SAMPLE_CLIP);
    expect(t[0]).toEqual({ index: 0, layout: 'title', start_ms: 0, end_ms: 2500 });
    expect(t[7].end_ms).toBe(41000);
    expect(clipDurationMs(SAMPLE_CLIP)).toBe(41000);
    expect(formatClipDuration(41000)).toBe('0:41');
    expect(formatClipDuration(65400)).toBe('1:05');
  });

  it('fills the progress segments', () => {
    expect(clipProgressSegments(SAMPLE_CLIP, 1, 2000)).toEqual([1, 0.5, 0, 0, 0, 0, 0, 0]);
    expect(clipProgressSegments(SAMPLE_CLIP, 8, 0)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(clipProgressSegments(SAMPLE_CLIP, 0, 99999)[0]).toBe(1);
  });
});

describe('speech', () => {
  it('a scene with voice says only that; without, it reads its own Chinese', () => {
    const u = clipUtterances(SAMPLE_CLIP);
    expect(u.map((x) => [x.scene, x.line, x.text])).toEqual([
      [0, -1, '刚和刚才，有什么不一样？'],
      [1, 0, '刚才'],
      [2, 0, '我刚才吃了饭。'],
      [5, 0, '你刚才去哪儿了？'],
      [5, 1, '我刚下楼。'],
      [6, 0, '刚刚'],
    ]);
    expect(u[0].voice_id).toBeNull();
    expect(u[3].voice_id).toBe(CLIP_VOICE_IDS.female);
    expect(u[4].voice_id).toBe(CLIP_VOICE_IDS.male);
    // A story WITH voice: only the voice.
    const story = clone(SAMPLE_CLIP.scenes[5]);
    story.voice = { text: '听听他们说什么。', lang: 'zh', voice: 'narrator' };
    expect(sceneUtterances(story, 5)).toEqual([{ scene: 5, line: -1, text: '听听他们说什么。', lang: 'zh', voice_id: CLIP_VOICE_IDS.narrator }]);
  });

  it('casts named speakers: first left, second right, the narrator centred', () => {
    const cast = storyCast((SAMPLE_STORY_CLIP.scenes[1] as { story: { lines: Array<{ speaker?: string }> } }).story.lines);
    expect(cast.sides).toEqual(['center', 'left', 'right', 'center']);
    expect(cast.voices).toEqual([CLIP_VOICE_IDS.narrator, CLIP_VOICE_IDS.female, CLIP_VOICE_IDS.male, CLIP_VOICE_IDS.narrator]);
    expect(storyCast([{ speaker: 'Narrator' }, { speaker: '秦始皇' }, { speaker: '徐福' }, { speaker: '秦始皇' }, {}]).sides).toEqual(['center', 'left', 'right', 'left', 'left']);
  });

  it('lists the distinct clips and pictures', () => {
    expect(clipAudioClips(SAMPLE_CLIP)).toHaveLength(6);
    expect(clipImagePrompts(SAMPLE_STORY_CLIP)).toHaveLength(1);
    expect(clipTopic(SAMPLE_CLIP)).toBe('刚 vs 刚才');
    expect(clipTopic({ title: ' T ' })).toBe('T');
  });
});

describe('feed', () => {
  const base = (id: string, extra: Partial<RankableClip> = {}): RankableClip => ({
    id,
    created_at: '2026-10-20 10:00:00',
    words: [],
    tags: [],
    topic: null,
    state: { viewed: false, completed: false, liked: false, saved: false, skips: 0 },
    ...extra,
  });
  const ctx = { studying: new Set(['刚才', '银行']), struggling: new Set(['马上']), likedTags: new Set(['grammar']) };

  it('unseen first, then by fit, then newest', () => {
    const clips = [
      base('done', { words: ['马上'], state: { viewed: true, completed: true, liked: false, saved: false, skips: 0 } }),
      base('seen', { state: { viewed: true, completed: false, liked: false, saved: false, skips: 0 } }),
      base('plain-old', { created_at: '2026-10-01 00:00:00' }),
      base('plain-new', { created_at: '2026-10-22 00:00:00' }),
      base('fits', { words: ['刚才'], tags: ['Grammar'] }),
      base('struggle', { words: ['马上'] }),
    ];
    expect(rankClipFeed(clips, ctx).map((c) => c.id)).toEqual(['fits', 'struggle', 'plain-new', 'plain-old', 'seen', 'done']);
  });

  it('offers the follow-ups', () => {
    const offers = learnMoreOffers(SAMPLE_CLIP, null);
    expect(offers.map((o) => o.action)).toEqual(['lesson', 'reader', 'podcast', 'study_words', 'add_card', 'more']);
    expect(offers[3].label).toBe('Study these 2 words today');
    expect(learnMoreOffers(SAMPLE_CLIP, { status: 'ready', lesson_id: 'l1', error: null })[0].label).toBe('Open the mini lesson');
    expect(learnMoreOffers(SAMPLE_CLIP, { status: 'generating', lesson_id: null, error: null })[0].label).toBe('Mini lesson — writing…');
    expect(learnMoreTitle('刚 vs 刚才')).toBe('Keep going with 刚 vs 刚才');
  });
});

describe('the clip clock', () => {
  it('runs scenes, holds while speaking, ends on the end card', () => {
    let s = clipStart(SAMPLE_CLIP);
    expect(s).toEqual({ scene: 0, elapsed_ms: 0, interact: null, done: false });
    s = clipTick(SAMPLE_CLIP, s, 2000, false);
    expect(s.elapsed_ms).toBe(2000);
    s = clipTick(SAMPLE_CLIP, s, 1000, true); // past 2500 but still speaking → holds
    expect(s).toMatchObject({ scene: 0, elapsed_ms: 2500 });
    s = clipTick(SAMPLE_CLIP, s, 16, false);
    expect(s).toMatchObject({ scene: 1, elapsed_ms: 0 });
    expect(clipSceneFill(SAMPLE_CLIP, clipTick(SAMPLE_CLIP, s, 1000, false))).toBe(0.25);
  });

  it('a quiz waits for an answer — no time limit — then shows it; Skip after a while', () => {
    let s = clipStart(SAMPLE_CLIP, 4);
    expect(s.interact).toEqual({ picked: null, result: null, waited_ms: 0, reveal_ms: 0 });
    expect(clipWaiting(s)).toBe(true);
    s = clipTick(SAMPLE_CLIP, s, 3000, false);
    expect(clipSkipShown(s)).toBe(false);
    s = clipAnswerOption(SAMPLE_CLIP, s, 1);
    expect(s.interact).toMatchObject({ picked: 1, result: 'right' });
    expect(clipQuizRight(SAMPLE_CLIP, s)).toBe(true);
    expect(clipAnswerOption(SAMPLE_CLIP, s, 0)).toBe(s);
    expect(clipSceneFill(SAMPLE_CLIP, s)).toBe(1);
    s = clipTick(SAMPLE_CLIP, s, 2000, false);
    expect(s.scene).toBe(4);
    s = clipTick(SAMPLE_CLIP, s, 600, false);
    expect(s.scene).toBe(5);

    // Waiting far past its duration: still waiting (no timeout), Skip shown.
    let t = clipStart(SAMPLE_CLIP, 4);
    t = clipTick(SAMPLE_CLIP, t, 60_000, false);
    expect(t).toMatchObject({ scene: 4, elapsed_ms: 8000, interact: { waited_ms: CLIP_SKIP_AFTER_MS } });
    expect(clipWaiting(t)).toBe(true);
    expect(clipSkipShown(t)).toBe(true);
    expect(clipTick(SAMPLE_CLIP, t, 100, false)).toBe(t); // nothing changes any more while it waits
    t = clipSkip(t);
    expect(t.interact).toMatchObject({ picked: null, result: 'skipped' });
    expect(clipQuizRight(SAMPLE_CLIP, t)).toBeNull();
    t = clipTick(SAMPLE_CLIP, t, 2499, true);
    t = clipTick(SAMPLE_CLIP, t, 1000, true); // the answer's speech holds it
    expect(t.scene).toBe(4);
    t = clipTick(SAMPLE_CLIP, t, 10, false);
    expect(t.scene).toBe(5);
    const end = clipTick(SAMPLE_CLIP, clipStart(SAMPLE_CLIP, 7), 5000, false);
    expect(end).toEqual({ scene: 8, elapsed_ms: 0, interact: null, done: true });
    expect(clipTick(SAMPLE_CLIP, end, 100, false)).toBe(end);
    expect(CLIP_SKIP_AFTER_MS).toBe(6000);
  });

  it('listen / order / reveal / speak wait, answer and move on', () => {
    const spec = SAMPLE_INTERACTIVE_CLIP;
    expect(spec.scenes.map((x) => x.layout)).toEqual(['title', 'big_word', 'sentence', 'listen', 'order', 'reveal', 'speak']);
    // listen: an option.
    let l = clipStart(spec, 3);
    l = clipAnswerOption(spec, l, 2);
    expect(l.interact).toMatchObject({ picked: 2, result: 'wrong' });
    expect(clipQuizRight(spec, l)).toBe(false);
    // order: the tapped tiles.
    let o = clipStart(spec, 4);
    expect(clipAnswerOption(spec, o, 0)).toBe(o); // not an option scene
    o = clipAnswerOrder(spec, o, [0, 1, 2, 3, 4]);
    expect(o.interact?.result).toBe('right');
    expect(clipAnswerOrder(spec, clipStart(spec, 4), [1, 0, 2, 3, 4]).interact?.result).toBe('wrong');
    o = clipTick(spec, o, 2999, false);
    expect(o.scene).toBe(4);
    o = clipTick(spec, o, 1, false);
    expect(o.scene).toBe(5);
    // reveal: a flip; "Next ›" moves on at once.
    let r = clipFlip(o);
    expect(r.interact?.result).toBe('done');
    r = clipContinue(spec, r);
    expect(r.scene).toBe(6);
    expect(clipContinue(spec, r)).toBe(r); // still waiting: nothing to continue
    // speak: the verdict.
    expect(clipSpeakResult(r, 'exact').interact?.result).toBe('right');
    expect(clipSpeakResult(r, 'close').interact?.result).toBe('close');
    expect(clipSpeakResult(r, 'wrong').interact?.result).toBe('wrong');
    const sp = clipTick(spec, clipSpeakResult(r, 'close'), 3499, false);
    expect(sp.scene).toBe(6);
    expect(clipTick(spec, sp, 1, false)).toMatchObject({ done: true, scene: 7 });
    expect([clipInteractValue('wrong'), clipInteractValue('right'), clipInteractValue('close'), clipInteractValue('done'), clipInteractValue('skipped')]).toEqual([0, 1, 2, 3, -1]);
  });

  it('shuffles order tiles the same way every time, never into the answer', () => {
    expect(clipHash('')).toBe(0x811c9dc5);
    expect(clipHash('a')).toBe(0xe40c292c);
    const tiles = ['我', '下班', '顺便', '去', '银行'];
    const a = clipOrderShuffle(tiles, 'clip-1:4');
    expect(clipOrderShuffle(tiles, 'clip-1:4')).toEqual(a);
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4]);
    for (let i = 0; i < 200; i++) {
      const order = clipOrderShuffle(tiles, `seed-${i}`);
      expect(clipOrderRight(tiles, order)).toBe(false);
      expect(clipOrderRight(['我', '我', '你'], clipOrderShuffle(['我', '我', '你'], `s${i}`))).toBe(false);
    }
    expect(clipOrderRight(['我', '我', '你'], [1, 0, 2])).toBe(true); // identical tiles swap freely
    expect(clipOrderShuffle(['一'], 'x')).toEqual([0]);
  });

  it('spreads story lines over the scene, the spoken one always showing', () => {
    expect(storyLinesShown(4, 8000, 0)).toBe(1);
    expect(storyLinesShown(4, 8000, 2800)).toBe(2);
    expect(storyLinesShown(4, 8000, 5600)).toBe(4);
    expect(storyLinesShown(4, 8000, 0, 2)).toBe(3);
    expect(storyLinesShown(1, 8000, 0)).toBe(1);
    expect(storyLinesShown(0, 8000, 0)).toBe(0);
  });
});

describe('interactive speech', () => {
  it('listen / speak always say their hanzi; order / reveal say theirs once answered', () => {
    const spec = SAMPLE_INTERACTIVE_CLIP;
    expect(sceneUtterances(spec.scenes[3], 3)).toEqual([{ scene: 3, line: 0, text: '我顺便帮你拿快递。', lang: 'zh', voice_id: null }]);
    const voiced = { ...spec.scenes[6], voice: { text: 'Your turn!', lang: 'en' as const } };
    expect(sceneUtterances(voiced, 6).map((u) => [u.line, u.text])).toEqual([[-1, 'Your turn!'], [0, '顺便问一下。']]);
    expect(sceneUtterances(spec.scenes[4], 4)).toEqual([]);
    expect(sceneRevealUtterances(spec.scenes[4], 4)).toEqual([{ scene: 4, line: 0, text: '我下班顺便去银行', lang: 'zh', voice_id: null }]);
    expect(sceneRevealUtterances(spec.scenes[5], 5).map((u) => u.text)).toEqual(['你顺便关一下窗户。']);
    expect(sceneRevealUtterances(spec.scenes[3], 3)).toEqual([]);
    // Prefetch covers the answers' lines.
    expect(clipAudioClips(spec).map((c) => c.text)).toContain('我下班顺便去银行');
  });
});

describe('karaoke captions', () => {
  it('counts syllables', () => {
    expect(karaokeSyllables('刚才')).toBe(2);
    expect(karaokeSyllables('i人')).toBe(2);
    expect(karaokeSyllables('really')).toBe(2);
    expect(karaokeSyllables('shùnbiàn')).toBe(2);
    expect(karaokeSyllables('2026年')).toBe(5);
    expect(karaokeSyllables('MBTI')).toBe(1);
    expect(karaokeSyllables('?')).toBe(1);
  });

  it('cuts a line into words, by the segmenter when it matches', () => {
    expect(karaokePieces('我刚才吃了饭。', 'zh', ['我', '刚才', '吃', '了', '饭', '。']).map((p) => [p.text, p.kind, p.weight])).toEqual([
      ['我', 'word', 1], ['刚才', 'word', 2], ['吃', 'word', 1], ['了', 'word', 1], ['饭', 'word', 1], ['。', 'punct', 0.9],
    ]);
    // Not matching the text → one word per character.
    expect(karaokePieces('我刚才', 'zh', ['我', '刚']).map((p) => p.text)).toEqual(['我', '刚', '才']);
    expect(karaokePieces('How long is 一会儿, really?', 'en').map((p) => p.text)).toEqual(['How', ' ', 'long', ' ', 'is', ' ', '一', '会', '儿', ',', ' ', 'really', '?']);
  });

  it('shares the real duration out by syllables, with pauses at punctuation', () => {
    const t = karaokeTimeline('刚和刚才，有什么不一样？', 'zh', 3000, ['刚', '和', '刚才', '，', '有', '什么', '不', '一样', '？']);
    // 10 syllables + a comma (0.5); the final ？ is the tail. 3000 − 120 − 220 = 2660 ms of speech.
    expect(t[0]).toMatchObject({ text: '刚', start_ms: 120, end_ms: 373 });
    expect(t[3]).toMatchObject({ text: '，', kind: 'punct' });
    expect(t[t.length - 2].end_ms).toBe(2780);
    expect(t[t.length - 1]).toMatchObject({ text: '？', weight: 0, start_ms: 2780, end_ms: 2780 });
    expect(karaokeActive(t, 0)).toBe(-1);
    expect(karaokeActive(t, 130)).toBe(0);
    expect(karaokeActive(t, 700)).toBe(2);
    expect(karaokeActive(t, 9999)).toBe(t.length - 2);
    expect(karaokeStates(t, 2).slice(0, 4)).toEqual(['past', 'past', 'active', 'next']);
    expect(karaokeStates(t, -1).every((x) => x === 'next')).toBe(true);
    // Very short: the lead / tail shrink; no words at all → everything at the lead.
    expect(karaokeTimeline('好', 'zh', 200)[0]).toMatchObject({ start_ms: 50, end_ms: 150 });
    expect(karaokeTimeline('。', 'zh', 1000)).toEqual([{ text: '。', kind: 'punct', weight: 0, start_ms: 120, end_ms: 120 }]);
  });
});

describe('clip music', () => {
  it('picks a loop by theme, ducks under voices, follows mute + the toggle', () => {
    expect(clipMusicFor('neon').id).toBe('clip-beat-nightbus-v1');
    expect(clipMusicFor('paper').id).toBe('clip-beat-cafe-v1');
    expect(clipMusicFor('ink').id).toBe('clip-beat-rain-v1');
    expect(clipMusicFor('nope').id).toBe('clip-beat-cafe-v1');
    expect(clipMusicTarget({ speaking: true })).toBe(CLIP_MUSIC_DUCKED);
    expect(clipMusicTarget({ speaking: false })).toBe(CLIP_MUSIC_VOLUME);
    expect(clipMusicStep(0.22, 0.07, 100)).toBe(0.145);
    expect(clipMusicStep(0.145, 0.07, 1000)).toBe(0.07);
    expect(clipMusicStep(0.07, 0.22, 100)).toBe(0.108);
    expect(clipMusicStep(0.07, 0.22, -5)).toBe(0.07);
    expect(clipMusicShouldPlay({ playing: true, muted: false, music: true })).toBe(true);
    expect(clipMusicShouldPlay({ playing: true, muted: true, music: true })).toBe(false);
    expect(clipMusicShouldPlay({ playing: true, muted: false, music: false })).toBe(false);
    expect(clipMusicShouldPlay({ playing: false, muted: false, music: true })).toBe(false);
  });
});
