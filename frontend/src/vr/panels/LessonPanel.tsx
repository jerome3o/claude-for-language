/**
 * A mini lesson in VR — the "content as data" path (docs/VR.md "Security model"): the lesson
 * arrives as a validated `CustomLessonSpec` (from the device, or inline in a `lesson_spec` panel
 * spec checked by validateVrPanelSpec) and is drawn only by these trusted builders. VR plays
 * `note`, `choice` and `scramble` exercises; any other type says "Open it on your phone".
 * A VR run is practice: nothing is recorded (the lesson's real run stays on the phone).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { vrLessonCoverage, vrPlayableExercise } from '@shared/vr';
import type { CustomLessonSpec, LessonExercise } from '@shared/lesson/types';
import { db } from '../../db/database';
import { playText } from '../audio';
import type { UiNode } from '../ui/layout';
import { segmentsOf } from './StudyPanel';
import type { PanelHostProps } from './types';

export interface LessonRunState {
  index: number;
  /** choice: the option picked; scramble: tile indexes in the order tapped. */
  picked: number[];
  checked: boolean;
  right: number;
  scored: number;
}

export const START_RUN: LessonRunState = { index: 0, picked: [], checked: false, right: 0, scored: 0 };

export function flattenExercises(spec: Pick<CustomLessonSpec, 'sections'>): LessonExercise[] {
  return (spec.sections ?? []).flatMap((s) => s.exercises ?? []);
}

/** Did the learner's scramble match the answer (or an accepted alternative order)? */
export function scrambleCorrect(ex: { tiles: string[]; correct_order: string[]; alt_orders?: string[][] }, picked: readonly number[]): boolean {
  const said = picked.map((i) => ex.tiles[i]).join('');
  return [ex.correct_order, ...(ex.alt_orders ?? [])].some((order) => order.join('') === said);
}

export function lessonView(spec: CustomLessonSpec, run: LessonRunState, segments?: (t: string) => string[] | undefined): UiNode[] {
  const exercises = flattenExercises(spec);
  const total = exercises.length;
  const zh = (text: string, size = 40): UiNode => ({ t: 'text', text, size, color: 'zh', explore: true, segments: segments?.(text) });
  if (run.index >= total) {
    const cov = vrLessonCoverage(spec);
    return [
      { t: 'spacer', h: 16 },
      { t: 'text', text: '✓ Lesson finished', size: 48, weight: 700, color: 'good', align: 'center' },
      { t: 'text', text: run.scored > 0 ? `${run.right} of ${run.scored} right` : 'Nice work.', size: 30, align: 'center' },
      { t: 'text', text: cov.playable < cov.total ? `Practice in VR — ${cov.total - cov.playable} exercises need your phone; finish the lesson there to count it.` : 'Practice in VR — open it on your phone to count it.', size: 24, color: 'muted', align: 'center' },
      { t: 'button', label: '↺ Again', action: 'restart', tone: 'plain' },
    ];
  }
  const ex = exercises[run.index];
  const nodes: UiNode[] = [
    { t: 'progress', value: run.index, max: total },
    { t: 'text', text: `${run.index + 1} / ${total}${spec.description && run.index === 0 ? ` · ${spec.description}` : ''}`, size: 22, color: 'muted', maxLines: 1 },
  ];
  const next: UiNode = { t: 'button', label: run.index === total - 1 ? 'Finish' : 'Next →', action: 'next', tone: 'primary' };
  if (!vrPlayableExercise(ex)) {
    nodes.push(
      { t: 'spacer', h: 10 },
      { t: 'text', text: 'This exercise needs your phone', size: 34, weight: 600, align: 'center' },
      { t: 'text', text: `(${ex.type.replace(/_/g, ' ')}) — open the lesson there to do it.`, color: 'muted', align: 'center' },
      { t: 'button', label: 'Skip →', action: 'next', tone: 'plain' },
    );
    return nodes;
  }
  if (ex.type === 'note') {
    if (ex.title) nodes.push({ t: 'text', text: ex.title, size: 34, weight: 600 });
    if (ex.body) nodes.push({ t: 'text', text: ex.body, size: 26, explore: true, segments: segments?.(ex.body), maxLines: 10 });
    (ex.sentences ?? []).slice(0, 4).forEach((s, i) => {
      nodes.push(zh(s.hanzi, 36));
      const sub = [s.pinyin, s.english].filter(Boolean).join(' — ');
      if (sub) nodes.push({ t: 'text', text: sub, size: 22, color: 'muted' });
      nodes.push({ t: 'row', mode: 'wrap', children: [{ t: 'button', label: '▶', action: `say:${i}`, tone: 'chip', size: 24 }] });
    });
    nodes.push(next);
    return nodes;
  }
  if (ex.type === 'choice') {
    nodes.push({ t: 'text', text: ex.question, size: 30, weight: 600, explore: true, segments: segments?.(ex.question) });
    ex.options.forEach((o, i) => {
      const picked = run.picked[0] === i;
      const tone = run.checked ? (i === ex.correct ? 'good' : picked ? 'again' : 'plain') : 'plain';
      nodes.push({ t: 'button', label: o.hanzi, sub: run.checked ? [o.pinyin, o.english].filter(Boolean).join(' — ') || undefined : undefined, action: `pick:${i}`, tone, disabled: run.checked && !picked && i !== ex.correct });
    });
    if (run.checked) {
      const ok = run.picked[0] === ex.correct;
      nodes.push({ t: 'text', text: ok ? 'Right ✓' : 'Not quite', size: 30, weight: 600, color: ok ? 'good' : 'bad' });
      if (ex.explanation) nodes.push({ t: 'text', text: ex.explanation, size: 24, color: 'muted', explore: true, segments: segments?.(ex.explanation) });
      nodes.push(next);
    }
    return nodes;
  }
  if (ex.type !== 'scramble') return nodes;
  const used = new Set(run.picked);
  nodes.push({ t: 'text', text: 'Put the words in order', size: 26, color: 'muted' });
  nodes.push({ t: 'text', text: ex.english, size: 28, weight: 600 });
  const said = run.picked.map((i) => ex.tiles[i]).join('');
  nodes.push({ t: 'text', text: said || '…', size: 44, color: 'zh', align: 'center' });
  if (!run.checked) {
    nodes.push({ t: 'row', mode: 'wrap', align: 'center', children: ex.tiles.map((tile, i) => ({ t: 'button' as const, label: tile, action: `tile:${i}`, tone: 'chip' as const, size: 36, disabled: used.has(i) })) });
    nodes.push({
      t: 'row',
      mode: 'fill',
      children: [
        { t: 'button', label: '⌫ Undo', action: 'untile', tone: 'plain', disabled: run.picked.length === 0 },
        { t: 'button', label: 'Check', action: 'check', tone: 'primary', disabled: run.picked.length !== ex.tiles.length },
      ],
    });
  } else {
    const ok = scrambleCorrect(ex, run.picked);
    nodes.push({ t: 'text', text: ok ? 'Right ✓' : `Not quite — ${ex.correct_order.join('')}`, size: 30, weight: 600, color: ok ? 'good' : 'bad' });
    nodes.push(next);
  }
  return nodes;
}

/** The run after an action (pure: unit-tested). */
export function lessonReduce(spec: CustomLessonSpec, run: LessonRunState, action: string): LessonRunState {
  const exercises = flattenExercises(spec);
  const ex = exercises[run.index];
  if (action === 'restart') return START_RUN;
  if (action === 'next') return { ...run, index: Math.min(exercises.length, run.index + 1), picked: [], checked: false };
  if (!ex) return run;
  if (ex.type === 'choice' && action.startsWith('pick:') && !run.checked) {
    const i = Number(action.slice(5));
    if (!(i >= 0 && i < ex.options.length)) return run;
    return { ...run, picked: [i], checked: true, scored: run.scored + 1, right: run.right + (i === ex.correct ? 1 : 0) };
  }
  if (ex.type === 'scramble' && !run.checked) {
    if (action.startsWith('tile:')) {
      const i = Number(action.slice(5));
      if (!(i >= 0 && i < ex.tiles.length) || run.picked.includes(i)) return run;
      return { ...run, picked: [...run.picked, i] };
    }
    if (action === 'untile') return { ...run, picked: run.picked.slice(0, -1) };
    if (action === 'check' && run.picked.length === ex.tiles.length) {
      return { ...run, checked: true, scored: run.scored + 1, right: run.right + (scrambleCorrect(ex, run.picked) ? 1 : 0) };
    }
  }
  return run;
}

export function LessonPanel({ spec, ctx, report }: PanelHostProps<{ kind: 'lesson_spec'; lesson_id?: string; spec?: CustomLessonSpec }>) {
  const stored = useLiveQuery(async () => (spec.lesson_id ? (await db.customLessons.get(spec.lesson_id)) ?? null : null), [spec.lesson_id]);
  const lesson: CustomLessonSpec | null = spec.spec ?? stored?.spec ?? null;
  const [run, setRun] = useState<LessonRunState>(START_RUN);
  useEffect(() => {
    setRun(START_RUN);
  }, [spec.lesson_id, spec.spec]);

  const view = useMemo(() => {
    if (!lesson) {
      return {
        title: 'Mini lesson',
        nodes: [{ t: 'text', text: stored === undefined ? 'Loading…' : 'This lesson isn’t on this device.', color: 'muted', align: 'center' } as UiNode],
      };
    }
    return { title: `${lesson.icon ?? '🎓'} ${lesson.title}`, nodes: lessonView(lesson, run, segmentsOf) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, run, stored, ctx.segVersion]);

  const onAction = (action: string) => {
    if (!lesson) return;
    if (action.startsWith('say:')) {
      const ex = flattenExercises(lesson)[run.index];
      const s = ex?.type === 'note' ? ex.sentences?.[Number(action.slice(4))] : undefined;
      if (s) void playText(s.hanzi);
      return;
    }
    setRun((r) => lessonReduce(lesson, r, action));
  };

  const latest = useRef(onAction);
  latest.current = onAction;
  useEffect(() => {
    report({ view, onAction: (a) => latest.current(a) });
  }, [view, report]);
  return null;
}
