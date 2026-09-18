/**
 * Self-contained "Lessons" section for the tutor's view of a connection:
 * the student's mini lessons (assigned by me / by another tutor / their own),
 * with completion stats, an Edit link for lessons I assigned, and a link to
 * the library to assign more. Renders nothing for non-tutors.
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getStudentLessons } from '../../api/lessonEditor';
import { Loading } from '../Loading';

const RATING_LABELS: Record<number, string> = { 0: 'Again', 1: 'Hard', 2: 'Good', 3: 'Easy' };

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function StudentLessonsSection({ relId, isTutor }: { relId: string; isTutor: boolean }) {
  const lessons = useQuery({
    queryKey: ['student-lessons', relId],
    queryFn: () => getStudentLessons(relId),
    enabled: isTutor,
    retry: 1,
  });
  if (!isTutor) return null;

  const rows = lessons.data ?? [];
  return (
    <div className="detail-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Mini Lessons</h2>
        <Link to="/library" className="btn btn-secondary btn-sm">📚 Assign from library</Link>
      </div>
      {lessons.isLoading && <Loading message="Loading lessons…" />}
      {lessons.isError && <p className="text-light">Couldn't load the student's lessons.</p>}
      {lessons.data && rows.length === 0 && (
        <p className="text-light" style={{ marginTop: '0.5rem' }}>No mini lessons yet. Assign one from your library.</p>
      )}
      {rows.length > 0 && (
        <div className="shared-decks-list" style={{ marginTop: '0.5rem' }}>
          {rows.map(l => (
            <div key={l.id} className="shared-deck-item">
              <div className="shared-deck-info">
                <span className="shared-deck-name">{l.icon || '🎓'} {l.title}</span>
                <span className="shared-deck-meta">
                  {l.assigned_by_me ? 'Assigned by you' : l.assigned_by ? 'Assigned by another tutor' : `From ${l.source}`}
                  {' • '}{l.exercise_count} exercises
                  {' • '}{l.completions === 0 ? 'not studied yet' : `studied ${l.completions}× · last ${l.last_rating !== null ? RATING_LABELS[l.last_rating] : ''} ${when(l.last_completed_at)}`}
                </span>
              </div>
              {l.assigned_by_me && (
                <Link to={`/lessons/${l.id}/edit`} className="btn btn-link btn-sm">✏️ Edit</Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
