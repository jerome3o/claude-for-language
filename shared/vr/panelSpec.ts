/**
 * What a VR window shows, as DATA (docs/VR.md "Security model"): every window is opened from a
 * `VrPanelSpec` — a kind from a fixed list plus a few validated parameters — and rendered by one
 * of a fixed set of trusted panel builders in the web app (frontend/src/vr/panels/). Nothing in a
 * spec is ever executed: no code, no HTML, no script URLs; text is drawn as text.
 *
 * The same validator guards every way a spec arrives: the tray, a tap inside another window,
 * the windows remembered in localStorage, and (later) specs Claude makes server-side — those are
 * validated here before they are stored, exactly like `validateLessonSpec` guards mini lessons.
 */
import { validateLessonSpec } from '../lesson/validate';
import type { CustomLessonSpec, LessonExercise } from '../lesson/types';

export const VR_PANEL_KINDS = ['study', 'reader', 'homework', 'explorer', 'lesson_spec', 'feedback'] as const;
export type VrPanelKind = (typeof VR_PANEL_KINDS)[number];

export type VrPanelSpec =
  /** The regular study session (today's queue, the same review events as the web). */
  | { kind: 'study'; deck_id?: string }
  /** Graded readers: the Up next list, or one reader. */
  | { kind: 'reader'; reader_id?: string }
  /** Home's homework list, or one assignment's pass. */
  | { kind: 'homework'; assignment_id?: string }
  /** The language explorer, opened on a character or word. */
  | { kind: 'explorer'; text: string }
  /** A mini lesson (its id on the device, or a spec carried inline), played in VR. */
  | { kind: 'lesson_spec'; lesson_id?: string; spec?: CustomLessonSpec }
  /** Feedback about the VR app (screenshot + message). */
  | { kind: 'feedback' };

export type VrPanelSpecResult = { ok: true; spec: VrPanelSpec } | { ok: false; problems: string[] };

/** Ids are short tokens (uuids, client ids): never a URL, never markup. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** The explorer opens on a few characters (a word, a short phrase), never a document. */
export const VR_EXPLORER_TEXT_MAX = 24;

const ALLOWED_KEYS: Record<VrPanelKind, readonly string[]> = {
  study: ['deck_id'],
  reader: ['reader_id'],
  homework: ['assignment_id'],
  explorer: ['text'],
  lesson_spec: ['lesson_id', 'spec'],
  feedback: [],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const HAN_RE = /\p{Script=Han}/u;

export function isVrPanelKind(v: unknown): v is VrPanelKind {
  return typeof v === 'string' && (VR_PANEL_KINDS as readonly string[]).includes(v);
}

/**
 * Checks an untrusted panel spec. Unknown kinds and unknown keys are refused (a spec is a closed
 * shape, so a later field can't sneak in meaning); ids must be plain tokens; an inline lesson
 * spec must pass `validateLessonSpec`.
 */
export function validateVrPanelSpec(input: unknown): VrPanelSpecResult {
  if (!isRecord(input)) return { ok: false, problems: ['a panel spec must be an object'] };
  const kind = input.kind;
  if (!isVrPanelKind(kind)) return { ok: false, problems: [`unknown panel kind ${JSON.stringify(typeof kind === 'string' ? kind.slice(0, 40) : kind)}`] };
  const problems: string[] = [];
  const allowed = ALLOWED_KEYS[kind];
  for (const key of Object.keys(input)) {
    if (key !== 'kind' && !allowed.includes(key)) problems.push(`"${key}" is not a ${kind} panel field`);
  }
  const id = (key: string) => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || !ID_RE.test(v)) {
      problems.push(`"${key}" must be a short id`);
      return undefined;
    }
    return v;
  };
  let spec: VrPanelSpec | null = null;
  switch (kind) {
    case 'study': {
      const deck_id = id('deck_id');
      spec = deck_id ? { kind, deck_id } : { kind };
      break;
    }
    case 'reader': {
      const reader_id = id('reader_id');
      spec = reader_id ? { kind, reader_id } : { kind };
      break;
    }
    case 'homework': {
      const assignment_id = id('assignment_id');
      spec = assignment_id ? { kind, assignment_id } : { kind };
      break;
    }
    case 'explorer': {
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) problems.push('"text" is required');
      else if ([...text].length > VR_EXPLORER_TEXT_MAX) problems.push(`"text" is longer than ${VR_EXPLORER_TEXT_MAX} characters`);
      else if (!HAN_RE.test(text)) problems.push('"text" has no Chinese character to explore');
      spec = { kind, text };
      break;
    }
    case 'lesson_spec': {
      const lesson_id = id('lesson_id');
      const hasSpec = input.spec !== undefined;
      if (!lesson_id && !hasSpec) problems.push('a lesson panel needs "lesson_id" or "spec"');
      if (lesson_id && hasSpec) problems.push('a lesson panel takes "lesson_id" or "spec", not both');
      if (hasSpec) {
        const lessonProblems = validateLessonSpec(input.spec);
        for (const p of lessonProblems.slice(0, 10)) problems.push(`spec: ${p}`);
      }
      spec = lesson_id ? { kind, lesson_id } : { kind, spec: input.spec as CustomLessonSpec };
      break;
    }
    case 'feedback':
      spec = { kind };
      break;
  }
  if (problems.length > 0 || !spec) return { ok: false, problems };
  return { ok: true, spec };
}

/**
 * Which window a spec belongs in: one window per key (opening Study again focuses the open one;
 * the explorer is one window with its own stack). Also the key a window's position is remembered by.
 */
export function vrPanelKey(spec: VrPanelSpec): string {
  if (spec.kind === 'lesson_spec') return spec.lesson_id ? `lesson:${spec.lesson_id}` : 'lesson:inline';
  return spec.kind;
}

/** The window's title bar text (the panel may refine it once its data loads). */
export function vrPanelTitle(spec: VrPanelSpec): string {
  switch (spec.kind) {
    case 'study': return 'Study';
    case 'reader': return 'Reader';
    case 'homework': return 'Homework';
    case 'explorer': return 'Explorer';
    case 'lesson_spec': return spec.spec?.title ?? 'Mini lesson';
    case 'feedback': return 'Feedback';
  }
}

/** Exercise types the VR lesson panel can play; anything else says "Open on your phone". */
export const VR_LESSON_EXERCISE_TYPES = ['note', 'choice', 'scramble'] as const;

export function vrPlayableExercise(ex: Pick<LessonExercise, 'type'>): boolean {
  return (VR_LESSON_EXERCISE_TYPES as readonly string[]).includes(ex.type);
}

/** How much of a lesson VR can play: playable / total exercises. */
export function vrLessonCoverage(spec: Pick<CustomLessonSpec, 'sections'>): { playable: number; total: number } {
  let playable = 0;
  let total = 0;
  for (const s of spec.sections ?? []) {
    for (const ex of s.exercises ?? []) {
      total++;
      if (vrPlayableExercise(ex)) playable++;
    }
  }
  return { playable, total };
}
