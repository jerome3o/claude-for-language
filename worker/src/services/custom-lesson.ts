/**
 * Custom mini lessons: agent-authored, schema-driven lessons (shared/lesson).
 *
 * This service is the single write path for lessons authored inside the main
 * worker (the REST route and the in-app chat tool): validate the untrusted
 * spec, store it, and queue illustration generation for any describe_image
 * exercises. The MCP worker has its own copy of this flow against the same
 * database and queue.
 */

import { CustomLessonSpec, validateLessonSpec } from '@shared/lesson';
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
- {type:"note", title?, body?, sentences?:[{hanzi,pinyin?,english?}]} — teaching text with example sentences (has TTS). Not scored.
- {type:"scramble", english, tiles:[...], correct_order:[...], alt_orders?} — arrange tiles into the sentence; tiles must be exactly a permutation of correct_order.
- {type:"choice", question, options:[{hanzi,pinyin?,english?}], correct:<index>, explanation?} — multiple choice (2-5 options).
- {type:"translate", english, reference_hanzi, reference_pinyin?, note?} — translate EN→ZH, self-assessed against the reference.
- {type:"match", pairs:[{hanzi,pinyin?,english}]} — connect hanzi with meanings (2-8 pairs, no duplicates).
- {type:"describe_image", image_prompt, task?, reference_hanzi, reference_pinyin?, reference_english?} — an illustration is generated from image_prompt (English, detailed, no text in image); the learner describes it aloud and self-assesses.
- {type:"speak", prompt, example?:{hanzi,pinyin?,english?}} — say your own sentence out loud, self-assessed.
Always use tone-marked pinyin (nǐ hǎo), never tone numbers.`,
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
