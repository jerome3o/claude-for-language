/**
 * Lesson attempts — what was answered in each exercise and how long it took.
 *
 * Tutor:   /connections/:relId/lesson-attempts[?lesson=]   the student's attempts
 *          /connections/:relId/lesson-attempts/:attemptId  one attempt
 * Learner: /lesson-attempts[?lesson=]                      my own
 *          /lesson-attempts/:attemptId
 */

import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDuration } from '@shared/lesson';
import { listAttempts, getAttempt, type AttemptSummary } from '../api/lessonPractice';
import { AttemptReview } from '../components/lessonAttempts/AttemptReview';
import { Loading, ErrorMessage } from '../components/Loading';
import { TutorPageFrame, formatDateTime } from './tutor/tutor-shared';
import '../components/lessonAttempts/attempts.css';

function AttemptList({ relId, lessonId }: { relId: string | null; lessonId?: string }) {
  const q = useQuery({
    queryKey: ['lesson-attempts', relId, lessonId ?? null],
    queryFn: () => listAttempts(relId, lessonId),
    retry: 1,
  });
  if (q.isLoading) return <Loading message="Loading attempts…" />;
  if (q.isError) return <ErrorMessage message="Couldn't load the attempts (are you online?)" />;
  const rows: AttemptSummary[] = q.data ?? [];
  if (rows.length === 0) {
    return <p className="text-light">No answers recorded yet. They appear here after a lesson is finished and the device has synced.</p>;
  }
  const base = relId ? `/connections/${relId}/lesson-attempts` : '/lesson-attempts';
  return (
    <div className="att-list">
      {rows.map(r => (
        <Link key={r.id} to={`${base}/${r.id}`} className="att-list-item">
          <span className="att-list-icon">{r.lesson_icon || '🎓'}</span>
          <span className="att-list-main">
            <span className="att-list-title">{r.lesson_title}</span>
            <span className="att-list-meta">
              {formatDateTime(r.completed_at)} · {formatDuration(r.duration_ms)}
              {r.recordings > 0 ? ` · 🎙 ${r.recordings}` : ''}
            </span>
          </span>
          {r.total ? <span className="att-list-score">{r.correct}/{r.total}</span> : null}
          <span aria-hidden="true">›</span>
        </Link>
      ))}
    </div>
  );
}

function AttemptDetailView({ relId, attemptId }: { relId: string | null; attemptId: string }) {
  const q = useQuery({
    queryKey: ['lesson-attempt', relId, attemptId],
    queryFn: () => getAttempt(relId, attemptId),
    retry: 1,
    // A recording may still be transcribing — look again shortly.
    refetchInterval: query => (query.state.data?.media.some(m => m.transcript_status === 'pending') ? 5000 : false),
  });
  if (q.isLoading) return <Loading message="Loading answers…" />;
  if (q.isError || !q.data) return <ErrorMessage message="Couldn't load this attempt (are you online?)" />;
  const a = q.data;
  return (
    <>
      <div className="att-heading">
        <h2 style={{ margin: '0 0 0.25rem' }}>{a.spec.icon || '🎓'} {a.spec.title}</h2>
        <p className="text-light" style={{ margin: '0 0 0.75rem' }}>{formatDateTime(a.completed_at)}</p>
      </div>
      <AttemptReview attempt={a} />
    </>
  );
}

/** Tutor: the list, or one attempt. */
export function StudentLessonAttemptsPage() {
  const { relId = '', attemptId } = useParams<{ relId: string; attemptId?: string }>();
  const [params] = useSearchParams();
  const lessonId = params.get('lesson') ?? undefined;
  return (
    <TutorPageFrame
      relId={relId}
      title={attemptId ? 'Lesson answers' : 'Lesson attempts'}
      backTo={attemptId ? `/connections/${relId}/lesson-attempts` : `/connections/${relId}`}
      backLabel={attemptId ? 'All attempts' : 'Back'}
    >
      {() => (attemptId ? <AttemptDetailView relId={relId} attemptId={attemptId} /> : <AttemptList relId={relId} lessonId={lessonId} />)}
    </TutorPageFrame>
  );
}

/** Learner: my own attempts. */
export function MyLessonAttemptsPage() {
  const { attemptId } = useParams<{ attemptId?: string }>();
  const [params] = useSearchParams();
  const lessonId = params.get('lesson') ?? undefined;
  return (
    <div className="page">
      <div className="container">
        <Link to={attemptId ? '/lesson-attempts' : '/lessons'} className="back-link">← {attemptId ? 'My answers' : 'Mini lessons'}</Link>
        <h1>{attemptId ? 'My answers' : '📝 My lesson answers'}</h1>
        {attemptId ? <AttemptDetailView relId={null} attemptId={attemptId} /> : <AttemptList relId={null} lessonId={lessonId} />}
      </div>
    </div>
  );
}
