/**
 * `/lessons/:id/play?from=&mode=revision` — a mini lesson outside any session: Home's homework /
 * to-do rows ("🎓 new", "🔁 Revision"), the Mini Lessons page (▶ Start / ▶ Revision / ▶ Do it
 * again), a finished homework pass, the podcast player's companion card.
 *
 * The real player (StudyCustomLesson): a run saved as it goes (it continues next time), the
 * retry round at the end, the completion recorded at the end — its outcome decides done forever
 * vs a revision in a week (shared/study/lessonRevision.ts). `mode=revision` plays the lesson's
 * revision (what was missed last time + a few that were got) while one is waiting; otherwise the
 * whole lesson. Closing (✕) records nothing — the run waits. Works offline for cached lessons.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { StudyCustomLesson } from '../components/StudyCustomLesson';
import { completeCustomLesson, syncCustomLessons } from '../services/custom-lesson-study';
import { learnOf, revisionKeysFor } from '../services/lessonLearn';
import { track } from '../services/analytics';
import { lockedLessonLine, unlockButtonLabel } from '@shared/lesson';
import { lockStatusOf, unlockLesson } from '../services/lessonUnlock';
import './StudyPage.css';

const FROM = new Set(['lessons_page', 'homework', 'today', 'player', 'coach', 'home']);

export function LessonReplayPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const from = FROM.has(params.get('from') ?? '') ? (params.get('from') as string) : 'lessons_page';
  const wantsRevision = params.get('mode') === 'revision';
  const navigate = useNavigate();
  const lesson = useLiveQuery(async () => (await db.customLessons.get(id)) ?? null, [id]);
  // Decided once, when the lesson is first read: the finish mid-page doesn't change what is played.
  const [plan, setPlan] = useState<{ keys: string[] | null } | null>(null);

  useEffect(() => {
    if (!lesson || plan) return;
    const learn = learnOf(lesson);
    const revision = wantsRevision && learn.status === 'revision';
    const keys = revision ? revisionKeysFor(lesson) : null;
    setPlan({ keys });
    track('lesson.replay', { from, revision, status: learn.status });
  }, [lesson, plan, from, wantsRevision]);

  const exit = () => navigate(-1);

  if (lesson === undefined || (lesson && !plan)) return <div className="study-fullscreen" />;
  if (!lesson || !plan) {
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

  return (
    <StudyCustomLesson
      lesson={lesson}
      lessonId={lesson.id}
      revisionKeys={plan.keys}
      label="Mini lesson"
      source={from === 'homework' ? 'homework' : from === 'home' ? 'home' : 'replay'}
      onComplete={({ correct, total, attempt, recordings, outcome }) =>
        completeCustomLesson(lesson.id, correct, total, attempt, recordings, { source: from, outcome })
          .then(() => {
            if (navigator.onLine) void syncCustomLessons().catch(() => {});
          })
          .catch(err => console.error('[lesson] completion failed:', err))
      }
      onEnd={exit}
    />
  );
}
