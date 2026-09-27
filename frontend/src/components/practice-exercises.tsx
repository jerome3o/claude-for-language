/**
 * Study views for the practice exercise types: sentence making, writing
 * (typed and handwritten — separate skills, separate types), dictation, oral
 * expression (recorded) and two-voice conversations.
 *
 * Same contract as lesson-exercises.tsx: plain props, offline-first (TTS is
 * cache-first, Claude's sentence check degrades to self-assessment), and
 * `onNext(correct, answer)` reports what was answered so the lesson attempt
 * can show it to the tutor. Oral expression also hands back the recording.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  diffHanzi,
  sentenceUsesWord,
  resolveConversationVoices,
  type ConversationLine,
  type ConversationQuestion,
  type ConversationSpeaker,
  type ExerciseAnswer,
  type HandwritingAnswer,
  type HanziDiff,
  type LessonSentence,
  type LessonWord,
  type SentenceFeedback,
  type WritingCue,
  type WritingInput,
} from '@shared/lesson';
import { HandwritingPad } from './handwriting/HandwritingPad';
import { StrokesView } from './handwriting/StrokesView';
import { ListenPlayButton, type OnNext } from './lesson-exercises';
import { checkMadeSentence } from '../api/lessonPractice';
import { useAudioRecorder } from '../hooks/useAudio';
import { useLessonClips } from '../hooks/useLessonClips';
import { createAudioPlayer } from '../utils/audioPlayback';
import { shuffledIndexes } from '../utils/shuffle';
import './lesson-exercises.css';

type Speak = (text: string) => void;

// ============ Small shared pieces ============

function WordChips({ words, speak, marks }: { words: LessonWord[]; speak: Speak; marks?: boolean[] }) {
  return (
    <div className="word-chips">
      {words.map((w, i) => (
        <button
          key={i}
          type="button"
          className={`word-chip ${marks ? (marks[i] ? 'used' : 'missing') : ''}`}
          onClick={() => speak(w.hanzi)}
        >
          <span className="word-chip-hanzi" lang="zh-CN">{marks ? (marks[i] ? '✓ ' : '✗ ') : ''}{w.hanzi}</span>
          {w.pinyin && <span className="word-chip-pinyin">{w.pinyin}</span>}
          {w.english && <span className="word-chip-english">{w.english}</span>}
        </button>
      ))}
    </div>
  );
}

function Reference({ sentence, speak, label }: { sentence: LessonSentence; speak: Speak; label?: string }) {
  return (
    <>
      {label && <p className="result-explanation">{label}</p>}
      <div className="translate-ref">
        <div className="translate-ref-hanzi" onClick={() => speak(sentence.hanzi)} lang="zh-CN">
          {sentence.hanzi} 🔊
        </div>
        {sentence.pinyin && <div className="translate-ref-pinyin">{sentence.pinyin}</div>}
        {sentence.english && <div className="contrast-english">{sentence.english}</div>}
      </div>
    </>
  );
}

function SelfAssess({ onAnswer, question }: { onAnswer: (correct: boolean) => void; question: string }) {
  return (
    <>
      <p className="result-explanation">{question}</p>
      <div className="exercise-actions">
        <button className="practice-btn" onClick={() => onAnswer(false)}>✗ Not quite</button>
        <button className="practice-btn primary" onClick={() => onAnswer(true)}>✓ Got it</button>
      </div>
    </>
  );
}

/** The typed answer and the expected text, wrong / missed characters marked. */
function CharDiffView({ diff }: { diff: HanziDiff }) {
  return (
    <div className="char-diff">
      <div className="char-diff-row">
        <span className="char-diff-label">You wrote</span>
        <span className="char-diff-chars" lang="zh-CN">
          {diff.typed.length === 0 ? <span className="char-diff-empty">(nothing)</span> : diff.typed.map((m, i) => (
            <span key={i} className={m.hit ? 'hit' : 'extra'}>{m.ch}</span>
          ))}
        </span>
      </div>
      {!diff.correct && (
        <div className="char-diff-row">
          <span className="char-diff-label">Answer</span>
          <span className="char-diff-chars" lang="zh-CN">
            {diff.expected.map((m, i) => <span key={i} className={m.hit ? 'hit' : 'miss'}>{m.ch}</span>)}
          </span>
        </div>
      )}
    </div>
  );
}

function hasStrokes(hw: HandwritingAnswer | null): boolean {
  return !!hw && ((hw.strokes?.strokes.length ?? 0) > 0 || !!hw.text);
}

/** What the learner wrote by hand next to the model characters. */
function HandwritingCompare({ hw, model, speak }: { hw: HandwritingAnswer | null; model: LessonSentence; speak: Speak }) {
  return (
    <div className="hw-compare">
      <div className="hw-compare-cell">
        {hw?.strokes ? <StrokesView strokes={hw.strokes} label="You wrote" /> : <div className="hw-view">(nothing written)</div>}
      </div>
      <div className="hw-compare-cell">
        <button type="button" className="hw-model" lang="zh-CN" onClick={() => speak(model.hanzi)}>{model.hanzi}</button>
        <div className="hw-model-caption">{model.pinyin ?? ''} 🔊</div>
      </div>
    </div>
  );
}

// ============ Sentence making ============

export function SentenceMakingExercise(props: {
  words: LessonWord[];
  task?: string;
  input?: WritingInput;
  example?: LessonSentence;
  speak: Speak;
  onNext: OnNext;
}) {
  const { words, task, input = 'type', example, speak, onNext } = props;
  const [text, setText] = useState('');
  const [hw, setHw] = useState<HandwritingAnswer | null>(null);
  const [phase, setPhase] = useState<'answer' | 'checking' | 'result'>('answer');
  const [feedback, setFeedback] = useState<SentenceFeedback | null>(null);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);

  const typed = input === 'type';
  const canCheck = typed ? text.trim().length > 0 : hasStrokes(hw);
  const marks = typed && phase === 'result' ? words.map(w => sentenceUsesWord(text, w.hanzi)) : undefined;

  async function check() {
    if (!typed) {
      setPhase('result');
      return;
    }
    setPhase('checking');
    try {
      setFeedback(await checkMadeSentence(words.map(w => w.hanzi), task, text));
    } catch {
      setOfflineNote('Claude can’t check it right now — compare with the example.');
    }
    setPhase('result');
  }

  const answer = (): ExerciseAnswer => ({
    text: typed ? text.trim() : hw?.text,
    handwriting: typed ? undefined : hw ?? undefined,
    feedback: feedback ?? undefined,
    self_assessed: !feedback,
  });

  const verdictLabel: Record<SentenceFeedback['verdict'], string> = {
    correct: '✓ Natural and correct',
    minor: '≈ Almost — one small fix',
    incorrect: '✗ Not quite',
  };
  const claudeCorrect = feedback ? feedback.verdict !== 'incorrect' && feedback.uses_all_words : null;

  return (
    <div className="exercise">
      <div className="phase-label">Make a sentence {typed ? '⌨️' : '✍️'}</div>
      <div className="translate-prompt">{task || 'Write your own sentence using these words.'}</div>
      <WordChips words={words} speak={speak} marks={marks} />

      {phase !== 'result' ? (
        <>
          {typed ? (
            <textarea
              className="translate-input"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Type your sentence in Chinese…"
              rows={3}
              lang="zh-CN"
              disabled={phase === 'checking'}
            />
          ) : (
            <HandwritingPad onChange={setHw} />
          )}
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={check} disabled={!canCheck || phase === 'checking'}>
              {phase === 'checking' ? 'Claude is checking…' : typed ? 'Check' : 'Done'}
            </button>
          </div>
        </>
      ) : (
        <>
          {typed ? (
            <div className="speak-transcript">
              <div className="speak-transcript-label">Your sentence</div>
              <div className="speak-transcript-text" lang="zh-CN">{text.trim()}</div>
            </div>
          ) : hw?.strokes && <StrokesView strokes={hw.strokes} label="Your sentence" />}

          {feedback && (
            <div className={`feedback-card ${feedback.verdict}`}>
              <div className="feedback-verdict">{verdictLabel[feedback.verdict]}</div>
              {!feedback.uses_all_words && <div className="feedback-note">Use every target word.</div>}
              {feedback.corrected && (
                <div className="feedback-corrected" onClick={() => speak(feedback.corrected!.hanzi)}>
                  <div className="translate-ref-hanzi" lang="zh-CN">{feedback.corrected.hanzi} 🔊</div>
                  {feedback.corrected.pinyin && <div className="translate-ref-pinyin">{feedback.corrected.pinyin}</div>}
                  {feedback.corrected.english && <div className="contrast-english">{feedback.corrected.english}</div>}
                </div>
              )}
              <p className="feedback-comment">{feedback.comment}</p>
            </div>
          )}
          {offlineNote && <p className="result-explanation">{offlineNote}</p>}
          {example && <Reference sentence={example} speak={speak} label="One way to say it:" />}

          {feedback ? (
            <div className="exercise-actions">
              <button className="practice-btn primary" onClick={() => onNext(claudeCorrect === true, answer())}>Continue</button>
            </div>
          ) : (
            <SelfAssess
              question={typed ? 'Is your sentence grammatical, and does it use every word?' : 'Compare with the example — is your sentence right, and does it use every word?'}
              onAnswer={correct => onNext(correct, answer())}
            />
          )}
        </>
      )}
    </div>
  );
}

// ============ Writing: cues ============

function WritingCues({ answer, cues, prompt, speak }: { answer: LessonSentence; cues: WritingCue[]; prompt?: string; speak: Speak }) {
  return (
    <>
      {prompt && <div className="contrast-context">{prompt}</div>}
      {cues.includes('english') && answer.english && <div className="translate-prompt">{answer.english}</div>}
      {cues.includes('pinyin') && answer.pinyin && <div className="cue-pinyin">{answer.pinyin}</div>}
      {cues.includes('audio') && <ListenPlayButton text={answer.hanzi} speak={speak} />}
    </>
  );
}

// ============ Writing — typed ============

export function WriteTypedExercise(props: {
  answer: LessonSentence;
  prompt?: string;
  cues?: WritingCue[];
  alternatives?: string[];
  speak: Speak;
  onNext: OnNext;
}) {
  const { answer, prompt, cues = ['english', 'pinyin'], alternatives, speak, onNext } = props;
  const [text, setText] = useState('');
  const [diff, setDiff] = useState<HanziDiff | null>(null);

  function check() {
    setDiff(diffHanzi(text, answer.hanzi, alternatives));
    speak(answer.hanzi);
  }

  return (
    <div className="exercise">
      <div className="phase-label">Type it in characters ⌨️</div>
      <WritingCues answer={answer} cues={cues} prompt={prompt} speak={speak} />
      {!diff ? (
        <>
          <input
            className="translate-input write-input"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && text.trim()) check(); }}
            placeholder="汉字…"
            lang="zh-CN"
            autoComplete="off"
          />
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={check} disabled={!text.trim()}>Check</button>
          </div>
        </>
      ) : (
        <>
          <div className={`result-banner ${diff.correct ? 'correct' : 'wrong'}`}>
            {diff.correct ? '✓ Correct' : `✗ Not quite — ${Math.round(diff.accuracy * 100)}% of the characters`}
          </div>
          <CharDiffView diff={diff} />
          <Reference sentence={answer} speak={speak} />
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={() => onNext(diff.correct, { text: text.trim() })}>Continue</button>
          </div>
        </>
      )}
    </div>
  );
}

// ============ Writing — handwriting ============

export function WriteHandwritingExercise(props: {
  answer: LessonSentence;
  prompt?: string;
  cues?: WritingCue[];
  speak: Speak;
  onNext: OnNext;
}) {
  const { answer, prompt, cues = ['english', 'pinyin'], speak, onNext } = props;
  const [hw, setHw] = useState<HandwritingAnswer | null>(null);
  const [checked, setChecked] = useState(false);
  // A stroke engine's own verdict, when the registered pad gives one.
  const engineVerdict = typeof hw?.checked === 'boolean' ? hw.checked : null;

  return (
    <div className="exercise">
      <div className="phase-label">Write it by hand ✍️</div>
      <WritingCues answer={answer} cues={cues} prompt={prompt} speak={speak} />
      {!checked ? (
        <>
          <HandwritingPad target={answer.hanzi} onChange={setHw} />
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={() => { setChecked(true); speak(answer.hanzi); }} disabled={!hasStrokes(hw)}>
              Check
            </button>
          </div>
        </>
      ) : (
        <>
          {engineVerdict !== null && (
            <div className={`result-banner ${engineVerdict ? 'correct' : 'wrong'}`}>{engineVerdict ? '✓ Correct' : '✗ Not quite'}</div>
          )}
          <HandwritingCompare hw={hw} model={answer} speak={speak} />
          {answer.english && <div className="contrast-english" style={{ textAlign: 'center' }}>{answer.english}</div>}
          {engineVerdict !== null ? (
            <div className="exercise-actions">
              <button className="practice-btn primary" onClick={() => onNext(engineVerdict, { handwriting: hw ?? undefined })}>Continue</button>
            </div>
          ) : (
            <SelfAssess
              question="Did you write every character correctly — right components, nothing missing?"
              onAnswer={correct => onNext(correct, { handwriting: hw ?? undefined, self_assessed: true })}
            />
          )}
        </>
      )}
    </div>
  );
}

// ============ Dictation ============

export function DictationExercise(props: {
  audio: LessonSentence;
  input?: WritingInput;
  alternatives?: string[];
  note?: string;
  speak: Speak;
  onNext: OnNext;
}) {
  const { audio, input = 'type', alternatives, note, speak, onNext } = props;
  const typed = input === 'type';
  const [text, setText] = useState('');
  const [hw, setHw] = useState<HandwritingAnswer | null>(null);
  const [diff, setDiff] = useState<HanziDiff | null>(null);
  const [revealed, setRevealed] = useState(false);
  const plays = useRef(0);

  function check() {
    if (typed) setDiff(diffHanzi(text, audio.hanzi, alternatives));
    setRevealed(true);
  }

  const engineVerdict = !typed && typeof hw?.checked === 'boolean' ? hw.checked : null;
  const base = (): ExerciseAnswer => ({ plays: plays.current, ...(typed ? { text: text.trim() } : { handwriting: hw ?? undefined }) });

  return (
    <div className="exercise">
      <div className="phase-label">Dictation {typed ? '⌨️' : '✍️'}</div>
      <p className="describe-task">Write down exactly what you hear.</p>
      <ListenPlayButton text={audio.hanzi} speak={speak} onPlay={() => { plays.current++; }} />
      {!revealed ? (
        <>
          {typed ? (
            <input
              className="translate-input write-input"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && text.trim()) check(); }}
              placeholder="汉字…"
              lang="zh-CN"
              autoComplete="off"
            />
          ) : (
            <HandwritingPad target={audio.hanzi} onChange={setHw} />
          )}
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={check} disabled={typed ? !text.trim() : !hasStrokes(hw)}>Check</button>
          </div>
        </>
      ) : (
        <>
          {diff && (
            <>
              <div className={`result-banner ${diff.correct ? 'correct' : 'wrong'}`}>
                {diff.correct ? '✓ Every character right' : `${Math.round(diff.accuracy * 100)}% of the characters`}
              </div>
              <CharDiffView diff={diff} />
            </>
          )}
          {!typed && (
            <>
              {engineVerdict !== null && (
                <div className={`result-banner ${engineVerdict ? 'correct' : 'wrong'}`}>{engineVerdict ? '✓ Correct' : '✗ Not quite'}</div>
              )}
              <HandwritingCompare hw={hw} model={audio} speak={speak} />
            </>
          )}
          <Reference sentence={audio} speak={speak} />
          {note && <p className="result-explanation">{note}</p>}
          {typed || engineVerdict !== null ? (
            <div className="exercise-actions">
              <button className="practice-btn primary" onClick={() => onNext(typed ? diff!.correct : engineVerdict!, base())}>Continue</button>
            </div>
          ) : (
            <SelfAssess
              question="Did you write down every character you heard?"
              onAnswer={correct => onNext(correct, { ...base(), self_assessed: true })}
            />
          )}
        </>
      )}
    </div>
  );
}

// ============ Oral expression (recorded) ============

export function OralExpressionExercise(props: {
  prompt: string;
  questionAudio?: LessonSentence;
  hints?: LessonWord[];
  example?: LessonSentence;
  targetSeconds?: number;
  /** Media key for the attempt; without one (preview / trial) nothing is kept. */
  mediaKey?: string;
  speak: Speak;
  onNext: (correct: boolean, answer: ExerciseAnswer, recording?: Blob) => void;
}) {
  const { prompt, questionAudio, hints, example, targetSeconds = 30, mediaKey, speak, onNext } = props;
  const recorder = useAudioRecorder();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const playerRef = useRef(createAudioPlayer());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  useEffect(() => {
    if (questionAudio) speak(questionAudio.hanzi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!recorder.isRecording || startedAt === null) return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(timer);
  }, [recorder.isRecording, startedAt]);

  async function start() {
    playerRef.current.stop();
    setElapsed(0);
    setStartedAt(Date.now());
    await recorder.startRecording();
  }

  function stop() {
    if (startedAt !== null) setDurationMs(Date.now() - startedAt);
    recorder.stopRecording();
  }

  function finish() {
    setDone(true);
    if (example) speak(example.hanzi);
  }

  const blob = recorder.audioBlob;
  const answer = (): ExerciseAnswer => ({
    self_assessed: true,
    recording: blob && mediaKey ? { media_key: mediaKey, duration_ms: durationMs, mime: blob.type || 'audio/webm' } : undefined,
  });

  return (
    <div className="exercise">
      <div className="phase-label">Speak — recorded 🎙</div>
      <div className="translate-prompt">{prompt}</div>
      {questionAudio && (
        <button type="button" className="question-audio" onClick={() => speak(questionAudio.hanzi)}>
          🔊 <span lang="zh-CN">{questionAudio.hanzi}</span>
        </button>
      )}
      {hints && hints.length > 0 && (
        <>
          <div className="hint-label">Useful words</div>
          <WordChips words={hints} speak={speak} />
        </>
      )}

      {!done ? (
        <div className="oral-recorder">
          {recorder.isRecording ? (
            <>
              <div className="rec-status">
                <span className="rec-dot" /> Recording… {elapsed}s <span className="rec-target">/ ~{targetSeconds}s</span>
              </div>
              <div className="rec-level"><div style={{ width: `${Math.round(recorder.audioLevel * 100)}%` }} /></div>
              <button className="rec-btn stop" onClick={stop} aria-label="Stop recording">■</button>
            </>
          ) : blob ? (
            <>
              <div className="rec-status">Recorded {Math.round(durationMs / 1000)}s</div>
              <div className="exercise-actions">
                <button className="practice-btn" onClick={() => playerRef.current.play(blob, { label: 'lesson-recording' })}>▶ Listen back</button>
                <button className="practice-btn" onClick={start}>🎙 Again</button>
              </div>
              <div className="exercise-actions">
                <button className="practice-btn primary" onClick={finish}>Done</button>
              </div>
            </>
          ) : (
            <>
              <button className="rec-btn" onClick={start} aria-label="Start recording">🎙</button>
              <div className="rec-hint">Tap to record your answer (about {targetSeconds} seconds)</div>
              {recorder.error && (
                <>
                  <p className="result-explanation">{recorder.error}</p>
                  <div className="exercise-actions">
                    <button className="practice-btn" onClick={() => { setSkipped(true); finish(); }}>Say it without recording</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {blob && !skipped && (
            <div className="exercise-actions">
              <button className="practice-btn" onClick={() => playerRef.current.play(blob, { label: 'lesson-recording' })}>▶ Your answer</button>
            </div>
          )}
          {example && <Reference sentence={example} speak={speak} label="One way to say it:" />}
          {mediaKey && blob && <p className="result-explanation small">Your tutor can listen to this recording.</p>}
          <div className="exercise-actions">
            <button className="practice-btn" onClick={() => onNext(false, answer(), blob ?? undefined)}>✗ Not quite</button>
            <button className="practice-btn primary" onClick={() => onNext(true, answer(), blob ?? undefined)}>✓ I said it well</button>
          </div>
        </>
      )}
    </div>
  );
}

// ============ Conversation (two voices) ============

interface QuestionState {
  choice?: number;
  text?: string;
  revealed?: boolean;
  correct: boolean | null;
}

const SPEAKER_ICONS: Record<string, string> = { female: '👩', male: '👨' };

export function ConversationExercise(props: {
  situation: string;
  speakers: ConversationSpeaker[];
  lines: ConversationLine[];
  questions: ConversationQuestion[];
  onNext: OnNext;
}) {
  const { situation, speakers, lines, questions, onNext } = props;
  const voices = useMemo(() => resolveConversationVoices(speakers), [speakers]);
  const { playClip, stop } = useLessonClips();
  const [playing, setPlaying] = useState(false);
  const [currentLine, setCurrentLine] = useState<number | null>(null);
  const [listened, setListened] = useState(false);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [transcriptPeek, setTranscriptPeek] = useState(false);
  const [answers, setAnswers] = useState<QuestionState[]>(() => questions.map(() => ({ correct: null })));
  const [showTranscript, setShowTranscript] = useState(false);
  const [optionOrders] = useState(() => questions.map(q => shuffledIndexes(q.options?.length ?? 0)));
  const runRef = useRef(0);
  const plays = useRef(0);

  const speakerIcon = (i: number) => SPEAKER_ICONS[speakers[i]?.voice ?? (i % 2 === 0 ? 'female' : 'male')] ?? '🧑';

  async function playAll() {
    const run = ++runRef.current;
    setPlaying(true);
    plays.current++;
    let failures = 0;
    for (let i = 0; i < lines.length; i++) {
      if (runRef.current !== run) return;
      setCurrentLine(i);
      const ok = await playClip(lines[i].hanzi, voices[lines[i].speaker]);
      if (!ok) failures++;
      if (runRef.current !== run) return;
      await new Promise(r => setTimeout(r, 350));
    }
    if (runRef.current !== run) return;
    setPlaying(false);
    setCurrentLine(null);
    setListened(true);
    if (failures === lines.length) setAudioUnavailable(true);
  }

  function stopPlaying() {
    runRef.current++;
    stop();
    setPlaying(false);
    setCurrentLine(null);
    setListened(true);
  }

  // Start listening straight away, like every listening exercise.
  useEffect(() => {
    void playAll();
    return () => { runRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function playLine(i: number) {
    runRef.current++;
    setPlaying(false);
    setCurrentLine(i);
    void playClip(lines[i].hanzi, voices[lines[i].speaker]).then(() => setCurrentLine(c => (c === i ? null : c)));
  }

  function setAnswer(i: number, patch: Partial<QuestionState>) {
    setAnswers(prev => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  }

  const allAnswered = answers.every(a => a.correct !== null);
  const score = answers.filter(a => a.correct).length;
  const questionsOpen = listened || audioUnavailable;

  const report = (): ExerciseAnswer => ({
    plays: plays.current,
    hint_used: transcriptPeek || undefined,
    questions: answers.map(a => ({ choice: a.choice, text: a.text?.trim() || undefined, correct: a.correct })),
  });

  return (
    <div className="exercise convo">
      <div className="phase-label">Conversation 💬</div>
      <div className="convo-situation">{situation}</div>
      <div className="convo-speakers">
        {speakers.map((s, i) => (
          <span key={i} className={`convo-speaker s${i}`}>{speakerIcon(i)} {s.name}</span>
        ))}
      </div>

      <div className="convo-bubbles" aria-label="Conversation lines">
        {lines.map((line, i) => (
          <button
            key={i}
            type="button"
            className={`convo-bubble s${Math.min(line.speaker, 2)} ${currentLine === i ? 'active' : ''} ${showTranscript || transcriptPeek ? 'open' : ''}`}
            onClick={() => (questionsOpen ? playLine(i) : undefined)}
            aria-label={`Line ${i + 1}, ${speakers[line.speaker]?.name ?? ''}`}
          >
            <span className="convo-bubble-icon">{speakerIcon(line.speaker)}</span>
            {showTranscript || transcriptPeek ? (
              <span className="convo-bubble-text">
                <span className="convo-hanzi" lang="zh-CN">{line.hanzi}</span>
                {showTranscript && line.pinyin && <span className="convo-pinyin">{line.pinyin}</span>}
                {showTranscript && line.english && <span className="convo-english">{line.english}</span>}
              </span>
            ) : (
              <span className="convo-wave" aria-hidden="true">{currentLine === i ? '▮▯▮▮▯▮' : '···'}</span>
            )}
          </button>
        ))}
      </div>

      <div className="exercise-actions">
        {playing ? (
          <button className="practice-btn" onClick={stopPlaying}>■ Stop</button>
        ) : (
          <button className="practice-btn" onClick={() => void playAll()}>{listened ? '↻ Play again' : '▶ Play conversation'}</button>
        )}
      </div>

      {audioUnavailable && !transcriptPeek && (
        <div className="convo-offline">
          <p className="result-explanation">The audio isn’t on this device yet (it downloads on the next sync online).</p>
          <button className="practice-btn" onClick={() => setTranscriptPeek(true)}>Read it instead</button>
        </div>
      )}

      {questionsOpen && (
        <div className="convo-questions">
          {questions.map((q, qi) => {
            const a = answers[qi];
            return (
              <div key={qi} className="convo-question">
                <div className="convo-question-text">{qi + 1}. {q.question}</div>
                {q.options ? (
                  <div className="convo-options">
                    {optionOrders[qi].map(oi => {
                      const answered = a.correct !== null;
                      const cls = !answered ? '' : oi === q.correct ? 'correct' : oi === a.choice ? 'wrong' : '';
                      return (
                        <button
                          key={oi}
                          type="button"
                          className={`contrast-option ${cls}`}
                          disabled={answered}
                          onClick={() => setAnswer(qi, { choice: oi, correct: oi === q.correct })}
                        >
                          {q.options![oi]}
                        </button>
                      );
                    })}
                  </div>
                ) : !a.revealed ? (
                  <>
                    <textarea
                      className="translate-input"
                      rows={2}
                      value={a.text ?? ''}
                      onChange={e => setAnswer(qi, { text: e.target.value })}
                      placeholder="Your answer (English or Chinese)…"
                    />
                    <div className="exercise-actions">
                      <button className="practice-btn" onClick={() => setAnswer(qi, { revealed: true })}>Show answer</button>
                    </div>
                  </>
                ) : (
                  <>
                    {a.text?.trim() && <div className="convo-your-answer">You: {a.text.trim()}</div>}
                    <div className="convo-model-answer">{q.answer}</div>
                    {a.correct === null && (
                      <div className="exercise-actions">
                        <button className="practice-btn" onClick={() => setAnswer(qi, { correct: false })}>✗ Missed it</button>
                        <button className="practice-btn primary" onClick={() => setAnswer(qi, { correct: true })}>✓ Got it</button>
                      </div>
                    )}
                  </>
                )}
                {a.correct !== null && q.explanation && <p className="result-explanation">{q.explanation}</p>}
              </div>
            );
          })}
        </div>
      )}

      {allAnswered && (
        <>
          <div className={`result-banner ${score === questions.length ? 'correct' : 'wrong'}`}>
            {score}/{questions.length} questions right
          </div>
          <div className="exercise-actions">
            {!showTranscript && (
              <button className="practice-btn" onClick={() => setShowTranscript(true)}>Show transcript</button>
            )}
            <button className="practice-btn primary" onClick={() => { stopPlaying(); onNext(score === questions.length, report()); }}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}
