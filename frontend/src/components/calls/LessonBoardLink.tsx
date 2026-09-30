/**
 * "📝 Lesson board · 12 pages" on the student / tutor page — the video-call
 * board's pages of this relationship (read from the device, so it shows
 * offline). Hidden until something has been written.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import './BoardPages.css';
import { refreshRelationshipBoardPages } from '../../services/boardPages';

export function LessonBoardLink({ relId }: { relId: string }) {
  // Online: bring the count up to date (pages change in every call).
  useEffect(() => {
    if (navigator.onLine) void refreshRelationshipBoardPages(relId).catch(() => {});
  }, [relId]);
  const count = useLiveQuery(() => db.boardPages.where('relationship_id').equals(relId).count(), [relId]) ?? 0;
  if (count === 0) return null;
  return (
    <Link to={`/connections/${relId}/board`} className="lb-link" data-testid="lesson-board-link">
      <span aria-hidden="true">📝</span>
      <span className="lb-link-text">
        Lesson board <span className="lb-link-count">· {count} page{count === 1 ? '' : 's'}</span>
      </span>
      <span aria-hidden="true" className="lb-link-chevron">›</span>
    </Link>
  );
}
