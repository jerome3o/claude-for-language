/**
 * 🎬 "Learn more" follow-ups that start other content in the learner's OWN account (never sent
 * to anyone): a graded reader (the reader generator, due-words mode: the clip's words woven into
 * a story at his level), a 🎧 podcast (an audio lesson, dialogue format, about the clip's idea),
 * "More clips like this" (two more on its topic). The ✨ mini lesson is lesson.ts.
 */
import { clipTopic, parseStoredClipSpec, type ClipRecord, type ClipSpec } from '@shared/clips';
import { pickAudioLessonInput } from '@shared/audio-lesson/input';
import type { Env, VocabularyItem } from '../../types';
import * as db from '../../db/queries';
import * as audioQ from '../../db/audio-lesson-queries';
import { startAudioLessonJob } from '../audio-lessons/start';
import { trackServer } from '../analytics/server-events';
import { getClipRow, learnerContext } from './store';
import { requestClipGeneration } from './job';

type Ctx = Pick<ExecutionContext, 'waitUntil'>;

/** The dialogue an audio lesson practises, from the clip. */
export function clipPodcastDescription(spec: ClipSpec): string {
  const words = spec.words.map((w) => `${w.hanzi} (${w.english})`).join(', ');
  return `An everyday situation where people naturally use ${words}. It follows up a short clip: "${spec.title}" — ${spec.hook}. Make the difference / idea of the clip (${clipTopic(spec)}) come up naturally in the conversation.`.slice(0, 600);
}

/** The target words of the clip's reader (clip words first, then a few he is studying). */
export function clipReaderVocabulary(spec: ClipSpec, studying: VocabularyItem[]): VocabularyItem[] {
  const out: VocabularyItem[] = [];
  const seen = new Set<string>();
  for (const w of [...spec.words, ...studying.slice(0, 12)]) {
    if (seen.has(w.hanzi)) continue;
    seen.add(w.hanzi);
    out.push({ hanzi: w.hanzi, pinyin: w.pinyin, english: w.english });
  }
  return out;
}

async function clipSpecFor(env: Env, userId: string, clipId: string): Promise<ClipSpec | { error: string; status: 404 | 409 }> {
  const row = await getClipRow(env.DB, userId, clipId);
  if (!row) return { error: 'Not found', status: 404 };
  const spec = row.status === 'ready' ? parseStoredClipSpec(row.spec) : null;
  return spec ?? { error: 'This clip isn’t ready yet.', status: 409 };
}

export async function startClipReader(env: Env, userId: string, clipId: string): Promise<{ reader: { id: string; status: string } } | { error: string; status: 404 | 409 | 503 }> {
  const spec = await clipSpecFor(env, userId, clipId);
  if ('error' in spec) return spec;
  if (!env.ANTHROPIC_API_KEY) return { error: 'AI generation is not configured', status: 503 };
  const ctx = await learnerContext(env.DB, userId);
  const vocabulary = clipReaderVocabulary(spec, ctx.studying);
  const topic = clipTopic(spec);
  const reader = await db.createPendingReader(env.DB, userId, {
    title_chinese: '生成中...',
    title_english: `Story about: ${topic}`,
    difficulty_level: 'elementary',
    topic,
    source_deck_ids: [],
    vocabulary_used: vocabulary,
  });
  await env.STORY_QUEUE.send({ readerId: reader.id, topic, difficulty: 'elementary', mode: 'due_cards' });
  void trackServer('server.content_created', { kind: 'reader', count: 1, via: 'clip' }, { env, userId });
  return { reader: { id: reader.id, status: 'generating' } };
}

export async function startClipPodcast(env: Env, ctx: Ctx, userId: string, clipId: string): Promise<{ audio_lesson: { id: string; status: string } } | { error: string; status: 400 | 404 | 409 | 503 }> {
  const spec = await clipSpecFor(env, userId, clipId);
  if ('error' in spec) return spec;
  if (!env.ANTHROPIC_API_KEY && env.E2E_TEST_MODE !== 'true') return { error: 'Audio lessons need the Claude key, which is not configured on the server', status: 503 };
  const picked = pickAudioLessonInput({ format: 'dialogue', description: clipPodcastDescription(spec), title: `🎬 ${clipTopic(spec)}`.slice(0, 120) });
  if (picked.problems.length) return { error: picked.problems[0], status: 400 };
  if ((await audioQ.countActiveAudioLessons(env.DB, userId)) >= 3) return { error: '3 audio lessons are already being made — wait for one to finish', status: 409 };
  const id = await audioQ.createAudioLesson(env.DB, { userId, format: picked.format, title: picked.title, input: picked.input });
  await startAudioLessonJob(env, ctx, id);
  void trackServer('server.content_created', { kind: 'audio_lesson', count: 1, via: 'clip' }, { env, userId });
  return { audio_lesson: { id, status: 'queued' } };
}

export async function startMoreClips(env: Env, ctx: Ctx, userId: string, clipId: string): Promise<{ clips: ClipRecord[] } | { error: string; status: 404 | 409 | 503 }> {
  const spec = await clipSpecFor(env, userId, clipId);
  if ('error' in spec) return spec;
  return requestClipGeneration(env, userId, { topic: clipTopic(spec), words: spec.words.map((w) => w.hanzi), count: 2 }, { waitUntil: (p) => ctx.waitUntil(p), via: 'more' });
}
