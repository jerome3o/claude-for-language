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
  type ClipSpec,
  type RankableClip,
} from './index';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('validateClipSpec', () => {
  it('accepts the samples', () => {
    expect(validateClipSpec(SAMPLE_CLIP)).toEqual([]);
    expect(validateClipSpec(SAMPLE_STORY_CLIP)).toEqual([]);
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
