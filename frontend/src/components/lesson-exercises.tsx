/**
 * Reusable, schema-driven exercise views.
 *
 * These are the unbundled building blocks of a lesson: each takes plain
 * props (no lesson-type coupling) so both the grammar lessons and custom
 * mini lessons compose them in any order. Everything works fully offline;
 * production exercises (translate / speak / describe) are self-assessed.
 *
 * Styling reuses the practice-page classes (PracticePage.css) plus
 * lesson-exercises.css for the new match / describe-image views.
 */

import { useEffect, useState } from 'react';
import { useCachedImageUrl } from '../hooks/useCachedImageUrl';
import './lesson-exercises.css';

export interface ExerciseSentence {
  hanzi: string;
  pinyin?: string | null;
  english?: string | null;
}

type Speak = (text: string) => void;

/** Joined-sentence scramble check: whitespace-insensitive, alt orders accepted. */
export function checkScrambleOrder(
  userOrder: string[],
  correctOrder: string[],
  altOrders?: string[][],
): boolean {
  const join = (arr: string[]) => arr.join('').replace(/\s/g, '');
  const userSentence = join(userOrder);
  if (userSentence === join(correctOrder)) return true;
  return (altOrders ?? []).some(alt => userSentence === join(alt));
}

// ============ Word order (scramble) ============

export function ScrambleExercise(props: {
  english: string;
  tiles: string[];
  correctOrder: string[];
  altOrders?: string[][];
  speak: Speak;
  onNext: (correct: boolean) => void;
}) {
  const { english, tiles, correctOrder, altOrders, speak, onNext } = props;
  const [pickedOrder, setPickedOrder] = useState<number[]>([]);
  const [result, setResult] = useState<boolean | null>(null);
  // The English translation starts hidden: build the sentence from the Chinese
  // tiles alone, reaching for the English only as a deliberate hint. After
  // checking it's always shown so the feedback has full context.
  const [showEnglish, setShowEnglish] = useState(false);

  const picked = pickedOrder.map(i => tiles[i]);
  const allPicked = pickedOrder.length === tiles.length;

  function check() {
    const ok = checkScrambleOrder(picked, correctOrder, altOrders);
    setResult(ok);
    speak(correctOrder.join(''));
  }

  return (
    <div className="exercise">
      <div className="phase-label">Word order</div>
      {showEnglish || result !== null ? (
        <div className="scramble-prompt">{english}</div>
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
        {tiles.map((t, i) => {
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
          {!result && <div className="result-correction">{correctOrder.join(' ')}</div>}
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

// ============ Multiple choice ============

export function ChoiceExercise(props: {
  question: string;
  options: ExerciseSentence[];
  correctIndex: number;
  explanation?: string;
  speak: Speak;
  onNext: (correct: boolean) => void;
}) {
  const { question, options, correctIndex, explanation, speak, onNext } = props;
  const [choice, setChoice] = useState<number | null>(null);
  const result = choice === null ? null : choice === correctIndex;

  function pick(index: number) {
    setChoice(index);
    speak(options[index].hanzi);
  }

  return (
    <div className="exercise">
      <div className="phase-label">Which one fits?</div>
      <div className="contrast-context">{question}</div>
      {options.map((s, index) => {
        const cls =
          result === null ? '' : index === correctIndex ? 'correct' : index === choice ? 'wrong' : '';
        return (
          <button
            key={index}
            className={`contrast-option ${cls}`}
            onClick={() => result === null && pick(index)}
            disabled={result !== null}
          >
            <div className="contrast-hanzi">{s.hanzi}</div>
            {/* Pinyin/English only after answering — reading the hanzi IS the exercise */}
            {result !== null && s.pinyin && <div className="contrast-pinyin">{s.pinyin}</div>}
            {result !== null && s.english && <div className="contrast-english">{s.english}</div>}
          </button>
        );
      })}
      {result !== null && (
        <>
          <div className={`result-banner ${result ? 'correct' : 'wrong'}`}>
            {result ? '✓ Correct' : '✗ Not quite'}
          </div>
          {explanation && <p className="result-explanation">{explanation}</p>}
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

// ============ Translate (self-assessed) ============

export function TranslateExercise(props: {
  label?: string;
  english: string;
  referenceHanzi: string;
  referencePinyin?: string | null;
  note?: string;
  speak: Speak;
  onNext: (correct: boolean) => void;
}) {
  const { label, english, referenceHanzi, referencePinyin, note, speak, onNext } = props;
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);

  function reveal() {
    setRevealed(true);
    speak(referenceHanzi);
  }

  return (
    <div className="exercise">
      <div className="phase-label">{label || 'Say it in Chinese'}</div>
      <div className="translate-prompt">{english}</div>
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
            <div className="translate-ref-hanzi" onClick={() => speak(referenceHanzi)}>
              {referenceHanzi} 🔊
            </div>
            {referencePinyin && <div className="translate-ref-pinyin">{referencePinyin}</div>}
          </div>
          <p className="result-explanation">
            {note || 'Did yours match the meaning? (Different wording is fine.)'}
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

// ============ Match the pairs ============

function shuffled(count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Connect the Chinese words with their English meanings. Correct = every
 * pair matched with no wrong taps along the way.
 */
export function MatchExercise(props: {
  pairs: Array<{ hanzi: string; pinyin?: string | null; english: string }>;
  speak: Speak;
  onNext: (correct: boolean) => void;
}) {
  const { pairs, speak, onNext } = props;
  const [leftOrder] = useState(() => shuffled(pairs.length));
  const [rightOrder] = useState(() => shuffled(pairs.length));
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [selectedRight, setSelectedRight] = useState<number | null>(null);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [wrongFlash, setWrongFlash] = useState<{ left: number; right: number } | null>(null);

  const done = matched.size === pairs.length;

  // Evaluate whenever one side is picked while the other is already selected
  function trySelect(side: 'left' | 'right', pairIndex: number) {
    if (matched.has(pairIndex) || wrongFlash || done) return;
    if (side === 'left') {
      speak(pairs[pairIndex].hanzi);
      if (selectedRight === null) {
        setSelectedLeft(pairIndex === selectedLeft ? null : pairIndex);
        return;
      }
      evaluate(pairIndex, selectedRight);
    } else {
      if (selectedLeft === null) {
        setSelectedRight(pairIndex === selectedRight ? null : pairIndex);
        return;
      }
      evaluate(selectedLeft, pairIndex);
    }
  }

  function evaluate(left: number, right: number) {
    setSelectedLeft(null);
    setSelectedRight(null);
    if (left === right) {
      setMatched(prev => new Set(prev).add(left));
    } else {
      setMistakes(m => m + 1);
      setWrongFlash({ left, right });
      setTimeout(() => setWrongFlash(null), 600);
    }
  }

  function itemClass(side: 'left' | 'right', pairIndex: number): string {
    if (matched.has(pairIndex)) return 'matched';
    if (wrongFlash && (side === 'left' ? wrongFlash.left : wrongFlash.right) === pairIndex) return 'wrong';
    if ((side === 'left' ? selectedLeft : selectedRight) === pairIndex) return 'selected';
    return '';
  }

  return (
    <div className="exercise">
      <div className="phase-label">Match the pairs</div>
      <div className="match-grid">
        <div className="match-column">
          {leftOrder.map(pairIndex => (
            <button
              key={pairIndex}
              className={`match-item hanzi ${itemClass('left', pairIndex)}`}
              onClick={() => trySelect('left', pairIndex)}
              disabled={matched.has(pairIndex)}
            >
              <span>{pairs[pairIndex].hanzi}</span>
              {matched.has(pairIndex) && pairs[pairIndex].pinyin && (
                <span className="match-pinyin">{pairs[pairIndex].pinyin}</span>
              )}
            </button>
          ))}
        </div>
        <div className="match-column">
          {rightOrder.map(pairIndex => (
            <button
              key={pairIndex}
              className={`match-item ${itemClass('right', pairIndex)}`}
              onClick={() => trySelect('right', pairIndex)}
              disabled={matched.has(pairIndex)}
            >
              {pairs[pairIndex].english}
            </button>
          ))}
        </div>
      </div>
      {done && (
        <>
          <div className={`result-banner ${mistakes === 0 ? 'correct' : 'wrong'}`}>
            {mistakes === 0 ? '✓ All matched!' : `Matched with ${mistakes} miss${mistakes === 1 ? '' : 'es'}`}
          </div>
          <div className="exercise-actions">
            <button className="practice-btn primary" onClick={() => onNext(mistakes === 0)}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============ Describe the picture (self-assessed) ============

export function DescribeImageExercise(props: {
  imageKey?: string | null;
  imagePrompt: string;
  task?: string;
  referenceHanzi: string;
  referencePinyin?: string | null;
  referenceEnglish?: string | null;
  speak: Speak;
  onNext: (correct: boolean) => void;
}) {
  const { imageKey, imagePrompt, task, referenceHanzi, referencePinyin, referenceEnglish, speak, onNext } = props;
  const [revealed, setRevealed] = useState(false);
  const imageUrl = useCachedImageUrl(imageKey ?? null);

  function reveal() {
    setRevealed(true);
    speak(referenceHanzi);
  }

  return (
    <div className="exercise">
      <div className="phase-label">Describe the picture</div>
      {imageUrl ? (
        <div className="describe-image-container">
          <img src={imageUrl} alt="Scene to describe" className="describe-image" />
        </div>
      ) : (
        // The illustration hasn't been generated (or cached) yet — the
        // exercise still works from the scene description.
        <div className="describe-image-fallback">
          <span className="describe-image-fallback-label">Imagine this scene:</span> {imagePrompt}
        </div>
      )}
      <p className="describe-task">{task || 'Describe what you see — out loud, in Chinese.'}</p>
      {!revealed ? (
        <div className="exercise-actions">
          <button className="practice-btn primary" onClick={reveal}>
            🎤 I've described it
          </button>
        </div>
      ) : (
        <>
          <div className="translate-ref">
            <div className="translate-ref-hanzi" onClick={() => speak(referenceHanzi)}>
              {referenceHanzi} 🔊
            </div>
            {referencePinyin && <div className="translate-ref-pinyin">{referencePinyin}</div>}
            {referenceEnglish && <div className="contrast-english">{referenceEnglish}</div>}
          </div>
          <p className="result-explanation">
            Did your description capture the scene? (Any correct sentence counts.)
          </p>
          <div className="exercise-actions">
            <button className="practice-btn" onClick={() => onNext(false)}>
              ✗ Not quite
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

// ============ Speak your own sentence (self-assessed) ============

export function SpeakPromptExercise(props: {
  prompt: string;
  example?: ExerciseSentence | null;
  speak: Speak;
  onNext: (correct: boolean) => void;
}) {
  const { prompt, example, speak, onNext } = props;
  const [finished, setFinished] = useState(false);

  return (
    <div className="exercise">
      <div className="phase-label">Say it out loud</div>
      <div className="translate-prompt">{prompt}</div>
      {!finished ? (
        <div className="exercise-actions">
          <button className="practice-btn primary" onClick={() => setFinished(true)}>
            🎤 I've said my sentence
          </button>
        </div>
      ) : (
        <>
          {example && (
            <>
              <p className="result-explanation">One way to say it:</p>
              <div className="translate-ref">
                <div className="translate-ref-hanzi" onClick={() => speak(example.hanzi)}>
                  {example.hanzi} 🔊
                </div>
                {example.pinyin && <div className="translate-ref-pinyin">{example.pinyin}</div>}
                {example.english && <div className="contrast-english">{example.english}</div>}
              </div>
            </>
          )}
          <p className="result-explanation">Was your sentence grammatical and on task?</p>
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

// ============ Teaching note (not scored) ============

export function LessonNoteCard(props: {
  title?: string;
  body?: string;
  sentences?: ExerciseSentence[];
  speak: Speak;
  onNext: () => void;
}) {
  const { title, body, sentences, speak, onNext } = props;

  // Hearing the first example right away mirrors the grammar lesson's
  // listen-first flow.
  useEffect(() => {
    if (sentences && sentences.length > 0) speak(sentences[0].hanzi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="exercise">
      {title && <div className="phase-label">{title}</div>}
      {body && (
        <div className="lesson-note-body">
          {body.split(/\n{2,}/).map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      )}
      {sentences?.map((s, i) => (
        <div className="lesson-note-sentence" key={i} onClick={() => speak(s.hanzi)}>
          <div className="lesson-note-hanzi">{s.hanzi} 🔊</div>
          {s.pinyin && <div className="translate-ref-pinyin">{s.pinyin}</div>}
          {s.english && <div className="contrast-english">{s.english}</div>}
        </div>
      ))}
      <div className="exercise-actions">
        <button className="practice-btn primary" onClick={onNext}>
          Continue
        </button>
      </div>
    </div>
  );
}
