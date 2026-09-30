/**
 * The Lesson board (/connections/:relId/board): every page the tutor and the
 * student have written on the video-call board, read-only, with the same
 * numbered strip as in a call. Pages come from the device first (IndexedDB,
 * filled by the sync — so past pages open offline) and are refreshed when
 * online. Read-only by design: pages are written in a call, where the call room
 * merges both people's typing; a second writer here could not be merged in.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { pagePreview } from '@shared/calls';
import { cachedBoardPages, refreshRelationshipBoardPages } from '../services/boardPages';
import { BoardPageStrip } from '../components/calls/BoardPageStrip';
import '../components/calls/BoardPages.css';
import './LessonBoardPage.css';

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function LessonBoardPage() {
  const { relId = '' } = useParams<{ relId: string }>();
  const [params, setParams] = useSearchParams();
  const pages = useLiveQuery(() => cachedBoardPages(relId), [relId]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Online: bring this relationship's pages up to date on the device.
  useEffect(() => {
    if (!relId || !navigator.onLine) return;
    let alive = true;
    setRefreshing(true);
    refreshRelationshipBoardPages(relId)
      .catch((err: unknown) => {
        if (alive) setRefreshError(err instanceof Error ? err.message : 'Could not load the board');
      })
      .finally(() => alive && setRefreshing(false));
    return () => {
      alive = false;
    };
  }, [relId]);

  const selectedId = params.get('page');
  const current = useMemo(() => {
    if (!pages || pages.length === 0) return null;
    return pages.find((p) => p.id === selectedId) ?? pages[pages.length - 1];
  }, [pages, selectedId]);

  const stripPages = useMemo(() => (pages ?? []).map((p) => ({ id: p.id, title: p.title, preview: pagePreview(p.text) })), [pages]);

  const open = (id: string) => {
    setCopied(false);
    setParams({ page: id }, { replace: true });
  };

  return (
    <div className="page lb-page">
      <div className="container lb-container">
        <div className="lb-head">
          <Link to={`/connections/${relId}`} className="lb-back" aria-label="Back">
            ←
          </Link>
          <div className="lb-titles">
            <h1>Lesson board</h1>
            <p className="lb-sub">
              {pages === undefined ? 'Loading…' : `${pages.length} page${pages.length === 1 ? '' : 's'}`}
              {refreshing && pages && pages.length > 0 ? ' · updating…' : ''}
            </p>
          </div>
        </div>

        {pages && pages.length === 0 && (
          <div className="lb-empty" data-testid="lesson-board-empty">
            {refreshing ? 'Loading the board…' : refreshError && !navigator.onLine ? 'You’re offline and this board isn’t on this device yet.' : 'Nothing written on the board yet — it fills up in your video lessons.'}
          </div>
        )}

        {current && pages && pages.length > 0 && (
          <div className="lb-strip">
            <BoardPageStrip pages={stripPages} current={current.id} onOpen={open} />
          </div>
        )}

        {current && (
          <article className="lb-paper" data-testid="lesson-board-page">
            <header className="lb-paper-head">
              <div>
                <h2>{current.title || `Page ${current.number}`}</h2>
                <span className="lb-date">{dayLabel(current.created_at)}{current.updated_at - current.created_at > 60 * 60_000 ? ` · last written ${dayLabel(current.updated_at)}` : ''}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary lb-copy"
                disabled={!current.text}
                onClick={() => {
                  void navigator.clipboard?.writeText(current.text).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy text'}
              </button>
            </header>
            {current.text.trim() ? (
              <div className="lb-text" lang="zh">
                {current.text}
              </div>
            ) : (
              <p className="lb-blank">This page is empty.</p>
            )}
            <p className="lb-note">Pages are written during video calls — you both see every page here.</p>
          </article>
        )}
      </div>
    </div>
  );
}

export default LessonBoardPage;
