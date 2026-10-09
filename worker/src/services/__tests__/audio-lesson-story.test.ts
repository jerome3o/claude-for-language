/**
 * Story lessons ("Listen & repeat a story", docs/AUDIO_LESSONS.md "Story") through the audio-lesson
 * job against real SQLite with a mocked translation and mocked voices: the text split by code,
 * translated in batches (checkpointed — a deadline in the middle resumes without translating
 * again), each chunk ×3 + its English, spoken at the slowest rate, rendered to one file.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { SAMPLE_STORY_TEXT, STORY_LIMITS, uniqueSpeech, type AudioLessonScript, type StoryPlan } from '@shared/audio-lesson';
import { DEFAULT_TTS_CONFIG } from '@shared/tts';
import type { Env } from '../../types';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import * as q from '../../db/audio-lesson-queries';
import { runAudioLessonJob } from '../audio-lessons/job';
import { fakeClip } from '../audio-lessons/fake';
import { lessonClipRate, type ClipOutcome, type ClipRequest } from '../audio-lessons/synth';
import { checkStoryBatch, storyBatchUser, type StoryBatchRequest, type StoryTranslate } from '../audio-lessons/story';
import { roleVoice } from '../audio-lessons/voices';

function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> }>();
  const bucket = {
    async put(key: string, value: Uint8Array | ArrayBuffer, opts?: { customMetadata?: Record<string, string> }) {
      store.set(key, { bytes: value instanceof Uint8Array ? value : new Uint8Array(value), meta: opts?.customMetadata });
    },
    async get(key: string) {
      const v = store.get(key);
      return v ? { arrayBuffer: async () => v.bytes.slice().buffer, customMetadata: v.meta, size: v.bytes.length } : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async list(opts: { prefix?: string }) {
      return { objects: [...store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((key) => ({ key })), truncated: false };
    },
  };
  return { store, bucket: bucket as unknown as R2Bucket };
}

let db: SqliteD1;
let r2: ReturnType<typeof fakeBucket>;
let env: Env;

beforeEach(async () => {
  db = await createSqliteD1();
  r2 = fakeBucket();
  env = { DB: db, AUDIO_BUCKET: r2.bucket } as unknown as Env;
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'learner@example.com', 'Learner', 'student')");
});

/** A translation that records what it was asked; 一 / 不 left unchanged so the app's rule is seen fixing it. */
function mockTranslate(): { translate: StoryTranslate; requests: StoryBatchRequest[] } {
  const requests: StoryBatchRequest[] = [];
  const translate: StoryTranslate = async (req) => {
    requests.push(req);
    return {
      items: req.chunks.map((c) => ({ i: c.i, english: `English of line ${c.i + 1}.`, pinyin: c.hanzi.includes('一杯') ? 'wǒ yào yī bēi rè kāfēi, bù yào táng.' : 'pīnyīn' })),
      speakers: req.labels.map((label) => ({ label, gender: label === '杰罗姆' ? 'male' : 'female' })),
      usage: { input_tokens: 1000, output_tokens: 400 },
    };
  };
  return { translate, requests };
}

const speakOk = async (clip: ClipRequest): Promise<ClipOutcome> => ({ ok: true, bytes: fakeClip(clip.text, clip.rate), provider: 'minimax', voice: 'v' });

async function newStory(text: string) {
  return q.createAudioLesson(db, { userId: 'u1', format: 'story', title: '在咖啡馆', input: { text } });
}

describe('story lessons', () => {
  it('splits, translates, speaks each chunk ×3 + its English, renders one file', async () => {
    const id = await newStory(SAMPLE_STORY_TEXT);
    const { translate, requests } = mockTranslate();
    const spoken: ClipRequest[] = [];
    const speak = async (clip: ClipRequest) => {
      spoken.push(clip);
      return speakOk(clip);
    };
    expect(await runAudioLessonJob(env, id, { translate, speak, requeue: async () => {} })).toBe('done');
    // One batch, the speaker labels given, the Chinese as written.
    expect(requests).toHaveLength(1);
    expect(requests[0].labels).toEqual(['明慧', '杰罗姆']);
    expect(requests[0].chunks.map((c) => c.hanzi)).toEqual(['你好！你今天想喝什么？', '我要一杯热咖啡，不要糖。', '好的。你要大杯还是小杯？', '小杯就好。谢谢！', '他们坐在窗边，外面下着小雨。']);

    const row = (await q.getAudioLesson(db, id))!;
    expect(row.status).toBe('ready');
    const plan = JSON.parse(row.plan_json!) as StoryPlan;
    // The one 一 / 不 rule ran over Claude's pinyin.
    expect(plan.chunks[1].pinyin).toBe('wǒ yào yì bēi rè kāfēi, bú yào táng.');
    expect(plan.speakers).toEqual([{ label: '明慧', gender: 'female' }, { label: '杰罗姆', gender: 'male' }]);
    const script = JSON.parse(row.script_json!) as AudioLessonScript;
    // Each distinct clip made once: 5 Chinese chunks + 5 English lines.
    expect(uniqueSpeech(script)).toHaveLength(10);
    expect(spoken.filter((c) => c.lang === 'zh').every((c) => c.rate === 0.5)).toBe(true);
    expect(spoken.filter((c) => c.lang === 'en').every((c) => c.voice === 'recap')).toBe(true);

    const detail = q.lessonDetail(row);
    expect(detail.format).toBe('story');
    expect(detail.chapters.map((c) => c.title)).toEqual(['在咖啡馆']);
    expect(detail.transcript.filter((l) => l.lang === 'zh')).toHaveLength(15);
    expect(detail.transcript[0]).toMatchObject({ text: '明慧：你好！你今天想喝什么？', english: 'English of line 1.' });
    expect(detail.words).toEqual([]);
    expect(detail.notice).toBeNull();
    expect(detail.usage).toMatchObject({ model: 'claude-sonnet-5', input_tokens: 1000, output_tokens: 400, tts_clips: 10, zh_provider: 'minimax' });
    expect(detail.usage!.claude_usd).toBeCloseTo((1000 * 2 + 400 * 10) / 1e6);
  });

  it('a long text: translated in batches, checkpointed — a deadline in the middle resumes without asking twice; the cut is noted', async () => {
    const line = '小明每天早上七点起床，然后吃早饭，坐地铁去公司上班。';
    const id = await newStory(Array.from({ length: 150 }, () => line).join('\n'));
    const { translate, requests } = mockTranslate();
    let clock = 0;
    // The first batch takes "5 minutes": the delivery stops there and re-enqueues itself.
    const slow: StoryTranslate = async (req) => {
      const out = await translate(req);
      if (requests.length === 1) clock += 5 * 60 * 1000;
      return out;
    };
    const requeued: number[] = [];
    const deps = { translate: slow, speak: speakOk, requeue: async (_: string, d: number) => void requeued.push(d), now: () => clock };
    expect(await runAudioLessonJob(env, id, deps)).toBe('continue');
    expect(requeued).toEqual([0]);
    let row = (await q.getAudioLesson(db, id))!;
    expect(row.status).toBe('writing');
    expect(row.progress).toMatch(/^Translating — 30 of \d+ lines…$/);

    clock = 0;
    expect(await runAudioLessonJob(env, id, deps)).toBe('done');
    row = (await q.getAudioLesson(db, id))!;
    const plan = JSON.parse(row.plan_json!) as StoryPlan;
    expect(plan.cut).toBeDefined();
    const total = plan.chunks.length;
    expect(total).toBeLessThanOrEqual(STORY_LIMITS.maxChunks);
    // Every chunk translated exactly once, 30 at a time, with the chunks before as context.
    expect(requests.flatMap((r) => r.chunks.map((c) => c.i))).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(requests.every((r) => r.chunks.length <= STORY_LIMITS.translateBatch)).toBe(true);
    expect(requests[1].before).toHaveLength(3);
    // Chapters every 10 chunks.
    const detail = q.lessonDetail(row);
    expect(detail.chapters).toHaveLength(Math.ceil(total / 10));
    expect(detail.notice).toMatch(/^The text is long: this lesson covers the first/);
    expect(detail.duration_ms! / 60000).toBeLessThan(STORY_LIMITS.maxMinutes + 5);
  });

  it('no Chinese sentences → failed with a reason; a translation that throws fails, Retry translates again', async () => {
    const empty = await q.createAudioLesson(db, { userId: 'u1', format: 'story', title: 'x', input: { text: '# 标题' } });
    expect(await runAudioLessonJob(env, empty, { translate: mockTranslate().translate, speak: speakOk, requeue: async () => {} })).toBe('failed');
    expect((await q.getAudioLesson(db, empty))!.error).toBe('No Chinese sentences found in the text');

    const id = await newStory(SAMPLE_STORY_TEXT);
    const broken: StoryTranslate = async () => {
      throw new Error('Claude is overloaded');
    };
    expect(await runAudioLessonJob(env, id, { translate: broken, speak: speakOk, requeue: async () => {} })).toBe('failed');
    expect((await q.getAudioLesson(db, id))!.error).toMatch(/overloaded/);
    await q.resetAudioLessonForRetry(db, id);
    expect(await runAudioLessonJob(env, id, { translate: mockTranslate().translate, speak: speakOk, requeue: async () => {} })).toBe('done');
  });

  it('the Chinese at each provider’s slowest natural rate; speakers get two voices, narration the app voice', () => {
    const chunk = { lang: 'zh' as const, voice: 'speaker_a' as const, rate: 0.5 };
    expect(lessonClipRate('minimax', chunk, DEFAULT_TTS_CONFIG)).toBe(0.5);
    expect(lessonClipRate('azure', chunk, DEFAULT_TTS_CONFIG)).toBe(0.6);
    expect(lessonClipRate('google', { ...chunk, voice: 'teacher' }, DEFAULT_TTS_CONFIG)).toBe(0.6);
    const speakers = [
      { role: 'speaker_a' as const, name: '明慧', gender: 'female' as const },
      { role: 'speaker_b' as const, name: '杰罗姆', gender: 'male' as const },
    ];
    const a = roleVoice('azure', 'speaker_a', speakers, DEFAULT_TTS_CONFIG)!.voice;
    const b = roleVoice('azure', 'speaker_b', speakers, DEFAULT_TTS_CONFIG)!.voice;
    expect(a).not.toBe(b);
    expect(roleVoice('minimax', 'teacher', speakers, DEFAULT_TTS_CONFIG)!.voice).toBe(DEFAULT_TTS_CONFIG.providers.minimax.voices.default);
  });

  it('the translation call: numbered chunks with their speaker; every chunk must come back', () => {
    const req: StoryBatchRequest = { chunks: [{ i: 4, hanzi: '你好！', speaker: 'A' }, { i: 5, hanzi: '再见。', speaker: null }], before: ['A：早上好。'], labels: ['A'] };
    const user = storyBatchUser(req);
    expect(user).toContain('[4] A：你好！');
    expect(user).toContain('[5] 再见。');
    expect(user).toContain('do not translate):\nA：早上好。');
    expect(() => checkStoryBatch(req, { chunks: [{ i: 4, english: 'Hi!', pinyin: 'nǐ hǎo!' }], speakers: [] })).toThrow(/chunks 5/);
    expect(() => checkStoryBatch(req, { chunks: [{ i: 4, english: 'Hi!', pinyin: 'x' }, { i: 5, english: '再见', pinyin: 'x' }], speakers: [] })).toThrow(/chunks 5/);
    expect(checkStoryBatch(req, { chunks: [{ i: 5, english: ' Bye. ', pinyin: 'zàijiàn.' }, { i: 4, english: 'Hi!', pinyin: 'nǐ hǎo!' }], speakers: [{ label: 'A', gender: 'male' }, { label: 'B', gender: 'x' }] })).toEqual({
      items: [{ i: 4, english: 'Hi!', pinyin: 'nǐ hǎo!' }, { i: 5, english: 'Bye.', pinyin: 'zàijiàn.' }],
      speakers: [{ label: 'A', gender: 'male' }],
    });
  });
});
