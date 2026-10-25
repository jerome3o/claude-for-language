/**
 * Homework in VR: Home's one-off homework list (services/homework.ts — the same items, offline
 * from IndexedDB). A word list is passed right here (Show answer → Got it / Not yet, the same
 * pass events as the web's `/homework/:id`); a reader opens in the Reader window, a mini lesson in
 * a lesson window; anything VR can't do yet says "Open it on your phone".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { KIND_ICON, nextPassItem, passItemIds, passProgress, titleParts } from '@shared/homework';
import { db } from '../../db/database';
import { useHomeworkItems } from '../../components/homework/useHomeworkItems';
import { recordPassEvent, type HomeworkItem } from '../../services/homework';
import { track } from '../../services/analytics';
import { playNoteClip } from '../audio';
import type { UiNode } from '../ui/layout';
import { segmentsOf } from './StudyPanel';
import type { PanelHostProps } from './types';

export function homeworkListView(items: readonly HomeworkItem[] | null, notice: string | null): UiNode[] {
  if (!items) return [{ t: 'text', text: 'Loading your homework…', color: 'muted', align: 'center' }];
  const nodes: UiNode[] = [];
  if (notice) nodes.push({ t: 'text', text: notice, color: 'warn', size: 26 });
  if (items.length === 0) {
    nodes.push({ t: 'text', text: 'No homework to do 🎉', size: 36, weight: 600, align: 'center' });
    nodes.push({ t: 'text', text: 'What your tutor sends shows up here.', color: 'muted', align: 'center' });
    return nodes;
  }
  nodes.push({
    t: 'list',
    items: items.slice(0, 7).map((it) => {
      const a = it.assignment;
      const { base, part } = titleParts(a);
      const progress = it.progress.total > 1 ? `${it.progress.done} / ${it.progress.total}` : it.done ? 'done' : 'to do';
      return {
        icon: KIND_ICON[a.kind] ?? '📌',
        title: base,
        sub: [part, it.due.text].filter(Boolean).join(' · ') || (a.tutor_name ? `from ${a.tutor_name}` : ''),
        right: progress,
        action: `open:${a.id}`,
      };
    }),
  });
  return nodes;
}

export interface PassViewInput {
  title: string;
  done: number;
  total: number;
  complete: boolean;
  note: { hanzi: string; pinyin: string; english: string } | null;
  revealed: boolean;
  retrying: number;
  segments?: (text: string) => string[] | undefined;
}

export function passView(s: PassViewInput): UiNode[] {
  const nodes: UiNode[] = [{ t: 'progress', value: s.done, max: s.total }, { t: 'text', text: `${s.done} of ${s.total} words${s.retrying ? ` · ${s.retrying} to try again` : ''}`, color: 'muted', size: 24, align: 'center' }];
  if (s.complete) {
    nodes.push(
      { t: 'spacer', h: 16 },
      { t: 'text', text: '✓ All done', size: 52, weight: 700, color: 'good', align: 'center' },
      { t: 'text', text: s.title, align: 'center', color: 'muted' },
      { t: 'button', label: '← All homework', action: 'back', tone: 'plain' },
    );
    return nodes;
  }
  if (!s.note) {
    nodes.push({ t: 'text', text: 'Loading the next word…', color: 'muted', align: 'center' });
    return nodes;
  }
  nodes.push({ t: 'spacer', h: 10 }, { t: 'text', text: s.note.hanzi, size: 104, weight: 600, color: 'zh', align: 'center', explore: true, segments: s.segments?.(s.note.hanzi) });
  if (!s.revealed) {
    nodes.push({ t: 'text', text: 'Say it — what does it mean?', color: 'muted', align: 'center', size: 26 });
    nodes.push({ t: 'button', label: 'Show answer', action: 'reveal', tone: 'primary' });
    return nodes;
  }
  nodes.push(
    { t: 'text', text: s.note.pinyin, size: 36, color: 'accent', align: 'center' },
    { t: 'text', text: s.note.english, size: 34, align: 'center' },
    { t: 'row', mode: 'wrap', align: 'center', children: [{ t: 'button', label: '▶ Play', action: 'play', tone: 'chip' }] },
    {
      t: 'row',
      mode: 'fill',
      children: [
        { t: 'button', label: 'Not yet', action: 'wrong', tone: 'again' },
        { t: 'button', label: 'Got it', action: 'right', tone: 'good' },
      ],
    },
  );
  return nodes;
}

export function HomeworkPanel({ spec, ctx, report }: PanelHostProps<{ kind: 'homework'; assignment_id?: string }>) {
  const items = useHomeworkItems();
  const [openId, setOpenId] = useState<string | null>(spec.assignment_id ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (spec.assignment_id) setOpenId(spec.assignment_id);
  }, [spec.assignment_id]);

  const pass = useLiveQuery(async () => {
    if (!openId) return null;
    const assignment = await db.homeworkAssignments.get(openId);
    if (!assignment) return { assignment: null, events: [], note: null } as const;
    const events = await db.homeworkEvents.where('assignment_id').equals(openId).toArray();
    const progress = passProgress(passItemIds(assignment), events);
    const nextId = nextPassItem(progress);
    const note = nextId ? (await db.notes.get(nextId)) ?? null : null;
    return { assignment, events, progress, note } as const;
  }, [openId]);

  const noteId = pass && 'note' in pass ? pass.note?.id ?? null : null;
  useEffect(() => setRevealed(false), [noteId]);
  const started = useRef<string | null>(null);
  useEffect(() => {
    const a = pass?.assignment;
    if (a && started.current !== a.id) {
      started.current = a.id;
      track('homework.pass_start', { kind: a.kind, items: passItemIds(a).length });
    }
  }, [pass?.assignment]);

  const view = useMemo(() => {
    if (!openId || !pass) return { title: 'Homework', nodes: homeworkListView(items?.todo ?? null, notice) };
    if (!pass.assignment) return { title: 'Homework', nodes: [{ t: 'text', text: 'This homework isn’t on this device.', color: 'muted', align: 'center' } as UiNode, { t: 'button', label: '← All homework', action: 'back', tone: 'plain' } as UiNode] };
    const a = pass.assignment;
    const progress = pass.progress!;
    const { base } = titleParts(a);
    return {
      title: `Homework · ${base}`,
      nodes: passView({
        title: base,
        done: progress.done,
        total: progress.total,
        complete: progress.complete,
        note: pass.note ? { hanzi: pass.note.hanzi, pinyin: pass.note.pinyin, english: pass.note.english } : null,
        revealed,
        retrying: progress.retrying,
        segments: segmentsOf,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, pass, items, notice, revealed, ctx.segVersion]);

  const open = (id: string) => {
    const item = items?.todo.find((it) => it.assignment.id === id);
    const a = item?.assignment;
    if (!a) return;
    setNotice(null);
    if (a.kind === 'deck') setOpenId(a.id);
    else if (a.kind === 'reader') ctx.open({ kind: 'reader', reader_id: a.target_id }, 'homework');
    else if (a.kind === 'lesson') ctx.open({ kind: 'lesson_spec', lesson_id: a.target_id }, 'homework');
    else setNotice(`“${titleParts(a).base}” is a link — open it on your phone.`);
  };

  const answer = async (right: boolean) => {
    const a = pass?.assignment;
    const n = pass && 'note' in pass ? pass.note : null;
    if (!a || !n) return;
    await recordPassEvent(a.id, n.id, right ? 'right' : 'wrong');
    const after = passProgress(passItemIds(a), [...(pass?.events ?? []), { item_id: n.id, result: right ? 'right' : 'wrong', created_at: new Date().toISOString() } as const]);
    if (after.complete) track('homework.pass_done', { kind: a.kind, items: passItemIds(a).length });
  };

  const onAction = (action: string) => {
    if (action.startsWith('open:')) open(action.slice(5));
    else if (action === 'back') setOpenId(null);
    else if (action === 'reveal') {
      setRevealed(true);
      const n = pass && 'note' in pass ? pass.note : null;
      if (n) void playNoteClip(n.audio_url, n.hanzi);
    } else if (action === 'play') {
      const n = pass && 'note' in pass ? pass.note : null;
      if (n) void playNoteClip(n.audio_url, n.hanzi);
    } else if (action === 'right' || action === 'wrong') void answer(action === 'right');
  };

  const latest = useRef(onAction);
  latest.current = onAction;
  useEffect(() => {
    report({ view, onAction: (a) => latest.current(a) });
  }, [view, report]);
  return null;
}
