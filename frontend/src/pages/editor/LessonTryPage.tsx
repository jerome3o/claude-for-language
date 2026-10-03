import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { track } from '../../services/analytics';
import { useQuery } from '@tanstack/react-query';
import { getLibraryItem } from '../../api/lessonEditor';
import { StudyCustomLesson } from '../../components/StudyCustomLesson';
import { Loading } from '../../components/Loading';
import type { LocalCustomLesson } from '../../db/database';
import { CardQueue, IntervalPreview, Rating } from '../../types';
import '../StudyPage.css';
import '../DeckTryPage.css';

const NO_PREVIEWS = {} as Record<Rating, IntervalPreview>;
const NO_COUNTS = { new: 0, secondaryNew: 0, learning: 0, review: 0 };

/**
 * "Try it" for a library lesson: the real lesson player the student gets, in
 * preview mode — no counts, no rating, no completion event. Nothing is saved.
 */
export function LessonTryPage() {
  const { id } = useParams<{ id: string }>();
  useEffect(() => { track('tutor.try_as_student', { kind: 'lesson' }); }, [id]);
  const navigate = useNavigate();
  const item = useQuery({ queryKey: ['library-item', id], queryFn: () => getLibraryItem(id!), enabled: !!id, retry: false });
  const back = () => navigate(id ? `/library/${id}` : '/library');

  const lesson = useMemo<LocalCustomLesson | null>(() => {
    if (!item.data) return null;
    return {
      id: item.data.id,
      title: item.data.spec.title || item.data.title,
      description: item.data.description,
      icon: item.data.icon,
      source: 'preview',
      status: 'active',
      created_at: item.data.created_at,
      spec: item.data.spec,
      queue: CardQueue.NEW,
      stability: 0,
      difficulty: 0,
      lapses: 0,
      interval: 0,
      repetitions: 0,
      next_review_at: null,
      due_timestamp: null,
      last_reviewed_at: null,
      _synced_at: null,
    };
  }, [item.data]);

  if (item.isLoading) return <Loading />;
  if (!lesson) {
    return (
      <div className="deck-try">
        <p className="deck-try-empty">{item.error instanceof Error ? item.error.message : 'Lesson not found.'}</p>
        <button type="button" className="btn btn-secondary" onClick={back}>Back</button>
      </div>
    );
  }

  return (
    <div className="study-page-fullscreen">
      <StudyCustomLesson
        lesson={lesson}
        intervalPreviews={NO_PREVIEWS}
        counts={NO_COUNTS}
        onComplete={back}
        onEnd={back}
        preview
      />
    </div>
  );
}
