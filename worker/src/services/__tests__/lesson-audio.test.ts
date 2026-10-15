import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../types';
import type { CustomLessonSpec, LessonAudioClip } from '@shared/lesson';
import { LESSON_AUDIO_MAX_ATTEMPTS, LESSON_AUDIO_TICK_MS, lessonClipsForUser, queueLessonAudio, runLessonAudioJob } from '../lesson-audio';
import type { PracticeClipStatus } from '../tts-cache';

const spec: CustomLessonSpec = {
  title: 'Busy',
  sections: [{
    exercises: [
      { type: 'scramble', english: 'Even if he is busy, he reviews Chinese every day.', tiles: ['即使', '他', '很忙，', '也', '每天', '复习中文。'], correct_order: ['即使', '他', '很忙，', '也', '每天', '复习中文。'] },
      { type: 'translate', english: 'Hello', reference_hanzi: '你好。' },
      { type: 'choice', question: 'q', options: [{ hanzi: '你好。' }, { hanzi: '再见。' }], correct: 0 },
    ],
  }],
} as unknown as CustomLessonSpec;

function fakeEnv(row: { user_id: string; spec: string } | null) {
  const sent: Array<{ body: unknown; opts?: { delaySeconds?: number } }> = [];
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) },
    TTS_QUEUE: { send: async (body: unknown, opts?: { delaySeconds?: number }) => { sent.push({ body, opts }); } },
  } as unknown as Env;
  return { env, sent };
}

describe('lessonClipsForUser', () => {
  it('a lesson without a conversation needs no account lookups: its distinct default-voice clips', async () => {
    const clips = await lessonClipsForUser({} as Env, 'u1', spec);
    expect(clips.map((c) => c.text)).toEqual(['即使他很忙，也每天复习中文。', '你好。', '再见。']);
    expect(clips.every((c) => c.kind === 'tts')).toBe(true);
  });
});

describe('runLessonAudioJob', () => {
  it('makes what R2 lacks, skips what it has', async () => {
    const { env, sent } = fakeEnv({ user_id: 'u1', spec: JSON.stringify(spec) });
    const ensure = vi.fn(async (_env: Env, clip: LessonAudioClip): Promise<PracticeClipStatus> => ({ status: clip.text === '你好。' ? 'cached' : 'made' }));
    const run = await runLessonAudioJob(env, { kind: 'lesson_audio', lesson_id: 'l1' }, { ensure });
    expect(run).toEqual({ clips: 3, made: 2, cached: 1, failed: 0, next: 'done' });
    expect(sent).toEqual([]);
  });

  it('a rate limit puts the lesson back with a delay; past the cap it gives up', async () => {
    const { env, sent } = fakeEnv({ user_id: 'u1', spec: JSON.stringify(spec) });
    const ensure = vi.fn(async (): Promise<PracticeClipStatus> => ({ status: 'rate_limited', retryAfterMs: 5_000 }));
    const run = await runLessonAudioJob(env, { kind: 'lesson_audio', lesson_id: 'l1', attempt: 2 }, { ensure });
    expect(run.next).toBe('rate_limited');
    expect(sent).toEqual([{ body: { kind: 'lesson_audio', lesson_id: 'l1', attempt: 3 }, opts: { delaySeconds: 60 } }]);

    const again = await runLessonAudioJob(env, { kind: 'lesson_audio', lesson_id: 'l1', attempt: LESSON_AUDIO_MAX_ATTEMPTS }, { ensure });
    expect(again.next).toBe('gave_up');
    expect(sent).toHaveLength(1);
  });

  it('a long delivery sends itself again for the rest', async () => {
    const { env, sent } = fakeEnv({ user_id: 'u1', spec: JSON.stringify(spec) });
    let t = 0;
    const ensure = vi.fn(async (): Promise<PracticeClipStatus> => { t += LESSON_AUDIO_TICK_MS; return { status: 'made' }; });
    const run = await runLessonAudioJob(env, { kind: 'lesson_audio', lesson_id: 'l1' }, { ensure, now: () => t });
    expect(run).toMatchObject({ made: 2, next: 'continue' });
    expect(sent).toEqual([{ body: { kind: 'lesson_audio', lesson_id: 'l1' }, opts: undefined }]);
  });

  it('a failed clip is skipped; a deleted lesson ends the job', async () => {
    const { env } = fakeEnv({ user_id: 'u1', spec: JSON.stringify(spec) });
    const ensure = vi.fn(async (): Promise<PracticeClipStatus> => ({ status: 'failed', reason: 'x' }));
    expect((await runLessonAudioJob(env, { kind: 'lesson_audio', lesson_id: 'l1' }, { ensure })).failed).toBe(3);
    const gone = fakeEnv(null);
    expect((await runLessonAudioJob(gone.env, { kind: 'lesson_audio', lesson_id: 'x' }, { ensure })).next).toBe('gone');
  });
});

describe('queueLessonAudio', () => {
  it('never throws, and is a no-op without the queue', async () => {
    expect(await queueLessonAudio({}, 'l1')).toBe(false);
    const broken = { TTS_QUEUE: { send: async () => { throw new Error('down'); } } } as unknown as Env;
    expect(await queueLessonAudio(broken, 'l1')).toBe(false);
  });
});
