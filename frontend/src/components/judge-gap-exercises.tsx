/**
 * The two per-sentence exercises (shared/lesson/judgeGap.ts):
 *
 * - **Judge each sentence** (`judge`): every sentence gets ✓ Correct / ✗ Incorrect; Check marks
 *   each judgement and shows a wrong sentence's correction + why.
 * - **Choose the word** (`gap_choice`): each sentence has one gap and 2–4 words to choose from;
 *   Check marks each pick and shows the full sentence (the answer in the gap) with pinyin, ▶ and
 *   the explanation.
 *
 * Checked on the device (offline). Jerome is somewhat red / green colour-blind: every state is an
 * icon + words (✓ / ✗, "Right" / "Not quite"), never colour alone.
 */
import { useState } from 'react';
import {
  allAnswered,
  fillGap,
  gapFeedback,
  gapItemOptions,
  gapParts,
  gapResults,
  itemsScoreLine,
  judgeFeedback,
  judgeResults,
  GAP_DEFAULT_QUESTION,
  JUDGE_CORRECT_LABEL,
  JUDGE_DEFAULT_QUESTION,
  JUDGE_INCORRECT_LABEL,
  type ExerciseAnswer,
  type GapChoiceExerciseSpec,
  type JudgeExerciseSpec,
} from '@shared/lesson';
import { track } from '../services/analytics';
import './lesson-exercises.css';

type Speak = (text: string) => void;
type OnNext = (correct: boolean, answer?: ExerciseAnswer) => void;

function PlayButton({ text, speak }: { text: string; speak: Speak }) {
  if (!text) return null;
  return (
    <button type="button" className="jg-play" onClick={() => speak(text)} aria-label="Play the sentence">▶</button>
  );
}

function ResultLine({ right, text }: { right: boolean; text: string }) {
  return <div className={`jg-result ${right ? 'right' : 'miss'}`} role="status">{text}</div>;
}

function Footer({ results, checked, onCheck, onContinue }: {
  results: Array<boolean | null>;
  checked: boolean;
  onCheck: () => void;
  onContinue: () => void;
}) {
  const ready = allAnswered(results);
  if (!checked) {
    const left = results.filter(r => r === null).length;
    return (
      <div className="exercise-actions">
        <button className="practice-btn primary" disabled={!ready} onClick={onCheck} data-testid="jg-check">
          {ready ? 'Check' : `Check · ${left} to go`}
        </button>
      </div>
    );
  }
  const all = results.every(r => r === true);
  return (
    <>
      <div className={`result-banner ${all ? 'correct' : 'wrong'}`}>{itemsScoreLine(results)}</div>
      <div className="exercise-actions">
        <button className="practice-btn primary" onClick={onContinue}>Continue</button>
      </div>
    </>
  );
}

// ============ Judge each sentence ============

export function JudgeExercise({ exercise, speak, onNext }: { exercise: JudgeExerciseSpec; speak: Speak; onNext: OnNext }) {
  const { sentences } = exercise;
  const [judged, setJudged] = useState<Array<boolean | null>>(() => sentences.map(() => null));
  const [checked, setChecked] = useState(false);
  const results = judgeResults(exercise, judged);

  function judge(i: number, value: boolean) {
    if (checked) return;
    setJudged(prev => prev.map((v, j) => (j === i ? value : v)));
  }

  const check = () => {
    setChecked(true);
    track('lesson.items_checked', { exercise_type: 'judge', items: results.length, right: results.filter(r => r === true).length });
  };

  const report = (): ExerciseAnswer => ({
    items: sentences.map((_, i) => ({ judged: judged[i] ?? undefined, correct: results[i] })),
  });

  return (
    <div className="exercise jg">
      <div className="phase-label">Correct or incorrect? ⚖️</div>
      <div className="contrast-context">{exercise.question || JUDGE_DEFAULT_QUESTION}</div>
      <ol className="jg-list">
        {sentences.map((s, i) => {
          const j = judged[i];
          const r = results[i];
          return (
            <li key={i} className={`jg-row ${checked ? (r ? 'right' : 'miss') : ''}`} data-testid={`judge-row-${i}`}>
              <div className="jg-sentence">
                <span className="jg-num">{i + 1}.</span>
                <span className="jg-hanzi" lang="zh-CN">{s.hanzi}</span>
                {checked && s.correct && <PlayButton text={s.hanzi} speak={speak} />}
              </div>
              {checked && s.correct && (s.pinyin || s.english) && (
                <div className="jg-detail">
                  {s.pinyin && <div className="contrast-pinyin">{s.pinyin}</div>}
                  {s.english && <div className="contrast-english">{s.english}</div>}
                </div>
              )}
              <div className="jg-toggle" role="group" aria-label={`Sentence ${i + 1}`}>
                <button
                  type="button"
                  className={`jg-opt ${j === true ? 'on' : ''}`}
                  aria-pressed={j === true}
                  disabled={checked}
                  onClick={() => judge(i, true)}
                >
                  {JUDGE_CORRECT_LABEL}
                </button>
                <button
                  type="button"
                  className={`jg-opt ${j === false ? 'on' : ''}`}
                  aria-pressed={j === false}
                  disabled={checked}
                  onClick={() => judge(i, false)}
                >
                  {JUDGE_INCORRECT_LABEL}
                </button>
              </div>
              {checked && r !== null && <ResultLine right={r} text={judgeFeedback(s.correct, r)} />}
              {checked && !s.correct && s.correction && (
                <div className="jg-fix">
                  <div className="jg-fix-label">Correct version</div>
                  <div className="jg-sentence">
                    <span className="jg-hanzi" lang="zh-CN">{s.correction.hanzi}</span>
                    <PlayButton text={s.correction.hanzi} speak={speak} />
                  </div>
                  {s.correction.pinyin && <div className="contrast-pinyin">{s.correction.pinyin}</div>}
                  {(s.correction.english || s.english) && <div className="contrast-english">{s.correction.english || s.english}</div>}
                </div>
              )}
              {checked && s.explanation && <p className="result-explanation jg-why">{s.explanation}</p>}
            </li>
          );
        })}
      </ol>
      <Footer results={results} checked={checked} onCheck={check} onContinue={() => onNext(results.every(r => r === true), report())} />
    </div>
  );
}

// ============ Choose the word for the gap ============

export function GapChoiceExercise({ exercise, speak, onNext }: { exercise: GapChoiceExerciseSpec; speak: Speak; onNext: OnNext }) {
  const { items } = exercise;
  const [picks, setPicks] = useState<Array<string | null>>(() => items.map(() => null));
  const [checked, setChecked] = useState(false);
  const results = gapResults(exercise, picks);

  function choose(i: number, word: string) {
    if (checked) return;
    setPicks(prev => prev.map((v, j) => (j === i ? word : v)));
  }

  const check = () => {
    setChecked(true);
    track('lesson.items_checked', { exercise_type: 'gap_choice', items: results.length, right: results.filter(r => r === true).length });
  };

  const report = (): ExerciseAnswer => ({
    items: items.map((_, i) => ({ pick: picks[i] ?? undefined, correct: results[i] })),
  });

  return (
    <div className="exercise jg">
      <div className="phase-label">Choose the word 🔀</div>
      <div className="contrast-context">{exercise.question || GAP_DEFAULT_QUESTION}</div>
      <ol className="jg-list">
        {items.map((item, i) => {
          const { before, after } = gapParts(item.sentence);
          const pick = picks[i];
          const r = results[i];
          const shown = checked ? item.answer : pick;
          const full = fillGap(item.sentence, item.answer);
          return (
            <li key={i} className={`jg-row ${checked ? (r ? 'right' : 'miss') : ''}`} data-testid={`gap-row-${i}`}>
              <div className="jg-sentence">
                <span className="jg-num">{i + 1}.</span>
                <span className="jg-hanzi" lang="zh-CN">
                  {before}
                  <span className={`jg-gap ${shown ? 'filled' : ''}`} aria-label={shown ? undefined : 'gap'}>{shown || '　　'}</span>
                  {after}
                </span>
                {checked && <PlayButton text={full} speak={speak} />}
              </div>
              <div className="jg-toggle" role="group" aria-label={`Sentence ${i + 1}: choose a word`}>
                {gapItemOptions(exercise, item).map(word => {
                  const on = pick === word;
                  const answer = checked && word === item.answer;
                  return (
                    <button
                      key={word}
                      type="button"
                      lang="zh-CN"
                      className={`jg-opt jg-word ${on ? 'on' : ''} ${answer ? 'answer' : ''}`}
                      aria-pressed={on}
                      disabled={checked}
                      onClick={() => choose(i, word)}
                    >
                      {checked && answer ? `✓ ${word}` : checked && on ? `✗ ${word}` : word}
                    </button>
                  );
                })}
              </div>
              {checked && r !== null && <ResultLine right={r} text={gapFeedback(item.answer, pick)} />}
              {checked && (item.pinyin || item.english) && (
                <div className="jg-detail">
                  {item.pinyin && <div className="contrast-pinyin">{item.pinyin}</div>}
                  {item.english && <div className="contrast-english">{item.english}</div>}
                </div>
              )}
              {checked && item.explanation && <p className="result-explanation jg-why">{item.explanation}</p>}
            </li>
          );
        })}
      </ol>
      <Footer results={results} checked={checked} onCheck={check} onContinue={() => onNext(results.every(r => r === true), report())} />
    </div>
  );
}
