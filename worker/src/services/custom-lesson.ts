/**
 * Custom mini lessons: agent-authored, schema-driven lessons (shared/lesson).
 *
 * This service is the single write path for lessons authored inside the main
 * worker (the REST route and the in-app chat tool): validate the untrusted
 * spec, store it, and queue illustration generation for any describe_image
 * exercises. The MCP worker has its own copy of this flow against the same
 * database and queue.
 */

import { CustomLessonSpec, validateLessonSpec, LESSON_EXERCISE_DOC, LESSON_AUTHORING_RULES } from '@shared/lesson';
import { Env } from '../types';
import * as db from '../db/queries';

/**
 * JSON schema for the lesson spec, used as tool input by the in-app chat
 * agent. Mirrors shared/lesson/types.ts (validateLessonSpec is still the
 * authority — the schema is guidance for the model).
 */
export const LESSON_SPEC_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string', description: 'Short lesson title, e.g. "Ordering at a café"' },
    icon: { type: 'string', description: 'One emoji for the lesson (default 🎓)' },
    description: { type: 'string', description: 'One sentence on what the lesson covers' },
    sections: {
      type: 'array',
      description: 'Ordered sections; each holds any number of exercises of any type in any order',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Optional section heading' },
          exercises: {
            type: 'array',
            description: `Exercises, each an object with a "type" plus type-specific fields:
${LESSON_EXERCISE_DOC}
${LESSON_AUTHORING_RULES}`,
            items: { type: 'object' },
          },
        },
        required: ['exercises'],
      },
    },
  },
  required: ['title', 'sections'],
};

export type CreateCustomLessonResult =
  | { ok: true; lesson: db.CustomLessonRow; imageJobs: number }
  | { ok: false; errors: string[] };

export async function createCustomLessonFromSpec(
  env: Env,
  userId: string,
  rawSpec: unknown,
  source: 'mcp' | 'chat' | 'api',
): Promise<CreateCustomLessonResult> {
  const errors = validateLessonSpec(rawSpec);
  if (errors.length > 0) return { ok: false, errors };
  const spec = rawSpec as CustomLessonSpec;

  const lesson = await db.createCustomLesson(env.DB, userId, {
    title: spec.title,
    description: spec.description ?? null,
    icon: spec.icon ?? null,
    spec: JSON.stringify(spec),
    source,
  });

  const imageJobs = await queueLessonImages(env, lesson.id, spec);
  return { ok: true, lesson, imageJobs };
}

export type UpdateCustomLessonResult =
  | { ok: true; lesson: db.CustomLessonRow; imageJobs: number }
  | { ok: false; notFound: boolean; errors: string[] };

/**
 * Replace an existing lesson's content in place — same id, so its completion
 * history and FSRS schedule carry over. Illustrations already generated for
 * describe_image exercises are kept when the new spec reuses the same
 * image_prompt (agents rarely echo image_url back), so an edit to a question
 * doesn't re-render every picture.
 */
export async function updateCustomLessonFromSpec(
  env: Env,
  userId: string,
  lessonId: string,
  rawSpec: unknown,
): Promise<UpdateCustomLessonResult> {
  const existing = await db.getCustomLesson(env.DB, lessonId, userId);
  if (!existing) return { ok: false, notFound: true, errors: ['Lesson not found'] };

  const errors = validateLessonSpec(rawSpec);
  if (errors.length > 0) return { ok: false, notFound: false, errors };
  const spec = rawSpec as CustomLessonSpec;

  mergeKeptImages(JSON.parse(existing.spec) as CustomLessonSpec, spec);

  const lesson = await db.updateCustomLesson(env.DB, lessonId, userId, {
    title: spec.title,
    description: spec.description ?? null,
    icon: spec.icon ?? null,
    spec: JSON.stringify(spec),
  });
  if (!lesson) return { ok: false, notFound: true, errors: ['Lesson not found'] };

  const imageJobs = await queueLessonImages(env, lesson.id, spec);
  return { ok: true, lesson, imageJobs };
}

/**
 * Carry generated illustrations over from the previous spec when a
 * describe_image exercise keeps its image_prompt (agents rarely echo
 * image_url back), so an edit to a question doesn't re-render every picture.
 * Mutates and returns `next`. Shared by the REST update, the editor and
 * library push-updates.
 */
export function mergeKeptImages(previous: CustomLessonSpec, next: CustomLessonSpec): CustomLessonSpec {
  const imageByPrompt = new Map<string, string>();
  for (const section of previous.sections) {
    for (const ex of section.exercises) {
      if (ex.type === 'describe_image' && ex.image_url) imageByPrompt.set(ex.image_prompt, ex.image_url);
    }
  }
  for (const section of next.sections) {
    for (const ex of section.exercises) {
      if (ex.type === 'describe_image' && !ex.image_url) {
        const kept = imageByPrompt.get(ex.image_prompt);
        if (kept) ex.image_url = kept;
      }
    }
  }
  return next;
}

/** Queue illustration generation for describe_image exercises without an
 * image yet. Returns the number of jobs queued. */
export async function queueLessonImages(
  env: Pick<Env, 'IMAGE_QUEUE' | 'GEMINI_API_KEY'>,
  lessonId: string,
  spec: CustomLessonSpec,
): Promise<number> {
  if (!env.GEMINI_API_KEY || !env.IMAGE_QUEUE) return 0;
  let queued = 0;
  for (let si = 0; si < spec.sections.length; si++) {
    const exercises = spec.sections[si].exercises;
    for (let ei = 0; ei < exercises.length; ei++) {
      const ex = exercises[ei];
      if (ex.type === 'describe_image' && !ex.image_url) {
        await env.IMAGE_QUEUE.send({
          lessonId,
          sectionIndex: si,
          exerciseIndex: ei,
          imagePrompt: ex.image_prompt,
        });
        queued++;
      }
    }
  }
  return queued;
}
