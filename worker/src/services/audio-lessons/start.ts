/**
 * Start (or continue) an audio lesson's build: on audio-lesson-queue, or — E2E_TEST_MODE — right
 * here in waitUntil (fake model and voices, a second or two) instead of relying on a local queue.
 * The audio-lessons route and the clips' "🎧 Podcast" follow-up both start builds through it.
 */
import type { Env } from '../../types';
import { runAudioLessonJob } from './job';

export async function startAudioLessonJob(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, lessonId: string): Promise<void> {
  if (env.E2E_TEST_MODE === 'true') {
    ctx.waitUntil(
      (async () => {
        for (let i = 0; i < 20; i++) {
          const out = await runAudioLessonJob(env, lessonId, { requeue: async () => {} });
          if (out !== 'continue' && out !== 'waiting') break;
        }
      })(),
    );
    return;
  }
  await env.AUDIO_LESSON_QUEUE.send({ lessonId });
}
