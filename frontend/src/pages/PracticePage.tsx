import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getNextGrammarPoint,
  startPracticeSession,
  submitPracticeAttempt,
  completePracticeSession,
  listGrammarPoints,
  type GrammarPoint,
  type PracticeSessionContent,
  type ScrambleExercise,
  type ContrastExercise,
  type TranslateExercise,
  type TranslateFeedback,
  type ExampleSentence,
  transcribeAudio,
} from '../api/client';
import { useAudioRecorder } from '../hooks/useAudio';
import { usePracticeTTS } from '../hooks/usePracticeTTS';
import './PracticePage.css';

type Phase =
  | 'landing'
  | 'generating'
  | 'flood'
  | 'scramble'
  | 'contrast'
  | 'translate'
  | 'speak'
  | 'done';

type ActivePhase = Exclude<Phase, 'landing' | 'generating' | 'done'>;

const PHASE_ORDER: Phase[] = ['flood', 'scramble', 'contrast', 'translate', 'speak'];
const SPEAK_COUNT = 2;

const PRACTICE_STATE_KEY = 'practice-session-state';
const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PersistedState {
  phase: ActivePhase;
  sessionId: string;
  content: PracticeSessionContent;
  idx: number;
  score: { correct: number; total: number };
  savedAt: number;
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(PRACTICE_STATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PersistedState;
    if (Date.now() - s.savedAt > STATE_MAX_AGE_MS) {
      localStorage.removeItem(PRACTICE_STATE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function savePersistedState(s: PersistedState) {
  try {
    localStorage.setItem(PRACTICE_STATE_KEY, JSON.stringify(s));
  } catch {}
}

function clearPersistedState() {
  localStorage.removeItem(PRACTICE_STATE_KEY);
}

export function PracticePage() {
  const navigate = useNavigate();
  const { speak, prefetch } = usePracticeTTS();

  const [phase, setPhase] = useState<Phase>('landing');
  const [error, setError] = useState<string | null>(null);
  const [nextPoint, setNextPoint] = useState<GrammarPoint | null>(null);
  const [allPoints, setAllPoints] = useState<
    Array<GrammarPoint & { progress: { status: 'new' | 'learning' | 'known' } | null }>
  >([]);
  const [showPicker, setShowPicker] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [content, setContent] = useState<PracticeSessionContent | null>(null);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [resumeCandidate, setResumeCandidate] = useState<PersistedState | null>(loadPersistedState);

  useEffect(() => {
    getNextGrammarPoint()
      .then((r) => setNextPoint(r.point))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (phase === 'done') {
      clearPersistedState();
      return;
    }
    if (phase === 'landing' || phase === 'generating' || !sessionId || !content) return;
    savePersistedState({
      phase: phase as ActivePhase,
      sessionId,
      content,
      idx,
      score,
      savedAt: Date.now(),
    });
  }, [phase, idx, score, sessionId, content]);

  function togglePicker() {
    if (!showPicker && allPoints.length === 0) {
      listGrammarPoints()
        .then((r) => setAllPoints(r.points))
        .catch(() => {});
    }
    setShowPicker((v) => !v);
  }

  const phaseLengths = useMemo(
    () =>
      content
        ? [
            content.flood.length,
            content.scrambles.length,
            content.contrasts.length,
            content.translates.length,
            Math.min(SPEAK_COUNT, content.flood.length),
          ]
        : [],
    [content],
  );
  const totalExercises = phaseLengths.reduce((a, b) => a + b, 0);

  const completedExercises = useMemo(() => {
    const phaseIdx = PHASE_ORDER.indexOf(phase);
    if (phaseIdx < 0) return phase === 'done' ? totalExercises : 0;
    return phaseLengths.slice(0, phaseIdx).reduce((a, b) => a + b, 0) + idx;
  }, [phaseLengths, phase, idx, totalExercises]);

  function resumeSession(s: PersistedState) {
    setSessionId(s.sessionId);
    setContent(s.content);
    setIdx(s.idx);
    setScore(s.score);
    setPhase(s.phase);
    setResumeCandidate(null);
    void prefetch(s.content.flood.map((e) => e.hanzi));
  }

  function discardResume() {
    clearPersistedState();
    setResumeCandidate(null);
  }

  async function start(pointId?: string) {
    setResumeCandidate(null);
    clearPersistedState();
    setPhase('generating');
    setError(null);
    try {
      const res = await startPracticeSession(pointId);
      setSessionId(res.session_id);
      setContent(res.content);
      setIdx(0);
      setScore({ correct: 0, total: 0 });
      setPhase('flood');
      void prefetch(res.content.flood.map((e) => e.hanzi));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('landing');
    }
  }

  function advance(gotPoint: boolean | null) {
    if (gotPoint !== null) {
      setScore((s) => ({
        correct: s.correct + (gotPoint ? 1 : 0),
        total: s.total + 1,
      }));
    }
    if (!content) return;
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
      if (sessionId) {
        const finalCorrect = score.correct + (gotPoint ? 1 : 0);
        const finalTotal = score.total + (gotPoint !== null ? 1 : 0);
        void completePracticeSession(sessionId, finalCorrect, finalTotal);
      }
    }
  }

  if (phase === 'landing') {
    return (
      <div className="practice-page">
        <h1>Grammar Practice</h1>
        <p className="practice-sub">
          One pattern a day. Examples → word order → meaning → say it yourself. ~10 min.
        </p>
        {error && <div className="practice-error">{error}</div>}
        {resumeCandidate && (
          <div className="resume-card">
            <div className="resume-label">Resume where you left off</div>
            <div className="resume-point">{resumeCandidate.content.grammar_point.title}</div>
            <div className="resume-meta">
              {resumeCandidate.phase} · {resumeCandidate.score.correct}/{resumeCandidate.score.total} correct
            </div>
            <div className="resume-actions">
              <button className="practice-btn primary" onClick={() => resumeSession(resumeCandidate)}>
                Resume
              </button>
              <button className="practice-btn" onClick={discardResume}>
                Start fresh
              </button>
            </div>
          </div>
        )}
        {nextPoint ? (
          <div className="gp-card">
            <div className="gp-level">{nextPoint.level}</div>
            <h2>{nextPoint.title}</h2>
            <div className="gp-pattern">{nextPoint.pattern}</div>
            <p>{nextPoint.explanation}</p>
            <button className="practice-btn primary" onClick={() => start(nextPoint.id)}>
              Start practice
            </button>
          </div>
        ) : (
          <div className="gp-card">Loading today's pattern…</div>
        )}
        <button className="practice-link" onClick={togglePicker}>
          {showPicker ? 'Hide all patterns' : 'Choose a different pattern'}
        </button>
        {showPicker && (
          <div className="gp-list">
            {allPoints.map((p) => (
              <button key={p.id} className="gp-list-item" onClick={() => start(p.id)}>
                <span className="gp-list-title">
                  <span className="gp-level small">{p.level}</span> {p.title}
                </span>
                <span className={`gp-status ${p.progress?.status ?? 'new'}`}>
                  {p.progress?.status ?? 'new'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (phase === 'generating') {
    return (
      <div className="practice-page center">
        <div className="spinner" />
        <p>Generating exercises from your vocabulary…</p>
        <p className="practice-sub">This takes a few seconds.</p>
      </div>
    );
  }

  if (!content || !sessionId) return null;
  const gp = content.grammar_point;

  const header = (
    <div className="practice-header">
      <button className="practice-back" onClick={() => navigate('/')}>
        ←
      </button>
      <div className="practice-progress">
        <div
          className="practice-progress-fill"
          style={{ width: `${(completedExercises / totalExercises) * 100}%` }}
        />
      </div>
      <div className="practice-count">
        {completedExercises}/{totalExercises}
      </div>
    </div>
  );

  if (phase === 'flood') {
    return (
      <div className="practice-page">
        {header}
        <FloodView
          gp={gp}
          example={content.flood[idx]}
          index={idx}
          total={content.flood.length}
          speak={speak}
          onNext={() => advance(null)}
        />
      </div>
    );
  }

  if (phase === 'scramble') {
    return (
      <div className="practice-page">
        {header}
        <ScrambleView
          key={`sc-${idx}`}
          exercise={content.scrambles[idx]}
          speak={speak}
          onSubmit={async (order) => {
            const r = await submitPracticeAttempt(sessionId, {
              exercise_type: 'scramble',
              exercise_index: idx,
              user_answer: order,
            });
            return r.is_correct ?? false;
          }}
          onNext={(correct) => advance(correct)}
        />
      </div>
    );
  }

  if (phase === 'contrast') {
    return (
      <div className="practice-page">
        {header}
        <ContrastView
          key={`ct-${idx}`}
          exercise={content.contrasts[idx]}
          speak={speak}
          onSubmit={async (choice) => {
            const r = await submitPracticeAttempt(sessionId, {
              exercise_type: 'contrast',
              exercise_index: idx,
              user_answer: choice,
            });
            return r.is_correct ?? false;
          }}
          onNext={(correct) => advance(correct)}
        />
      </div>
    );
  }

  if (phase === 'speak') {
    return (
      <div className="practice-page">
        {header}
        <SpeakView
          key={`sp-${idx}`}
          gp={gp}
          model={content.flood[idx]}
          speak={speak}
          onSubmit={async (transcript) => {
            const r = await submitPracticeAttempt(sessionId, {
              exercise_type: 'speak',
              exercise_index: idx,
              user_answer: transcript,
            });
            return r.feedback;
          }}
          onNext={(correct) => advance(correct)}
          onSkip={() => advance(null)}
        />
      </div>
    );
  }

  if (phase === 'translate') {
    return (
      <div className="practice-page">
        {header}
        <TranslateView
          key={`tr-${idx}`}
          gp={gp}
          exercise={content.translates[idx]}
          speak={speak}
          onSubmit={async (answer) => {
            const r = await submitPracticeAttempt(sessionId, {
              exercise_type: 'translate',
              exercise_index: idx,
              user_answer: answer,
            });
            return r.feedback;
          }}
          onNext={(correct) => advance(correct)}
        />
      </div>
    );
  }

  const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
  return (
    <div className="practice-page center">
      <div className="done-emoji">🎉</div>
      <h1>Pattern complete</h1>
      <h2>{gp.title}</h2>
      <div className="done-score">
        {score.correct}/{score.total} correct ({pct}%)
      </div>
      {gp.cgw_url && (
        <a className="practice-link" href={gp.cgw_url} target="_blank" rel="noreferrer">
          Read more on Chinese Grammar Wiki →
        </a>
      )}
      <button className="practice-btn primary" onClick={() => navigate('/')}>
        Done
      </button>
      <button className="practice-btn" onClick={() => { clearPersistedState(); setPhase('landing'); }}>
        Another pattern
      </button>
    </div>
  );
}

function FeedbackPanel(props: {
  feedback: TranslateFeedback;
  pattern: string;
  speak: (text: string) => void;
  showCorrected?: boolean;
}) {
  const { feedback, pattern, speak, showCorrected } = props;
  const correct = feedback.is_correct && feedback.uses_target_structure;
  return (
    <>
      <div className={`result-banner ${correct ? 'correct' : 'wrong'}`}>
        {correct
          ? '✓ Correct'
          : feedback.uses_target_structure
            ? '✗ Close — small fix needed'
            : `✗ Try using the pattern: ${pattern}`}
      </div>
      <div className="diff-display">
        {feedback.diff_segments.map((seg, i) => (
          <span key={i} className={`diff-${seg.status}`}>
            {seg.text}
          </span>
        ))}
      </div>
      {showCorrected && (
        <div className="translate-ref">
          <div className="translate-ref-hanzi" onClick={() => speak(feedback.corrected_hanzi)}>
            {feedback.corrected_hanzi} 🔊
          </div>
          <div className="translate-ref-pinyin">{feedback.corrected_pinyin}</div>
        </div>
      )}
      <p className="result-explanation">{feedback.explanation}</p>
    </>
  );
}

// ============ Exercise sub-views ============

function FloodView(props: {
  gp: GrammarPoint;
  example: ExampleSentence;
  index: number;
  total: number;
  speak: (text: string) => void;
  onNext: () => void;
}) {
  const { gp, example, index, total, speak, onNext } = props;
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
          <h2>{gp.title}</h2>
          <div className="gp-pattern">{gp.pattern}</div>
          <p>{gp.explanation}</p>
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
  exercise: ScrambleExercise;
  speak: (text: string) => void;
  onSubmit: (order: string[]) => Promise<boolean>;
  onNext: (correct: boolean) => void;
}) {
  const { exercise, speak, onSubmit, onNext } = props;
  const [pickedOrder, setPickedOrder] = useState<number[]>([]);
  const [result, setResult] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const picked = pickedOrder.map((i) => exercise.tiles[i]);
  const allPicked = pickedOrder.length === exercise.tiles.length;

  async function check() {
    setChecking(true);
    const ok = await onSubmit(picked);
    setResult(ok);
    setChecking(false);
    speak(exercise.correct_order.join(''));
  }

  return (
    <div className="exercise">
      <div className="phase-label">Word order</div>
      <div className="scramble-prompt">{exercise.english}</div>
      <div className="scramble-row answer">
        {picked.map((t, i) => (
          <button
            key={i}
            className="tile"
            onClick={() =>
              result === null && setPickedOrder(pickedOrder.filter((_, j) => j !== i))
            }
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
          <button
            className="practice-btn primary"
            onClick={check}
            disabled={!allPicked || checking}
          >
            {checking ? 'Checking…' : 'Check'}
          </button>
        </div>
      ) : (
        <>
          <div className={`result-banner ${result ? 'correct' : 'wrong'}`}>
            {result ? '✓ Correct' : '✗ Not quite'}
          </div>
          {!result && (
            <div className="result-correction">{exercise.correct_order.join(' ')}</div>
          )}
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
  exercise: ContrastExercise;
  speak: (text: string) => void;
  onSubmit: (choice: 'a' | 'b') => Promise<boolean>;
  onNext: (correct: boolean) => void;
}) {
  const { exercise, speak, onSubmit, onNext } = props;
  const [choice, setChoice] = useState<'a' | 'b' | null>(null);
  const [result, setResult] = useState<boolean | null>(null);

  async function pick(c: 'a' | 'b') {
    setChoice(c);
    const ok = await onSubmit(c);
    setResult(ok);
    speak((c === 'a' ? exercise.option_a : exercise.option_b).hanzi);
  }

  function opt(key: 'a' | 'b', s: ExampleSentence) {
    const cls =
      result === null
        ? ''
        : key === exercise.correct
          ? 'correct'
          : key === choice
            ? 'wrong'
            : '';
    return (
      <button
        className={`contrast-option ${cls}`}
        onClick={() => result === null && pick(key)}
        disabled={result !== null}
      >
        <div className="contrast-hanzi">{s.hanzi}</div>
        <div className="contrast-pinyin">{s.pinyin}</div>
      </button>
    );
  }

  return (
    <div className="exercise">
      <div className="phase-label">Which one fits?</div>
      <div className="contrast-context">{exercise.context}</div>
      {opt('a', exercise.option_a)}
      {opt('b', exercise.option_b)}
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

function TranslateView(props: {
  gp: GrammarPoint;
  exercise: TranslateExercise;
  speak: (text: string) => void;
  onSubmit: (answer: string) => Promise<TranslateFeedback | null>;
  onNext: (correct: boolean) => void;
}) {
  const { gp, exercise, speak, onSubmit, onNext } = props;
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<TranslateFeedback | null>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    if (!answer.trim()) return;
    setChecking(true);
    const fb = await onSubmit(answer.trim());
    setFeedback(fb);
    setChecking(false);
    if (fb) speak(fb.corrected_hanzi);
  }

  const correct = feedback ? feedback.is_correct && feedback.uses_target_structure : null;

  return (
    <div className="exercise">
      <div className="phase-label">Say it · {gp.pattern}</div>
      <div className="translate-prompt">{exercise.english}</div>
      {!feedback ? (
        <>
          <textarea
            className="translate-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type or speak your Chinese answer…"
            rows={3}
            lang="zh-CN"
          />
          <div className="exercise-actions">
            <button
              className="practice-btn primary"
              onClick={check}
              disabled={!answer.trim() || checking}
            >
              {checking ? 'Checking…' : 'Check'}
            </button>
          </div>
        </>
      ) : (
        <>
          <FeedbackPanel feedback={feedback} pattern={gp.pattern} speak={speak} showCorrected />
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={() => onNext(!!correct)}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SpeakView(props: {
  gp: GrammarPoint;
  model: ExampleSentence;
  speak: (text: string) => void;
  onSubmit: (transcript: string) => Promise<TranslateFeedback | null>;
  onNext: (correct: boolean) => void;
  onSkip: () => void;
}) {
  const { gp, model, speak, onSubmit, onNext, onSkip } = props;
  const { isRecording, audioBlob, audioLevel, startRecording, stopRecording, clearRecording } =
    useAudioRecorder();
  const [transcript, setTranscript] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TranslateFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const processedRef = useRef<Blob | null>(null);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  useEffect(() => {
    speak(model.hanzi);
  }, [model.hanzi, speak]);

  useEffect(() => {
    if (!audioBlob || processedRef.current === audioBlob) return;
    processedRef.current = audioBlob;
    setBusy(true);
    transcribeAudio(audioBlob)
      .then(async (r) => {
        setTranscript(r.text);
        const fb = await submitRef.current(r.text);
        setFeedback(fb);
      })
      .catch(() => setTranscript(''))
      .finally(() => setBusy(false));
  }, [audioBlob]);

  function retry() {
    clearRecording();
    processedRef.current = null;
    setTranscript(null);
    setFeedback(null);
  }

  const correct = feedback ? feedback.is_correct && feedback.uses_target_structure : null;

  return (
    <div className="exercise">
      <div className="phase-label">Say your own · {gp.pattern}</div>
      <div className="speak-model">
        <div className="speak-model-label">Listen, then say a different sentence with the same pattern</div>
        <div className="speak-model-hanzi" onClick={() => speak(model.hanzi)}>
          {model.hanzi} 🔊
        </div>
        <div className="flood-pinyin">{model.pinyin}</div>
      </div>

      {transcript === null ? (
        <>
          <button
            className={`record-btn ${isRecording ? 'recording' : ''}`}
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            disabled={busy}
          >
            {isRecording ? (
              <>
                <span
                  className="record-pulse"
                  style={{ transform: `scale(${1 + audioLevel * 0.6})` }}
                />
                Tap to stop
              </>
            ) : busy ? (
              'Transcribing…'
            ) : (
              '🎤 Tap to record'
            )}
          </button>
          <button className="practice-link" onClick={onSkip}>
            Skip
          </button>
        </>
      ) : (
        <>
          <div className="speak-transcript">
            <div className="speak-transcript-label">You said</div>
            <div className="speak-transcript-text">{transcript || '(nothing detected)'}</div>
          </div>
          {feedback && <FeedbackPanel feedback={feedback} pattern={gp.pattern} speak={speak} />}
          <div className="exercise-actions">
            <button className="practice-btn" onClick={retry}>
              Try again
            </button>
            <button
              className="practice-btn primary"
              onClick={() => onNext(!!correct)}
              disabled={!feedback}
            >
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}
