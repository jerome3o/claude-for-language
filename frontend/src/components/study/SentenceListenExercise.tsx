/**
 * Hard mode's "Sentences by ear" (docs/STUDY_SESSION.md "Sentences by ear"; rules in
 * shared/study/sentenceRound.ts; Lab `ListenExerciseCard` in ui/study/SentenceRoundUi.kt): a listen
 * exercise of the Sentence round. The sentence's clip plays by itself once the exercise has the floor —
 * no text on screen — with ▶ Play again and 0.75×; he gives the meaning in English in the voice-first box
 * (🎤 Say it, ✏️ Type). Online with the sentence's English, Claude's lesson answer check judges the meaning
 * (`listenCheckInput`, cached; his English = the sentence's English → right at once with no call);
 * offline, with no English, or when no check can be had, he checks himself (✓ Got it / ✗ Missed it).
 * The reveal — Chinese, pinyin, English, ▶ — shows at once; the verdict lands in a slim row under it
 * whose height is reserved, so nothing above it moves.
 *
 * A clip that won't play (gone, not on the device offline) hands the exercise back as a read one
 * (`onUnavailable` → `exerciseAsRead`).
 */
import { useEffect, useRef, useState } from 'react';
import {
  LISTEN_EX_CHECKING,
  LISTEN_EX_GOT_IT,
  LISTEN_EX_LISTENING,
  LISTEN_EX_MISSED_IT,
  LISTEN_EX_PLACEHOLDER,
  LISTEN_EX_PLAY,
  LISTEN_EX_SELF_QUESTION,
  LISTEN_EX_SHOW_ANSWER,
  LISTEN_EX_SLOW,
  LISTEN_EX_SUBMIT,
  LISTEN_EX_YOU_SAID,
  LISTEN_SLOW_RATE,
  SENTENCE_ROUND_PROMPT,
  SENTENCE_ROUND_RESULT,
  SENTENCE_ROUND_TRANSLATION_OFFLINE,
  listenCheckBy,
  listenCheckInput,
  listenSelfResult,
  listenVerdictResult,
  type RoundExercise,
} from '@shared/study/sentenceRound';
import { exactAnswerCheck, type AnswerCheck } from '@shared/lesson/answerCheck';
import { SENTENCE_HIDE_TITLE } from '@shared/study/sentenceHistory';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { resolveNoteAudioSource } from '../../hooks/useAudio';
import { createAudioPlayer } from '../../utils/audioPlayback';
import { getCachedAudio } from '../../services/audioCache';
import { checkLessonAnswer } from '../../services/answerCheck';
import { track } from '../../services/analytics';
import { API_BASE } from '../../api/client';
import { VoiceTextInputView } from '../voice/VoiceTextInput';
import type { RoundSentenceRow } from './SentenceRound';

type Status = 'right' | 'close' | 'wrong' | null;

interface Props {
  ex: RoundExercise;
  index: number;
  row: RoundSentenceRow;
  /** Has the floor: the clip plays by itself once, the answer box is open. */
  active: boolean;
  onActivate: () => void;
  /** Answered (or 👁 shown): the box closes, the next listen exercise gets the floor. */
  onRevealed: () => void;
  /** Said right on this showing (the round's count), else this exercise's own result. */
  isRight: boolean;
  online: boolean;
  /** The round's 🎤 (a read / translate take) is on: this box waits. */
  micBusy: boolean;
  onJudged: (result: 'right' | 'close' | 'wrong') => void;
  /** The clip can't play: read it instead. */
  onUnavailable: () => void;
  onMore: () => void;
  longPress: Record<string, unknown>;
  where: 'session' | 'homework';
}

type Verdict =
  | { kind: 'checking' }
  | { kind: 'claude'; check: AnswerCheck; result: 'right' | 'close' | 'wrong'; by: 'claude' | 'exact' }
  | { kind: 'self' }
  | { kind: 'self_done'; result: 'right' | 'wrong' };

export function SentenceListenExercise({
  ex, index, row, active, onActivate, onRevealed, isRight, online, micBusy, onJudged, onUnavailable, onMore, longPress, where,
}: Props) {
  const [answer, setAnswer] = useState('');
  const [said, setSaid] = useState<{ text: string; input: 'spoken' | 'edited' | 'typed' | 'none' } | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [playing, setPlaying] = useState(false);
  const replays = useRef(0);
  const slowUsed = useRef(false);
  const played = useRef(false);
  const autoplayed = useRef(false);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const latest = useRef({ onJudged, onUnavailable, onRevealed, online });
  latest.current = { onJudged, onUnavailable, onRevealed, online };
  useEffect(() => () => {
    playerRef.current?.dispose();
    playerRef.current = null;
    // Unmounted before the clip got going (React's dev double-mount, a quick re-render): it autoplays again.
    if (!played.current) autoplayed.current = false;
  }, []);

  const answered = said != null;

  /** The clip — never the device voice: a listening exercise in a robot voice teaches nothing. */
  const play = (rate: number) => {
    const url = row.audio_url;
    if (!url) { latest.current.onUnavailable(); return; }
    if (!playerRef.current) playerRef.current = createAudioPlayer();
    const player = playerRef.current;
    const id = player.claim();
    player.setRate(rate);
    const offline = !latest.current.online;
    const source: Promise<Blob | string | null> = offline ? getCachedAudio(url).catch(() => null) : resolveNoteAudioSource(url, API_BASE).catch(() => null);
    void source.then((src) => {
      if (!player.isCurrent(id)) return;
      if (!src) {
        if (!played.current) latest.current.onUnavailable();
        return;
      }
      player.play(src, {
        label: 'sentence-listen',
        cacheKey: url,
        onPlay: () => { played.current = true; setPlaying(true); },
        onEnded: () => setPlaying(false),
        onError: () => {
          setPlaying(false);
          if (!played.current) latest.current.onUnavailable();
        },
      });
    });
  };

  // Its turn: the clip plays by itself, once.
  useEffect(() => {
    if (!active || answered || autoplayed.current) return;
    autoplayed.current = true;
    play(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, answered]);

  const report = (result: 'right' | 'close' | 'wrong', by: 'claude' | 'exact' | 'self', input: string) => {
    track('study.sentence_listen', { result, checked_by: by, input, replays: replays.current, slow: slowUsed.current, fallback: false, where });
    latest.current.onJudged(result);
  };

  const submit = (text: string, input: 'spoken' | 'edited' | 'typed' | 'none') => {
    playerRef.current?.stop();
    setPlaying(false);
    setSaid({ text, input });
    latest.current.onRevealed();
    // 👁 Show the answer with nothing said, offline, or no English to compare: he checks himself.
    if (input === 'none' || listenCheckBy(latest.current.online, row.translation) === 'self') {
      setVerdict({ kind: 'self' });
      return;
    }
    const checkInput = listenCheckInput(row, text, input);
    const exact = exactAnswerCheck(checkInput);
    if (exact) {
      setVerdict({ kind: 'claude', check: exact, result: 'right', by: 'exact' });
      report('right', 'exact', input);
      return;
    }
    setVerdict({ kind: 'checking' });
    checkLessonAnswer(checkInput).then(
      ({ check }) => {
        const result = listenVerdictResult(check.verdict);
        setVerdict({ kind: 'claude', check, result, by: 'claude' });
        report(result, 'claude', input);
      },
      // No check to be had (offline after all, busy, declined): he checks himself.
      () => setVerdict({ kind: 'self' }),
    );
  };

  const selfCheck = (gotIt: boolean) => {
    const result = listenSelfResult(gotIt);
    setVerdict({ kind: 'self_done', result });
    report(result, 'self', said?.input ?? 'none');
  };

  const d = useVoiceDictation({
    surface: 'sentence_listen',
    value: answer,
    onChange: setAnswer,
    lang: 'en',
    onSubmit: (a) => {
      const text = a.text.trim();
      if (text) submit(text, a.source === 'spoken' ? 'spoken' : a.source === 'edited' ? 'edited' : 'typed');
    },
  });
  const dictating = d.state.phase === 'listening' || d.state.phase === 'finishing';
  // The round's own 🎤 took the microphone: this box lets go.
  const cancelRef = useRef(d.cancel);
  cancelRef.current = d.cancel;
  useEffect(() => {
    if (micBusy && dictating) cancelRef.current();
  }, [micBusy, dictating]);

  const status: Status = isRight ? 'right'
    : verdict?.kind === 'claude' ? verdict.result
      : verdict?.kind === 'self_done' ? verdict.result
        : null;

  const tap = (rate: number) => {
    if (!active) onActivate();
    if (played.current || autoplayed.current) replays.current += 1;
    if (rate !== 1) slowUsed.current = true;
    autoplayed.current = true;
    play(rate);
  };

  return (
    <li
      {...longPress}
      onContextMenu={(e) => { e.preventDefault(); onMore(); }}
      className={`sentence-round-ex sentence-listen-ex${status ? ` is-${status}` : ''}${active && !answered ? ' is-turn' : ''}`}
      data-testid="sentence-round-exercise"
      data-mode="listen"
      data-exercise={ex.id}
      data-status={status ?? 'open'}
    >
      <div className="sentence-round-ex-head">
        <span className="sentence-round-ex-num" aria-hidden="true">{status === 'right' ? '✓' : index + 1}</span>
        <span className="sentence-round-ex-prompt">{SENTENCE_ROUND_PROMPT.listen}</span>
        {status && (
          <span className={`sentence-round-ex-status is-${status}`} data-testid="sentence-round-status">{SENTENCE_ROUND_RESULT[status]}</span>
        )}
        <button type="button" className="sentence-round-ex-more" onClick={onMore} aria-label={`More: ${SENTENCE_HIDE_TITLE}`} data-testid="sentence-round-more">
          ⋯
        </button>
      </div>

      {!answered ? (
        <div className="sentence-listen-question">
          <div className="sentence-listen-audio">
            <button
              type="button"
              className={`btn btn-secondary btn-sm sentence-listen-play${playing ? ' is-playing' : ''}`}
              onClick={() => tap(1)}
              data-testid="sentence-listen-play"
            >
              ▶ {LISTEN_EX_PLAY}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm sentence-listen-slow"
              onClick={() => tap(LISTEN_SLOW_RATE)}
              aria-label={`Play at ${LISTEN_EX_SLOW}`}
              data-testid="sentence-listen-slow"
            >
              🐢 {LISTEN_EX_SLOW}
            </button>
          </div>
          {active && (
            <>
              <VoiceTextInputView
                value={answer}
                onChange={setAnswer}
                lang="en"
                placeholder={LISTEN_EX_PLACEHOLDER}
                listeningPlaceholder={LISTEN_EX_LISTENING}
                submitLabel={LISTEN_EX_SUBMIT}
                disabled={micBusy}
                testId="sentence-listen-input"
                state={d.state}
                finalText={d.finalText}
                partialText={d.partialText}
                canSubmit={d.canSubmit}
                actions={{ say: d.say, stop: d.stop, cancel: d.cancel, retake: d.retake, retryUpload: d.retryUpload, edit: d.edit, type: d.type, submit: d.submit }}
              />
              <button
                type="button"
                className="sentence-round-skip sentence-listen-show"
                onClick={() => { d.cancel(); submit('', 'none'); }}
                disabled={dictating}
                data-testid="sentence-listen-show"
              >
                👁 {LISTEN_EX_SHOW_ANSWER}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* The reveal, at once: the sentence, its pinyin and English, ▶. */}
          <div className="sentence-round-ex-body" data-testid="sentence-listen-reveal">
            <div className="sentence-round-ex-text">
              <p className="sentence-round-zh" lang="zh-CN" data-testid="sentence-round-chinese">{row.hanzi}</p>
              {row.pinyin && <p className="sentence-round-pinyin">{row.pinyin}</p>}
              {row.translation?.trim() ? (
                <p className="sentence-round-en is-after" data-testid="sentence-listen-english">{row.translation}</p>
              ) : (
                <p className="sentence-round-en is-after is-pending" data-testid="sentence-round-english-pending">{SENTENCE_ROUND_TRANSLATION_OFFLINE}</p>
              )}
            </div>
            <div className="sentence-round-ex-tools">
              <button
                type="button"
                className={`sentence-set-play${playing ? ' is-playing' : ''}`}
                onClick={() => tap(1)}
                aria-label={`Play: ${row.hanzi}`}
                data-testid="sentence-round-play"
              >
                ▶
              </button>
            </div>
          </div>
          {said && said.input !== 'none' && (
            <p className="sentence-listen-said" data-testid="sentence-listen-said">
              <span className="sentence-listen-said-label">{LISTEN_EX_YOU_SAID}:</span> {said.text}
            </p>
          )}
          {/* The verdict, slim, under the reveal — its height kept from the start so nothing jumps. */}
          <div className={`sentence-listen-verdict${status ? ` is-${status}` : ''}`} role="status" aria-live="polite" data-testid="sentence-listen-verdict">
            {verdict?.kind === 'checking' && <span className="sentence-listen-checking">{LISTEN_EX_CHECKING}</span>}
            {verdict?.kind === 'claude' && (
              <span className="sentence-listen-headline" data-testid="sentence-listen-headline">
                <strong>{SENTENCE_ROUND_RESULT[verdict.result]}</strong> · {verdict.check.headline}
              </span>
            )}
            {verdict?.kind === 'self' && (
              <div className="sentence-listen-self">
                <span className="sentence-listen-self-q">{LISTEN_EX_SELF_QUESTION}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => selfCheck(false)} data-testid="sentence-listen-missed">
                  ✗ {LISTEN_EX_MISSED_IT}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => selfCheck(true)} data-testid="sentence-listen-got">
                  ✓ {LISTEN_EX_GOT_IT}
                </button>
              </div>
            )}
            {verdict?.kind === 'self_done' && (
              <span className="sentence-listen-headline"><strong>{SENTENCE_ROUND_RESULT[verdict.result]}</strong></span>
            )}
          </div>
          {verdict?.kind === 'claude' && verdict.check.tips.length > 0 && (
            <ul className="sentence-listen-tips" data-testid="sentence-listen-tips">
              {verdict.check.tips.map((t, i) => (
                <li key={i}>
                  {t.quote && <span className="sentence-listen-quote" lang="zh-CN">{t.quote}</span>} {t.text}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}
