/**
 * The answer screen's feedback pieces, one set for every mini-lesson exercise type
 * (shared/lesson/feedback.ts; docs/STUDY_SESSION.md "Mini lessons" → "Feedback"; Lab
 * ui/lessons/LessonFeedbackViews.kt):
 *
 * - `LessonFeel` — mounted at the moment a verdict appears: the StudyFeel haptic + chime and a SMALL
 *   confetti burst at that spot (never the full-screen rain);
 * - `ResultBanner` — the "✓ Correct" / "✗ Not quite" banner, felt when right;
 * - `SayItAgain` — 🎤 Say it again: the coach's "Practise saying it" (live transcription, the "You said"
 *   row) over the exercise's answer / example / Claude's fix. Practice only: nothing is scored or stored.
 * - `MarkedAnswer` — his answer with the characters the model answer doesn't have marked (the device's diff).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { diffHanzi } from '@shared/lesson';
import {
  lessonFeel, SAY_AGAIN_FIX_LABEL, SAY_AGAIN_LABEL, SAY_AGAIN_NOTE, type LessonFeelMoment,
} from '@shared/lesson/feedback';
import { ConfettiBurst } from '../ConfettiBurst';
import { PractiseSentence } from '../coach/PractiseSentence';
import { studyFeel } from '../../services/studyFeel';
import { track } from '../../services/analytics';
import './LessonFeedback.css';

/** Plays a moment's feel once, when mounted, and shows its burst (inside a position: relative parent). */
export function LessonFeel({ moment, celebrated = false }: { moment: LessonFeelMoment; celebrated?: boolean }) {
  const { feel, confetti } = lessonFeel(moment, celebrated);
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    studyFeel(feel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return confetti ? <ConfettiBurst /> : null;
}

export function ResultBanner({ ok, children, testId }: { ok: boolean; children: ReactNode; testId?: string }) {
  return (
    <div className={`result-banner lesson-feel-host ${ok ? 'correct' : 'wrong'}`} data-testid={testId ?? 'lesson-result-banner'}>
      {children}
      {ok && <LessonFeel moment="checked_right" />}
    </div>
  );
}

/** 🎤 Say it again over one sentence: practice only (never scored); `kind` tells the analytics which target. */
export function SayItAgain({ hanzi, exerciseType, kind = 'answer', testId = 'lesson-say-again' }: {
  hanzi: string;
  exerciseType: string;
  kind?: 'answer' | 'example' | 'fix';
  testId?: string;
}) {
  const label = kind === 'fix' ? SAY_AGAIN_FIX_LABEL : SAY_AGAIN_LABEL;
  const [burst, setBurst] = useState(0);
  return (
    <div className="lesson-say-again lesson-feel-host" data-testid={testId} data-kind={kind}>
      <PractiseSentence
        hanzi={hanzi}
        testId={`${testId}-row`}
        label={label}
        againLabel={label}
        againIcon="🎤"
        listeningLine="Listening… say it"
        surface="lesson_say_again"
        showListen={false}
        onOutcome={(o) => track('lesson.say_again', { exercise_type: exerciseType, target: kind, result: o })}
        onPractised={(p) => {
          const f = lessonFeel(p.result.accepted ? 'say_again_right' : 'say_again_miss');
          studyFeel(f.feel);
          if (f.confetti) setBurst((b) => b + 1);
        }}
      />
      {burst > 0 && <span className="lesson-say-again-burst"><ConfettiBurst key={burst} testId="say-again-burst" /></span>}
      <div className="lesson-say-again-note">{SAY_AGAIN_NOTE}</div>
    </div>
  );
}

/** His answer, each character marked: in the model answer (plain) or not (underlined) — the device's own diff. */
export function MarkedAnswer({ answer, model }: { answer: string; model: string }) {
  const d = diffHanzi(answer, model);
  return (
    <span className="char-diff-chars lesson-marked-answer" lang="zh-CN" data-testid="lesson-marked-answer">
      {d.typed.map((m, i) => <span key={i} className={m.hit ? 'hit' : 'extra'}>{m.ch}</span>)}
    </span>
  );
}

/** The model answer, the characters his answer missed highlighted (the other half of the device's diff). */
export function MarkedModel({ answer, model }: { answer: string; model: string }) {
  const d = diffHanzi(answer, model);
  return (
    <span className="lesson-marked-model" data-testid="lesson-marked-model">
      {d.expected.map((m, i) => <span key={i} className={m.hit ? undefined : 'miss'}>{m.ch}</span>)}
    </span>
  );
}
