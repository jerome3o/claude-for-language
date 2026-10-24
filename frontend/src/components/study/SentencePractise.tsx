/**
 * 🎤 on an example sentence row (docs/STUDY_SESSION.md "Practise a sentence aloud";
 * shared/study/sentencePractise.ts): left of ▶ once something is open. Read mode (the Chinese is
 * up) judges the take like the Sentence Coach's "Practise saying it"; translate mode (English-first,
 * Chinese hidden) takes the row's sentence or a homophone as right on the device, and anything else
 * in Chinese goes to the lesson answer check (`POST /api/lessons/answer-check`, translate, spoken)
 * when online. Practice only — nothing recorded; a take said right is reported to `onRight` (the
 * "Get two sentences right before Good / Easy" gate counts it).
 *
 * ONE microphone per list (`useSentencePractise`): a 🎤 on another row stops this one's take; tap
 * 🎤 again, press Enter or tap anywhere else to stop. Lab: `SentencePractiseState` in ui/study/Sentences.kt.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COACH_PRACTISE_EMPTY,
  practiseBlockNote,
  practiseMicEnabled,
} from '@shared/coach';
import {
  SENTENCE_PRACTISE_CHECKING,
  SENTENCE_PRACTISE_CHECK_ONLINE,
  SENTENCE_PRACTISE_LABEL,
  SENTENCE_PRACTISE_LISTENING,
  SENTENCE_PRACTISE_STOP,
  sentenceAnswerCheckInput,
  sentencePractiseResult,
  sentencePractiseVia,
  sentenceTake,
  showCheckOnline,
  type SentencePractiseMode,
  type SentenceTake,
} from '@shared/study/sentencePractise';
import { answerCheckChip, type AnswerCheck } from '@shared/lesson/answerCheck';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { checkLessonAnswer } from '../../services/answerCheck';
import { track } from '../../services/analytics';
import { YouSaidFailed, YouSaidRow } from './YouSaid';
import { CorrectionDiffLine } from '../chat/ChatCorrection';
import '../lessons/AnswerCheckCard.css';

/** The row a take is about. */
export interface PractiseRow {
  key: string;
  hanzi: string;
  pinyin: string | null;
  translation: string | null;
}

export interface RowTake {
  mode: SentencePractiseMode;
  take: SentenceTake;
  /** Claude's check of a translate take that wasn't the sentence. */
  claude: { status: 'checking' } | { status: 'done'; check: AnswerCheck } | { status: 'unavailable' } | null;
}

export function useSentencePractise({ enabled = true, showingKey, onRight, onTranslated, onResult }: {
  /** Off (the card editor): no 🎤, and the microphone's live session is never prefetched. */
  enabled?: boolean;
  /** A new showing of the card (or another note) starts from scratch. */
  showingKey: string;
  /** A row said right (each row may be reported more than once; the gate counts it once). */
  onRight?: (rowKey: string) => void;
  /** A translate take landed: the row reveals its Chinese. */
  onTranslated?: (rowKey: string) => void;
  /** A take judged right / close / wrong (the sentence's practice history records it). */
  onResult?: (rowKey: string, mode: SentencePractiseMode, result: 'right' | 'close' | 'wrong') => void;
}) {
  const [active, setActive] = useState<{ row: PractiseRow; mode: SentencePractiseMode } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [takes, setTakes] = useState<Record<string, RowTake>>({});
  const showing = useRef(showingKey);
  showing.current = showingKey;
  const latest = useRef({ onRight, onTranslated, onResult });
  latest.current = { onRight, onTranslated, onResult };

  const finish = useCallback((rowKey: string, mode: SentencePractiseMode, take: SentenceTake, claude: AnswerCheck | null) => {
    const result = sentencePractiseResult(take.practised, claude?.verdict ?? null);
    track('study.sentence_practise', { mode, result, via: sentencePractiseVia(take, !!claude) });
    if (result === 'right' || result === 'close' || result === 'wrong') latest.current.onResult?.(rowKey, mode, result);
    if (result === 'right') latest.current.onRight?.(rowKey);
  }, []);

  const dictation = useVoiceDictation({
    surface: 'sentence_practise',
    ...(enabled ? {} : { online: false }),
    value: '',
    onChange: () => {},
    autoSubmit: true,
    onSubmit: (answer) => {
      const a = activeRef.current;
      if (!a) return;
      const { row, mode } = a;
      const take = sentenceTake(mode, answer.text, row.hanzi);
      const forShowing = showing.current;
      setTakes((prev) => ({ ...prev, [row.key]: { mode, take, claude: take.askClaude ? { status: 'checking' } : null } }));
      if (mode === 'translate') latest.current.onTranslated?.(row.key);
      if (!take.askClaude) {
        finish(row.key, mode, take, null);
        return;
      }
      checkLessonAnswer(sentenceAnswerCheckInput(row, take.practised.said)).then(
        ({ check }) => {
          if (showing.current !== forShowing) return;
          setTakes((prev) => (prev[row.key]?.take === take ? { ...prev, [row.key]: { ...prev[row.key], claude: { status: 'done', check } } } : prev));
          finish(row.key, mode, take, check);
        },
        () => {
          if (showing.current !== forShowing) return;
          setTakes((prev) => (prev[row.key]?.take === take ? { ...prev, [row.key]: { ...prev[row.key], claude: { status: 'unavailable' } } } : prev));
          finish(row.key, mode, take, null);
        },
      );
    },
  });
  const { state } = dictation;
  const listening = state.phase === 'listening';
  const finishing = state.phase === 'finishing';

  // A take that gave nothing is reported once.
  const reported = useRef(false);
  useEffect(() => {
    if (state.phase === 'failed' && active && !reported.current) {
      reported.current = true;
      track('study.sentence_practise', { mode: active.mode, result: sentencePractiseResult(null, null, state.failure), via: 'local' });
    }
    if (state.phase !== 'failed') reported.current = false;
  }, [state.phase, state.failure, active]);

  // Another card (or another showing of it): no take carries over.
  const cancelRef = useRef(dictation.cancel);
  cancelRef.current = dictation.cancel;
  useEffect(() => {
    setTakes({});
    setActive(null);
    cancelRef.current();
  }, [showingKey]);

  // While recording: Enter, or a tap anywhere but this row's 🎤, stops the take (the Coach's rule).
  const stopRef = useRef(dictation.stop);
  stopRef.current = dictation.stop;
  const activeKey = active?.row.key ?? null;
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        stopRef.current();
      }
    };
    const onTap = (e: PointerEvent) => {
      const mic = e.target instanceof Element ? e.target.closest('[data-sentence-mic]') : null;
      if (mic && mic.getAttribute('data-sentence-mic') === activeKey) return;
      stopRef.current();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onTap, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onTap, true);
    };
  }, [listening, activeKey]);

  /**
   * 🎤 on a row: stop this take, or start one. A 🎤 on another row while a take is under way only
   * stops that take (the tap did, above) — its result must land on its own row first.
   */
  const toggle = (row: PractiseRow, mode: SentencePractiseMode) => {
    if (listening && activeKey === row.key) return dictation.stop();
    if (listening || finishing) return;
    setTakes((prev) => {
      if (!prev[row.key]) return prev;
      const next = { ...prev };
      delete next[row.key];
      return next;
    });
    setActive({ row, mode });
    dictation.say();
  };

  /** A row hidden again: its result goes too. */
  const clear = (rowKey: string) => {
    setTakes((prev) => {
      if (!prev[rowKey]) return prev;
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
  };

  return { dictation, active, takes, toggle, clear, listening, finishing };
}

export type SentencePractise = ReturnType<typeof useSentencePractise>;

/** 🎤 left of ▶ (36px like ▶, a 44px target). */
export function SentenceMicButton({ practise, row, mode }: { practise: SentencePractise; row: PractiseRow; mode: SentencePractiseMode }) {
  const mine = practise.active?.row.key === row.key;
  const listening = mine && practise.listening;
  const finishing = mine && practise.finishing;
  const enabled = practiseMicEnabled(practise.dictation.state.blocked);
  const label = listening ? SENTENCE_PRACTISE_STOP : `${SENTENCE_PRACTISE_LABEL[mode]}: ${mode === 'read' ? row.hanzi : row.translation ?? ''}`;
  return (
    <button
      type="button"
      className={`sentence-set-mic${listening ? ' is-listening' : ''}`}
      onClick={(e) => { e.stopPropagation(); practise.toggle(row, mode); }}
      disabled={!enabled || (practise.finishing && !mine)}
      aria-pressed={listening}
      aria-label={label}
      title={enabled ? (listening ? SENTENCE_PRACTISE_STOP : SENTENCE_PRACTISE_LABEL[mode]) : practiseBlockNote(practise.dictation.state.blocked) ?? undefined}
      data-sentence-mic={row.key}
      data-mode={mode}
      data-testid="sentence-practise-mic"
    >
      {finishing ? <span className="spinner sentence-set-mic-spinner" aria-hidden="true" /> : <span aria-hidden="true">{listening ? '⏹' : '🎤'}</span>}
    </button>
  );
}

/** Under the row's text: the live words while listening, then the result. */
export function SentencePractiseOutcome({ practise, row }: { practise: SentencePractise; row: PractiseRow }) {
  const mine = practise.active?.row.key === row.key;
  const { dictation } = practise;
  const take = practise.takes[row.key];
  if (mine && practise.listening) {
    const mode = practise.active!.mode;
    return (
      <div className="sentence-practise-live" aria-live="polite" data-testid="sentence-practise-live">
        {dictation.finalText || dictation.partialText ? (
          <span lang="zh-CN">
            {dictation.finalText}
            <span className="sentence-practise-partial">{dictation.partialText}</span>
          </span>
        ) : (
          <span className="sentence-practise-hint">{SENTENCE_PRACTISE_LISTENING[mode]}</span>
        )}
      </div>
    );
  }
  if (mine && dictation.state.phase === 'failed') {
    return dictation.state.failure === 'empty'
      ? <p className="sentence-practise-hint" role="status" data-testid="sentence-practise-empty">{COACH_PRACTISE_EMPTY}</p>
      : <YouSaidFailed onRetry={dictation.retryUpload} note="Or record it again" testId="sentence-practise-retry" />;
  }
  if (!take || (mine && practise.finishing)) return null;
  const { practised } = take.take;
  const claude = take.claude;
  return (
    <div className="sentence-practise-result" data-testid="sentence-practise-result" data-mode={take.mode}
      data-result={sentencePractiseResult(practised, claude?.status === 'done' ? claude.check.verdict : null)}>
      {claude?.status === 'done' ? (
        <TranslateVerdict check={claude.check} said={practised.said} />
      ) : (
        <YouSaidRow transcript={practised.said} correct={row.hanzi} verdict={practised.verdict} testId="sentence-practise-said" />
      )}
      {claude?.status === 'checking' && (
        <div className="answer-check checking" role="status" aria-live="polite" data-testid="sentence-practise-checking">
          <span className="answer-check-dot" aria-hidden="true" /> {SENTENCE_PRACTISE_CHECKING}
        </div>
      )}
      {showCheckOnline(take.take, claude?.status === 'done', claude?.status === 'checking') && (
        <p className="sentence-practise-hint" data-testid="sentence-practise-check-online">{SENTENCE_PRACTISE_CHECK_ONLINE}</p>
      )}
    </div>
  );
}

/** Claude's verdict on a translate take, compact: chip + headline, what was said, the fix. */
function TranslateVerdict({ check, said }: { check: AnswerCheck; said: string }) {
  const chip = answerCheckChip(check.verdict);
  return (
    <div className={`answer-check compact ${chip.tone} sentence-practise-verdict`} data-testid="sentence-practise-verdict" data-verdict={check.verdict}>
      <div className="answer-check-head">
        <span className={`answer-check-chip ${chip.tone}`}>{chip.label}</span>
        <span className="answer-check-headline">{check.headline}</span>
      </div>
      <div className="sentence-practise-said">
        <span className="sentence-practise-said-label">You said</span> <span lang="zh-CN">{said}</span>
      </div>
      {check.corrected && (
        <div className="answer-check-fix">
          <div className="answer-check-fix-line" lang="zh-CN"><CorrectionDiffLine original={said} corrected={check.corrected} /></div>
          {check.corrected_pinyin && <div className="answer-check-pinyin">{check.corrected_pinyin}</div>}
        </div>
      )}
    </div>
  );
}
