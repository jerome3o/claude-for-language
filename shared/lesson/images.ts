/**
 * describe_image pictures: one per scene description. The worker keys the
 * generated picture by a hash of the normalised image_prompt
 * (worker/src/services/lesson-images.ts), so every copy of a lesson — and the
 * catalogue sample — with the same scene shares one picture; the web app and
 * the Lab app remember prompt → picture the same way for offline use. A note's
 * structure card (`patterns[].image_prompt`) gets its picture the same way.
 */

import type { CustomLessonSpec } from './types';

/** Whitespace-insensitive form of a scene description (what the picture is keyed by). */
export function normalizeImagePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim();
}

/** Something in a lesson that carries a picture: a describe_image exercise, or a structure
 * (pattern) of a note with an `image_prompt` (shared/lesson/pattern.ts). */
interface ImageHolder {
  image_prompt: string;
  image_url?: string | null;
}

function describeImageExercises(spec: CustomLessonSpec): ImageHolder[] {
  const out: ImageHolder[] = [];
  for (const section of spec.sections ?? []) {
    for (const ex of section.exercises ?? []) {
      if (ex && ex.type === 'describe_image' && typeof ex.image_prompt === 'string' && ex.image_prompt.trim()) out.push(ex);
      if (ex && ex.type === 'note' && Array.isArray(ex.patterns)) {
        for (const p of ex.patterns) {
          if (p && typeof p.image_prompt === 'string' && p.image_prompt.trim()) out.push(p as ImageHolder);
        }
      }
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
