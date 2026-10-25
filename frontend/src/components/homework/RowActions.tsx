/**
 * The long-press / ⋯ menu on a homework or mini lesson row (docs/HOMEWORK.md §3d, docs/STUDY_SESSION.md
 * "Row menu"): Home's card, /homework and Mini Lessons' To do. Which actions a row offers, their words,
 * the confirm and the toast are the shared rules (shared/homework/row-actions.ts; Lab: same port).
 *
 *  - Skip this homework (the tutor's homework) → a `skip` event; confirmed; Undo.
 *  - Stop revising — done for good (a revision / his own lesson) → a revisit_events retire; Undo = restore.
 *  - Delete lesson → DELETE /api/custom-lessons/:id (confirmed, needs a connection).
 *  - Skip handwriting exercises → the account switch on; Undo turns it off.
 *
 * `useRowActions(from)` gives `open(target)` for a row and the element to render (sheet + toast).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  homeworkRowActionConfirm,
  homeworkRowActionIcon,
  homeworkRowActionLabel,
  homeworkRowActions,
  homeworkRowActionToast,
  homeworkRowActionUndoable,
  type HomeworkRowAction,
  type HomeworkRowKind,
} from '@shared/homework';
import { lessonHasHandwriting } from '@shared/lesson';
import { db } from '../../db/database';
import { deleteCustomLessonById } from '../../api/client';
import { recordSkip, recordUndoOf } from '../../services/homework';
import { markLessonDone } from '../../services/lessonLearn';
import { clearLessonRun } from '../../services/lessonRuns';
import { readSkipHandwriting, saveSkipHandwriting } from '../../services/skipHandwriting';
import { track } from '../../services/analytics';
import { useLongPress } from '../chat/useLongPress';
import './RowActions.css';

export type RowActionsFrom = 'home' | 'homework' | 'lessons_page';

/** What a row's menu acts on. */
export interface RowActionTarget {
  kind: HomeworkRowKind;
  title: string;
  tutor_name: string | null;
  assignment_id: string | null;
  /** The assignment's kind (deck / lesson / reader / link) for analytics; null without one. */
  assignment_kind: string | null;
  lesson_id: string | null;
}

interface Opened {
  target: RowActionTarget;
  actions: HomeworkRowAction[];
  confirm: HomeworkRowAction | null;
  busy: boolean;
  error: string | null;
}

interface ToastState {
  text: string;
  undo: (() => Promise<void>) | null;
}

export function useRowActions(from: RowActionsFrom, onChanged?: (action: HomeworkRowAction) => void): {
  open: (target: RowActionTarget) => void;
  element: ReactNode;
} {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const open = useCallback((target: RowActionTarget) => {
    void (async () => {
      let hasHandwriting = false;
      if (target.lesson_id) {
        const row = await db.customLessons.get(target.lesson_id).catch(() => undefined);
        hasHandwriting = !!row && lessonHasHandwriting(row.spec);
      }
      const actions = homeworkRowActions({
        kind: target.kind,
        assignment_id: target.assignment_id,
        lesson_id: target.lesson_id,
        has_handwriting: hasHandwriting,
        skip_handwriting: readSkipHandwriting(),
      });
      if (actions.length === 0) return;
      setOpened({ target, actions, confirm: null, busy: false, error: null });
    })();
  }, []);

  const run = useCallback(async (o: Opened, action: HomeworkRowAction) => {
    const { target } = o;
    const props = { action, kind: target.kind, from };
    let undo: (() => Promise<void>) | null = null;
    if (action === 'skip_homework' && target.assignment_id) {
      const event = await recordSkip(target.assignment_id);
      track('homework.skipped', { kind: target.assignment_kind ?? 'lesson', undo: false });
      undo = async () => {
        await recordUndoOf(target.assignment_id!, event.id);
        track('homework.skipped', { kind: target.assignment_kind ?? 'lesson', undo: true });
      };
    } else if (action === 'done_for_good' && target.lesson_id) {
      await markLessonDone(target.lesson_id, 'retire');
      undo = async () => { await markLessonDone(target.lesson_id!, 'restore'); };
    } else if (action === 'delete_lesson' && target.lesson_id) {
      await deleteCustomLessonById(target.lesson_id);
      await db.customLessons.delete(target.lesson_id).catch(() => undefined);
      await clearLessonRun(target.lesson_id);
    } else if (action === 'skip_handwriting') {
      track('settings.skip_handwriting', { on: true, source: 'row_menu' });
      await saveSkipHandwriting(true).catch(() => undefined);
      undo = async () => {
        track('settings.skip_handwriting', { on: false, source: 'undo' });
        await saveSkipHandwriting(false).catch(() => undefined);
      };
    }
    track('lesson.row_action', { ...props, undo: false });
    changed.current?.(action);
    setOpened(null);
    setToast({
      text: homeworkRowActionToast(action, target),
      undo: homeworkRowActionUndoable(action) && undo
        ? async () => {
          await undo!();
          track('lesson.row_action', { ...props, undo: true });
          changed.current?.(action);
        }
        : null,
    });
  }, [from]);

  const choose = useCallback((action: HomeworkRowAction) => {
    if (!opened || opened.busy) return;
    if (!opened.confirm && homeworkRowActionConfirm(action, opened.target)) {
      setOpened({ ...opened, confirm: action, error: null });
      return;
    }
    const o = { ...opened, busy: true, error: null };
    setOpened(o);
    run(o, action).catch((err: unknown) => {
      const msg = action === 'delete_lesson' ? "Couldn't delete it — are you online?" : err instanceof Error ? err.message : 'Something went wrong';
      setOpened({ ...o, busy: false, error: msg });
    });
  }, [opened, run]);

  const element = (
    <>
      {opened && (
        <RowActionsSheet
          opened={opened}
          onChoose={choose}
          onCancel={() => setOpened(opened.confirm ? { ...opened, confirm: null, error: null } : null)}
          onClose={() => setOpened(null)}
        />
      )}
      {toast && (
        <RowActionToast
          text={toast.text}
          onUndo={toast.undo ? () => { const u = toast.undo!; setToast(null); void u(); } : null}
          onDone={() => setToast(null)}
        />
      )}
    </>
  );
  return { open, element };
}

function RowActionsSheet({ opened, onChoose, onCancel, onClose }: {
  opened: Opened;
  onChoose: (a: HomeworkRowAction) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { target, actions, confirm, busy, error } = opened;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const confirmText = confirm ? homeworkRowActionConfirm(confirm, target) : null;
  return (
    <div className="row-actions-backdrop" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div className="row-actions-sheet" role="dialog" aria-modal="true" aria-label={target.title} onClick={(e) => e.stopPropagation()} data-testid="row-actions-sheet">
        <div className="row-actions-grip" aria-hidden="true" />
        <div className="row-actions-title" lang="zh">{target.title}</div>
        {confirm && confirmText ? (
          <>
            <p className="row-actions-confirm" data-testid="row-actions-confirm">{confirmText}</p>
            {error && <p className="row-actions-error" role="alert">{error}</p>}
            <div className="row-actions-confirm-row">
              <button type="button" className="row-actions-btn row-actions-btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
              <button
                type="button"
                className={`row-actions-btn ${confirm === 'delete_lesson' ? 'row-actions-btn--danger' : 'row-actions-btn--primary'}`}
                onClick={() => onChoose(confirm)}
                disabled={busy}
                data-testid="row-actions-confirm-go"
              >
                {busy ? '…' : homeworkRowActionLabel(confirm, target.kind)}
              </button>
            </div>
          </>
        ) : (
          <>
            {error && <p className="row-actions-error" role="alert">{error}</p>}
            <ul className="row-actions-list">
              {actions.map((a) => (
                <li key={a}>
                  <button
                    type="button"
                    className={`row-actions-item${a === 'delete_lesson' ? ' row-actions-item--danger' : ''}`}
                    onClick={() => onChoose(a)}
                    disabled={busy}
                    data-testid={`row-action-${a}`}
                  >
                    <span className="row-actions-icon" aria-hidden="true">{homeworkRowActionIcon(a)}</span>
                    <span>{homeworkRowActionLabel(a, target.kind)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="row-actions-btn row-actions-btn--secondary row-actions-close" onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function RowActionToast({ text, onUndo, onDone }: { text: string; onUndo: (() => void) | null; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return (
    <div className="row-actions-toast" role="status" data-testid="row-actions-toast">
      <span>{text}</span>
      {onUndo && <button type="button" className="row-actions-toast-undo" onClick={onUndo} data-testid="row-actions-undo">Undo</button>}
    </div>
  );
}

/**
 * The gesture for a row: long-press on touch, right-click with a mouse; `suppressTap()` stops the tap
 * that ends a long press from opening the row.
 */
export function useRowPress(onMenu: () => void): {
  handlers: ReturnType<ReturnType<typeof useLongPress>['bind']> & { onContextMenu: (e: React.MouseEvent) => void };
  suppressTap: () => boolean;
} {
  const { bind, suppressTap } = useLongPress();
  return {
    handlers: {
      ...bind(onMenu),
      onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onMenu(); },
    },
    suppressTap,
  };
}

/** The visible ⋯ next to a row (same menu as the long-press). */
export function RowMenuButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="row-menu-btn" onClick={onClick} aria-label={`More for ${label}`} data-testid="row-menu-btn">
      ⋯
    </button>
  );
}
