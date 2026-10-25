/**
 * Golden vectors: "Skip handwriting exercises" (shared/lesson/handwriting.ts) and the homework / lesson
 * row menu (shared/homework/row-actions.ts) — the run's steps with handwriting left out, a row's retry bar
 * from a saved run (`savedRunBar`), the keys and attempt rows of the exercises left out, the revision
 * state with them ignored, and which actions a row offers with their words. Writes homework-row-menu.json;
 * checked by core/…/HomeworkRowMenuParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lessonShape, lessonSteps, savedRunBar } from '../../../shared/study/lessonRun';
import { computeLessonLearnState, type LessonRunRecord } from '../../../shared/study/lessonRevision';
import { handwritingKeys, skippedHandwritingRows } from '../../../shared/lesson/handwriting';
import {
  homeRowKind,
  homeworkRowActionConfirm,
  homeworkRowActionIcon,
  homeworkRowActionLabel,
  homeworkRowActions,
  homeworkRowActionToast,
  homeworkRowActionUndoable,
  type HomeworkRowKind,
} from '../../../shared/homework/row-actions';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261025);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const TYPES = ['note', 'choice', 'write_handwriting', 'write_handwriting', 'write_typed', 'dictation', 'translate', 'scramble'];
const DAY = 86_400_000;
const BASE = Date.parse('2026-10-01T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const lessons = Array.from({ length: 160 }, () => {
  const sections = Array.from({ length: int(1, 3) }, () => Array.from({ length: int(0, 6) }, () => pick(TYPES)));
  const spec = { sections: sections.map((types) => ({ exercises: types.map((type) => ({ type })) })) };
  const skip = r() < 0.6;
  const all = lessonSteps(spec as never);
  const only = r() < 0.3 ? all.filter(() => r() < 0.5).map((s) => s.key) : null;
  const steps = lessonSteps(spec as never, only, { skipHandwriting: skip });
  // A saved run: in progress, nothing answered yet, another lesson, another shape — or none.
  const kind = pick(['run', 'run', 'fresh', 'other', 'shape', 'none'] as const);
  const saved = kind === 'none' ? null : {
    lesson_id: kind === 'other' ? 'L2' : 'L1',
    shape: kind === 'shape' ? 'x' : lessonShape(spec as never),
    mode: 'full' as const,
    keys: only,
    state: kind === 'fresh' ? { pos: 0, owed: [], fixed: 0, retried: 0 } : { pos: int(1, Math.max(1, steps.length)), owed: steps.filter((s) => s.scored && r() < 0.3).map((s) => s.key), fixed: int(0, 1), retried: int(0, 2) },
    correct: 0, total: 0, started_at: 'x', saved_at: 'x',
  };
  const keys = handwritingKeys(spec as never);
  const scored = lessonSteps(spec as never).filter((s) => s.scored).map((s) => s.key);
  const runs: LessonRunRecord[] = Array.from({ length: int(0, 3) }, (_, i) => {
    const ks = scored.filter(() => r() < 0.9);
    return { id: `c${i}`, at: iso(BASE + int(0, 20) * DAY), outcome: { keys: ks, missed: ks.filter(() => r() < 0.35) }, rating: null };
  });
  const ignore = skip ? keys : [];
  return {
    sections, skip, only,
    steps: steps.map((s) => s.key),
    saved,
    bar: savedRunBar(saved, 'L1', spec as never, { skipHandwriting: skip }),
    keys,
    rows: skippedHandwritingRows(spec as never, only),
    runs, ignore,
    state: computeLessonLearnState(runs, [], ignore),
  };
});

const KINDS: HomeworkRowKind[] = ['assignment', 'tutor_lesson', 'revision', 'lesson'];
const menus = [];
for (const kind of KINDS) {
  for (const assignment_id of [null, 'a1']) {
    for (const lesson_id of [null, 'l1']) {
      for (const has_handwriting of [false, true]) {
        for (const skip_handwriting of [false, true]) {
          const actions = homeworkRowActions({ kind, assignment_id, lesson_id, has_handwriting, skip_handwriting });
          const tutor = pick([null, '明慧老师', '']);
          menus.push({
            kind, assignment_id, lesson_id, has_handwriting, skip_handwriting, tutor, actions,
            labels: actions.map((a) => homeworkRowActionLabel(a, kind)),
            icons: actions.map(homeworkRowActionIcon),
            confirms: actions.map((a) => homeworkRowActionConfirm(a, { title: '把 sentences', tutor_name: tutor })),
            toasts: actions.map((a) => homeworkRowActionToast(a, { tutor_name: tutor })),
            undoable: actions.map(homeworkRowActionUndoable),
          });
        }
      }
    }
  }
}
const rowKinds = ['a1', 'revision:l1', 'lesson:l1', 'lesson', 'revision'].map((key) => ({ key, kind: homeRowKind({ key, kind: 'x' }) }));

writeFileSync(join(OUT, 'homework-row-menu.json'), JSON.stringify({ lessons, menus, rowKinds }));
