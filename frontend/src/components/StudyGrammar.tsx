import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocalGrammarLesson, GrammarExampleSentence } from '../db/database';
import { QueueCounts } from '../types';
import { QueueCountsHeader } from './QueueCountsHeader';
import { ScrambleExercise, ChoiceExercise, TranslateExercise } from './lesson-exercises';
import { getTTSWithCache } from '../services/ttsCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import '../pages/PracticePage.css';

type Exercises = NonNullable<LocalGrammarLesson['exercises']>;
type Contrast = Exercises['contrasts'][number];

/** Flatten a contrast's option_a..d into an ordered [letter, sentence] list
 * for the generic ChoiceExercise. */
function contrastEntries(ex: Contrast): Array<[string, GrammarExampleSentence]> {
  return [
    ['a', ex.option_a],
    ['b', ex.option_b],
    ...(ex.option_c ? [['c', ex.option_c] as ['c', GrammarExampleSentence]] : []),
    ...(ex.option_d ? [['d', ex.option_d] as ['d', GrammarExampleSentence]] : []),
  ];
}

function contrastOptions(ex: Contrast): GrammarExampleSentence[] {
  return contrastEntries(ex).map(([, s]) => s);
}

function contrastCorrectIndex(ex: Contrast): number {
  return contrastEntries(ex).findIndex(([letter]) => letter === ex.correct);
}

type Phase = 'flood' | 'scramble' | 'contrast' | 'translate' | 'speak' | 'done';
const PHASE_ORDER: Phase[] = ['flood', 'scramble', 'contrast', 'translate', 'speak'];
const SPEAK_COUNT = 2;

/**
 * Offline-capable audio for lesson sentences: cached TTS blob when
 * available, generated + cached when online, silent otherwise.
 */
function useOfflineSpeak(): (text: string) => void {
  const playerRef = useRef(createAudioPlayer());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  return useCallback((text: string) => {
    // claim() stops the current clip and reserves the id, so a slow cache
    // lookup can't start playing over whatever the user asked for next.
    const playId = playerRef.current.claim();
    void getTTSWithCache(text).then(blob => {
      if (!blob || !playerRef.current.isCurrent(playId)) return;
      playerRef.current.play(blob, { label: 'grammar-example' });
    });
  }, []);
}

/**
 * A grammar lesson inside the study session: pattern intro → example flood →
 * word order → meaning contrast → produce it yourself. Fully offline — the
 * production exercises are self-assessed against precomputed references
 * instead of AI-checked.
 */
export function StudyGrammar({
  lesson,
  counts,
  onComplete,
  onEnd,
}: {
  lesson: LocalGrammarLesson;
  counts: QueueCounts;
  onComplete: (correct: number, total: number) => void;
  onEnd: () => void;
}) {
  const speak = useOfflineSpeak();
  const exercises = lesson.exercises!;

  const [phase, setPhase] = useState<Phase>('flood');
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const phaseLengths = useMemo(
    () => [
      exercises.flood.length,
      exercises.scrambles.length,
      exercises.contrasts.length,
      exercises.translates.length,
      Math.min(SPEAK_COUNT, exercises.flood.length),
    ],
    [exercises],
  );
  const totalExercises = phaseLengths.reduce((a, b) => a + b, 0);
  const completedExercises = useMemo(() => {
    const phaseIdx = PHASE_ORDER.indexOf(phase);
    if (phaseIdx < 0) return totalExercises;
    return phaseLengths.slice(0, phaseIdx).reduce((a, b) => a + b, 0) + idx;
  }, [phaseLengths, phase, idx, totalExercises]);

  function advance(gotPoint: boolean | null) {
    if (gotPoint !== null) {
      setScore(s => ({ correct: s.correct + (gotPoint ? 1 : 0), total: s.total + 1 }));
    }
    const phaseIdx = PHASE_ORDER.indexOf(phase);
    if (idx + 1 < phaseLengths[phaseIdx]) {
      setIdx(idx + 1);
      return;
    }
    const next = PHASE_ORDER[phaseIdx + 1];
    if (next) {
      setPhase(next);
      setIdx(0);
    } else {
      setPhase('done');
    }
  }

  const body = (() => {
    switch (phase) {
      case 'flood':
        return (
          <FloodView
            lesson={lesson}
            example={exercises.flood[idx]}
            index={idx}
            total={exercises.flood.length}
            speak={speak}
            onNext={() => advance(null)}
          />
        );
      case 'scramble': {
        const ex = exercises.scrambles[idx];
        return (
          <ScrambleExercise
            key={`sc-${idx}`}
            english={ex.english}
            tiles={ex.tiles}
            correctOrder={ex.correct_order}
            altOrders={ex.alt_orders}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      }
      case 'contrast': {
        const ex = exercises.contrasts[idx];
        return (
          <ChoiceExercise
            key={`ct-${idx}`}
            question={ex.context}
            options={contrastOptions(ex)}
            correctIndex={contrastCorrectIndex(ex)}
            explanation={ex.explanation}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      }
      case 'translate': {
        const ex = exercises.translates[idx];
        return (
          <TranslateExercise
            key={`tr-${idx}`}
            label={`Say it · ${lesson.pattern}`}
            english={ex.english}
            referenceHanzi={ex.reference_hanzi}
            referencePinyin={ex.reference_pinyin}
            note="Did yours match the meaning and use the pattern? (Different wording is fine.)"
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      }
      case 'speak':
        return (
          <SpeakView
            key={`sp-${idx}`}
            lesson={lesson}
            model={exercises.flood[idx]}
            variations={[...exercises.flood, ...lesson.seed_examples]}
            speak={speak}
            onNext={correct => advance(correct)}
            onSkip={() => advance(null)}
          />
        );
      case 'done': {
        const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
        return (
          <div className="practice-page center" style={{ minHeight: 'auto' }}>
            <div className="done-emoji">🧩</div>
            <h2>Pattern complete</h2>
            <h3>{lesson.title}</h3>
            <div className="done-score">
              {score.correct}/{score.total} correct ({pct}%)
            </div>
            <p className="practice-sub">
              {lesson.correct_count + score.correct} lifetime correct — known at 8
            </p>
            {lesson.cgw_url && (
              <a className="practice-link" href={lesson.cgw_url} target="_blank" rel="noreferrer">
                Read more on Chinese Grammar Wiki →
              </a>
            )}
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: '1rem', minHeight: '44px' }}
              onClick={() => onComplete(score.correct, score.total)}
            >
              Finish lesson
            </button>
          </div>
        );
      }
    }
  })();

  return (
    <div className="study-fullscreen">
      <div className="study-topbar">
        <QueueCountsHeader counts={counts} />
        <div className="study-topbar-controls">
          <button className="study-close-btn" onClick={onEnd} aria-label="End session">
            ✕
          </button>
        </div>
      </div>

      <div className="study-card-content study-reader-content">
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#f97316', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            🧩 Grammar Lesson
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{lesson.title}</div>
        </div>

        {phase !== 'done' && (
          <div className="reader-progress-bar" style={{ marginBottom: '0.75rem' }}>
            <div
              className="reader-progress-fill"
              style={{ width: `${(completedExercises / totalExercises) * 100}%` }}
            />
          </div>
        )}

        <div className="practice-page" style={{ padding: 0, minHeight: 'auto' }}>
          {body}
        </div>
      </div>
    </div>
  );
}

// ============ Exercise sub-views (offline) ============

function FloodView(props: {
  lesson: LocalGrammarLesson;
  example: GrammarExampleSentence;
  index: number;
  total: number;
  speak: (text: string) => void;
  onNext: () => void;
}) {
  const { lesson, example, index, total, speak, onNext } = props;
  const [stage, setStage] = useState(0);

  useEffect(() => {
    speak(example.hanzi);
    setStage(0);
  }, [example.hanzi, speak]);

  const advanceLabel =
    stage === 0
      ? 'Show characters'
      : stage === 1
        ? 'Show meaning'
        : index + 1 < total
          ? 'Next example'
          : 'Continue';

  return (
    <div className="exercise">
      {index === 0 && (
        <div className="gp-intro">
          <div className="gp-pattern">{lesson.pattern}</div>
          <p>{lesson.explanation}</p>
        </div>
      )}
      <div className="phase-label">
        Listen · {index + 1}/{total}
      </div>
      <div
        className={`flood-hanzi ${stage >= 1 ? '' : 'hidden'}`}
        onClick={() => speak(example.hanzi)}
      >
        {example.hanzi}
      </div>
      <div className={`flood-reveal ${stage >= 2 ? '' : 'hidden'}`}>
        <div className="flood-pinyin">{example.pinyin}</div>
        <div className="flood-english">{example.english}</div>
      </div>
      <div className="exercise-actions">
        <button className="practice-btn" onClick={() => speak(example.hanzi)}>
          🔊 Replay
        </button>
        <button
          className="practice-btn primary"
          onClick={() => (stage < 2 ? setStage(stage + 1) : onNext())}
        >
          {advanceLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Offline speaking exercise: say your own sentence with the pattern out
 * loud, then compare against precomputed example variations and judge
 * yourself.
 */
function SpeakView(props: {
  lesson: LocalGrammarLesson;
  model: GrammarExampleSentence;
  variations: GrammarExampleSentence[];
  speak: (text: string) => void;
  onNext: (correct: boolean) => void;
  onSkip: () => void;
}) {
  const { lesson, model, variations, speak, onNext, onSkip } = props;
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    speak(model.hanzi);
  }, [model.hanzi, speak]);

  // A few reference variations, excluding the model sentence itself
  const shownVariations = variations.filter(v => v.hanzi !== model.hanzi).slice(0, 3);

  return (
    <div className="exercise">
      <div className="phase-label">Say your own · {lesson.pattern}</div>
      <div className="speak-model">
        <div className="speak-model-label">Listen, then say a different sentence with the same pattern — out loud</div>
        <div className="speak-model-hanzi" onClick={() => speak(model.hanzi)}>
          {model.hanzi} 🔊
        </div>
        <div className="flood-pinyin">{model.pinyin}</div>
      </div>

      {!finished ? (
        <>
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={() => setFinished(true)}>
              🎤 I've said my sentence
            </button>
          </div>
          <button className="practice-link" onClick={onSkip}>
            Skip
          </button>
        </>
      ) : (
        <>
          <p className="result-explanation">Here are some variations for comparison:</p>
          {shownVariations.map((v, i) => (
            <div className="translate-ref" key={i}>
              <div className="translate-ref-hanzi" onClick={() => speak(v.hanzi)}>
                {v.hanzi} 🔊
              </div>
              <div className="translate-ref-pinyin">{v.pinyin}</div>
            </div>
          ))}
          <p className="result-explanation">
            Was your sentence grammatical and did it use the pattern?
          </p>
          <div className="exercise-actions">
            <button className="practice-btn" onClick={() => onNext(false)}>
              ✗ Not quite
            </button>
            <button className="practice-btn primary" onClick={() => onNext(true)}>
              ✓ Yes
            </button>
          </div>
        </>
      )}
    </div>
  );
}
