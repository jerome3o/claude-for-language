/**
 * Composed audio lessons (docs/AUDIO_LESSONS.md "Composed lessons"; shared/audio-lesson/composed.ts):
 * the plan an agent wrote → pinyin checked (the impossible corrected, like every other plan) →
 * compiled → either a dry-run preview (nothing stored) or a lesson row with its script, recorded on
 * audio-lesson-queue like the other formats (no Claude call: the plan IS the lesson).
 */
import { composedPlanShapeProblems, previewComposedLesson, type ComposedPlan, type ComposedPreview } from '@shared/audio-lesson';
import type { PinyinFix } from '@shared/pinyin/fixes';
import { fixSpecPinyin, logPinyinFixes, type PinyinReadingSources } from '../pinyin-check';

export interface ComposedPrepared {
  /** The plan with its pinyin checked (what is stored). */
  plan: ComposedPlan | null;
  preview: ComposedPreview;
  pinyin_fixes: PinyinFix[];
}

/** Check the shape, correct impossible pinyin (in place), compile + measure. Never throws for a plan problem. */
export async function prepareComposedLesson(plan: ComposedPlan | null, sources: PinyinReadingSources = {}): Promise<ComposedPrepared> {
  const shape = composedPlanShapeProblems(plan);
  if (!plan || shape.length) return { plan, preview: previewComposedLesson(plan), pinyin_fixes: [] };
  const fixes = await fixSpecPinyin(plan, sources).catch(() => [] as PinyinFix[]);
  logPinyinFixes('composed audio lesson', fixes);
  return { plan, preview: previewComposedLesson(plan), pinyin_fixes: fixes };
}

/** The dry run's answer (also the body of a 400): nothing about the script itself, it is large. */
export function previewBody(p: ComposedPrepared) {
  const { preview } = p;
  return {
    problems: preview.problems,
    estimate_minutes: preview.estimate_minutes,
    chapters: preview.chapters.map((c) => ({ title: c.title, at: c.at })),
    transcript_preview: preview.transcript,
    clips: preview.clips,
    segments: preview.segments,
    tts_chars: preview.tts_chars,
    ...(p.pinyin_fixes.length ? { pinyin_fixes: p.pinyin_fixes } : {}),
  };
}
