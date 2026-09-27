/**
 * describe_image pictures: one per scene description. The worker keys the
 * generated picture by a hash of the normalised image_prompt
 * (worker/src/services/lesson-images.ts), so every copy of a lesson — and the
 * catalogue sample — with the same scene shares one picture; the web app and
 * the Lab app remember prompt → picture the same way for offline use.
 */

import type { CustomLessonSpec, DescribeImageExerciseSpec } from './types';

/** Whitespace-insensitive form of a scene description (what the picture is keyed by). */
export function normalizeImagePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim();
}

function describeImageExercises(spec: CustomLessonSpec): DescribeImageExerciseSpec[] {
  const out: DescribeImageExerciseSpec[] = [];
  for (const section of spec.sections ?? []) {
    for (const ex of section.exercises ?? []) {
      if (ex && ex.type === 'describe_image' && typeof ex.image_prompt === 'string' && ex.image_prompt.trim()) out.push(ex);
    }
  }
  return out;
}

/** The distinct scene prompts of a spec (by normalised text); `missingOnly` skips exercises that already have a picture. */
export function describeImagePrompts(spec: CustomLessonSpec, missingOnly = false): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ex of describeImageExercises(spec)) {
    if (missingOnly && ex.image_url) continue;
    const norm = normalizeImagePrompt(ex.image_prompt);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(ex.image_prompt);
  }
  return out;
}

/** Every picture key a spec already carries (for offline prefetch). */
export function describeImageKeys(spec: CustomLessonSpec): string[] {
  return [...new Set(describeImageExercises(spec).map(ex => ex.image_url).filter((k): k is string => !!k))];
}

/** Put `key` on every describe_image exercise with this prompt and no picture. Mutates; returns how many changed. */
export function applyImageToSpec(spec: CustomLessonSpec, prompt: string, key: string): number {
  const norm = normalizeImagePrompt(prompt);
  let changed = 0;
  for (const ex of describeImageExercises(spec)) {
    if (!ex.image_url && normalizeImagePrompt(ex.image_prompt) === norm) {
      ex.image_url = key;
      changed++;
    }
  }
  return changed;
}
