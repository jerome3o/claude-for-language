import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { insertIntoOrder, upNextIndex, upNextStatusLabel } from '@shared/decks';
import { addUpNextApi, listUpNextApi, removeUpNextApi, reorderUpNextApi, searchStudentNotesApi, type ApiUpNext } from '../../api/upNext';
import { getRelationship } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { getOtherUserInRelationship } from '../../types';
import { track } from '../../services/analytics';
import { UndoToast, UpNextBoard, type UpNextSearchHit, type UpNextViewRow } from '../../components/upNext/UpNextBoard';
import { Loading, ErrorMessage } from '../../components/Loading';
import '../../components/upNext/upNext.css';

/**
 * The tutor's view of a student's "Up next" list (`/connections/:relId/up-next`): the words
 * introduced first within the student's daily budget, in order. She can search the student's
 * cards and add (top / bottom / drag into place), reorder and remove — online, through
 * /api/relationships/:relId/student-up-next. The student sees "added by <tutor>".
 */
export function StudentUpNextPage() {
  const { relId = '' } = useParams();
  const { user } = useAuth();
  const relQuery = useQuery({ queryKey: ['relationship', relId], queryFn: () => getRelationship(relId), enabled: !!relId });
  const student = relQuery.data && user ? getOtherUserInRelationship(relQuery.data, user.id) : null;
  const name = student?.name || 'your student';
  const [list, setList] = useState<ApiUpNext[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const load = useCallback(async () => {
    try {
      setList((await listUpNextApi(relId)).up_next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the list');
    }
  }, [relId]);
  useEffect(() => { void load(); }, [load]);

  const rows: UpNextViewRow[] = useMemo(() => (list ?? []).map((e) => ({
    noteId: e.note_id,
    hanzi: e.hanzi,
    pinyin: e.pinyin,
    english: e.english,
    deckName: e.deck_name,
    status: upNextStatusLabel(e.status, e.new_cards),
    addedBy: e.added_by_name && e.added_by !== user?.id ? e.added_by_name : e.added_by === user?.id ? 'you' : null,
  })), [list, user?.id]);

  const run = async (fn: () => Promise<ApiUpNext[]>, done?: string) => {
    try {
      setList(await fn());
      if (done) setToast({ text: done });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : 'Something went wrong' });
      void load();
    }
  };

  const onReorder = (order: string[], how: 'drag' | 'top') => {
    const byId = new Map((list ?? []).map((e) => [e.note_id, e]));
    setList(order.map((id) => byId.get(id)!).filter(Boolean)); // at once; the answer replaces it
    track('study.up_next_moved', { how });
    void run(async () => (await reorderUpNextApi(order, relId)).up_next);
  };

  const onRemove = async (noteId: string) => {
    const index = (list ?? []).findIndex((e) => e.note_id === noteId);
    const hanzi = list?.[index]?.hanzi ?? '';
    track('study.up_next_removed', { source: 'tutor' });
    await run(async () => (await removeUpNextApi(noteId, relId)).up_next);
    setToast({
      text: `Removed ${hanzi} from ${name}’s Up next`,
      undo: () => void run(async () => (await addUpNextApi({ note_ids: [noteId], position: index }, relId)).up_next),
    });
  };

  const onAdd = (noteId: string, position: 'top' | 'bottom' | number) => {
    if (typeof position === 'number' && list) {
      // Show the drop at once.
      const placeholder = { note_id: noteId } as ApiUpNext;
      setList(insertIntoOrder(list.map((e) => e.note_id), [noteId], upNextIndex(position, list.length))
        .map((id) => list.find((e) => e.note_id === id) ?? placeholder)
        .filter((e) => e.hanzi !== undefined));
    }
    void run(async () => {
      const r = await addUpNextApi({ note_ids: [noteId], position }, relId);
      if (r.added.length) setToast({ text: `↑ ${r.added[0].hanzi} is up next for ${name}` });
      else if (r.no_new_cards.length) setToast({ text: `${name} has already studied every card of that word` });
      return r.up_next;
    });
  };

  const search = useCallback(async (q: string): Promise<UpNextSearchHit[]> => {
    const { notes } = await searchStudentNotesApi(relId, q);
    return notes.map((n) => ({
      noteId: n.id, hanzi: n.hanzi, pinyin: n.pinyin, english: n.english, deckName: n.deck_name,
      onList: n.on_up_next, studied: n.new_cards === 0,
    }));
  }, [relId]);

  return (
    <div className="page">
      <div className="container upnext-page" data-testid="student-upnext-page">
        <Link to={`/connections/${relId}`} className="back-link">← {student?.name ?? 'Student'}</Link>
        <h1>{student?.name ? `${student.name}’s Up next` : 'Up next'}</h1>
        <p className="upnext-intro">
          The words {name} learns next: they take the first of {name}’s daily new cards, in this order. Nothing is sent and
          nothing extra is added — only the order of {name}’s own cards changes.
        </p>
        {error && !list ? (
          <ErrorMessage message={error} />
        ) : !list ? (
          <Loading />
        ) : (
          <UpNextBoard
            rows={rows}
            onReorder={onReorder}
            onRemove={(id) => void onRemove(id)}
            onAdd={onAdd}
            search={search}
            searchPlaceholder={`Search ${name}’s cards…`}
            emptyText={`Nothing chosen yet — search above to pick the words ${name} learns next.`}
            readOnlyReason={online ? null : 'You’re offline — the list can be changed again once you’re back online.'}
          />
        )}
      </div>
      {toast && <UndoToast text={toast.text} onUndo={() => { toast.undo?.(); setToast(null); }} onDone={() => setToast(null)} hideUndo={!toast.undo} />}
    </div>
  );
}
