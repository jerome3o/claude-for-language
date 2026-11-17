/**
 * The grammar structures a learner has met in his mini lessons (docs/STUDY_SESSION.md "Listen in context" →
 * "Sentences that use your structures"). Jerome, Nov 2026: "look at what sentence structures I should
 * ostensibly know based on my lessons, cache those somewhere, and say 'use these sentence structures', so that
 * doing these cards I also learn the structures."
 *
 * Built from the `note` exercises of the lessons he has DONE (a completion — the server never sees a run in
 * progress): their `patterns`, else the structures parsed from older free-text notes (`structureNoteView`, the
 * same cards the player shows). One entry per structure name ("除了…还…"), with when it was first / last met
 * and how many runs went through it. The sentence generator gets a short mix of the recent and the
 * well-practised ones (`structuresForPrompt`) and tags each sentence with the one it used (`structureUsedBy`).
 *
 * Pure; the worker caches the list per user (services/learner-structures.ts).
 */
import { isPunctuation, isSlotPiece, patternLine, patternName, structureNoteView } from './pattern';
import type { CustomLessonSpec, LessonPattern } from './types';

export interface LearnerStructure {
  /** patternName — "除了…还…" (the key). */
  name: string;
  /** The pattern as a line: "除了 + [Noun] + (以外) + ， + [Subject] + 还 + [Verb]". */
  line: string;
  meaning: string | null;
  /** One example from the lesson. */
  example: string | null;
  /** The structure's fixed words in order (what a sentence must contain to use it). */
  fixed: string[];
  /** First / last completion of a lesson teaching it (ISO). */
  first_met: string;
  last_met: string;
  /** Lessons teaching it. */
  lessons: number;
  /** Completed runs through those lessons. */
  practised: number;
}

export interface LessonForStructures {
  id: string;
  spec: CustomLessonSpec | string | null | undefined;
  /** Completion times (ISO) of this lesson; none = not done (left out). */
  completions: readonly string[];
}

/** At most this many structures are kept per learner. */
export const LEARNER_STRUCTURES_MAX = 60;
/** At most this many go into one sentence prompt. */
export const STRUCTURES_PROMPT_MAX = 10;

function parseSpec(spec: LessonForStructures['spec']): CustomLessonSpec | null {
  if (!spec) return null;
  if (typeof spec === 'string') {
    try {
      return JSON.parse(spec) as CustomLessonSpec;
    } catch {
      return null;
    }
  }
  return spec;
}

/** A structure's fixed words (no optional ones, no punctuation), in order. */
export function structureFixedWords(pattern: Pick<LessonPattern, 'pieces'>): string[] {
  return pattern.pieces
    .filter((p) => !isSlotPiece(p) && !p.optional)
    .map((p) => (p.hanzi ?? '').trim())
    .filter((t) => t && !isPunctuation(t));
}

/** The patterns a lesson teaches (its notes' `patterns`, else parsed from their text). */
export function lessonPatterns(spec: CustomLessonSpec): Array<{ pattern: LessonPattern; example: string | null }> {
  const out: Array<{ pattern: LessonPattern; example: string | null }> = [];
  for (const section of spec.sections ?? []) {
    for (const ex of section?.exercises ?? []) {
      if (!ex || ex.type !== 'note') continue;
      let view;
      try {
        view = structureNoteView(ex);
      } catch {
        view = null;
      }
      for (const card of view?.cards ?? []) {
        out.push({ pattern: card.pattern, example: card.examples[0]?.hanzi ?? null });
      }
    }
  }
  return out;
}

/** The structures of the lessons he has done, newest met first. */
export function learnerStructuresFromLessons(lessons: readonly LessonForStructures[]): LearnerStructure[] {
  const byName = new Map<string, LearnerStructure & { lessonIds: Set<string> }>();
  for (const lesson of lessons) {
    const done = lesson.completions.filter((c) => typeof c === 'string' && c).slice().sort();
    if (done.length === 0) continue;
    const spec = parseSpec(lesson.spec);
    if (!spec) continue;
    const seenHere = new Set<string>();
    for (const { pattern, example } of lessonPatterns(spec)) {
      const fixed = structureFixedWords(pattern);
      if (fixed.length === 0) continue;
      const name = patternName(pattern).trim();
      if (!name) continue;
      let s = byName.get(name);
      if (!s) {
        s = {
          name,
          line: patternLine(pattern.pieces),
          meaning: pattern.meaning?.trim() || null,
          example,
          fixed,
          first_met: done[0],
          last_met: done[done.length - 1],
          lessons: 0,
          practised: 0,
          lessonIds: new Set(),
        };
        byName.set(name, s);
      }
      if (!s.meaning && pattern.meaning?.trim()) s.meaning = pattern.meaning.trim();
      if (!s.example && example) s.example = example;
      if (done[0] < s.first_met) s.first_met = done[0];
      if (done[done.length - 1] > s.last_met) s.last_met = done[done.length - 1];
      if (!seenHere.has(name)) {
        seenHere.add(name);
        if (!s.lessonIds.has(lesson.id)) {
          s.lessonIds.add(lesson.id);
          s.lessons++;
          s.practised += done.length;
        }
      }
    }
  }
  return [...byName.values()]
    .map(({ lessonIds: _, ...s }) => s)
    .sort((a, b) => (a.last_met < b.last_met ? 1 : a.last_met > b.last_met ? -1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, LEARNER_STRUCTURES_MAX);
}

/**
 * The structures one prompt names: alternately the most recently met and the most practised, without
 * repeats, up to `max` — what he is learning now and what he should know well.
 */
export function structuresForPrompt(list: readonly LearnerStructure[], max = STRUCTURES_PROMPT_MAX): LearnerStructure[] {
  const recent = list.slice().sort((a, b) => (a.last_met < b.last_met ? 1 : a.last_met > b.last_met ? -1 : 0));
  const practised = list.slice().sort((a, b) => b.practised - a.practised || (a.last_met < b.last_met ? 1 : a.last_met > b.last_met ? -1 : 0));
  const out: LearnerStructure[] = [];
  const names = new Set<string>();
  for (let i = 0; out.length < max && (i < recent.length || i < practised.length); i++) {
    for (const s of [recent[i], practised[i]]) {
      if (s && !names.has(s.name) && out.length < max) {
        names.add(s.name);
        out.push(s);
      }
    }
  }
  return out;
}

/** The prompt lines: "- 除了…还… (除了 + [Noun] + ， + 还 + [Verb]) — besides A, also B". '' when none. */
export function structuresPromptBlock(list: readonly LearnerStructure[]): string {
  if (list.length === 0) return '';
  return list
    .map((s) => `- ${s.name} (${s.line})${s.meaning ? ` — ${s.meaning}` : ''}`)
    .join('\n');
}

/** The listed structure a sentence uses: every fixed word in order (the longest such structure), else null. */
export function structureUsedBy(hanzi: string, list: readonly Pick<LearnerStructure, 'name' | 'fixed'>[]): string | null {
  let best: { name: string; len: number } | null = null;
  for (const s of list) {
    if (!s.fixed.length) continue;
    let at = 0;
    let ok = true;
    for (const w of s.fixed) {
      const i = hanzi.indexOf(w, at);
      if (i < 0) {
        ok = false;
        break;
      }
      at = i + w.length;
    }
    const len = s.fixed.join('').length;
    if (ok && (!best || len > best.len)) best = { name: s.name, len };
  }
  return best?.name ?? null;
}
