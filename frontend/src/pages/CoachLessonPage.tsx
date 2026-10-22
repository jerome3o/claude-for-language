/**
 * `/coach/:conversationId/lesson/:messageId` — a Sentence Coach "🎯 Mini lesson on this mistake"
 * (shared/coach/mistakeLesson.ts) in the real lesson player, as a PREVIEW: nothing is recorded
 * while he plays it. "＋ Save" in the top bar, or "Save to my mini lessons" at the end, put it in
 * his mini lessons (the normal create path, source 'coach'); saving at the end also records this
 * run as the lesson's first completion — all right first time = done, else it comes back as a
 * revision in a week (shared/study/lessonRevision.ts) instead of waiting as a new lesson. "Not now" / ✕ go back to the conversation. Plays offline
 * from the device's copy (services/coachLessons.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCoachConversation, saveCoachMistakeLesson, apiErrorStatus } from '../api/client';
import type { CoachConversation, CoachMessage } from '../types';
import { MISTAKE_LESSON_CONTENT_TYPE, mistakeLessonExerciseCount, parseMistakeLessonContent, type MistakeLessonContent } from '@shared/coach';
import { StudyCustomLesson } from '../components/StudyCustomLesson';
import { cachedCoachLesson, rememberCoachLesson } from '../services/coachLessons';
import { syncCustomLessons, prefetchCustomLessonMedia } from '../services/custom-lesson-study';
import { track } from '../services/analytics';
import { Confetti } from '../components/Confetti';
import './StudyPage.css';

type ConvData = { conversation: CoachConversation; messages: CoachMessage[] };

function saveErrorText(err: unknown): string {
  if (apiErrorStatus(err) === undefined) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? "You're offline — saving needs a connection. Try again when you're back online, or save it from the conversation later."
      : 'The connection dropped — try again.';
  }
  return err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : 'Couldn’t save it — try again.';
}

export function CoachLessonPage() {
  const { conversationId = '', messageId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const conv = useQuery({ queryKey: ['coach-conversation', conversationId], queryFn: () => getCoachConversation(conversationId), retry: false });
  const fromServer = useMemo(() => {
    const m = conv.data?.messages.find((x) => x.id === messageId && x.content_type === MISTAKE_LESSON_CONTENT_TYPE && !x.status);
    return m ? parseMistakeLessonContent(m.content) : null;
  }, [conv.data, messageId]);
  const content: MistakeLessonContent | null = fromServer ?? cachedCoachLesson(conversationId, messageId)?.content ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHere, setSavedHere] = useState(false);
  const [finished, setFinished] = useState<{ missed: number } | null>(null);
  const played = useRef(false);

  useEffect(() => {
    if (fromServer) rememberCoachLesson(conversationId, messageId, fromServer);
  }, [fromServer, conversationId, messageId]);
  useEffect(() => {
    if (!content || played.current) return;
    played.current = true;
    track('coach.mistake_lesson_play', { exercises: mistakeLessonExerciseCount(content.spec), saved: !!content.lesson_id });
  }, [content]);

  const back = () => navigate(`/coach?c=${encodeURIComponent(conversationId)}`, { replace: true });

  const save = async (completion: Parameters<typeof saveCoachMistakeLesson>[2]) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await saveCoachMistakeLesson(conversationId, messageId, completion);
      queryClient.setQueryData<ConvData>(['coach-conversation', conversationId], (prev) =>
        prev ? { ...prev, messages: prev.messages.map((m) => (m.id === res.message.id ? res.message : m)) } : prev);
      const saved = parseMistakeLessonContent(res.message.content);
      if (saved) rememberCoachLesson(conversationId, messageId, saved);
      setSavedHere(true);
      track('coach.mistake_lesson_save', { done: !!completion, missed: completion?.outcome?.missed.length ?? null });
      // Into the device's lessons now (with the completion), so it's scheduled — and works offline.
      void syncCustomLessons().then(() => prefetchCustomLessonMedia()).catch(() => {});
      return true;
    } catch (err) {
      setError(saveErrorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!content) {
    return (
      <div className="study-fullscreen">
        <div className="study-topbar">
          <span className="study-topbar-label">Mini lesson</span>
          <div className="study-topbar-controls">
            <button className="study-close-btn" onClick={back} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="study-card-content" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          {conv.isLoading ? <p>Loading…</p> : <p>This lesson isn&rsquo;t on this device — open it from the conversation when you&rsquo;re online.</p>}
          <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={back}>Back to the coach</button>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="study-fullscreen" data-testid="coach-lesson-saved">
        <Confetti />
        <div className="study-topbar">
          <span className="study-topbar-label">Mini lesson</span>
          <div className="study-topbar-controls">
            <button className="study-close-btn" onClick={back} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="study-card-content" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <div style={{ fontSize: '3.5rem' }}>{content.spec.icon || '🎯'}</div>
          <h2>Saved to your mini lessons</h2>
          <p className="text-light">
            {finished.missed === 0
              ? 'All right first time — it’s done. Do it again any time from Mini Lessons.'
              : 'Anything you missed comes back in a week as a short revision.'}
          </p>
          <button className="btn btn-primary" style={{ minHeight: 44 }} onClick={back} data-testid="coach-lesson-back">Back to the coach</button>
        </div>
      </div>
    );
  }

  return (
    <StudyCustomLesson
      lesson={{ title: content.spec.title, icon: content.spec.icon ?? '🎯', spec: content.spec }}
      preview
      previewSave={{
        saved: savedHere || !!content.lesson_id,
        busy,
        error,
        onSaveNow: () => void save(null),
        onSaveDone: ({ correct, total, attempt, outcome }) => {
          void save({ id: crypto.randomUUID(), correct, total, completed_at: new Date().toISOString(), attempt, outcome }).then((ok) => {
            if (ok) setFinished({ missed: outcome.missed.length });
          });
        },
      }}
      onEnd={back}
    />
  );
}

export default CoachLessonPage;
