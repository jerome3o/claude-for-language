/**
 * "Make a mini lesson from this episode" (docs/PODCASTS.md): the audio lessons' companion-lesson
 * writer (services/companion-lesson.ts `generateCompanionSpec` — the same prompt, validation,
 * repair rounds and 一 / 不 rule) fed a stretch of the episode's transcript as a "story" podcast.
 * The lesson is created in the learner's OWN account, unlocked (he asked for it now), and shows in
 * Mini Lessons like any other; it is never sent to anyone. Runs on audio-lesson-queue
 * (`{ kind: 'podcast_lesson', episodeId, userId }`); the state is on podcast_episode_users.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { StoryPlan } from '@shared/audio-lesson/types';
import type { CustomLessonSpec } from '@shared/lesson';
import type { Env } from '../../types';
import { fakeCompanionSpec, generateCompanionSpec, type CompanionSourceRow, type CreateMessage } from '../companion-lesson';
import { createCustomLessonFromSpec } from '../custom-lesson';
import { trackServer } from '../analytics/server-events';
import { getEpisode, getEpisodeUser, parseSegments, updateEpisodeUser, type EpisodeRow } from './store';
import type { PodcastSegment } from './segments';

export interface PodcastLessonMessage {
  kind: 'podcast_lesson';
  episodeId: string;
  userId: string;
}

/** Segments one lesson is written from (≈ 3–6 minutes of speech). */
export const LESSON_SEGMENTS = 60;

/** The stretch of the episode a lesson is about: from `from`, the next LESSON_SEGMENTS with Chinese. */
export function lessonStretch(segments: readonly PodcastSegment[], from: number): PodcastSegment[] {
  const start = Math.max(0, Math.min(from, Math.max(0, segments.length - 1)));
  return segments.slice(start).filter((s) => s.lang !== 'en').slice(0, LESSON_SEGMENTS);
}

/** The episode as the companion writer's source row (format "story": speakers + chunks). */
export function lessonSource(row: Pick<EpisodeRow, 'id' | 'title' | 'podcast_title'>, userId: string, stretch: readonly PodcastSegment[]): CompanionSourceRow {
  const labels = [...new Set(stretch.map((s) => s.speaker).filter((s): s is string => !!s))];
  const plan: StoryPlan = {
    title: row.title,
    speakers: labels.map((l, i) => ({ label: `Speaker ${l}`, gender: i % 2 === 0 ? 'female' : 'male' })),
    chunks: stretch.map((s) => ({
      hanzi: s.text,
      pinyin: s.pinyin ?? '',
      english: s.english ?? '',
      speaker: s.speaker ? `Speaker ${s.speaker}` : null,
      section: null,
    })),
  };
  return {
    id: row.id,
    user_id: userId,
    title: row.podcast_title ? `${row.podcast_title}: ${row.title}` : row.title,
    format: 'story',
    status: 'ready',
    plan_json: JSON.stringify(plan),
    words_json: '[]',
  };
}

export type PodcastLessonOutcome = 'created' | 'failed' | 'gone';

export async function runPodcastLessonJob(env: Env, episodeId: string, userId: string, deps: { create?: CreateMessage } = {}): Promise<PodcastLessonOutcome> {
  const [row, link] = await Promise.all([getEpisode(env.DB, episodeId), getEpisodeUser(env.DB, userId, episodeId)]);
  if (!row || !link) return 'gone';
  const fail = async (msg: string): Promise<PodcastLessonOutcome> => {
    await updateEpisodeUser(env.DB, userId, episodeId, { lesson_status: 'failed', lesson_error: msg.slice(0, 300) });
    return 'failed';
  };
  try {
    const stretch = lessonStretch(parseSegments(row.segments_json), link.lesson_from ?? 0);
    if (stretch.length < 3) return await fail('There is too little Chinese in this part of the episode for a lesson');
    const source = lessonSource(row, userId, stretch);
    let spec: CustomLessonSpec;
    if (env.E2E_TEST_MODE === 'true' && !deps.create) {
      spec = fakeCompanionSpec(source);
    } else {
      if (!env.ANTHROPIC_API_KEY && !deps.create) return await fail('The Claude key is not configured on the server');
      const client = deps.create ? null : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const create: CreateMessage = deps.create ?? ((params) => client!.messages.create(params));
      ({ spec } = await generateCompanionSpec(source, create));
    }
    spec.icon = '🎙';
    const res = await createCustomLessonFromSpec(env, userId, spec, 'podcast');
    if (!res.ok) return await fail(res.errors.slice(0, 3).join('; ') || 'Could not save the lesson');
    await updateEpisodeUser(env.DB, userId, episodeId, { lesson_status: 'ready', lesson_id: res.lesson.id, lesson_error: null });
    const exercises = spec.sections.reduce((n, s) => n + s.exercises.length, 0);
    void trackServer('podcast.lesson_created', { exercises, segments: stretch.length }, { env, userId });
    return 'created';
  } catch (err) {
    console.error('[podcasts] lesson failed for', episodeId, err);
    return await fail(err instanceof Error ? err.message : String(err));
  }
}
