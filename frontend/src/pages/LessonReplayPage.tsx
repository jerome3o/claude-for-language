/**
 * `/lessons/:id/play` — "▶ Do it again" / "▶ Start" on a mini lesson outside the
 * study session (the Mini Lessons page, a finished homework pass; `?from=`).
 *
 * The real player (StudyCustomLesson) with the replay rule (`replayIsPractice`,
 * shared/study/revisit.ts — the /tutor-notes/practice rule for lessons):
 * - due today (new, or due by the cutoff): a normal run — the rating records the
 *   completion (the attempt reaches the tutor, "revisit later" pacing, homework done);
 * - not due (finished, coming back later, or Done for good): the same ratings plus
 *   "Practice only", which records nothing. Rating it anyway is a normal completion.
 * Closing (✕) records nothing either way. Works offline for cached lessons.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { replayIsPractice } from '@shared/study/revisit';
import { db, getStudyCutoff } from '../db/database';
import { StudyCustomLesson } from '../components/StudyCustomLesson';
import { completeCustomLesson, getCustomLessonIntervalPreviews, syncCustomLessons } from '../services/custom-lesson-study';
import { rowRevisitState } from '../services/revisit';
import { track } from '../services/analytics';
import { lockedLessonLine, unlockButtonLabel } from '@shared/lesson';
import { lockStatusOf, unlockLesson } from '../services/lessonUnlock';
import { Confetti } from '../components/Confetti';
import './StudyPage.css';

const FROM = new Set(['lessons_page', 'homework', 'today', 'player']);

export function LessonReplayPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const from = FROM.has(params.get('from') ?? '') ? (params.get('from') as string) : 'lessons_page';
  const navigate = useNavigate();
  const lesson = useLiveQuery(async () => (await db.customLessons.get(id)) ?? null, [id]);
  const previews = useMemo(() => (lesson ? getCustomLessonIntervalPreviews(lesson) : null), [lesson]);
  // Decided once, when the lesson is first read: a rating mid-page doesn't flip it.
  const [practice, setPractice] = useState<boolean | null>(null);
  const [finished, setFinished] = useState<'rated' | 'practice' | null>(null);

  useEffect(() => {
    if (!lesson || practice !== null) return;
    const p = replayIsPractice(rowRevisitState(lesson), getStudyCutoff().ts);
    setPractice(p);
    track('lesson.replay', { from, practice: p });
  }, [lesson, practice, from]);

  const exit = () => navigate(-1);

  if (lesson === undefined || (lesson && practice === null)) return <div className="study-fullscreen" />;
  if (!lesson || !previews) {
    return (
      <div className="study-fullscreen">
        <div className="study-topbar">
          <span className="study-topbar-label">Mini lesson</span>
          <div className="study-topbar-controls">
            <button className="study-close-btn" onClick={exit} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="study-card-content" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <p>This lesson isn&rsquo;t on this device yet — it comes with the next sync.</p>
          <button className="btn btn-primary" onClick={exit}>Back</button>
        </div>
      </div>
    );
  }

  // A LOCKED lesson (shared/lesson/unlock.ts): what unlocks it, and the button.
  if (lesson.unlock && lockStatusOf(lesson) === 'locked') {
    return (
      <div className="study-fullscreen" data-testid="lesson-locked-gate">
        <div className="study-topbar">
          <span className="study-topbar-label">Mini lesson</span>
          <div className="study-topbar-controls">
            <button className="study-close-btn" onClick={exit} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="study-card-content" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <div style={{ fontSize: '3.5rem' }}>🔒</div>
          <h2>{lesson.title}</h2>
          <p className="text-light">{lockedLessonLine(lesson.unlock)}</p>
          <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => void unlockLesson(lesson.id, 'manual')} data-testid="lesson-gate-unlock">
            {unlockButtonLabel(lesson.unlock)}
          </button>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="study-fullscreen" data-testid="lesson-replay-done">
        {finished === 'rated' && <Confetti />}
        <div className="study-topbar">
          <span className="study-topbar-label">Mini lesson · again</span>
          <div className="study-topbar-controls">
            <button className="study-close-btn" onClick={exit} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="study-card-content" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <div style={{ fontSize: '3.5rem' }}>{lesson.icon || '🎓'}</div>
          <h2>{finished === 'rated' ? 'Saved' : 'Practice done'}</h2>
          <p className="text-light">
            {finished === 'rated'
              ? 'Your answers are saved and your rating decides when it comes back.'
              : 'Nothing was recorded — it comes back when it was going to.'}
          </p>
          <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={exit}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <StudyCustomLesson
      lesson={lesson}
      lessonId={lesson.id}
      intervalPreviews={previews}
      replay={{ practice: practice === true }}
      onPracticeDone={() => setFinished('practice')}
      onComplete={(correct, total, rating, attempt, recordings, retire) => {
        void completeCustomLesson(lesson.id, correct, total, rating, attempt, recordings, { retire, source: 'replay' })
          .then(() => {
            setFinished('rated');
            if (navigator.onLine) void syncCustomLessons().catch(() => {});
          });
      }}
      onEnd={exit}
    />
  );
}
