import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createQuiz,
  hintLevel,
  isComplete,
  mistakeMessage,
  requestHint,
  strokeCount,
  submitStroke,
  summarizeCharacter,
  summarizeExercise,
  writableCharacters,
  type CharStrokeData,
  type CharacterQuizState,
  type CharacterWritingResult,
  type Point,
  type WritingExerciseResult,
  type WritingGrade,
  type WritingMode,
} from '@shared/strokes';
import { getStrokeData } from '../../services/strokeData';
import { StrokePad, type InkOutcome } from './StrokePad';
import {
  isWritingSoundMuted,
  playCharacterDone,
  playStrokeCorrect,
  playStrokeMiss,
  setWritingSoundMuted,
} from './writingFeedback';
import './strokes.css';

/**
 * Write a word by hand, stroke by stroke, with feedback on every stroke.
 *
 * Self-contained so it can be dropped anywhere: the practice page, a sheet
 * over a study card, and later a mini-lesson exercise (`{ type: 'write',
 * hanzi, pinyin?, english?, mode? }` → render this with `onComplete` feeding
 * the lesson's result) or a "write" card type. Grading lives in
 * shared/strokes (pure, unit-tested); this component is rendering + timing.
 * Works offline for every character whose stroke data is on the device.
 */
export interface WritingExerciseProps {
  /** The word (non-Han characters are ignored). */
  text: string;
  /** Prompt shown in recall mode instead of the characters. */
  pinyin?: string | null;
  english?: string | null;
  initialMode?: WritingMode;
  allowModeSwitch?: boolean;
  /** Play the stroke-order animation when a character comes up in trace mode. Default true. */
  autoDemo?: boolean;
  /** Called once per finished run of the word. */
  onComplete?: (result: WritingExerciseResult) => void;
  /** Shows a Done button on the summary. */
  onDone?: () => void;
  doneLabel?: string;
  /** Recall mode hides the characters even with no pinyin / English prompt
   * (dictation: the prompt is the audio the lesson plays). */
  hideCharacters?: boolean;
}

type Loaded =
  | { status: 'loading' }
  | { status: 'offline'; chars: string[] }
  | { status: 'ready'; data: Map<string, CharStrokeData>; skipped: string[] };

type Tone = 'neutral' | 'good' | 'bad' | 'hint';

const GRADE_LINE: Record<WritingGrade, string> = {
  perfect: '完美！Perfect',
  good: '很好！Nicely done',
  practice: 'Done — worth another go',
};

const MODE_LABEL: Record<WritingMode, string> = { trace: 'Trace', recall: 'From memory' };

export function WritingExercise({
  text,
  pinyin,
  english,
  initialMode = 'trace',
  allowModeSwitch = true,
  autoDemo = true,
  onComplete,
  onDone,
  doneLabel = 'Done',
  hideCharacters = false,
}: WritingExerciseProps) {
  const chars = useMemo(() => writableCharacters(text), [text]);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded({ status: 'loading' });
    (async () => {
      const unique = Array.from(new Set(chars));
      const results = await Promise.all(unique.map(async (c) => [c, await getStrokeData(c)] as const));
      if (cancelled) return;
      const offline = results.filter(([, r]) => r.status === 'offline').map(([c]) => c);
      if (offline.length > 0) {
        setLoaded({ status: 'offline', chars: offline });
        return;
      }
      const data = new Map<string, CharStrokeData>();
      const skipped: string[] = [];
      for (const [c, r] of results) {
        if (r.status === 'ok') data.set(c, r.data);
        else skipped.push(c);
      }
      setLoaded({ status: 'ready', data, skipped });
    })();
    return () => {
      cancelled = true;
    };
  }, [chars, loadAttempt]);

  if (chars.length === 0) {
    return (
      <div className="writing">
        <div className="writing-message">
          <strong>Nothing to write</strong>
          Type a Chinese character or word.
        </div>
      </div>
    );
  }

  if (loaded.status === 'loading') {
    return (
      <div className="writing">
        <div className="writing-message">Loading stroke order…</div>
      </div>
    );
  }

  if (loaded.status === 'offline') {
    return (
      <div className="writing">
        <div className="writing-message" role="alert">
          <strong>{loaded.chars.join(' ')} isn't saved on this device yet</strong>
          Connect to the internet once and the stroke order is kept for offline practice.
          <div style={{ marginTop: '0.75rem' }}>
            <button className="btn btn-secondary" onClick={() => setLoadAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const playable = chars.filter((c) => loaded.data.has(c));
  if (playable.length === 0) {
    return (
      <div className="writing">
        <div className="writing-message">
          <strong>No stroke-order data for “{text}”</strong>
          The stroke database covers about 9,500 common characters; this one isn't among them.
        </div>
      </div>
    );
  }

  return (
    <WritingRun
      key={text}
      text={text}
      chars={playable}
      data={loaded.data}
      skipped={loaded.skipped}
      pinyin={pinyin}
      english={english}
      initialMode={initialMode}
      allowModeSwitch={allowModeSwitch}
      autoDemo={autoDemo}
      onComplete={onComplete}
      onDone={onDone}
      doneLabel={doneLabel}
      hideCharacters={hideCharacters}
    />
  );
}

interface RunProps extends Omit<WritingExerciseProps, 'text'> {
  text: string;
  chars: string[];
  data: Map<string, CharStrokeData>;
  skipped: string[];
  initialMode: WritingMode;
  allowModeSwitch: boolean;
  autoDemo: boolean;
  doneLabel: string;
  hideCharacters: boolean;
}

function WritingRun({
  text,
  chars,
  data,
  skipped,
  pinyin,
  english,
  initialMode,
  allowModeSwitch,
  autoDemo,
  onComplete,
  onDone,
  doneLabel,
  hideCharacters,
}: RunProps) {
  const [mode, setMode] = useState<WritingMode>(initialMode);
  const [charIdx, setCharIdx] = useState(0);
  const [results, setResults] = useState<CharacterWritingResult[]>([]);
  const [phase, setPhase] = useState<'writing' | 'summary'>('writing');
  const [quiz, setQuizState] = useState<CharacterQuizState>(() =>
    createQuiz(chars[0], data.get(chars[0])!, { mode: initialMode }, Date.now()),
  );
  const quizRef = useRef(quiz);
  const setQuiz = (q: CharacterQuizState) => {
    quizRef.current = q;
    setQuizState(q);
  };
  const [demoKey, setDemoKey] = useState<number | null>(() => (autoDemo && initialMode === 'trace' ? Date.now() : null));
  const [justCompleted, setJustCompleted] = useState<number | null>(null);
  const [status, setStatus] = useState<{ text: string; tone: Tone }>({ text: '', tone: 'neutral' });
  const [celebrate, setCelebrate] = useState<WritingGrade | null>(null);
  const [muted, setMuted] = useState(isWritingSoundMuted);
  const startedAt = useRef(Date.now());
  const advanceTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
  }, []);

  const hasPrompt = Boolean(pinyin || english);
  const hideChars = mode === 'recall' && (hasPrompt || hideCharacters);

  const startChar = useCallback(
    (idx: number, m: WritingMode, demo: boolean) => {
      const c = chars[idx];
      setCharIdx(idx);
      setQuiz(createQuiz(c, data.get(c)!, { mode: m }, Date.now()));
      setJustCompleted(null);
      setCelebrate(null);
      setStatus({ text: '', tone: 'neutral' });
      setDemoKey(demo ? Date.now() : null);
    },
    [chars, data],
  );

  const restartWord = (m: WritingMode) => {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    setResults([]);
    setPhase('writing');
    startedAt.current = Date.now();
    startChar(0, m, autoDemo && m === 'trace');
  };

  const finishChar = (state: CharacterQuizState) => {
    const now = Date.now();
    const result = summarizeCharacter(state, now);
    const all = [...results, result];
    setResults(all);
    setCelebrate(result.grade);
    setStatus({ text: GRADE_LINE[result.grade], tone: result.grade === 'practice' ? 'hint' : 'good' });
    playCharacterDone(result.grade === 'perfect');
    advanceTimer.current = window.setTimeout(() => {
      advanceTimer.current = null;
      if (charIdx + 1 < chars.length) {
        startChar(charIdx + 1, mode, autoDemo && mode === 'trace');
      } else {
        setPhase('summary');
        onComplete?.(summarizeExercise(text, mode, all, skipped, startedAt.current, Date.now()));
      }
    }, 1100);
  };

  const onStroke = (points: Point[]): InkOutcome => {
    const current = quizRef.current;
    if (isComplete(current)) return 'ignore';
    const { state, feedback } = submitStroke(current, points, Date.now());
    setQuiz(state);
    switch (feedback.kind) {
      case 'ignored':
        return 'ignore';
      case 'correct':
        setJustCompleted(feedback.index);
        playStrokeCorrect(feedback.index);
        if (feedback.complete) finishChar(state);
        else setStatus({ text: '', tone: 'neutral' });
        return 'accept';
      case 'revealed':
        setJustCompleted(feedback.index);
        playStrokeMiss();
        if (feedback.complete) finishChar(state);
        else setStatus({ text: `That's how stroke ${feedback.index + 1} goes — on to the next.`, tone: 'hint' });
        return 'reject';
      case 'mistake':
        playStrokeMiss();
        setStatus({ text: mistakeMessage(feedback), tone: feedback.hint === 'none' ? 'bad' : 'hint' });
        return 'reject';
    }
  };

  const onDemoEnd = useCallback(() => {
    setDemoKey(null);
    // Timing starts when the learner can write, not when the animation began.
    const q = quizRef.current;
    if (q.current === 0 && q.pending.misses === 0) {
      setQuiz({ ...q, startedAt: Date.now(), pending: { ...q.pending, startedAt: Date.now() } });
    }
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setWritingSoundMuted(next);
    setMuted(next);
  };

  if (phase === 'summary') {
    return (
      <WritingSummary
        results={results}
        skipped={skipped}
        mode={mode}
        allowModeSwitch={allowModeSwitch}
        onAgain={() => restartWord(mode)}
        onSwitchMode={() => {
          const m = mode === 'trace' ? 'recall' : 'trace';
          setMode(m);
          restartWord(m);
        }}
        onDone={onDone}
        doneLabel={doneLabel}
      />
    );
  }

  const charData = data.get(chars[charIdx])!;
  const level = hintLevel(quiz);
  const finished = isComplete(quiz);
  const total = strokeCount(quiz);
  const progressText =
    demoKey !== null
      ? 'Watch the stroke order — or just start writing'
      : finished
        ? `${total} strokes${chars.length > 1 ? ` · character ${charIdx + 1} of ${chars.length}` : ''}`
        : `Stroke ${quiz.current + 1} of ${total}${chars.length > 1 ? ` · character ${charIdx + 1} of ${chars.length}` : ''}`;


  return (
    <div className="writing" data-testid="writing-exercise">
      <div className="writing-head">
        <div className="writing-chars" aria-label="Characters">
          {chars.map((c, i) => {
            const r = results[i];
            const show = !hideChars || i < results.length;
            const cls = ['writing-char-chip', i === charIdx ? 'current' : '', r ? `grade-${r.grade}` : '', show ? '' : 'hidden-char']
              .filter(Boolean)
              .join(' ');
            return (
              <span key={i} className={cls}>
                {show ? c : i + 1}
              </span>
            );
          })}
        </div>
        {hasPrompt && (
          <div className="writing-prompt">
            {pinyin && <span className="writing-prompt-pinyin">{pinyin}</span>}
            {english && <span className="writing-prompt-english">{english}</span>}
          </div>
        )}
        <button
          type="button"
          className="writing-sound"
          onClick={toggleMute}
          aria-label={muted ? 'Turn sounds on' : 'Turn sounds off'}
          title={muted ? 'Sounds off' : 'Sounds on'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      {allowModeSwitch && (
        <div className="writing-modes" role="tablist" aria-label="Writing mode">
          {(['trace', 'recall'] as WritingMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`writing-mode${mode === m ? ' active' : ''}`}
              onClick={() => {
                if (m === mode) return;
                setMode(m);
                restartWord(m);
              }}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      <div
        className={`writing-status tone-${status.text ? status.tone : 'neutral'}`}
        role="status"
        aria-live="polite"
        data-testid="writing-status"
      >
        {status.text || progressText}
      </div>

      <StrokePad
        key={`${charIdx}-${chars[charIdx]}`}
        data={charData}
        showOutline={mode === 'trace'}
        completed={quiz.done.map((d) => ({ index: d.index, revealed: d.revealed }))}
        justCompleted={justCompleted}
        hint={!finished && level !== 'none' ? { index: quiz.current, level } : null}
        demoKey={demoKey}
        onDemoEnd={onDemoEnd}
        onPenDown={() => {
          if (demoKey !== null) setDemoKey(null);
        }}
        celebrate={celebrate}
        disabled={finished}
        onStroke={onStroke}
        label={hideChars ? `Write character ${charIdx + 1}` : `Write ${chars[charIdx]}`}
      />

      <div className="writing-tools">
        <button type="button" className="btn btn-secondary" onClick={() => setDemoKey(Date.now())} disabled={finished}>
          ▶ Watch
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setQuiz(requestHint(quizRef.current));
            setDemoKey(null);
            setStatus({ text: `Follow the blue stroke — start at the dot.`, tone: 'hint' });
          }}
          disabled={finished || level === 'stroke'}
        >
          💡 Hint
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => startChar(charIdx, mode, false)}
          disabled={finished}
        >
          ↺ Restart
        </button>
      </div>
    </div>
  );
}

function strokeDotClass(s: CharacterWritingResult['strokes'][number]): string {
  if (s.revealed) return 'writing-dot revealed';
  if (s.hinted) return 'writing-dot hinted';
  if (s.misses > 0) return 'writing-dot missed';
  return 'writing-dot';
}

function resultDetail(r: CharacterWritingResult): string {
  const parts: string[] = [];
  parts.push(r.mistakes === 0 ? 'no mistakes' : `${r.mistakes} mistake${r.mistakes === 1 ? '' : 's'}`);
  if (r.hints > 0) parts.push(`${r.hints} hint${r.hints === 1 ? '' : 's'}`);
  const kinds = new Set(r.strokes.flatMap((s) => s.mistakes));
  if (kinds.has('wrong_order')) parts.push('order slips');
  if (kinds.has('backwards')) parts.push('a stroke backwards');
  parts.push(`${(r.ms / 1000).toFixed(r.ms < 10_000 ? 1 : 0)} s`);
  return parts.join(' · ');
}

function WritingSummary({
  results,
  skipped,
  mode,
  allowModeSwitch,
  onAgain,
  onSwitchMode,
  onDone,
  doneLabel,
}: {
  results: CharacterWritingResult[];
  skipped: string[];
  mode: WritingMode;
  allowModeSwitch: boolean;
  onAgain: () => void;
  onSwitchMode: () => void;
  onDone?: () => void;
  doneLabel: string;
}) {
  const grade: WritingGrade = results.some((r) => r.grade === 'practice')
    ? 'practice'
    : results.every((r) => r.grade === 'perfect')
      ? 'perfect'
      : 'good';
  const mistakes = results.reduce((s, r) => s + r.mistakes, 0);
  const hints = results.reduce((s, r) => s + r.hints, 0);
  const title = grade === 'perfect' ? '完美！Perfect strokes' : grade === 'good' ? '很好！Nicely written' : 'Keep practising';

  return (
    <div className="writing writing-summary" data-testid="writing-summary">
      <div className="writing-summary-title">{title}</div>
      <div className="writing-summary-sub">
        {results.length} character{results.length === 1 ? '' : 's'} · {mistakes} mistake{mistakes === 1 ? '' : 's'} · {hints} hint
        {hints === 1 ? '' : 's'} · {MODE_LABEL[mode].toLowerCase()}
      </div>
      {results.map((r, i) => (
        <div key={i} className={`writing-result-row grade-${r.grade}`}>
          <span className="writing-result-char">{r.character}</span>
          <div className="writing-result-body">
            <span className="writing-result-label">
              {r.grade === 'perfect' ? 'Perfect' : r.grade === 'good' ? 'Good' : 'Needs practice'}
            </span>
            <div className="writing-dots" aria-label="Strokes">
              {r.strokes.map((s) => (
                <span key={s.index} className={strokeDotClass(s)} title={`Stroke ${s.index + 1}`} />
              ))}
            </div>
            <span className="writing-result-detail">{resultDetail(r)}</span>
          </div>
        </div>
      ))}
      <div className="writing-legend" aria-hidden="true">
        <span><i className="writing-dot" /> first try</span>
        <span><i className="writing-dot missed" /> after a miss</span>
        <span><i className="writing-dot hinted" /> with a hint</span>
        <span><i className="writing-dot revealed" /> shown</span>
      </div>
      {skipped.length > 0 && (
        <div className="writing-summary-sub">No stroke data for {skipped.join(' ')} — skipped.</div>
      )}
      <div className="writing-summary-actions">
        <button type="button" className={`btn btn-secondary${allowModeSwitch ? '' : ' full'}`} onClick={onAgain}>
          ↺ Again
        </button>
        {allowModeSwitch && (
          <button type="button" className="btn btn-secondary" onClick={onSwitchMode}>
            {mode === 'trace' ? '🧠 From memory' : '✏️ Trace it'}
          </button>
        )}
        {onDone && (
          <button type="button" className="btn btn-primary full" onClick={onDone}>
            {doneLabel}
          </button>
        )}
      </div>
    </div>
  );
}
