/**
 * The graded-reader editor — structured form by default (titles, then page
 * cards with auto-pinyin, auto-translate, illustrate), live validation, the
 * real reading view as preview, a Claude co-editor chat, exports and raw
 * JSON under the overflow menu. Built on the same EditorShell as the lesson
 * editor: side-by-side at ≥1024px, Edit / Preview / Claude tabs on phones.
 *
 * Route: /readers/:id/edit (owner only — readers are per-user).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReaderSpec,
  ReaderDiff,
  ReaderPageSpec,
  validateReaderSpec,
  diffReaderSpecs,
  formatReaderDiff,
  readerToMarkdown,
  readerToJson,
  readerToCsv,
  readerExportFilename,
} from '@shared/reader';
import { canonicalJson } from '@shared/lesson';
import { getReaderSpec, saveReaderSpec } from '../../api/readerEditor';
import { readerAssist } from '../../api/readerEditor';
import { LessonApiError } from '../../api/lessonEditor';
import { deleteGradedReader, generateReaderPageImage } from '../../api/client';
import { syncReadersFromServer, updateLocalReaderPageImage } from '../../services/readerSync';
import { EditorShell, EditorMenuItem } from '../../components/editor/EditorShell';
import { EditorChat } from '../../components/editor/EditorChat';
import { ReaderForm } from '../../components/editor/ReaderForm';
import { ReaderPreview } from '../../components/editor/ReaderPreview';
import { ReaderDiffCard } from '../../components/editor/ReaderDiffCard';
import { RawJsonModal } from '../../components/editor/RawJsonModal';
import { useLessonSpeak } from '../../components/editor/useLessonSpeak';
import { downloadText } from '../../components/editor/download';
import { Loading, ErrorMessage } from '../../components/Loading';
import { useToast } from './LessonEditorPage';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const READER_QUICK_PROMPTS = [
  'Simplify page 2',
  'Add a page where the weather changes',
  'Use 刮风 somewhere',
  'Check the pinyin',
  'Make the ending happier',
];

/**
 * Export formats, array-driven so another format (e.g. Anki .apkg) can be
 * appended with one entry. `run` gets the current (possibly unsaved) spec.
 */
export interface ReaderExportItem {
  label: string;
  run: (ctx: { spec: ReaderSpec; readerId: string; navigate: (to: string, opts?: { state?: unknown }) => void }) => void;
}

const download = (spec: ReaderSpec, format: 'md' | 'json' | 'csv') => {
  const text = format === 'md' ? readerToMarkdown(spec) : format === 'json' ? readerToJson(spec) : readerToCsv(spec);
  const mime = format === 'md' ? 'text/markdown' : format === 'json' ? 'application/json' : 'text/csv';
  downloadText(readerExportFilename(spec, format), text, `${mime};charset=utf-8`);
};

export const READER_EXPORTS: ReaderExportItem[] = [
  { label: '⬇ Export Markdown', run: ({ spec }) => download(spec, 'md') },
  { label: '🖨 Print view', run: ({ spec, readerId, navigate }) => navigate(`/readers/${readerId}/print`, { state: { spec } }) },
  { label: '⬇ Export JSON', run: ({ spec }) => download(spec, 'json') },
  { label: '⬇ Export CSV (Quizlet)', run: ({ spec }) => download(spec, 'csv') },
];

export function ReaderEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const speak = useLessonSpeak();
  const [toast, showToast] = useToast();

  const query = useQuery({
    queryKey: ['reader-spec', id],
    queryFn: () => getReaderSpec(id),
    retry: 1,
  });

  const [spec, setSpec] = useState<ReaderSpec | null>(null);
  const [savedSpec, setSavedSpec] = useState<ReaderSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [pollImages, setPollImages] = useState(0);

  useEffect(() => {
    setSpec(null);
    setSavedSpec(null);
  }, [id]);

  // Adopt the loaded spec once (never clobber in-progress edits on refetch).
  useEffect(() => {
    if (query.data && spec === null) {
      setSpec(clone(query.data.spec));
      setSavedSpec(clone(query.data.spec));
    }
  }, [query.data, spec]);

  const errors = useMemo(() => (spec ? validateReaderSpec(spec) : []), [spec]);
  const saved = savedSpec ? canonicalJson(savedSpec) : '';
  const dirty = spec !== null && canonicalJson(spec) !== saved;

  /** Merge server-side image keys into the working copy without touching edits. */
  const adoptImages = useCallback((server: ReaderSpec) => {
    const keys = new Map(server.pages.filter(p => p.id && p.image_url).map(p => [p.id as string, p.image_url as string]));
    const patch = (s: ReaderSpec | null): ReaderSpec | null => {
      if (!s) return s;
      let changed = false;
      const pages = s.pages.map(p => {
        const key = p.id ? keys.get(p.id) : undefined;
        if (key && p.image_url !== key && (p.image_prompt ?? '') === (server.pages.find(x => x.id === p.id)?.image_prompt ?? '')) {
          changed = true;
          return { ...p, image_url: key };
        }
        return p;
      });
      return changed ? { ...s, pages } : s;
    };
    setSpec(patch);
    setSavedSpec(patch);
  }, []);

  // After a save that queued illustrations, poll for them for a couple of minutes.
  useEffect(() => {
    if (pollImages <= 0) return;
    let ticks = 0;
    const timer = setInterval(async () => {
      ticks++;
      try {
        const fresh = await getReaderSpec(id);
        adoptImages(fresh.spec);
        const pending = fresh.spec.pages.filter(p => p.image_prompt && !p.image_url).length;
        if (pending === 0 || ticks >= 24) setPollImages(0);
      } catch {
        if (ticks >= 24) setPollImages(0);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [pollImages, id, adoptImages]);

  const save = useCallback(async () => {
    if (!spec || errors.length > 0 || saving) return;
    setSaving(true);
    try {
      const result = await saveReaderSpec(id, spec);
      setSpec(clone(result.spec));
      setSavedSpec(clone(result.spec));
      queryClient.invalidateQueries({ queryKey: ['reader-spec', id] });
      queryClient.invalidateQueries({ queryKey: ['reader', id] });
      queryClient.invalidateQueries({ queryKey: ['readers'] });
      // Keep the offline study copy current on this device.
      syncReadersFromServer().catch(() => { /* sync will rebuild it */ });
      if (result.image_jobs) {
        setPollImages(n => n + 1);
        showToast(`Saved — ${result.image_jobs} illustration${result.image_jobs === 1 ? '' : 's'} drawing in the background`);
      } else {
        showToast('Saved');
      }
    } catch (err) {
      const msg = err instanceof LessonApiError && err.problems.length
        ? `Not saved: ${err.problems.join('; ')}`
        : `Not saved: ${err instanceof Error ? err.message : 'unknown error'}`;
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }, [spec, errors.length, saving, id, queryClient, showToast]);

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

  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const assist = online
    ? (field: 'english' | 'image_prompt', chinese: string, english?: string) => readerAssist(id, field, chinese, english)
    : null;
  const illustrate = online
    ? async (page: ReaderPageSpec) => {
        if (!page.id) return null;
        const result = await generateReaderPageImage(id, page.id);
        if (result.image_url) {
          updateLocalReaderPageImage(id, page.id, result.image_url).catch(() => {});
          setSavedSpec(s => (s ? { ...s, pages: s.pages.map(p => (p.id === page.id ? { ...p, image_url: result.image_url } : p)) } : s));
        }
        return result.image_url ?? null;
      }
    : null;

  if (query.isLoading || (query.data && spec === null)) return <Loading message="Loading reader…" />;
  if (query.isError || !spec) {
    return (
      <div className="page"><div className="container">
        <ErrorMessage message={query.error instanceof Error ? query.error.message : 'Reader not found'} />
      </div></div>
    );
  }

  const menu: EditorMenuItem[] = [
    { label: '📖 Read it', onClick: () => navigate(`/readers/${id}`) },
    ...READER_EXPORTS.map((item, i) => ({
      label: item.label,
      section: i === 0,
      onClick: () => item.run({ spec, readerId: id, navigate }),
    })),
    { label: '{ } Advanced: raw JSON', onClick: () => setShowJson(true), section: true },
    {
      label: '🗑 Delete reader',
      danger: true,
      section: true,
      onClick: async () => {
        if (!confirm(`Delete "${spec.title_english || spec.title_chinese}"? This can't be undone.`)) return;
        try {
          await deleteGradedReader(id);
          queryClient.invalidateQueries({ queryKey: ['readers'] });
          syncReadersFromServer().catch(() => {});
          setSavedSpec(spec);
          navigate('/readers');
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Could not delete');
        }
      },
    },
  ];

  const pageCount = spec.pages.length;
  const subtitle = `${pageCount} page${pageCount === 1 ? '' : 's'} · ${spec.difficulty_level}${query.data?.is_published === 0 ? ' · draft' : ''}`;

  return (
    <>
      <EditorShell
        title={spec.title_chinese || spec.title_english}
        subtitle={subtitle}
        backTo="/readers"
        dirty={dirty}
        saving={saving}
        canSave={errors.length === 0}
        saveBlockedHint={`${errors.length} problem${errors.length === 1 ? '' : 's'} to fix`}
        onSave={save}
        menu={menu}
        edit={
          <ReaderForm
            spec={spec}
            onChange={setSpec}
            errors={errors}
            speak={speak}
            savedSpec={savedSpec}
            assist={assist}
            illustrate={illustrate}
          />
        }
        preview={<ReaderPreview spec={spec} speak={speak} />}
        chat={
          <EditorChat<ReaderSpec, ReaderDiff>
            target="reader"
            targetId={id}
            currentSpec={spec}
            quickPrompts={READER_QUICK_PROMPTS}
            pendingChanges={(a, b) => formatReaderDiff(diffReaderSpecs(a, b))}
            renderDiff={diff => <ReaderDiffCard diff={diff} />}
            subject="co-editor for this reader"
            emptyHint="Ask for changes in plain words — “simplify page 2”, “add a page where they go home”, “use 刮风 somewhere”. Claude answers with a proposal you can accept or reject."
            onAcceptProposal={next => {
              setSpec(next);
              showToast('Proposal applied — press Save to keep it');
            }}
          />
        }
      />
      {showJson && (
        <RawJsonModal<ReaderSpec>
          spec={spec}
          validate={validateReaderSpec}
          subject="reader"
          onApply={next => { setSpec(next); setShowJson(false); }}
          onClose={() => setShowJson(false)}
        />
      )}
      {toast && <div className="ed-toast" role="status">{toast}</div>}
    </>
  );
}
