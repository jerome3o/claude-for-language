/**
 * The lesson editor — for a student's own lesson, a lesson a tutor
 * assigned, or a tutor's library item. Structured form by default, live
 * validation, real-component preview, Claude co-editor chat, exports and
 * raw JSON under the overflow menu.
 *
 * Routes: /lessons/:id/edit (target "lesson"), /library/:id/edit ("library").
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CustomLessonSpec,
  validateLessonSpec,
  canonicalJson,
  lessonToMarkdown,
  lessonToJson,
  lessonToCsv,
  lessonExportFilename,
} from '@shared/lesson';
import {
  getEditableLesson,
  saveEditableLesson,
  getLibraryItem,
  updateLibraryItem,
  duplicateLibraryItem,
  archiveLibraryItem,
  LessonApiError,
} from '../../api/lessonEditor';
import { deleteCustomLessonById } from '../../api/client';
import { db } from '../../db/database';
import type { EditorTargetType } from '../../types/lessonEditor';
import { EditorShell, EditorMenuItem } from '../../components/editor/EditorShell';
import { EditorChat } from '../../components/editor/EditorChat';
import { LessonForm } from '../../components/editor/LessonForm';
import { LessonPreview } from '../../components/editor/LessonPreview';
import { RawJsonModal } from '../../components/editor/RawJsonModal';
import { useLessonSpeak } from '../../components/editor/useLessonSpeak';
import { downloadText } from '../../components/editor/download';
import { AnkiExportModal } from '../../components/export/AnkiExportModal';
import { Loading, ErrorMessage } from '../../components/Loading';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function useToast(): [string | null, (msg: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, setToast];
}

interface LoadedTarget {
  spec: CustomLessonSpec;
  is_owner: boolean;
  /** A student's copy of a tutor's library item. */
  assigned: boolean;
}

async function loadTarget(target: EditorTargetType, id: string): Promise<LoadedTarget> {
  if (target === 'library') {
    const item = await getLibraryItem(id);
    return { spec: item.spec, is_owner: true, assigned: false };
  }
  const lesson = await getEditableLesson(id);
  return { spec: lesson.spec, is_owner: lesson.is_owner, assigned: !!lesson.library_item_id };
}

export function LessonEditorPage({ target }: { target: EditorTargetType }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const speak = useLessonSpeak();
  const [toast, showToast] = useToast();

  const query = useQuery({
    queryKey: [target === 'library' ? 'library-item' : 'editable-lesson', id],
    queryFn: () => loadTarget(target, id),
    retry: 1,
  });

  const [spec, setSpec] = useState<CustomLessonSpec | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [showAnki, setShowAnki] = useState(false);

  // A different lesson under the same route (duplicate, back button) starts fresh.
  useEffect(() => {
    setSpec(null);
    setSaved('');
  }, [id, target]);

  // Adopt the loaded spec once (never clobber in-progress edits on refetch).
  useEffect(() => {
    if (query.data && spec === null) {
      setSpec(clone(query.data.spec));
      setSaved(canonicalJson(query.data.spec));
    }
  }, [query.data, spec]);

  const errors = useMemo(() => (spec ? validateLessonSpec(spec) : []), [spec]);
  const dirty = spec !== null && canonicalJson(spec) !== saved;
  const isOwner = query.data?.is_owner ?? true;
  const backTo = target === 'library' ? `/library/${id}` : '/lessons';

  const save = useCallback(async () => {
    if (!spec || errors.length > 0 || saving) return;
    setSaving(true);
    try {
      if (target === 'library') {
        const item = await updateLibraryItem(id, spec);
        setSpec(clone(item.spec));
        setSaved(canonicalJson(item.spec));
        queryClient.invalidateQueries({ queryKey: ['library-item', id] });
        queryClient.invalidateQueries({ queryKey: ['lesson-library'] });
      } else {
        const lesson = await saveEditableLesson(id, spec);
        setSpec(clone(lesson.spec));
        setSaved(canonicalJson(lesson.spec));
        queryClient.invalidateQueries({ queryKey: ['editable-lesson', id] });
        queryClient.invalidateQueries({ queryKey: ['custom-lessons-all'] });
        // Keep the offline study copy current on this device.
        try {
          if (await db.customLessons.get(id)) {
            await db.customLessons.update(id, {
              title: lesson.spec.title,
              description: lesson.spec.description ?? null,
              icon: lesson.spec.icon ?? null,
              spec: lesson.spec,
            });
          }
        } catch {
          // IndexedDB is a cache; sync will rebuild it.
        }
      }
      showToast('Saved');
    } catch (err) {
      const msg = err instanceof LessonApiError && err.problems.length
        ? `Not saved: ${err.problems.join('; ')}`
        : `Not saved: ${err instanceof Error ? err.message : 'unknown error'}`;
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }, [spec, errors.length, saving, target, id, queryClient, showToast]);

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  if (query.isLoading || (query.data && spec === null)) return <Loading message="Loading lesson…" />;
  if (query.isError || !spec) {
    return (
      <div className="page"><div className="container">
        <ErrorMessage message={query.error instanceof Error ? query.error.message : 'Lesson not found'} />
      </div></div>
    );
  }

  const exportAs = (format: 'md' | 'json' | 'csv') => {
    const text = format === 'md' ? lessonToMarkdown(spec) : format === 'json' ? lessonToJson(spec) : lessonToCsv(spec);
    const mime = format === 'md' ? 'text/markdown' : format === 'json' ? 'application/json' : 'text/csv';
    downloadText(lessonExportFilename(spec, format), text, `${mime};charset=utf-8`);
  };

  const menu: EditorMenuItem[] = [];
  if (target === 'library') {
    menu.push({
      label: '⧉ Duplicate',
      onClick: async () => {
        try {
          const copy = await duplicateLibraryItem(id);
          queryClient.invalidateQueries({ queryKey: ['lesson-library'] });
          navigate(`/library/${copy.id}/edit`);
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Could not duplicate');
        }
      },
    });
  }
  menu.push(
    { label: '⬇ Export Markdown', onClick: () => exportAs('md'), section: true },
    {
      label: '🖨 Print view',
      onClick: () => navigate(target === 'library' ? `/library/${id}/print` : `/lessons/${id}/print`, { state: { spec } }),
    },
    { label: '⬇ Export JSON', onClick: () => exportAs('json') },
    { label: '⬇ Export CSV (Quizlet)', onClick: () => exportAs('csv') },
    { label: '⬇ Export Anki (.apkg)', onClick: () => setShowAnki(true) },
    { label: '{ } Advanced: raw JSON', onClick: () => setShowJson(true), section: true },
  );
  if (isOwner) {
    menu.push({
      label: target === 'library' ? '🗄 Archive' : '🗑 Delete lesson',
      danger: true,
      section: true,
      onClick: async () => {
        if (target === 'library') {
          if (!confirm(`Archive "${spec.title}"? Students keep their copies.`)) return;
          await archiveLibraryItem(id);
          queryClient.invalidateQueries({ queryKey: ['lesson-library'] });
          setSaved(canonicalJson(spec));
          navigate('/library');
        } else {
          if (!confirm(`Delete "${spec.title}"? This can't be undone.`)) return;
          await deleteCustomLessonById(id);
          try { await db.customLessons.delete(id); } catch { /* cache only */ }
          queryClient.invalidateQueries({ queryKey: ['custom-lessons-all'] });
          setSaved(canonicalJson(spec));
          navigate('/lessons');
        }
      },
    });
  }

  const subtitle = target === 'library'
    ? 'Library master copy'
    : !isOwner
      ? "Student's lesson (you assigned it)"
      : query.data?.assigned
        ? 'Assigned by your tutor — your copy'
        : 'Your lesson';

  return (
    <>
      <EditorShell
        title={spec.title}
        subtitle={subtitle}
        backTo={backTo}
        dirty={dirty}
        saving={saving}
        canSave={errors.length === 0}
        saveBlockedHint={`${errors.length} problem${errors.length === 1 ? '' : 's'} to fix`}
        onSave={save}
        menu={menu}
        edit={<LessonForm spec={spec} onChange={setSpec} errors={errors} speak={speak} />}
        preview={<LessonPreview spec={spec} speak={speak} />}
        chat={
          <EditorChat
            target={target}
            targetId={id}
            currentSpec={spec}
            onAcceptProposal={next => {
              setSpec(next);
              showToast('Proposal applied — press Save to keep it');
            }}
          />
        }
      />
      {showJson && <RawJsonModal spec={spec} onApply={next => { setSpec(next); setShowJson(false); }} onClose={() => setShowJson(false)} />}
      {showAnki && <AnkiExportModal target={{ kind: 'lesson', spec, sourceId: id }} onClose={() => setShowAnki(false)} />}
      {toast && <div className="ed-toast" role="status">{toast}</div>}
    </>
  );
}
