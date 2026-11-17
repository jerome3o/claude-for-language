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
 * - `MarkedAnswer` — his answer lined up with the model answer (the slim answer diff, shared/cards/answer-diff.ts:
 *   wrong red, extra yellow struck through, missing in a dashed slot, tone off wavy) under ONE line that says what
 *   differs (docs/STUDY_SESSION.md "Answer feedback: one line and a diff").
 * - `FeedbackSentence` — the answer screen's Chinese sentence: every word tappable into the language explorer (the
 *   device segmenter) with a ▶ that plays the exercise's own clip again (the lesson's cache-first speak — offline once
 *   prefetched), never while a take records. Jerome: "it doesn't allow me to click on letters after I've submitted my
 *   answer. It also doesn't allow me to replay the AI audio."
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  lessonFeel, markedChars, SAY_AGAIN_FIX_LABEL, SAY_AGAIN_LABEL, SAY_AGAIN_NOTE, type LessonFeelMoment,
} from '@shared/lesson/feedback';
import { ConfettiBurst } from '../ConfettiBurst';
import { PractiseSentence } from '../coach/PractiseSentence';
import { studyFeel } from '../../services/studyFeel';
import { track } from '../../services/analytics';
import { ExplorableText } from '../explorer/ExplorableText';
import { useSegmentedWords } from '../../services/chineseSegmenter';
import { useTakeLock } from '../voice/TakeLock';
import { answerDiff, answerDiffLabel, answerDiffSummary } from '@shared/cards/answer-diff';
import { AnswerDiffChars } from '../study/AnswerDiff';
import '../study/AnswerDiff.css';
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

/**
 * His answer lined up with the model answer, character by character (the slim answer diff), and ONE line under it
 * that says what differs ("1 wrong character, 1 missing") — no explanation.
 */
export function MarkedAnswer({ answer, model }: { answer: string; model: string }) {
  const diff = answerDiff(answer, model);
  const line = answerDiffSummary(diff);
  return (
    <>
      <span className="lesson-marked-answer" data-testid="lesson-marked-answer" aria-label={answerDiffLabel(diff, line)}>
        <AnswerDiffChars parts={diff.parts} />
      </span>
      <span className="lesson-answer-diff-line" data-testid="lesson-answer-diff-line">{line}</span>
    </>
  );
}

/** The model answer, the characters his answer missed highlighted (the other half of the device's diff). */
export function MarkedModel({ answer, model }: { answer: string; model: string }) {
  return (
    <span className="lesson-marked-model" data-testid="lesson-marked-model">
      {markedChars(answer, model, 'model').map((m, i) => <span key={i} className={m.hit ? undefined : 'miss'}>{m.ch}</span>)}
    </span>
  );
}

/** ▶ the exercise's clip again, as often as he likes (not while a take records — it would play into the mic). */
export function ReplayButton({ hanzi, speak, exerciseType, testId = 'lesson-replay' }: {
  hanzi: string;
  speak: (text: string) => void;
  exerciseType: string;
  testId?: string;
}) {
  const lock = useTakeLock();
  const recording = lock?.phase === 'recording';
  return (
    <button
      type="button"
      className="lesson-replay-btn"
      onClick={(e) => {
        e.stopPropagation();
        if (recording) return;
        speak(hanzi);
        track('lesson.feedback_replay', { exercise_type: exerciseType });
      }}
      disabled={recording}
      aria-label={`Play it again: ${hanzi}`}
      title="Play it again"
      data-testid={testId}
    >
      <span aria-hidden="true">▶</span>
    </button>
  );
}

/**
 * The answer screen's Chinese sentence: tappable word by word into the explorer, ▶ to hear it again, then its pinyin
 * / English. `answer` = his answer, when the characters it missed are to be marked (the device's diff).
 */
export function FeedbackSentence({ hanzi, pinyin, english, speak, exerciseType, answer, label, testId = 'lesson-feedback-sentence' }: {
  hanzi: string;
  pinyin?: string | null;
  english?: string | null;
  speak: (text: string) => void;
  exerciseType: string;
  answer?: string | null;
  label?: string;
  testId?: string;
}) {
  const words = useSegmentedWords(hanzi, /\p{Script=Han}/u.test(hanzi));
  const marks = answer ? markedChars(answer, hanzi, 'model').flatMap((m) => Array.from(m.ch).map(() => !m.hit)) : undefined;
  return (
    <>
      {label && <p className="result-explanation">{label}</p>}
      <div className="translate-ref lesson-feedback-sentence" data-testid={testId}>
        <div className="lesson-feedback-sentence-line">
          <span className={`translate-ref-hanzi lesson-feedback-sentence-hanzi${marks ? ' lesson-marked-model' : ''}`}>
            <ExplorableText text={hanzi} segments={words} source="lesson" marks={marks} />
          </span>
          <ReplayButton hanzi={hanzi} speak={speak} exerciseType={exerciseType} />
        </div>
        {pinyin && <div className="translate-ref-pinyin">{pinyin}</div>}
        {english && <div className="contrast-english">{english}</div>}
      </div>
    </>
  );
}
