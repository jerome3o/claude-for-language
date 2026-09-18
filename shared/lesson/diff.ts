/**
 * Structural diff between two lesson specs.
 *
 * Used by the lesson editor's Claude side-chat in both directions: the server
 * tells Claude "what the author changed since your last message", and the
 * client renders Claude's proposal as a compact card of added / removed /
 * changed exercises. Pure and dependency-free so it runs in the worker, the
 * browser (offline) and unit tests.
 *
 * Exercises have no ids, so identity is inferred: an exercise that appears
 * unchanged is matched first (possibly moved to another section); the rest
 * are paired by type + a primary text field, and whatever is left over is an
 * add or a remove.
 */

import { CustomLessonSpec, LessonExercise, LessonSection } from './types';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export type ExerciseDiffEntry =
  | { kind: 'added'; section: number; index: number; exercise: LessonExercise }
  | { kind: 'removed'; section: number; index: number; exercise: LessonExercise }
  | {
      kind: 'changed';
      section: number;
      index: number;
      before: LessonExercise;
      after: LessonExercise;
      fields: FieldChange[];
    }
  | {
      kind: 'moved';
      fromSection: number;
      fromIndex: number;
      section: number;
      index: number;
      exercise: LessonExercise;
    };

export type SectionDiffEntry =
  | { kind: 'added'; index: number; title: string | null; exerciseCount: number }
  | { kind: 'removed'; index: number; title: string | null; exerciseCount: number }
  | { kind: 'renamed'; index: number; before: string | null; after: string | null };

export interface LessonDiff {
  /** True when anything at all differs. */
  changed: boolean;
  meta: FieldChange[];
  sections: SectionDiffEntry[];
  exercises: ExerciseDiffEntry[];
}

/** Deterministic JSON: object keys sorted, undefined dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * The text that identifies an exercise to a human — the question, the
 * English prompt, the played sentence. Used both for pairing edited
 * exercises and for labelling them in the rendered diff.
 */
export function exercisePrimaryText(ex: LessonExercise): string {
  switch (ex.type) {
    case 'note':
      return ex.title || ex.sentences?.[0]?.hanzi || (ex.body ?? '').slice(0, 60);
    case 'scramble':
      return ex.english;
    case 'choice':
      return ex.question;
    case 'translate':
      return ex.english;
    case 'match':
      return ex.pairs.map(p => p.hanzi).join(' · ');
    case 'describe_image':
      return ex.task || ex.reference_hanzi;
    case 'speak':
      return ex.prompt;
    case 'listen_choice':
      return ex.audio.hanzi;
    case 'listen_translate':
      return ex.audio.hanzi;
    default:
      return '';
  }
}

/** Fields whose equality is strong evidence two exercises are "the same one". */
function identityFields(ex: LessonExercise): string[] {
  switch (ex.type) {
    case 'note':
      return ['title', 'body', 'sentences'];
    case 'scramble':
      return ['english', 'correct_order'];
    case 'choice':
      return ['question', 'options'];
    case 'translate':
      return ['english', 'reference_hanzi'];
    case 'match':
      return ['pairs'];
    case 'describe_image':
      return ['image_prompt', 'reference_hanzi', 'task'];
    case 'speak':
      return ['prompt', 'example'];
    case 'listen_choice':
      return ['audio', 'options', 'question'];
    case 'listen_translate':
      return ['audio'];
    default:
      return [];
  }
}

interface Located {
  section: number;
  index: number;
  exercise: LessonExercise;
  key: string;
  matched: boolean;
}

function locate(spec: CustomLessonSpec): Located[] {
  const out: Located[] = [];
  spec.sections.forEach((section, si) => {
    section.exercises.forEach((exercise, ei) => {
      out.push({ section: si, index: ei, exercise, key: canonicalJson(exercise), matched: false });
    });
  });
  return out;
}

function asRecord(ex: LessonExercise): Record<string, unknown> {
  return ex as unknown as Record<string, unknown>;
}

function fieldChanges(before: LessonExercise, after: LessonExercise): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: FieldChange[] = [];
  for (const field of Array.from(keys).sort()) {
    // image_url is server-filled; a proposal that omits it isn't a change.
    if (field === 'image_url') continue;
    const b = asRecord(before)[field];
    const a = asRecord(after)[field];
    if (canonicalJson(b) !== canonicalJson(a)) changes.push({ field, before: b, after: a });
  }
  return changes;
}

/** How alike two same-type exercises are: fraction of identity fields equal. */
function similarity(a: LessonExercise, b: LessonExercise): number {
  if (a.type !== b.type) return 0;
  const fields = identityFields(a);
  if (fields.length === 0) return 0;
  let same = 0;
  for (const f of fields) {
    if (canonicalJson(asRecord(a)[f]) === canonicalJson(asRecord(b)[f])) same++;
  }
  // Same primary text is decisive even when everything else moved.
  if (exercisePrimaryText(a) && exercisePrimaryText(a) === exercisePrimaryText(b)) same = Math.max(same, fields.length * 0.75);
  return same / fields.length;
}

function sectionTitle(s: LessonSection | undefined): string | null {
  return s?.title?.trim() ? s.title.trim() : null;
}

export function diffLessonSpecs(before: CustomLessonSpec, after: CustomLessonSpec): LessonDiff {
  const meta: FieldChange[] = [];
  for (const field of ['title', 'icon', 'description'] as const) {
    const b = before[field] ?? null;
    const a = after[field] ?? null;
    if ((b ?? '') !== (a ?? '')) meta.push({ field, before: b, after: a });
  }

  const sections: SectionDiffEntry[] = [];
  const common = Math.min(before.sections.length, after.sections.length);
  for (let i = 0; i < common; i++) {
    const b = sectionTitle(before.sections[i]);
    const a = sectionTitle(after.sections[i]);
    if (b !== a) sections.push({ kind: 'renamed', index: i, before: b, after: a });
  }
  for (let i = common; i < after.sections.length; i++) {
    sections.push({ kind: 'added', index: i, title: sectionTitle(after.sections[i]), exerciseCount: after.sections[i].exercises.length });
  }
  for (let i = common; i < before.sections.length; i++) {
    sections.push({ kind: 'removed', index: i, title: sectionTitle(before.sections[i]), exerciseCount: before.sections[i].exercises.length });
  }

  const olds = locate(before);
  const news = locate(after);
  const exercises: ExerciseDiffEntry[] = [];

  // Pass 1: byte-identical exercises (unchanged, or moved between sections).
  for (const n of news) {
    const o = olds.find(x => !x.matched && x.key === n.key);
    if (!o) continue;
    o.matched = true;
    n.matched = true;
    if (o.section !== n.section) {
      exercises.push({
        kind: 'moved',
        fromSection: o.section,
        fromIndex: o.index,
        section: n.section,
        index: n.index,
        exercise: n.exercise,
      });
    }
  }

  // Pass 2: edited exercises — best same-type match above a threshold.
  for (const n of news) {
    if (n.matched) continue;
    let best: Located | null = null;
    let bestScore = 0;
    for (const o of olds) {
      if (o.matched) continue;
      const score = similarity(o.exercise, n.exercise);
      if (score > bestScore) {
        best = o;
        bestScore = score;
      }
    }
    if (best && bestScore >= 0.34) {
      best.matched = true;
      n.matched = true;
      exercises.push({
        kind: 'changed',
        section: n.section,
        index: n.index,
        before: best.exercise,
        after: n.exercise,
        fields: fieldChanges(best.exercise, n.exercise),
      });
    }
  }

  for (const n of news) {
    if (!n.matched) exercises.push({ kind: 'added', section: n.section, index: n.index, exercise: n.exercise });
  }
  for (const o of olds) {
    if (!o.matched) exercises.push({ kind: 'removed', section: o.section, index: o.index, exercise: o.exercise });
  }

  // Stable, readable order: by section, then position.
  exercises.sort((a, b) => a.section - b.section || a.index - b.index);

  return {
    changed: meta.length > 0 || sections.length > 0 || exercises.length > 0,
    meta,
    sections,
    exercises,
  };
}

export const EXERCISE_TYPE_LABELS: Record<LessonExercise['type'], string> = {
  note: 'note',
  scramble: 'word order',
  choice: 'multiple choice',
  translate: 'translate',
  match: 'match pairs',
  describe_image: 'describe picture',
  speak: 'speak',
  listen_choice: 'listen & pick',
  listen_translate: 'listen & translate',
};

function short(value: unknown, max = 60): string {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function describe(ex: LessonExercise): string {
  const label = EXERCISE_TYPE_LABELS[ex.type] ?? ex.type;
  const text = exercisePrimaryText(ex);
  return text ? `${label} "${short(text)}"` : label;
}

/**
 * Plain-text lines describing a diff, for the model ("Changes the author
 * made since your last message") and for logs. Empty when nothing changed.
 */
export function formatLessonDiff(diff: LessonDiff): string[] {
  const lines: string[] = [];
  for (const m of diff.meta) {
    lines.push(`${m.field}: "${short(m.before)}" → "${short(m.after)}"`);
  }
  for (const s of diff.sections) {
    const name = (t: string | null) => (t ? `"${t}"` : '(untitled)');
    if (s.kind === 'added') lines.push(`Section ${s.index + 1} ${name(s.title)} added (${s.exerciseCount} exercises)`);
    else if (s.kind === 'removed') lines.push(`Section ${s.index + 1} ${name(s.title)} removed (${s.exerciseCount} exercises)`);
    else lines.push(`Section ${s.index + 1} renamed ${name(s.before)} → ${name(s.after)}`);
  }
  for (const e of diff.exercises) {
    const where = `Section ${e.section + 1}, exercise ${e.index + 1}`;
    switch (e.kind) {
      case 'added':
        lines.push(`${where}: added ${describe(e.exercise)}`);
        break;
      case 'removed':
        lines.push(`${where}: removed ${describe(e.exercise)}`);
        break;
      case 'moved':
        lines.push(`${where}: moved ${describe(e.exercise)} here from section ${e.fromSection + 1}`);
        break;
      case 'changed': {
        const fields = e.fields.map(f => `${f.field} "${short(f.before, 40)}" → "${short(f.after, 40)}"`).join('; ');
        lines.push(`${where}: changed ${describe(e.after)} — ${fields || 'reworded'}`);
        break;
      }
    }
  }
  return lines;
}
