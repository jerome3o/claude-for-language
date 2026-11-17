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

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExplorableText } from './explorer/ExplorableText';
import type { ExerciseAnswer, LessonPattern } from '@shared/lesson';
import { structureNoteView } from '@shared/lesson/pattern';
import { StructureCards } from './lessons/StructureCards';
import { useLessonImage, lessonImagePlaceholder } from '../hooks/useLessonImage';
import { shuffledIndexes, scramblePoolOrder } from '../utils/shuffle';
import { VoiceTextInput, type DictatedAnswer } from './voice/VoiceTextInput';
import { TakeLockActions } from './voice/TakeLock';
import { lessonSpokenCheck } from '@shared/lesson/spoken-check';
import { isExactHanziMatch } from '@shared/lesson/answer-check';
import { answerMarks } from '@shared/lesson/feedback';
import { useLessonAnswerCheck } from './lessons/useLessonAnswerCheck';
import { SpeakingAnswer } from './lessons/SpeakingAnswer';
import { FeedbackSentence, LessonFeel, MarkedAnswer, ReplayButton, ResultBanner, SayItAgain } from './lessons/LessonFeedback';
import { useScrambleCheck } from './lessons/useScrambleCheck';
import { scrambleCheckInput, scrambleLocalVerdict, scrambleOutcome, scrambleSentence, scrambleSpokenSentence } from '@shared/lesson/scrambleCheck';
import { CLAUDE_CHECKING_LINE } from '@shared/lesson/feedback';
import { choiceAsksForWrong, choicePickSpeech, choiceSayAgainSentence, isWrongOption } from '@shared/lesson/choiceMistake';
import { useChoiceCorrection } from '../services/choiceCorrection';
import './lesson-exercises.css';

export interface ExerciseSentence {
  hanzi: string;
  pinyin?: string | null;
  english?: string | null;
}

type Speak = (text: string) => void;

/** What an exercise reports when the learner moves on: the verdict plus what
 * they answered (recorded in the lesson attempt for the tutor to review). */
export type OnNext = (correct: boolean, answer?: ExerciseAnswer) => void;

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

/**
 * A multiple-choice option once answered: its Chinese tappable word by word into the explorer, ▶ to hear it again,
 * then its pinyin / English (a choice is never changed once checked).
 */
function AnsweredOption({ option, cls, speak, exerciseType }: {
  option: { hanzi: string; pinyin?: string | null; english?: string | null };
  cls: string;
  speak: Speak;
  exerciseType: string;
}) {
  const han = /\p{Script=Han}/u.test(option.hanzi);
  return (
    <div className={`contrast-option answered ${cls}`} data-testid="lesson-answered-option">
      <div className="contrast-hanzi answered-option-line">
        {han ? <ExplorableText text={option.hanzi} source="lesson" /> : option.hanzi}
        {han && <ReplayButton hanzi={option.hanzi} speak={speak} exerciseType={exerciseType} testId="lesson-option-replay" />}
      </div>
      {option.pinyin && <div className="contrast-pinyin">{option.pinyin}</div>}
      {option.english && <div className="contrast-english">{option.english}</div>}
    </div>
  );
}

// ============ Word order (scramble) ============

export function ScrambleExercise(props: {
  english: string;
  tiles: string[];
  correctOrder: string[];
  altOrders?: string[][];
  /** The lesson's title / grammar point, for Claude's check of an unlisted order. */
  focus?: string;
  speak: Speak;
  onNext: OnNext;
}) {
  const { english, tiles, correctOrder, altOrders, focus, speak, onNext } = props;
  const [pickedOrder, setPickedOrder] = useState<number[]>([]);
  // The device's verdict on Check: the listed orders are right at once; any other order of every tile is asked of
  // Claude (shared/lesson/scrambleCheck.ts) — "Checking…" in place, then ✓ Also right / ✗ Not quite.
  const [local, setLocal] = useState<'right' | 'unexpected' | null>(null);
  const scrambleCheck = useScrambleCheck();
  // Pool display order is shuffled per attempt (never presenting a correct
  // order) — exercises repeat under FSRS, so fixed positions would be
  // memorizable, and authored tile order is often the answer itself.
  const [poolOrder] = useState(() => scramblePoolOrder(tiles, correctOrder, altOrders));
  // The English translation starts hidden: build the sentence from the Chinese
  // tiles alone, reaching for the English only as a deliberate hint. After
  // checking it's always shown so the feedback has full context.
  const [showEnglish, setShowEnglish] = useState(false);

  const picked = pickedOrder.map(i => tiles[i]);
  const allPicked = pickedOrder.length === tiles.length;
  const outcome = local ? scrambleOutcome(local, scrambleCheck.status, scrambleSentence(picked) === scrambleSentence(correctOrder)) : null;
  const checked = outcome !== null;

  // Play once the verdict is known: his own order when it is right, else the expected one.
  const spokenFor = useRef<string | null>(null);
  const toSpeak = outcome ? scrambleSpokenSentence(outcome, picked, correctOrder) : null;
  useEffect(() => {
    if (!toSpeak || spokenFor.current === toSpeak) return;
    spokenFor.current = toSpeak;
    speak(toSpeak);
  }, [toSpeak, speak]);

  function check() {
    const verdict = scrambleLocalVerdict(picked, tiles, correctOrder, altOrders);
    if (verdict === 'incomplete') return;
    setLocal(verdict);
    if (verdict === 'unexpected') scrambleCheck.start(scrambleCheckInput({ english, correct_order: correctOrder }, picked, focus));
  }

  function next() {
    if (!outcome) return;
    const status = scrambleCheck.status;
    const done = local === 'unexpected' && status?.status === 'done' ? status.check : undefined;
    onNext(outcome.correct, { order: picked, hint_used: showEnglish, ...(done ? { check: done } : {}) });
  }

  return (
    <div className="exercise">
      <div className="phase-label">Word order</div>
      {showEnglish || checked ? (
        <div className="scramble-prompt">{english}</div>
      ) : (
        <button className="scramble-prompt hidden-hint" onClick={() => setShowEnglish(true)}>
          Tap to show English
        </button>
      )}
      <div className="scramble-row answer">
        {picked.map((t, i) => !checked ? (
          <button
            key={i}
            className="tile"
            onClick={() => setPickedOrder(pickedOrder.filter((_, j) => j !== i))}
          >
            {t}
          </button>
        ) : (
          // Checked: his blocks are words to explore now (while arranging, a tap places / removes a block).
          <span key={i} className="tile tile-done" data-testid="scramble-answer-tile">
            <ExplorableText text={t} source="lesson" />
          </span>
        ))}
        {picked.length === 0 && <div className="tile-placeholder">Tap tiles below</div>}
      </div>
      <div className="scramble-row pool">
        {poolOrder.map(i => {
          const isPicked = pickedOrder.includes(i);
          return (
            <button
              key={i}
              className={`tile ${isPicked ? 'ghost' : ''}`}
              onClick={() => !isPicked && setPickedOrder([...pickedOrder, i])}
              disabled={isPicked || checked}
            >
              {tiles[i]}
            </button>
          );
        })}
      </div>
      {!outcome ? (
        <TakeLockActions>
          <button className="practice-btn primary" onClick={check} disabled={!allPicked}>
            Check
          </button>
        </TakeLockActions>
      ) : (
        <>
          {outcome.tone === 'neutral' ? (
            <div className="result-banner checking" role="status" aria-live="polite" data-testid="lesson-result-banner" data-kind={outcome.kind}>
              {outcome.banner}
            </div>
          ) : (
            <ResultBanner ok={outcome.tone === 'good'}>
              <span data-kind={outcome.kind} data-testid="scramble-verdict">{outcome.banner}</span>
            </ResultBanner>
          )}
          <FeedbackSentence
            hanzi={correctOrder.join('')}
            label={outcome.expectedLabel ?? undefined}
            speak={speak}
            exerciseType="scramble"
            testId="scramble-correct-sentence"
          />
          <SayItAgain hanzi={correctOrder.join('')} exerciseType="scramble" />
          <TakeLockActions>
            <button className="practice-btn primary" onClick={next}>
              Continue
            </button>
          </TakeLockActions>
          {/* Claude's slot, LAST so nothing he reads moves when it lands (shared/lesson/feedback.ts). */}
          {outcome.checking && (
            <div className="answer-check checking" role="status" aria-live="polite" data-testid="answer-check-checking">
              <span className="answer-check-dot" aria-hidden="true" /> {CLAUDE_CHECKING_LINE}
            </div>
          )}
          {outcome.note && (
            <p className={`scramble-claude-note ${outcome.tone}`} data-testid="scramble-claude-note">
              <span className="scramble-claude-note-label">Claude: </span>
              <ExplorableText text={outcome.note} source="lesson" />
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ============ Multiple choice ============

/**
 * The option of a "which sentence is wrong?" choice that IS the mistake, once answered: struck through, marked in words
 * (never colour alone), no ▶ — the mistake is never read aloud (shared/lesson/choiceMistake.ts).
 */
function MistakeOption({ option, cls }: { option: ExerciseSentence; cls: string }) {
  return (
    <div className={`contrast-option answered choice-mistake ${cls}`} data-testid="choice-mistake-option">
      <div className="contrast-hanzi answered-option-line">
        <s className="choice-mistake-hanzi" lang="zh-CN">{option.hanzi}</s>
      </div>
      <div className="choice-mistake-label">✗ This sentence has the mistake</div>
      {option.english && <div className="contrast-english">{option.english}</div>}
    </div>
  );
}

export function ChoiceExercise(props: {
  question: string;
  options: ExerciseSentence[];
  correctIndex: number;
  explanation?: string;
  /** A "which is wrong?" choice's right version of the wrong option (spec `correction`). */
  correction?: ExerciseSentence | null;
  speak: Speak;
  onNext: OnNext;
}) {
  const { question, options, correctIndex, explanation, correction, speak, onNext } = props;
  const ex = useMemo(() => ({
    question,
    options: options.map(o => ({ hanzi: o.hanzi, pinyin: o.pinyin ?? undefined, english: o.english ?? undefined })),
    correct: correctIndex,
    explanation,
    correction: correction?.hanzi ? { hanzi: correction.hanzi, pinyin: correction.pinyin ?? undefined, english: correction.english ?? undefined } : undefined,
  }), [question, options, correctIndex, explanation, correction]);
  // "Which sentence is wrong?": the reveal plays the CORRECTION, never the mistake (an older lesson asks for one).
  const fix = useChoiceCorrection(ex);
  const asksWrong = choiceAsksForWrong(ex);
  const [choice, setChoice] = useState<number | null>(null);
  // Options are shuffled per attempt — under FSRS the same exercise comes
  // back, and "the answer is always the first one" would be memorizable.
  const [optionOrder] = useState(() => shuffledIndexes(options.length));
  const result = choice === null ? null : choice === correctIndex;
  // Picked the mistake before its correction arrived: speak the correction once it does (never the mistake).
  const owedCorrection = useRef(false);

  function pick(index: number) {
    setChoice(index);
    const text = choicePickSpeech(ex, index, fix);
    if (text) speak(text);
    else owedCorrection.current = isWrongOption(ex, index, fix);
  }

  useEffect(() => {
    if (!owedCorrection.current || fix.status === 'loading') return;
    owedCorrection.current = false;
    const text = choice === null ? '' : choicePickSpeech(ex, choice, fix);
    if (text) speak(text);
  }, [fix, choice, ex, speak]);

  const sayAgain = result !== null ? choiceSayAgainSentence(ex, fix) : null;

  return (
    <div className="exercise">
      <div className="phase-label">{asksWrong ? 'Which one is wrong?' : 'Which one fits?'}</div>
      <div className="contrast-context">{question}</div>
      {optionOrder.map(index => {
        const s = options[index];
        const cls =
          result === null ? '' : index === correctIndex ? 'correct' : index === choice ? 'wrong' : '';
        if (result !== null) {
          if (isWrongOption(ex, index, fix)) return <MistakeOption key={index} option={s} cls={cls} />;
          return <AnsweredOption key={index} option={s} cls={cls} speak={speak} exerciseType="choice" />;
        }
        return (
          <button
            key={index}
            className={`contrast-option ${cls}`}
            onClick={() => pick(index)}
          >
            {/* Pinyin/English only after answering — reading the hanzi IS the exercise */}
            <div className="contrast-hanzi">{s.hanzi}</div>
          </button>
        );
      })}
      {result !== null && (
        <>
          <ResultBanner ok={result}>{result ? '✓ Correct' : '✗ Not quite'}</ResultBanner>
          {fix.status === 'ready' && (
            <FeedbackSentence
              hanzi={fix.correction.hanzi}
              pinyin={fix.correction.pinyin}
              english={fix.correction.english}
              label="✓ Correct:"
              speak={speak}
              exerciseType="choice"
              testId="choice-correction"
            />
          )}
          {fix.status === 'loading' && (
            <p className="result-explanation choice-correction-pending" role="status" data-testid="choice-correction-pending">Finding the correct version…</p>
          )}
          {fix.status === 'unavailable' && (
            <p className="result-explanation choice-correction-pending" data-testid="choice-correction-offline">
              {fix.offline ? 'The correct version needs a connection.' : 'Couldn’t get the correct version this time.'}
            </p>
          )}
          {explanation && <p className="result-explanation">{explanation}</p>}
          {sayAgain && /\p{Script=Han}/u.test(sayAgain.hanzi) && <SayItAgain hanzi={sayAgain.hanzi} exerciseType="choice" />}
          <TakeLockActions>
            <button className="practice-btn primary" onClick={() => onNext(result, { choice: choice ?? undefined })}>
              Continue
            </button>
          </TakeLockActions>
        </>
      )}
    </div>
  );
}

// ============ Translate (self-assessed) ============

/** Compare a typed answer to the reference ignoring whitespace and
 * punctuation, so 蛋糕被妹妹吃掉了 matches 蛋糕被妹妹吃掉了。 (now in shared/lesson/answer-check.ts,
 * where Claude's answer check reads it too). */
export { isExactHanziMatch };

export function TranslateExercise(props: {
  label?: string;
  english: string;
  referenceHanzi: string;
  referencePinyin?: string | null;
  note?: string;
  /** The lesson's title / grammar point (Claude's answer check stays on topic). */
  focus?: string;
  speak: Speak;
  onNext: OnNext;
}) {
  const { label, english, referenceHanzi, referencePinyin, note, focus, speak, onNext } = props;
  const [answer, setAnswer] = useState('');
  const [source, setSource] = useState<DictatedAnswer['source'] | null>(null);
  const [revealed, setRevealed] = useState(false);
  // Claude's check of the answer (shared/lesson/answerCheck.ts), started the moment it is final.
  const ac = useLessonAnswerCheck({
    exerciseType: 'translate', promptEn: english, modelAnswer: referenceHanzi, modelPinyin: referencePinyin, focus,
    onRetry: () => { setAnswer(''); setSource(null); setRevealed(false); },
  });

  function reveal(given?: DictatedAnswer) {
    if (given) {
      setAnswer(given.text);
      setSource(given.source);
    }
    ac.onFinal(given ? given.text : answer, given ? given.source : 'typed');
    setRevealed(true);
    speak(referenceHanzi);
  }
  // Voice-first (shared/voice/dictation.ts): an unchanged spoken answer also matches by sound.
  const matched = isExactHanziMatch(answer, referenceHanzi) || lessonSpokenCheck(answer, referenceHanzi, [], source).accepted;
  // The device's character marks — never on a reordering of the same characters (a neutral note instead) nor once
  // Claude says it's right (shared/lesson/feedback.ts `answerMarks`).
  const marks = answerMarks(answer, referenceHanzi, ac.verdict);
  const report = () => ac.report({ text: answer.trim() || undefined, input: answer.trim() ? source ?? undefined : undefined, self_assessed: true });

  return (
    <div className="exercise">
      <div className="phase-label">{label || 'Say it in Chinese'}</div>
      <div className="translate-prompt">{english}</div>
      {!revealed ? (
        <>
          <VoiceTextInput
            surface="lesson_translate"
            value={answer}
            onChange={setAnswer}
            onSubmit={reveal}
            submitLabel="Check"
            placeholder="Type it in Chinese…"
            multiline
            testId="lesson-voice"
          />
          <TakeLockActions>
            <button className="practice-btn" onClick={() => reveal()} data-testid="lesson-show-answer">
              Show answer
            </button>
          </TakeLockActions>
        </>
      ) : (
        <>
          {/* At once, from the device: what he said (an exact match gets a green nudge and is felt; otherwise the
              characters the model answer doesn't have are marked — no "wrong" state, other wordings can be right),
              then the model answer big. Claude's check lands LAST, below the buttons, so nothing here moves. */}
          {answer.trim() && (
            <div className={`speak-transcript lesson-feel-host ${matched ? 'exact' : ''}`} data-testid="lesson-your-answer">
              <div className="speak-transcript-label">
                {source === 'spoken' || source === 'edited' ? '🎤 You said' : 'Your answer'}
                {matched && (
                  <span className="speak-transcript-exact-badge">{isExactHanziMatch(answer, referenceHanzi) ? '✓ Exact match' : '✓ Sounds right'}</span>
                )}
              </div>
              <div className="speak-transcript-text">{matched || !marks.marks ? answer.trim() : <MarkedAnswer answer={answer.trim()} model={referenceHanzi} />}</div>
              {!matched && marks.note && <div className="lesson-answer-note" data-testid="lesson-answer-note">{marks.note}</div>}
              {matched && <LessonFeel moment="matched_answer" />}
            </div>
          )}
          <FeedbackSentence
            hanzi={referenceHanzi}
            pinyin={referencePinyin}
            // The model answer once, unmarked: the diff is on HIS answer above (shared/cards/answer-diff.ts).
            speak={speak}
            exerciseType="translate"
          />
          <SayItAgain hanzi={referenceHanzi} exerciseType="translate" />
          <p className="result-explanation">
            {note || 'Did yours match the meaning? (Different wording is fine.)'}
          </p>
          <TakeLockActions>
            <button className={`practice-btn${ac.suggested === 'missed_it' ? ' suggested' : ''}`} onClick={() => onNext(false, report())} data-testid="lesson-missed-it">
              ✗ Missed it
            </button>
            <button className={`practice-btn primary${ac.suggested === 'got_it' ? ' suggested' : ''}`} onClick={() => onNext(true, report())} data-testid="lesson-got-it">
              ✓ Got it
            </button>
          </TakeLockActions>
          {answer.trim() && ac.view(answer.trim(), speak, { offered: referenceHanzi, celebrated: matched })}
        </>
      )}
    </div>
  );
}

// ============ Match the pairs ============

/**
 * Connect the Chinese words with their English meanings. Correct = every
 * pair matched with no wrong taps along the way.
 */
export function MatchExercise(props: {
  pairs: Array<{ hanzi: string; pinyin?: string | null; english: string }>;
  speak: Speak;
  onNext: OnNext;
}) {
  const { pairs, speak, onNext } = props;
  const [leftOrder] = useState(() => shuffledIndexes(pairs.length));
  const [rightOrder] = useState(() => shuffledIndexes(pairs.length));
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
          <ResultBanner ok={mistakes === 0}>
            {mistakes === 0 ? '✓ All matched!' : `Matched with ${mistakes} miss${mistakes === 1 ? '' : 'es'}`}
          </ResultBanner>
          <TakeLockActions>
            <button className="practice-btn primary" onClick={() => onNext(mistakes === 0, { mistakes })}>
              Continue
            </button>
          </TakeLockActions>
        </>
      )}
    </div>
  );
}

// ============ Describe the picture (self-assessed) ============

/**
 * The picture, or what stands in for it: "Drawing the picture…" while it is
 * being generated (useLessonImage polls and swaps it in), the scene text when
 * there is none (offline and never downloaded, or the generator gave up).
 */
export function DescribeImagePicture({ image, imagePrompt }: {
  image: ReturnType<typeof useLessonImage>;
  imagePrompt: string;
}) {
  if (image.state === 'ready') {
    return (
      <div className="describe-image-container">
        <img src={image.url} alt="Scene to describe" className="describe-image" onError={image.onImageError} />
      </div>
    );
  }
  const text = lessonImagePlaceholder(image.state);
  if (text.kind === 'drawing') {
    return (
      <div className="describe-image-pending" role="status" aria-live="polite">
        <div className="describe-image-pending-art" aria-hidden="true">🎨</div>
        <div className="describe-image-pending-title">{text.title}</div>
        {text.detail && <div className="describe-image-pending-detail">{text.detail}</div>}
        {image.state === 'slow' && <div className="describe-image-pending-scene">{imagePrompt}</div>}
      </div>
    );
  }
  return (
    <div className="describe-image-fallback">
      <span className="describe-image-fallback-label">{text.title}</span> {imagePrompt}
    </div>
  );
}


export function DescribeImageExercise(props: {
  imageKey?: string | null;
  imagePrompt: string;
  task?: string;
  referenceHanzi: string;
  referencePinyin?: string | null;
  referenceEnglish?: string | null;
  speak: Speak;
  onNext: OnNext;
}) {
  const { imageKey, imagePrompt, task, referenceHanzi, referencePinyin, referenceEnglish, speak, onNext } = props;
  const [revealed, setRevealed] = useState(false);
  const image = useLessonImage(imageKey, imagePrompt);

  function reveal() {
    setRevealed(true);
    speak(referenceHanzi);
  }

  return (
    <div className="exercise">
      <div className="phase-label">Describe the picture</div>
      <DescribeImagePicture image={image} imagePrompt={imagePrompt} />
      <p className="describe-task">{task || 'Describe what you see — out loud, in Chinese.'}</p>
      {!revealed ? (
        <TakeLockActions>
          <button className="practice-btn primary" onClick={reveal}>
            🎤 I've described it
          </button>
        </TakeLockActions>
      ) : (
        <>
          <FeedbackSentence hanzi={referenceHanzi} pinyin={referencePinyin} english={referenceEnglish} speak={speak} exerciseType="describe_image" />
          <SayItAgain hanzi={referenceHanzi} exerciseType="describe_image" kind="example" />
          <p className="result-explanation">
            Did your description capture the scene? (Any correct sentence counts.)
          </p>
          <TakeLockActions>
            <button className="practice-btn" onClick={() => onNext(false, { self_assessed: true })}>
              ✗ Not quite
            </button>
            <button className="practice-btn primary" onClick={() => onNext(true, { self_assessed: true })}>
              ✓ Got it
            </button>
          </TakeLockActions>
        </>
      )}
    </div>
  );
}

// ============ Speak your own sentence (self-assessed) ============

export function SpeakPromptExercise(props: {
  prompt: string;
  example?: ExerciseSentence | null;
  /** The lesson's title / grammar point (Claude's check stays on topic). */
  focus?: string;
  speak: Speak;
  onNext: OnNext;
}) {
  const { prompt, example, focus, speak, onNext } = props;
  return (
    <div className="exercise">
      <div className="phase-label">Say it out loud</div>
      <div className="translate-prompt">{prompt}</div>
      {/* Record it and Claude checks the transcript (docs/STUDY_SESSION.md "Claude checks your speaking");
          nothing is kept — or say it without recording, as before. */}
      <SpeakingAnswer
        exerciseType="speak"
        prompt={prompt}
        example={example ? { hanzi: example.hanzi, pinyin: example.pinyin ?? undefined, english: example.english ?? undefined } : null}
        targetSeconds={15}
        focus={focus}
        speak={speak}
        gotItLabel="✓ Yes"
        allowWithoutRecording
        onNext={(correct, answer) => onNext(correct, answer)}
      />
    </div>
  );
}

// ============ Listening: pick what you heard ============

/** Big replayable play button shared by the listening exercises. The played
 * text is never rendered next to it — hearing it IS the exercise. */
export function ListenPlayButton(props: { text: string; speak: Speak; onPlay?: () => void; autoPlay?: boolean }) {
  const { text, speak, onPlay, autoPlay = true } = props;
  // Auto-play once on mount so the exercise starts in the ear, not the eye.
  useEffect(() => {
    if (!autoPlay) return;
    speak(text);
    onPlay?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button className="listen-play-btn" onClick={() => { speak(text); onPlay?.(); }} aria-label="Play audio">
      🔊
      <span className="listen-play-hint">Tap to replay</span>
    </button>
  );
}

export function ListenChoiceExercise(props: {
  audio: ExerciseSentence;
  question?: string;
  options: ExerciseSentence[];
  correctIndex: number;
  explanation?: string;
  speak: Speak;
  onNext: OnNext;
}) {
  const { audio, question, options, correctIndex, explanation, speak, onNext } = props;
  const [choice, setChoice] = useState<number | null>(null);
  const [optionOrder] = useState(() => shuffledIndexes(options.length));
  const plays = useRef(0);
  const result = choice === null ? null : choice === correctIndex;

  return (
    <div className="exercise">
      <div className="phase-label">What do you hear?</div>
      {question && <div className="contrast-context">{question}</div>}
      <ListenPlayButton text={audio.hanzi} speak={speak} onPlay={() => { plays.current++; }} />
      {optionOrder.map(index => {
        const s = options[index];
        const cls =
          result === null ? '' : index === correctIndex ? 'correct' : index === choice ? 'wrong' : '';
        // After answering, ▶ on an option speaks it — hearing the contrast between the choices is the point.
        if (result !== null) return <AnsweredOption key={index} option={s} cls={cls} speak={speak} exerciseType="listen_choice" />;
        return (
          <button
            key={index}
            className={`contrast-option ${cls}`}
            onClick={() => setChoice(index)}
          >
            {/* Pinyin/English only after answering — they'd give the audio away */}
            <div className="contrast-hanzi">{s.hanzi}</div>
          </button>
        );
      })}
      {result !== null && (
        <>
          <ResultBanner ok={result}>{result ? '✓ Correct' : '✗ Not quite'}</ResultBanner>
          <FeedbackSentence hanzi={audio.hanzi} pinyin={audio.pinyin} english={audio.english} speak={speak} exerciseType="listen_choice" />
          <SayItAgain hanzi={audio.hanzi} exerciseType="listen_choice" />
          {explanation && <p className="result-explanation">{explanation}</p>}
          <TakeLockActions>
            <button className="practice-btn primary" onClick={() => onNext(result, { choice: choice ?? undefined, plays: plays.current })}>
              Continue
            </button>
          </TakeLockActions>
        </>
      )}
    </div>
  );
}

// ============ Listening: translate what you heard (self-assessed) ============

/** Learners answer a listening exercise either by transcribing the hanzi or
 * by translating to English — a full match on either goes green (same
 * no-wrong-state rule as TranslateExercise: paraphrases stay neutral). */
function isListenAnswerMatch(answer: string, audio: ExerciseSentence): boolean {
  if (isExactHanziMatch(answer, audio.hanzi)) return true;
  if (audio.english) {
    const norm = (s: string) => s.toLowerCase().replace(/[\s。，！？；：、．…,.!?;:'"''""()（）]/g, '');
    const a = norm(answer);
    return a.length > 0 && a === norm(audio.english);
  }
  return false;
}

export function ListenTranslateExercise(props: {
  audio: ExerciseSentence;
  note?: string;
  focus?: string;
  speak: Speak;
  onNext: OnNext;
}) {
  const { audio, note, focus, speak, onNext } = props;
  const [answer, setAnswer] = useState('');
  const [source, setSource] = useState<DictatedAnswer['source'] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const plays = useRef(0);
  // Claude checks an answer written in Chinese (an English one keeps the self-assessment alone).
  const ac = useLessonAnswerCheck({
    exerciseType: 'listen_translate', promptEn: audio.english, modelAnswer: audio.hanzi, modelPinyin: audio.pinyin, focus,
    onRetry: () => { setAnswer(''); setSource(null); setRevealed(false); },
  });
  const report = () => ac.report({ text: answer.trim() || undefined, input: answer.trim() ? source ?? undefined : undefined, self_assessed: true, plays: plays.current });
  const reveal = (given?: DictatedAnswer) => {
    if (given) {
      setAnswer(given.text);
      setSource(given.source);
    }
    ac.onFinal(given ? given.text : answer, given ? given.source : 'typed');
    setRevealed(true);
  };

  return (
    <div className="exercise">
      <div className="phase-label">Listen and translate</div>
      <ListenPlayButton text={audio.hanzi} speak={speak} onPlay={() => { plays.current++; }} />
      {!revealed ? (
        <>
          {/* What it meant, usually in English: the transcriber hears English first here. */}
          <VoiceTextInput
            surface="lesson_listen_translate"
            value={answer}
            onChange={setAnswer}
            onSubmit={reveal}
            submitLabel="Check"
            placeholder="What did it mean?"
            listeningPlaceholder="Listening… say what it meant"
            multiline
            lang="en"
            testId="lesson-voice"
          />
          <TakeLockActions>
            <button className="practice-btn" onClick={() => reveal()} data-testid="lesson-show-answer">
              Show answer
            </button>
          </TakeLockActions>
        </>
      ) : (
        <>
          {answer.trim() && (
            <div className={`speak-transcript lesson-feel-host ${isListenAnswerMatch(answer, audio) ? 'exact' : ''}`} data-testid="lesson-your-answer">
              <div className="speak-transcript-label">
                {source === 'spoken' || source === 'edited' ? '🎤 You said' : 'Your answer'}
                {isListenAnswerMatch(answer, audio) && (
                  <span className="speak-transcript-exact-badge">✓ Exact match</span>
                )}
              </div>
              <div className="speak-transcript-text">{answer.trim()}</div>
              {isListenAnswerMatch(answer, audio) && <LessonFeel moment="matched_answer" />}
            </div>
          )}
          <FeedbackSentence hanzi={audio.hanzi} pinyin={audio.pinyin} english={audio.english} speak={speak} exerciseType="listen_translate" />
          <SayItAgain hanzi={audio.hanzi} exerciseType="listen_translate" />
          <p className="result-explanation">
            {note || 'Did you catch the meaning? (Different wording is fine.)'}
          </p>
          <TakeLockActions>
            <button className={`practice-btn${ac.suggested === 'missed_it' ? ' suggested' : ''}`} onClick={() => onNext(false, report())}>
              ✗ Missed it
            </button>
            <button className={`practice-btn primary${ac.suggested === 'got_it' ? ' suggested' : ''}`} onClick={() => onNext(true, report())}>
              ✓ Got it
            </button>
          </TakeLockActions>
          {answer.trim() && ac.view(answer.trim(), speak, { offered: audio.hanzi, celebrated: isListenAnswerMatch(answer, audio) })}
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
  patterns?: LessonPattern[];
  speak: Speak;
  onNext: () => void;
}) {
  const { title, body, sentences, patterns, speak, onNext } = props;
  // Nothing plays by itself on a note (Jerome, Nov 2026): ▶ / a tap plays an example.
  // Grammar structures — the note's own patterns, or ones read from older free text — are cards.
  const structures = useMemo(() => structureNoteView({ body, sentences, patterns }), [body, sentences, patterns]);
  if (structures) return <StructureCards title={title} view={structures} speak={speak} onNext={onNext} />;

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
          {/* A character opens the language explorer; the rest of the row still plays it. */}
          <div className="lesson-note-hanzi"><ExplorableText text={s.hanzi} source="lesson" /> 🔊</div>
          {s.pinyin && <div className="translate-ref-pinyin">{s.pinyin}</div>}
          {s.english && <div className="contrast-english">{s.english}</div>}
        </div>
      ))}
      <TakeLockActions>
        <button className="practice-btn primary" onClick={onNext}>
          Continue
        </button>
      </TakeLockActions>
    </div>
  );
}

export {
  SentenceMakingExercise,
  WriteTypedExercise,
  WriteHandwritingExercise,
  DictationExercise,
  OralExpressionExercise,
  ConversationExercise,
} from './practice-exercises';
