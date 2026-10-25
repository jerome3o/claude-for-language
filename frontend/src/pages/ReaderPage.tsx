import { useCallback, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNativeOutputHold } from '../hooks/useNativeOutputHold';
import { useQuery } from '@tanstack/react-query';
import { getGradedReader, markDailyActivity } from '../api/client';
import { db } from '../db/database';
import { recordReaderFinish } from '../services/reader-study';
import { syncService } from '../services/sync';
import { Loading } from '../components/Loading';
import { AnkiExportButton } from '../components/export/AnkiExportModal';
import { ReaderView, type ReaderViewData } from '../components/reader/ReaderView';
import { DifficultyLevel } from '../types';
import './ReaderPage.css';

const DIFFICULTY_COLORS: Record<DifficultyLevel, { bg: string; text: string; label: string }> = {
  beginner: { bg: '#dcfce7', text: '#166534', label: 'Beginner' },
  elementary: { bg: '#dbeafe', text: '#1e40af', label: 'Elementary' },
  intermediate: { bg: '#fef3c7', text: '#92400e', label: 'Intermediate' },
  advanced: { bg: '#fce7f3', text: '#9d174d', label: 'Advanced' },
};

/**
 * `/readers/:id` — a story opened from the Readers list (or a folder). It is the
 * SAME reading view as the study session's daily reader and a homework pass
 * (components/reader/ReaderView.tsx): listen-first pages, the phrase-block
 * scrubber, ▶ Play whole story, the speed chip, word chips → the explorer, and
 * Finish ✓. Only the top bar differs (← back, Edit, ⬇ Anki, the difficulty).
 * Finishing (or listening to the end) is a read exactly like in the session: a
 * reader review event (so the daily rule never offers it again), homework done,
 * and the day's reader mark. Offline-first: the copy on the device is read when
 * there is one; the server's otherwise (and while it is still being written).
 */
export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useNativeOutputHold();
  const [finishing, setFinishing] = useState(false);

  const local = useLiveQuery(async () => (id ? (await db.readers.get(id)) ?? null : null), [id]);
  const localReady = !!local && local.status === 'ready' && local.pages.length > 0;

  const readerQuery = useQuery({
    queryKey: ['reader', id],
    queryFn: () => getGradedReader(id!),
    enabled: !!id && local !== undefined && !localReady,
    refetchInterval: (q) =>
      q.state.data?.status === 'generating' || (q.state.data && q.state.data.pages.length === 0)
        ? 3000
        : false,
  });

  const handleBack = useCallback(() => navigate('/readers'), [navigate]);

  const handleFinish = useCallback((timeSpentMs: number) => {
    if (!id) return;
    setFinishing(true);
    // Read once, like the session: the review event (the daily rule skips it from now on), homework done…
    void recordReaderFinish(id, timeSpentMs)
      .catch(err => console.error('[ReaderPage] Recording the finish failed:', err))
      .finally(() => {
        // …and the day's reader mark (streaks) — best effort, offline just skips it.
        if (navigator.onLine) {
          markDailyActivity('reader', id).catch(() => {});
          syncService.syncEvents().catch(console.error);
        }
        handleBack();
      });
  }, [id, handleBack]);

  const server = readerQuery.data;
  const reader: (ReaderViewData & { difficulty_level: string }) | null = localReady
    ? local
    : server && server.status !== 'generating' && server.pages.length > 0
      ? server
      : null;

  if (local === undefined || (!reader && readerQuery.isLoading)) {
    return <Loading />;
  }

  if (!reader && (readerQuery.error || !server)) {
    return (
      <div className="page">
        <div className="container">
          <div className="card" style={{ textAlign: 'center' }}>
            <p style={{ color: '#dc2626', marginBottom: '1rem' }}>
              {navigator.onLine ? 'Failed to load reader.' : "This story isn't on the device yet — open it again when you're online."}
            </p>
            <Link to="/readers" className="btn btn-primary">
              Back to Readers
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!reader) {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: 'center', paddingTop: '3rem' }}>
          <span className="spinner" />
          <p className="text-light mt-2">Generating your reader…</p>
          <p className="text-light">{server?.title_english}</p>
        </div>
      </div>
    );
  }

  const difficultyStyle = DIFFICULTY_COLORS[reader.difficulty_level as DifficultyLevel] ?? DIFFICULTY_COLORS.beginner;

  return (
    // The session's full-screen frame (index.css), so the page sits exactly where the session's does.
    <div className="study-page-fullscreen">
    <ReaderView
      reader={reader}
      source="library"
      isFinishing={finishing}
      onFinish={handleFinish}
      topbarStart={(
        <button type="button" className="study-close-btn reader-view-back" onClick={handleBack} aria-label="Back to readers">
          &larr;
        </button>
      )}
      topbarEnd={(
        <div className="reader-view-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(`/readers/${reader.id}/edit`)}
          >
            Edit
          </button>
          <AnkiExportButton
            target={{ kind: 'reader', readerId: reader.id, title: reader.title_chinese }}
            className="btn btn-secondary btn-sm"
          >
            ⬇ Anki
          </AnkiExportButton>
          <span
            className="reader-difficulty-badge"
            style={{ backgroundColor: difficultyStyle.bg, color: difficultyStyle.text }}
          >
            {difficultyStyle.label}
          </span>
        </div>
      )}
    />
    </div>
  );
}
