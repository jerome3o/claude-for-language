import { useEffect, useRef, useState } from 'react';
import { drillScoreLine, type DrillQuestion } from '@shared/explorer';
import { getTTSWithCache } from '../../services/ttsCache';
import { createAudioPlayer } from '../../utils/audioPlayback';
import { playFanfare } from '../../utils/fanfare';
import { useTTS } from '../../hooks/useAudio';
import { WritingExercise } from '../strokes/WritingExercise';
import { playStrokeCorrect, playStrokeMiss } from '../strokes/writingFeedback';
import { Confetti } from '../Confetti';

const TONE_LABELS = ['1st ā', '2nd á', '3rd ǎ', '4th à', 'neutral a'];

const PROMPTS: Record<DrillQuestion['kind'], string> = {
  meaning: 'What does it mean?',
  listen: 'Which word do you hear?',
  reverse: 'Which word means this?',
  tone: 'Which tone is it here?',
  write: 'Write it',
};

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // no haptics
  }
}

/**
 * A quick drill inside the explorer (docs/LANGUAGE_EXPLORER.md "Mini drills"): one question
 * at a time, instant feedback, a score at the end. Practice only — nothing here writes a
 * review event; the caller logs analytics with the result.
 */
export function DrillView({
  questions,
  onFinish,
  onAgain,
  onExit,
}: {
  questions: DrillQuestion[];
  /** Called once when the last question is answered. */
  onFinish: (correct: number) => void;
  onAgain: () => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [wrote, setWrote] = useState<boolean | null>(null);
  const [correct, setCorrect] = useState(0);
  const [done, setDone] = useState(false);
  const player = useRef(createAudioPlayer());
  const tts = useTTS();
  const q = questions[index];

  const play = async (text: string) => {
    const id = player.current.claim();
    const blob = await getTTSWithCache(text).catch(() => null);
    if (!player.current.isCurrent(id)) return;
    if (blob) player.current.play(blob, {});
    else tts.speak(text);
  };

  useEffect(() => {
    if (q?.kind === 'listen') void play(q.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    const p = player.current;
    return () => p.dispose();
  }, []);

  const answered = q?.kind === 'write' ? wrote !== null : picked !== null;

  const pick = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    const right = i === q.answer;
    if (right) {
      setCorrect((c) => c + 1);
      playStrokeCorrect(2);
      buzz(12);
    } else {
      playStrokeMiss();
      buzz(40);
    }
  };

  const next = () => {
    if (index + 1 >= questions.length) {
      setDone(true);
      onFinish(correct);
      if (correct / questions.length >= 0.6) playFanfare();
      return;
    }
    setIndex(index + 1);
    setPicked(null);
    setWrote(null);
  };

  if (done) {
    const good = correct / questions.length >= 0.6;
    return (
      <div className="xp-drill xp-drill-done" data-testid="explorer-drill-done">
        {good && <Confetti />}
        <div className="xp-drill-done-icon" aria-hidden="true">{good ? '🎉' : '💪'}</div>
        <div className="xp-drill-score">{drillScoreLine(correct, questions.length)}</div>
        <p className="xp-muted">Practice only — your cards’ schedule isn’t touched.</p>
        <div className="xp-footer-row">
          <button type="button" className="btn btn-secondary" onClick={onAgain}>Again</button>
          <button type="button" className="btn btn-primary" onClick={onExit} data-testid="explorer-drill-exit">Keep exploring</button>
        </div>
      </div>
    );
  }

  return (
    <div className="xp-drill" data-testid="explorer-drill">
      <div className="xp-drill-top">
        <span className="xp-drill-progress" data-testid="explorer-drill-progress">🎯 {index + 1} / {questions.length}</span>
        <div className="xp-drill-dots" aria-hidden="true">
          {questions.map((_, i) => <span key={i} className={i < index ? 'done' : i === index ? 'current' : ''} />)}
        </div>
      </div>
      <div className="xp-drill-ask">{q.kind === 'tone' ? `Which tone is ${q.prompt} here?` : PROMPTS[q.kind]}</div>

      {q.kind === 'meaning' && <div className="xp-drill-prompt" lang="zh-CN">{q.prompt}</div>}
      {q.kind === 'reverse' && <div className="xp-drill-prompt xp-drill-prompt--en">“{q.prompt}”</div>}
      {q.kind === 'listen' && (
        <button type="button" className="xp-drill-listen" onClick={() => void play(q.prompt)} aria-label="Play again">🔊</button>
      )}
      {q.kind === 'tone' && (
        <div className="xp-drill-prompt" lang="zh-CN">
          {[...(q.context ?? q.prompt)].map((c, i) => <span key={i} className={c === q.prompt ? 'xt-hl' : 'xp-drill-dim'}>{c}</span>)}
        </div>
      )}
      {answered && q.pinyin && q.kind !== 'write' && <div className="xp-drill-pinyin">{q.pinyin}</div>}

      {q.kind === 'write' ? (
        <div className="xp-drill-write">
          <WritingExercise
            text={q.prompt}
            initialMode="trace"
            onComplete={(r) => {
              if (wrote !== null) return;
              const ok = r.grade !== 'practice';
              setWrote(ok);
              if (ok) setCorrect((c) => c + 1);
            }}
          />
        </div>
      ) : (
        <div className={`xp-drill-options${q.kind === 'tone' ? ' xp-drill-options--tones' : ''}`}>
          {q.options.map((opt, i) => {
            const state = picked === null ? '' : i === q.answer ? ' right' : i === picked ? ' wrong' : ' dim';
            return (
              <button
                key={i}
                type="button"
                className={`xp-drill-option${state}`}
                lang={q.kind === 'listen' || q.kind === 'reverse' ? 'zh-CN' : undefined}
                onClick={() => pick(i)}
                disabled={picked !== null}
                data-testid="explorer-drill-option"
                data-right={i === q.answer ? 'true' : undefined}
              >
                {q.kind === 'tone' ? TONE_LABELS[Number(opt) - 1] : opt}
              </button>
            );
          })}
        </div>
      )}

      <div className="xp-footer-row xp-drill-actions">
        <button type="button" className="btn btn-secondary" onClick={onExit}>End</button>
        {q.kind === 'write' && !answered ? (
          <button type="button" className="btn btn-secondary" onClick={() => setWrote(false)}>Skip</button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={next} disabled={!answered} data-testid="explorer-drill-next">
            {index + 1 >= questions.length ? 'See score' : 'Next →'}
          </button>
        )}
      </div>
    </div>
  );
}
