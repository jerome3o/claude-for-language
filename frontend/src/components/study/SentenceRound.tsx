/**
 * The Sentence round (docs/STUDY_SESSION.md "Sentence round"; rules in shared/study/sentenceRound.ts,
 * Lab `ui/study/SentenceRoundUi.kt`): with Settings → Study → "Sentence round before the answer" on,
 * a reading or meaning card goes from its question to FOUR sentence exercises — two "Read it aloud"
 * (the Chinese up) and two "Say it in Chinese" (the English up; its Chinese and ▶ only once answered),
 * easiest → harder — and any two said right open the answer with Good / Easy unlocked. Skip goes to
 * the answer at once, where the gate still applies. Each take is the rows' 🎤 (useSentencePractise:
 * the Coach's practise rule, Claude's spoken translate check online) — practice only, nothing kept.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  pickRoundExercises,
  roundSentences,
  sentenceRoundCheer,
  sentenceRoundCounter,
  sentenceRoundIntro,
  sentenceRoundProgress,
  sentenceRoundSkipNote,
  SENTENCE_ROUND_HIDE_ENGLISH,
  SENTENCE_ROUND_PROMPT,
  SENTENCE_ROUND_RESULT,
  SENTENCE_ROUND_SEE_ANSWER,
  SENTENCE_ROUND_SHOW_ENGLISH,
  SENTENCE_ROUND_SKIP,
  SENTENCE_ROUND_TITLE,
  SENTENCE_ROUND_TRY_AGAIN,
  exercisesFromLog,
  type RoundExercise,
} from '@shared/study/sentenceRound';
import { sentencePractiseResult } from '@shared/study/sentencePractise';
import {
  SENTENCES_COMING_NOTE,
  SENTENCE_HIDDEN_TOAST,
  SENTENCE_HIDE_TITLE,
  sentenceHistoryKey,
  wantsMoreSentences,
  type SentenceHideReason,
} from '@shared/study/sentenceHistory';
import { hideSentence, recordSentenceAttempt, requestMoreSentences, sentencesComing, unhideSentence, useSentenceStats } from '../../services/sentencePractice';
import { useLongPress } from '../chat/useLongPress';
import { UndoToast } from '../upNext/UpNextBoard';
import { SentenceHideSheet } from './SentenceHideSheet';
import { practiseBlockNote, practiseMicEnabled } from '@shared/coach';
import type { Note } from '../../types';
import { fetchNoteSentences, API_BASE } from '../../api/client';
import {
  cacheSentenceAudio,
  getCachedClueTranslation,
  getLocalNoteSentences,
  putLocalNoteSentences,
} from '../../services/sentence-sets';
import { devicePinyinLine } from '../../utils/autoPinyin';
import { useNoteAudio } from '../../hooks/useAudio';
import { track } from '../../services/analytics';
import { Confetti } from '../Confetti';
import { SentenceMicButton, SentencePractiseOutcome, useSentencePractise, type PractiseRow, type RowTake } from './SentencePractise';
import './SentenceRound.css';

/** One of the card's sentences as the round needs it. */
export interface RoundSentenceRow {
  key: string;
  hanzi: string;
  pinyin: string | null;
  translation: string | null;
  audio_url: string | null;
}

type NoteSentenceFields = Pick<Note, 'id' | 'sentence_clue' | 'sentence_clue_pinyin' | 'sentence_clue_translation' | 'sentence_clue_audio_url'>;

/**
 * The card's sentences (the answer side's list: the card's own first, then the set), read from the
 * device — and from the server once when the device has no set yet. null while loading; off → [].
 */
export function useRoundSentences(note: NoteSentenceFields, enabled: boolean): RoundSentenceRow[] | null {
  const [set, setSet] = useState<RoundSentenceRow[] | null>(null);
  const [clueEnglish, setClueEnglish] = useState<string | null>(null);
  const clue = note.sentence_clue?.trim() ? note.sentence_clue : null;
  useEffect(() => {
    setSet(null);
    if (!enabled) return;
    let live = true;
    const toRows = (rows: Array<{ id: string; hanzi: string; pinyin: string | null; translation: string | null; audio_url: string | null }>) =>
      rows.map((s) => ({ key: s.id, hanzi: s.hanzi, pinyin: s.pinyin, translation: s.translation, audio_url: s.audio_url }));
    void (async () => {
      const local = await getLocalNoteSentences(note.id);
      if (!live) return;
      if (local.length === 0 && navigator.onLine) {
        try {
          const remote = await fetchNoteSentences(note.id);
          if (remote.length > 0) {
            const stored = await putLocalNoteSentences(note.id, remote);
            cacheSentenceAudio(stored);
            if (live) setSet(toRows(stored));
            return;
          }
        } catch {
          // offline / transient: the empty local set stands
        }
      }
      if (live) setSet(toRows(local));
    })();
    return () => {
      live = false;
    };
  }, [note.id, enabled]);
  useEffect(() => {
    setClueEnglish(null);
    if (!enabled || !clue || note.sentence_clue_translation?.trim()) return;
    let live = true;
    void getCachedClueTranslation(clue).then((t) => {
      if (live && t) setClueEnglish(t);
    });
    return () => {
      live = false;
    };
  }, [clue, note.sentence_clue_translation, enabled]);

  return useMemo(() => {
    if (!enabled) return [];
    if (!set) return null;
    const clueRow: RoundSentenceRow | null = clue
      ? {
          key: `clue:${note.id}`,
          hanzi: clue,
          pinyin: note.sentence_clue_pinyin?.trim() ? note.sentence_clue_pinyin : devicePinyinLine(clue) || null,
          translation: note.sentence_clue_translation?.trim() || clueEnglish,
          audio_url: note.sentence_clue_audio_url ?? null,
        }
      : null;
    const keys = roundSentences({ clue: clueRow, set }).map((s) => s.key);
    const byKey = new Map([...(clueRow ? [clueRow] : []), ...set].map((r) => [r.key, r]));
    return keys.map((k) => byKey.get(k)!);
  }, [enabled, set, clue, clueEnglish, note.id, note.sentence_clue_pinyin, note.sentence_clue_translation, note.sentence_clue_audio_url]);
}

interface SentenceRoundProps {
  /** The card showing ("one showing of the card": a new one starts afresh). */
  showingKey: string;
  /** The note (its sentences' practice history: the round prefers what he knows least). */
  noteId: string;
  /** The card's question, small at the top (the hanzi on a reading card, the English on a meaning card). */
  question: string;
  questionIsChinese: boolean;
  /** The card's sentences (null while loading). */
  sentences: RoundSentenceRow[] | null;
  /** Exercise ids said right on this showing (kept by the card: the answer side's gate counts them). */
  right: readonly string[];
  onRight: (exerciseId: string) => void;
  /** Enough right: the answer opens unlocked. */
  onDone: () => void;
  /** Skip to the answer (the gate still applies there). */
  onSkip: () => void;
  /** The exercises of this showing's round shown before (resume): the same ones come back. */
  initialIds?: readonly string[];
  /** The exercises as picked (the answer side marks their sentences, in this order). */
  onPicked?: (ids: string[]) => void;
  /** A take on an exercise was judged (its last result; the answer side's outline). */
  onResult?: (id: string, result: 'right' | 'close' | 'wrong') => void;
}

export function SentenceRound({ showingKey, noteId, question, questionIsChinese, sentences, right, onRight, onDone, onSkip, initialIds, onPicked, onResult }: SentenceRoundProps) {
  const stats = useSentenceStats(noteId);
  // The exercises are picked ONCE per showing (from the history as it stood): a take written meanwhile
  // must not reshuffle the round under his finger. A sentence hidden now leaves it.
  const [picked, setPicked] = useState<RoundExercise[] | null>(null);
  useEffect(() => {
    if (picked || !sentences || !stats) return;
    const hidden = (key: string) => !!stats.get(sentenceHistoryKey(key))?.hidden;
    const next = (initialIds?.length ? exercisesFromLog(sentences, initialIds, hidden) : null) ?? pickRoundExercises(sentences, stats);
    setPicked(next);
    onPicked?.(next.map((e) => e.id));
  }, [picked, sentences, stats]); // eslint-disable-line react-hooks/exhaustive-deps
  const isHidden = (key: string) => !!stats?.get(sentenceHistoryKey(key))?.hidden;
  const exercises = useMemo(() => (picked ?? []).filter((e) => !isHidden(e.key)), [picked, stats]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleKeys = useMemo(() => (sentences ?? []).filter((s) => !isHidden(s.key)).map((s) => s.key), [sentences, stats]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => new Map((sentences ?? []).map((s) => [s.key, s])), [sentences]);
  const progress = sentenceRoundProgress(exercises, right, visibleKeys);
  // More sentences for this word: every one left known in both modes, or fewer than four left.
  const [coming, setComing] = useState(() => sentencesComing(noteId));
  useEffect(() => {
    if (!sentences || !stats) return;
    if (wantsMoreSentences(sentences, stats)) {
      const visible = sentences.filter((s) => !isHidden(s.key)).length;
      requestMoreSentences(noteId, visible < 4 ? 'few' : 'known');
      setComing(true);
    }
  }, [sentences, stats, noteId]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Stop showing this sentence": the sheet, then Undo.
  const [hiding, setHiding] = useState<RoundExercise | null>(null);
  const [undo, setUndo] = useState<{ key: string } | null>(null);
  const longPress = useLongPress();
  const hide = (ex: RoundExercise, reason: SentenceHideReason) => {
    setHiding(null);
    void hideSentence(noteId, ex.key, reason, 'round');
    setUndo({ key: ex.key });
  };
  const { isPlaying, play } = useNoteAudio('sentence-round');
  const [playing, setPlaying] = useState<string | null>(null);
  const [english, setEnglish] = useState<Record<string, boolean>>({});
  const exerciseKey = useRef(new Map<string, string>());
  exerciseKey.current = new Map((picked ?? []).map((e) => [e.id, e.key]));
  const practise = useSentencePractise({
    showingKey: `${showingKey}:round`,
    onRight,
    // Every judged take goes into the sentence's practice history.
    onResult: (id, mode, result) => {
      const key = exerciseKey.current.get(id);
      if (key) recordSentenceAttempt(noteId, key, mode, result);
    },
  });

  // No sentences after all: straight to the answer.
  const latest = useRef({ onDone, onSkip });
  latest.current = { onDone, onSkip };
  useEffect(() => {
    if (picked && picked.length === 0) latest.current.onDone();
  }, [picked]);

  // A result landed: right / miss, once per take (a translate take waits for Claude's check).
  const reported = useRef(new WeakSet<RowTake>());
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  useEffect(() => {
    exercises.forEach((ex, index) => {
      const t = practise.takes[ex.id];
      if (!t || reported.current.has(t) || t.claude?.status === 'checking') return;
      reported.current.add(t);
      const result = sentencePractiseResult(t.take.practised, t.claude?.status === 'done' ? t.claude.check.verdict : null);
      if (result === 'right' || result === 'close' || result === 'wrong') onResultRef.current?.(ex.id, result);
      track('study.sentence_round', { action: result === 'right' ? 'right' : 'miss', index, mode: ex.mode, got: progress.got, needed: progress.needed });
    });
  }, [practise.takes, exercises, progress.got, progress.needed]);

  // A cheer when the count goes up; the answer once enough are right.
  const [cheer, setCheer] = useState<string | null>(null);
  const lastGot = useRef(progress.got);
  useEffect(() => {
    if (progress.got > lastGot.current) {
      setCheer(sentenceRoundCheer(progress));
      if (progress.done) track('study.sentence_round', { action: 'done', got: progress.got, needed: progress.needed });
    }
    lastGot.current = progress.got;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.got]);
  useEffect(() => {
    if (!progress.done || !cheer) return;
    const id = window.setTimeout(() => latest.current.onDone(), 1400);
    return () => window.clearTimeout(id);
  }, [progress.done, cheer]);

  const blocked = practise.dictation.state.blocked;
  const blockNote = practiseMicEnabled(blocked) ? null : practiseBlockNote(blocked);

  const playRow = (key: string, row: RoundSentenceRow) => {
    setPlaying(key);
    play(row.audio_url, row.hanzi, API_BASE);
  };

  const renderExercise = (ex: RoundExercise, index: number) => {
    const row = rows.get(ex.key);
    if (!row) return null;
    const practiseRow: PractiseRow = { key: ex.id, hanzi: row.hanzi, pinyin: row.pinyin, translation: row.translation };
    const take = practise.takes[ex.id];
    const mine = practise.active?.row.key === ex.id;
    const busy = mine && (practise.listening || practise.finishing);
    const result = take && take.claude?.status !== 'checking'
      ? sentencePractiseResult(take.take.practised, take.claude?.status === 'done' ? take.claude.check.verdict : null)
      : null;
    const isRight = right.includes(ex.id);
    const status: 'right' | 'close' | 'wrong' | null = isRight ? 'right' : result === 'close' || result === 'wrong' ? result : null;
    const answered = isRight || !!take;
    const showChinese = ex.mode === 'read' || answered;
    const showEnglish = ex.mode === 'translate' || (answered && english[ex.id]);
    return (
      <li
        key={ex.id}
        {...longPress.bind(() => setHiding(ex))}
        onContextMenu={(e) => { e.preventDefault(); setHiding(ex); }}
        className={`sentence-round-ex${status ? ` is-${status}` : ''}${busy ? ' is-active' : ''}`}
        data-testid="sentence-round-exercise"
        data-mode={ex.mode}
        data-status={status ?? 'open'}
      >
        <div className="sentence-round-ex-head">
          <span className="sentence-round-ex-num" aria-hidden="true">{status === 'right' ? '✓' : index + 1}</span>
          <span className="sentence-round-ex-prompt">{SENTENCE_ROUND_PROMPT[ex.mode]}</span>
          {status && (
            <span className={`sentence-round-ex-status is-${status}`} data-testid="sentence-round-status">
              {SENTENCE_ROUND_RESULT[status]}
            </span>
          )}
          <button
            type="button"
            className="sentence-round-ex-more"
            onClick={() => setHiding(ex)}
            aria-label={`More: ${SENTENCE_HIDE_TITLE}`}
            data-testid="sentence-round-more"
          >
            ⋯
          </button>
        </div>
        <div className="sentence-round-ex-body">
          <div className="sentence-round-ex-text">
            {ex.mode === 'translate' && <p className="sentence-round-en" data-testid="sentence-round-english">{row.translation}</p>}
            {showChinese && (
              <p className="sentence-round-zh" lang="zh-CN" data-testid="sentence-round-chinese">{row.hanzi}</p>
            )}
            {answered && row.pinyin && <p className="sentence-round-pinyin">{row.pinyin}</p>}
            {ex.mode === 'read' && showEnglish && row.translation && <p className="sentence-round-en is-after">{row.translation}</p>}
          </div>
          <div className="sentence-round-ex-tools">
            {!isRight && <SentenceMicButton practise={practise} row={practiseRow} mode={ex.mode} />}
            {answered && (
              <button
                type="button"
                className={`sentence-set-play${isPlaying && playing === ex.id ? ' is-playing' : ''}`}
                onClick={() => playRow(ex.id, row)}
                aria-label={`Play: ${row.hanzi}`}
                data-testid="sentence-round-play"
              >
                ▶
              </button>
            )}
          </div>
        </div>
        <SentencePractiseOutcome practise={practise} row={practiseRow} />
        {answered && (
          <div className="sentence-round-ex-actions">
            {(status === 'close' || status === 'wrong') && !busy && (
              <button
                type="button"
                className="btn btn-secondary btn-sm sentence-round-retry"
                disabled={!practiseMicEnabled(blocked) || practise.listening || practise.finishing}
                onClick={() => {
                  track('study.sentence_round', { action: 'retry', index, mode: ex.mode, got: progress.got, needed: progress.needed });
                  practise.toggle(practiseRow, ex.mode);
                }}
                data-testid="sentence-round-retry"
              >
                🔁 {SENTENCE_ROUND_TRY_AGAIN}
              </button>
            )}
            {ex.mode === 'read' && row.translation && (
              <button
                type="button"
                className="sentence-round-link"
                onClick={() => setEnglish((prev) => ({ ...prev, [ex.id]: !prev[ex.id] }))}
                aria-pressed={!!english[ex.id]}
              >
                {english[ex.id] ? SENTENCE_ROUND_HIDE_ENGLISH : SENTENCE_ROUND_SHOW_ENGLISH}
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="sentence-round" data-testid="sentence-round" aria-labelledby="sentence-round-title">
      {progress.done && cheer && <Confetti />}
      <div className="sentence-round-question" data-testid="sentence-round-question">
        <span className={questionIsChinese ? 'sentence-round-question-zh' : 'sentence-round-question-en'} lang={questionIsChinese ? 'zh-CN' : undefined}>
          {question}
        </span>
      </div>
      <header className="sentence-round-head">
        <h2 id="sentence-round-title" className="sentence-round-title">🎯 {SENTENCE_ROUND_TITLE}</h2>
        {progress.needed > 0 && (
          <div className="sentence-round-counter" data-testid="sentence-round-counter" aria-label={`${progress.got} of ${progress.needed} right`}>
            {Array.from({ length: progress.needed }, (_, i) => (
              <span key={i} className={`sentence-round-dot${i < progress.got ? ' is-on' : ''}`} aria-hidden="true">{i < progress.got ? '✓' : ''}</span>
            ))}
            <span className="sentence-round-count">{sentenceRoundCounter(progress)}</span>
          </div>
        )}
      </header>
      {sentences == null || picked == null ? (
        <p className="sentence-round-intro">Loading sentences…</p>
      ) : (
        <p className="sentence-round-intro">{sentenceRoundIntro(progress, exercises.length)}</p>
      )}
      {blockNote && <p className="sentence-round-blocked" role="status">{blockNote}</p>}
      {coming && <p className="sentence-round-coming" role="status" data-testid="sentences-coming">{SENTENCES_COMING_NOTE}</p>}
      {cheer && (
        <div className={`sentence-round-cheer${progress.done ? ' is-done' : ''}`} role="status" aria-live="polite" data-testid="sentence-round-cheer" key={cheer}>
          {cheer}
        </div>
      )}
      <ol className="sentence-round-list">{exercises.map(renderExercise)}</ol>
      <div className="sentence-round-footer">
        {progress.done ? (
          <button type="button" className="btn btn-primary btn-block" onClick={() => onDone()} data-testid="sentence-round-continue">
            {SENTENCE_ROUND_SEE_ANSWER} →
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-block sentence-round-skip"
              onClick={() => {
                track('study.sentence_round', { action: 'skip', got: progress.got, needed: progress.needed });
                onSkip();
              }}
              data-testid="sentence-round-skip"
            >
              {SENTENCE_ROUND_SKIP} →
            </button>
            {progress.needed > 0 && <p className="sentence-round-skip-note">{sentenceRoundSkipNote(progress)}</p>}
          </>
        )}
      </div>
      {hiding && rows.get(hiding.key) && (
        <SentenceHideSheet
          hanzi={rows.get(hiding.key)!.hanzi}
          translation={rows.get(hiding.key)!.translation}
          onHide={(reason) => hide(hiding, reason)}
          onClose={() => setHiding(null)}
        />
      )}
      {undo && (
        <UndoToast
          text={SENTENCE_HIDDEN_TOAST}
          onUndo={() => { void unhideSentence(noteId, undo.key, 'round'); setUndo(null); }}
          onDone={() => setUndo(null)}
        />
      )}
    </section>
  );
}
