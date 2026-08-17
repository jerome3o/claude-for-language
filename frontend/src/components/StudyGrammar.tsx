import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocalGrammarLesson, GrammarExampleSentence } from '../db/database';
import { QueueCounts } from '../types';
import { QueueCountsHeader } from './QueueCountsHeader';
import { getTTSWithCache } from '../services/ttsCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import '../pages/PracticePage.css';

type Exercises = NonNullable<LocalGrammarLesson['exercises']>;
type Scramble = Exercises['scrambles'][number];
type Contrast = Exercises['contrasts'][number];
type Translate = Exercises['translates'][number];

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

/** Local scramble check (same joined-sentence rule the server used). */
function checkScramble(exercise: Scramble, userOrder: string[]): boolean {
  const join = (arr: string[]) => arr.join('').replace(/\s/g, '');
  const userSentence = join(userOrder);
  if (userSentence === join(exercise.correct_order)) return true;
  return (exercise.alt_orders ?? []).some(alt => userSentence === join(alt));
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
      case 'scramble':
        return (
          <ScrambleView
            key={`sc-${idx}`}
            exercise={exercises.scrambles[idx]}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      case 'contrast':
        return (
          <ContrastView
            key={`ct-${idx}`}
            exercise={exercises.contrasts[idx]}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
      case 'translate':
        return (
          <TranslateView
            key={`tr-${idx}`}
            pattern={lesson.pattern}
            exercise={exercises.translates[idx]}
            speak={speak}
            onNext={correct => advance(correct)}
          />
        );
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

function ScrambleView(props: {
  exercise: Scramble;
  speak: (text: string) => void;
  onNext: (correct: boolean) => void;
}) {
  const { exercise, speak, onNext } = props;
  const [pickedOrder, setPickedOrder] = useState<number[]>([]);
  const [result, setResult] = useState<boolean | null>(null);
  // The English translation starts hidden: build the sentence from the Chinese
  // tiles alone, reaching for the English only as a deliberate hint. After
  // checking it's always shown so the feedback has full context.
  const [showEnglish, setShowEnglish] = useState(false);

  const picked = pickedOrder.map(i => exercise.tiles[i]);
  const allPicked = pickedOrder.length === exercise.tiles.length;

  function check() {
    const ok = checkScramble(exercise, picked);
    setResult(ok);
    speak(exercise.correct_order.join(''));
  }

  return (
    <div className="exercise">
      <div className="phase-label">Word order</div>
      {showEnglish || result !== null ? (
        <div className="scramble-prompt">{exercise.english}</div>
      ) : (
        <button className="scramble-prompt hidden-hint" onClick={() => setShowEnglish(true)}>
          Tap to show English
        </button>
      )}
      <div className="scramble-row answer">
        {picked.map((t, i) => (
          <button
            key={i}
            className="tile"
            onClick={() => result === null && setPickedOrder(pickedOrder.filter((_, j) => j !== i))}
            disabled={result !== null}
          >
            {t}
          </button>
        ))}
        {picked.length === 0 && <div className="tile-placeholder">Tap tiles below</div>}
      </div>
      <div className="scramble-row pool">
        {exercise.tiles.map((t, i) => {
          const isPicked = pickedOrder.includes(i);
          return (
            <button
              key={i}
              className={`tile ${isPicked ? 'ghost' : ''}`}
              onClick={() => !isPicked && setPickedOrder([...pickedOrder, i])}
              disabled={isPicked || result !== null}
            >
              {t}
            </button>
          );
        })}
      </div>
      {result === null ? (
        <div className="exercise-actions">
          <button className="practice-btn primary" onClick={check} disabled={!allPicked}>
            Check
          </button>
        </div>
      ) : (
        <>
          <div className={`result-banner ${result ? 'correct' : 'wrong'}`}>
            {result ? '✓ Correct' : '✗ Not quite'}
          </div>
          {!result && <div className="result-correction">{exercise.correct_order.join(' ')}</div>}
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={() => onNext(result)}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ContrastView(props: {
  exercise: Contrast;
  speak: (text: string) => void;
  onNext: (correct: boolean) => void;
}) {
  const { exercise, speak, onNext } = props;
  const [choice, setChoice] = useState<'a' | 'b' | 'c' | 'd' | null>(null);
  const [result, setResult] = useState<boolean | null>(null);

  function pick(c: 'a' | 'b' | 'c' | 'd') {
    setChoice(c);
    setResult(c === exercise.correct);
    const selected =
      c === 'a' ? exercise.option_a : c === 'b' ? exercise.option_b : c === 'c' ? exercise.option_c! : exercise.option_d!;
    speak(selected.hanzi);
  }

  const allOptions: Array<['a' | 'b' | 'c' | 'd', GrammarExampleSentence]> = [
    ['a', exercise.option_a],
    ['b', exercise.option_b],
    ...(exercise.option_c ? [['c', exercise.option_c] as ['c', GrammarExampleSentence]] : []),
    ...(exercise.option_d ? [['d', exercise.option_d] as ['d', GrammarExampleSentence]] : []),
  ];

  return (
    <div className="exercise">
      <div className="phase-label">Which one fits?</div>
      <div className="contrast-context">{exercise.context}</div>
      {allOptions.map(([key, s]) => {
        const cls =
          result === null ? '' : key === exercise.correct ? 'correct' : key === choice ? 'wrong' : '';
        return (
          <button
            key={key}
            className={`contrast-option ${cls}`}
            onClick={() => result === null && pick(key)}
            disabled={result !== null}
          >
            <div className="contrast-hanzi">{s.hanzi}</div>
            {/* Pinyin only after answering — reading the hanzi IS the exercise */}
            {result !== null && <div className="contrast-pinyin">{s.pinyin}</div>}
            {result !== null && <div className="contrast-english">{s.english}</div>}
          </button>
        );
      })}
      {result !== null && (
        <>
          <div className={`result-banner ${result ? 'correct' : 'wrong'}`}>
            {result ? '✓ Correct' : '✗ Not quite'}
          </div>
          <p className="result-explanation">{exercise.explanation}</p>
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={() => onNext(result)}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Offline production exercise: translate in your head (or type it), reveal
 * the reference, judge yourself. No AI checking — honest self-assessment.
 */
function TranslateView(props: {
  pattern: string;
  exercise: Translate;
  speak: (text: string) => void;
  onNext: (correct: boolean) => void;
}) {
  const { pattern, exercise, speak, onNext } = props;
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);

  function reveal() {
    setRevealed(true);
    speak(exercise.reference_hanzi);
  }

  return (
    <div className="exercise">
      <div className="phase-label">Say it · {pattern}</div>
      <div className="translate-prompt">{exercise.english}</div>
      {!revealed ? (
        <>
          <textarea
            className="translate-input"
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="Type it, say it aloud, or build it in your head…"
            rows={3}
            lang="zh-CN"
          />
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={reveal}>
              Show answer
            </button>
          </div>
        </>
      ) : (
        <>
          {answer.trim() && (
            <div className="speak-transcript">
              <div className="speak-transcript-label">Your answer</div>
              <div className="speak-transcript-text">{answer.trim()}</div>
            </div>
          )}
          <div className="translate-ref">
            <div className="translate-ref-hanzi" onClick={() => speak(exercise.reference_hanzi)}>
              {exercise.reference_hanzi} 🔊
            </div>
            <div className="translate-ref-pinyin">{exercise.reference_pinyin}</div>
          </div>
          <p className="result-explanation">
            Did yours match the meaning and use the pattern? (Different wording is fine.)
          </p>
          <div className="exercise-actions">
            <button className="practice-btn" onClick={() => onNext(false)}>
              ✗ Missed it
            </button>
            <button className="practice-btn primary" onClick={() => onNext(true)}>
              ✓ Got it
            </button>
          </div>
        </>
      )}
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
