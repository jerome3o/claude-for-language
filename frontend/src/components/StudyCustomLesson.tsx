/**
 * The mini lesson player: the whole lesson, or its REVISION (shared/study/lessonRevision.ts).
 *
 * The lesson spec (shared/lesson) is a list of sections, each holding any number of exercises of
 * any type — the run walks its steps (shared/study/lessonRun.ts `lessonSteps`) and renders each
 * with ExerciseView. Fully offline: TTS comes from the cache-first speak hook, images from the
 * blob cache, production exercises are self-assessed (Claude checks answers when online).
 *
 * - **The retry round**: every scored exercise answered wrong on the main pass is owed; after the
 *   last exercise the owed ones come back until each is right ("Let's put this one right · 2
 *   left"). The progress bar grows an orange "owed" part at its right end that the blue catches up.
 * - **Never lost**: a real run (`lessonId`) is saved after every exercise (services/lessonRuns.ts)
 *   and continues next time — another day, after a restart, offline: "Continue where you left off
 *   (7 of 18)" · Start over.
 * - **The end** records the completion at once — its attempt (answers, checks, time, retries) for
 *   the tutor and its outcome (what was missed first time), which decides: all right first time →
 *   done forever; otherwise it comes back in a week as a revision. No rating to give.
 *
 * `preview` runs the same lesson with nothing recorded (a tutor trying a library lesson or a
 * catalogue sample); with `previewSave` (the Sentence Coach's mistake lesson) the end offers
 * "Save to my mini lessons" with this run as its first completion.
 *
 * Closing (✕) never records a completion; the run waits, saved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  exercisePoints,
  type CustomLessonSpec,
  type ExerciseAnswer,
  type ExerciseAttempt,
  type LessonAttemptData,
  type LessonExercise,
} from '@shared/lesson';
import {
  NEW_RUN,
  advanceRun,
  lessonShape,
  lessonSteps,
  resumeLine,
  retryLine,
  retryMediaKey,
  retryNumber,
  runCurrent,
  runProgress,
  verdictWrong,
  type LessonRunMode,
  type LessonRunState,
} from '@shared/study/lessonRun';
import { runEndLine, runOutcome, type LessonRunOutcome } from '@shared/study/lessonRevision';
import { track } from '../services/analytics';
import { ExerciseView } from './ExerciseView';
import { getTTSWithCache } from '../services/ttsCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import { useLessonAudio } from '../hooks/useLessonAudio';
import type { LessonRecording } from '../services/custom-lesson-study';
import { clearLessonRun, loadLessonRun, saveLessonRun } from '../services/lessonRuns';
import { Confetti } from './Confetti';
import '../pages/PracticePage.css';
import './StudyReader.css';

export function useOfflineSpeak(): (text: string) => void {
  const playerRef = useRef(createAudioPlayer());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  return useCallback((text: string) => {
    const playId = playerRef.current.claim();
    void getTTSWithCache(text).then(blob => {
      if (!blob || !playerRef.current.isCurrent(playId)) return;
      playerRef.current.play(blob, { label: 'lesson-example' });
    });
  }, []);
}

/** The lesson fields the player needs (a cached lesson or a catalogue sample). */
export interface PlayableLesson {
  title: string;
  icon: string | null;
  spec: CustomLessonSpec;
}

/** What a finished real run hands back. */
export interface LessonRunResult {
  correct: number;
  total: number;
  attempt: LessonAttemptData;
  recordings: LessonRecording[];
  outcome: LessonRunOutcome;
  mode: LessonRunMode;
}

/**
 * A preview that may be KEPT (the Sentence Coach's "🎯 Mini lesson on this mistake"): played with
 * nothing recorded, then "Save to my mini lessons" — this run becomes its first completion (so a
 * lesson with mistakes comes back as a revision in a week), or Not now.
 */
export interface PreviewSave {
  /** Already in his mini lessons (saved before, or with ＋ Save just now). */
  saved: boolean;
  busy: boolean;
  /** Why the last save failed (offline, the server…). */
  error: string | null;
  /** Save from the top bar, mid-lesson (no completion). */
  onSaveNow: () => void;
  /** Save at the end with this run as its completion. */
  onSaveDone: (result: { correct: number; total: number; attempt: LessonAttemptData; outcome: LessonRunOutcome }) => void;
}

export function StudyCustomLesson({
  lesson,
  lessonId,
  revisionKeys = null,
  label = 'Mini lesson',
  source = 'lessons_page',
  onComplete,
  onEnd,
  preview = false,
  previewSave,
}: {
  lesson: PlayableLesson;
  /** A real run of this lesson: saved after every exercise, completed at the end. */
  lessonId?: string;
  /** A revision: its scored exercises (`revisionKeys`); null = the whole lesson. */
  revisionKeys?: string[] | null;
  /** The top bar's label ("Homework", "Mini lesson"…). */
  label?: string;
  /** Analytics: where the lesson is taken. */
  source?: string;
  /** A real run finished (the completion is recorded by the caller). */
  onComplete?: (result: LessonRunResult) => void | Promise<void>;
  onEnd: () => void;
  /** "Try it": nothing is recorded or kept. */
  preview?: boolean;
  /** With `preview`: offer to keep the lesson (PreviewSave). */
  previewSave?: PreviewSave;
}) {
  const real = !preview && !!lessonId;
  const shape = useMemo(() => lessonShape(lesson.spec), [lesson.spec]);

  // The run: loaded once (a saved one continues), then kept in step with every answer.
  const [loaded, setLoaded] = useState(!real);
  const [mode, setMode] = useState<LessonRunMode>(revisionKeys ? 'revision' : 'full');
  const [keys, setKeys] = useState<string[] | null>(revisionKeys);
  const [state, setState] = useState<LessonRunState>(NEW_RUN);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [resumed, setResumed] = useState(false);
  const [finishedLine, setFinishedLine] = useState<string | null>(null);
  const startedAt = useRef(new Date());
  const exerciseStart = useRef(Date.now());
  const attempts = useRef<ExerciseAttempt[]>([]);
  const recordings = useRef<LessonRecording[]>([]);
  const completedRef = useRef(false);
  const [runKey, setRunKey] = useState(0);

  const steps = useMemo(() => lessonSteps(lesson.spec, keys), [lesson.spec, keys]);
  const exercises = useMemo(() => {
    const map = new Map<string, { exercise: LessonExercise; sectionTitle: string | null }>();
    lesson.spec.sections.forEach((s, si) => s.exercises.forEach((ex, i) => map.set(`s${si}e${i}`, { exercise: ex, sectionTitle: s.title ?? null })));
    return map;
  }, [lesson.spec]);

  useEffect(() => {
    if (!real || !lessonId) return;
    let cancelled = false;
    void loadLessonRun(lessonId, shape).then(saved => {
      if (cancelled) return;
      if (saved) {
        setMode(saved.mode);
        setKeys(saved.keys);
        setState(saved.state);
        setScore({ correct: saved.correct, total: saved.total });
        startedAt.current = new Date(saved.started_at);
        attempts.current = saved.attempts ?? [];
        recordings.current = saved.recordings ?? [];
        setResumed(true);
        track('lesson.resume', { source, mode: saved.mode, exercises: lessonSteps(lesson.spec, saved.keys).length, at: saved.state.pos });
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, lessonId, shape]);

  const current = loaded ? runCurrent(state, steps) : null;
  const done = loaded && !current;
  const progress = runProgress(state, steps);
  const flatIndex = current ? steps.findIndex(s => s.key === current.step.key) : steps.length;

  // Analytics: where this lesson is taken (Home / homework pass / Mini Lessons / a tutor's preview).
  useEffect(() => {
    if (!loaded) return;
    track('lesson.start', { source: preview ? 'preview' : source, exercises: steps.length, mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, runKey]);

  // Every clip of the lesson is fetched as it opens (current exercise first); a late clip never
  // plays on a later exercise (docs/AUDIO.md "Lesson audio prefetch").
  const { speak, cancelPending } = useLessonAudio(lesson.spec, Math.max(0, flatIndex), preview ? 'preview' : source);

  function attemptData(): LessonAttemptData {
    const resumedRun = resumed;
    const total = attempts.current.reduce((s, a) => s + Math.max(0, a.duration_ms), 0);
    return {
      started_at: startedAt.current.toISOString(),
      // A run continued on another day: the time spent on its exercises, not the days between.
      duration_ms: resumedRun ? total : Date.now() - startedAt.current.getTime(),
      exercises: attempts.current,
    };
  }

  function persist(next: LessonRunState, nextScore: { correct: number; total: number }) {
    if (!real || !lessonId) return;
    void saveLessonRun({
      lesson_id: lessonId,
      shape,
      mode,
      keys,
      state: next,
      correct: nextScore.correct,
      total: nextScore.total,
      started_at: startedAt.current.toISOString(),
      saved_at: new Date().toISOString(),
      attempts: attempts.current,
      recordings: recordings.current,
    });
  }

  function finish(nextScore: { correct: number; total: number }) {
    const attempt = attemptData();
    const outcome = runOutcome(attempt) ?? { keys: [], missed: [] };
    setFinishedLine(runEndLine(outcome, mode === 'revision'));
    if (preview || completedRef.current) return;
    completedRef.current = true;
    track('lesson.complete', {
      source, mode, duration_ms: attempt.duration_ms,
      missed: outcome.missed.length, scored: outcome.keys.length, retries: attempts.current.filter(a => (a.retry ?? 0) > 0).length,
    });
    if (real && onComplete) {
      void Promise.resolve(onComplete({ correct: nextScore.correct, total: nextScore.total, attempt, recordings: recordings.current, outcome, mode }));
    }
  }

  function advance(correct: boolean | null, answer?: ExerciseAnswer, recording?: Blob) {
    if (!current) return;
    const { step, phase } = current;
    const ex = exercises.get(step.key)?.exercise;
    const maxPoints = ex ? exercisePoints(ex) : 0;
    // A conversation scores one point per question; everything else 0/1.
    const points = answer?.questions ? answer.questions.filter(q => q.correct).length : correct ? maxPoints : 0;
    const scoredPoints = correct === null ? 0 : Math.min(points, maxPoints);
    const retry = phase === 'retry' ? retryNumber(attempts.current, step.key) : 0;
    let nextScore = score;
    if (phase === 'main' && correct !== null && maxPoints > 0) {
      nextScore = { correct: score.correct + scoredPoints, total: score.total + maxPoints };
      setScore(nextScore);
    }
    attempts.current = [...attempts.current, {
      section: step.section,
      index: step.index,
      type: step.type,
      correct,
      points: scoredPoints,
      max_points: correct === null ? 0 : maxPoints,
      duration_ms: Date.now() - exerciseStart.current,
      answer,
      ...(retry > 0 ? { retry } : {}),
    }];
    if (recording && answer?.recording) {
      recordings.current = [...recordings.current, { media_key: answer.recording.media_key, blob: recording }];
    }
    exerciseStart.current = Date.now();
    cancelPending();
    // Wrong = owed (main pass) / back of the queue (retry round): a conversation with a missed question too.
    const wrong = verdictWrong(correct, scoredPoints, correct === null ? 0 : maxPoints);
    const next = advanceRun(state, steps, correct === null ? null : !wrong);
    setState(next);
    if (phase === 'retry') track('lesson.retry', { type: step.type, right: !wrong, left: runProgress(next, steps).owed });
    if (!runCurrent(next, steps)) finish(nextScore);
    else persist(next, nextScore);
  }

  function startOver() {
    attempts.current = [];
    recordings.current = [];
    startedAt.current = new Date();
    exerciseStart.current = Date.now();
    completedRef.current = false;
    setScore({ correct: 0, total: 0 });
    setState(NEW_RUN);
    setMode(revisionKeys ? 'revision' : 'full');
    setKeys(revisionKeys);
    setResumed(false);
    setFinishedLine(null);
    cancelPending();
    if (real && lessonId) {
      void clearLessonRun(lessonId);
      track('lesson.start_over', { source });
    }
    setRunKey(k => k + 1);
  }

  if (!loaded) return <div className="study-fullscreen" />;

  const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 100;
  const item = current ? exercises.get(current.step.key) : null;
  const sectionStart = current?.phase === 'main' && item?.sectionTitle && (flatIndex === 0 || steps[flatIndex - 1]?.section !== current.step.section);
  const mediaKey = current && !preview ? retryMediaKey(current.step.section, current.step.index, current.phase === 'retry' ? retryNumber(attempts.current, current.step.key) : 0) : undefined;

  return (
    <div className="study-fullscreen">
      <div className="study-topbar">
        {preview && previewSave ? (
          <span className="lesson-preview-badge">{previewSave.saved ? '✓ In your mini lessons' : 'Trying it · not saved yet'}</span>
        ) : preview ? <span className="lesson-preview-badge">Preview · nothing is recorded</span> : <span className="study-topbar-label">{mode === 'revision' ? `${label} · revision` : label}</span>}
        <div className="study-topbar-controls">
          {preview && previewSave && !previewSave.saved && !done && (
            <button type="button" className="lesson-preview-save" onClick={previewSave.onSaveNow} disabled={previewSave.busy} data-testid="lesson-preview-save-now">
              {previewSave.busy ? 'Saving…' : '＋ Save'}
            </button>
          )}
          <button className="study-close-btn" onClick={onEnd} aria-label={preview ? 'Close preview' : 'Close lesson'}>✕</button>
        </div>
      </div>

      <div className="study-card-content study-reader-content">
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {lesson.icon || '🎓'} {mode === 'revision' ? 'Revision' : 'Mini Lesson'}
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{lesson.title}</div>
        </div>

        {resumed && !done && (
          <div className="lesson-resume-line" data-testid="lesson-resume">
            <span>{resumeLine(state, steps)}</span>
            <button type="button" className="lesson-resume-over" onClick={startOver} data-testid="lesson-start-over">Start over</button>
          </div>
        )}

        {!done && <LessonRunBar done={progress.done} total={progress.total} owed={progress.owed} />}

        {current?.phase === 'retry' && (
          <div className="lesson-retry-line" data-testid="lesson-retry-line">🔁 {retryLine(progress.owed)}</div>
        )}
        {sectionStart && <div className="lesson-section-title">{item?.sectionTitle}</div>}

        <div className="practice-page" style={{ padding: 0, minHeight: 'auto' }}>
          {done ? (
            <div className="practice-page center" style={{ minHeight: 'auto' }} data-testid="lesson-complete">
              {!preview && <Confetti />}
              <div className="done-emoji">{lesson.icon || '🎓'}</div>
              <h2>{mode === 'revision' ? 'Revision complete' : 'Lesson complete'}</h2>
              <h3>{lesson.title}</h3>
              {score.total > 0 && (
                <div className="done-score">
                  {score.correct}/{score.total} right first time ({pct}%)
                </div>
              )}
              {finishedLine && !preview && <p className="lesson-end-line" data-testid="lesson-end-line">{finishedLine}</p>}
              {preview && !previewSave && <p className="text-light">Preview — nothing was recorded.</p>}
              {preview && previewSave?.saved && <p className="text-light" data-testid="lesson-preview-saved">✓ In your mini lessons.</p>}
            </div>
          ) : item && current ? (
            <ExerciseView
              key={`ex-${runKey}-${current.phase}-${current.step.key}-${progress.done}`}
              exercise={item.exercise}
              speak={speak}
              mediaKey={mediaKey}
              focus={lesson.title}
              onDone={advance}
            />
          ) : null}
        </div>
      </div>

      {done && !preview && (
        <div className="study-rating-sticky">
          <div className="exercise-actions" style={{ padding: '0 1rem 1rem' }}>
            <button className="practice-btn primary" onClick={onEnd} data-testid="lesson-done">Done</button>
          </div>
        </div>
      )}
      {done && preview && previewSave && (
        <div className="study-rating-sticky" data-testid="lesson-preview-save">
          <div className="study-reader-rating-header">
            <div className="study-reader-rating-prompt" style={{ marginRight: 0 }}>
              {previewSave.saved
                ? 'Keep this run as done? Anything you missed comes back in a week as a revision.'
                : 'Save it to your mini lessons? Anything you missed comes back in a week as a revision.'}
            </div>
          </div>
          <div className="exercise-actions" style={{ padding: '0.5rem 1rem 0' }}>
            <button
              className="practice-btn primary"
              disabled={previewSave.busy}
              data-testid="lesson-preview-save-done"
              onClick={() => {
                const attempt = attemptData();
                previewSave.onSaveDone({ correct: score.correct, total: score.total, attempt, outcome: runOutcome(attempt) ?? { keys: [], missed: [] } });
              }}
            >
              {previewSave.busy ? 'Saving…' : previewSave.saved ? 'Save this run' : 'Save to my mini lessons'}
            </button>
          </div>
          {previewSave.error && <div className="lesson-preview-save-error" role="alert">{previewSave.error}</div>}
          <div className="exercise-actions" style={{ padding: '0.5rem 1rem 0' }}>
            <button className="practice-btn" onClick={startOver} disabled={previewSave.busy}>↻ Try again</button>
            <button className="practice-btn" onClick={onEnd} disabled={previewSave.busy} data-testid="lesson-preview-not-now">
              {previewSave.saved ? 'Done' : 'Not now'}
            </button>
          </div>
        </div>
      )}
      {done && preview && !previewSave && (
        <div className="study-rating-sticky">
          <div className="exercise-actions" style={{ padding: '0 1rem 1rem' }}>
            <button className="practice-btn" onClick={startOver}>↻ Try again</button>
            <button className="practice-btn primary" onClick={onEnd}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The lesson's progress: blue = done, orange at the right end = retries still owed (every
 * mistake adds a slot there, so the bar never runs backwards and the blue catches up).
 */
function LessonRunBar({ done, total, owed }: { done: number; total: number; owed: number }) {
  const doneW = total > 0 ? (done / total) * 100 : 0;
  const owedW = total > 0 ? (owed / total) * 100 : 0;
  return (
    <div className="reader-progress-bar lesson-run-bar" style={{ marginBottom: '0.75rem' }} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} data-testid="lesson-run-bar">
      <div className="reader-progress-fill" style={{ width: `${doneW}%` }} />
      {owed > 0 && <div className="lesson-run-bar-owed" style={{ width: `${owedW}%` }} data-testid="lesson-run-bar-owed" />}
    </div>
  );
}
