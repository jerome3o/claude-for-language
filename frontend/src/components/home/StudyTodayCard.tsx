import { useEffect, useRef, useState } from 'react';
import type { QueueCounts } from '../../types';
import { describeDue, breakdownRows } from './studyEstimate';

interface StudyTodayCardProps {
  counts: QueueCounts;
  totalDue: number;
  /** Counts are still loading and nothing is cached. */
  isLoading: boolean;
  /** A full sync has completed at least once on this device (undefined = unknown yet). */
  hasSyncedOnce: boolean | undefined;
  isSyncing: boolean;
  isOnline: boolean;
  hasDecks: boolean;
  hasMoreNew: boolean;
  onStudy: () => void;
  onMoreNew: () => void;
}

/**
 * The one thing the home is for: a Study button with a plain-words subtitle.
 * The four-colour queue arithmetic lives behind the ⓘ (and in the session
 * header, untouched).
 */
export function StudyTodayCard({
  counts, totalDue, isLoading, hasSyncedOnce, isSyncing, isOnline, hasDecks, hasMoreNew, onStudy, onMoreNew,
}: StudyTodayCardProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showBreakdown) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setShowBreakdown(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowBreakdown(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [showBreakdown]);

  if (isLoading) {
    return (
      <div className="card home-study-card" aria-busy="true">
        <div className="home-study-loading">
          <span className="spinner home-spinner" />
          <span className="text-light">Loading cards…</span>
        </div>
      </div>
    );
  }

  if (totalDue > 0) {
    const rows = breakdownRows(counts).filter(r => r.count > 0);
    return (
      <div className="card home-study-card">
        <button type="button" className="btn btn-primary btn-lg btn-block home-study-btn" onClick={onStudy}>
          Study today's cards
        </button>
        <div className="home-study-subtitle" ref={popoverRef}>
          <span>{describeDue(totalDue)}</span>
          <button
            type="button"
            className="home-info-btn"
            aria-label="What's in today's cards"
            aria-expanded={showBreakdown}
            onClick={() => setShowBreakdown(v => !v)}
          >
            ⓘ
          </button>
          {showBreakdown && (
            <div className="home-breakdown" role="dialog" aria-label="Today's cards">
              <ul>
                {rows.map(row => (
                  <li key={row.key}>
                    <span className="home-breakdown-dot" style={{ background: row.color }} aria-hidden="true" />
                    <strong>{row.count}</strong> {row.label}
                  </li>
                ))}
              </ul>
              <p className="home-breakdown-note">
                Same order as the session header. New words are limited per day; Again puts a card back into learning.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Nothing due. Only claim "done" once this device has really synced —
  // an empty cache on a fresh phone is not a finished day.
  if (!hasSyncedOnce || (!hasDecks && isSyncing)) {
    return (
      <div className="card home-study-card">
        <div className="home-study-loading">
          {isOnline ? <span className="spinner home-spinner" /> : <span aria-hidden="true">📡</span>}
          <span className="text-light">
            {isOnline ? 'Getting your words…' : 'Connect to the internet once to download your words.'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="card home-study-card">
      <button type="button" className="btn btn-secondary btn-lg btn-block home-study-btn" onClick={onStudy}>
        ✓ Flashcards done
      </button>
      <div className="home-study-subtitle">
        {hasMoreNew ? (
          <button type="button" className="btn-link home-more-link" onClick={onMoreNew}>
            Study 10 more new cards
          </button>
        ) : (
          <span>Nothing due right now — see you tomorrow.</span>
        )}
      </div>
    </div>
  );
}
