/**
 * The Sentence round (docs/STUDY_SESSION.md "Sentence round"; rules in shared/study/sentenceRound.ts,
 * Lab `ui/study/SentenceRoundUi.kt`): with Settings → Study → "Sentence round before the answer" on,
 * a reading or meaning card goes from its question to FOUR sentence exercises — two "Read it aloud"
 * (the Chinese up) and two "Say it in Chinese" (the English up; its Chinese and ▶ only once answered),
 * easiest → harder — and any two said right open the answer with Good / Easy unlocked. Skip is quiet
 * (muted text) and asks first ("Skip this exercise?"); confirmed, it goes to the answer, where the gate
 * still applies. Each take is the rows' 🎤 (useSentencePractise:
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
  SENTENCE_ROUND_HIDE_ENGLISH,
  SENTENCE_ROUND_ENGLISH_CHIP,
  SENTENCE_ROUND_TRANSLATING,
  SENTENCE_ROUND_TRANSLATION_FAILED,
  SENTENCE_ROUND_TRANSLATION_OFFLINE,
  roundEnglishShown,
  SENTENCE_ROUND_PROMPT,
  SENTENCE_ROUND_RESULT,
  SENTENCE_ROUND_SEE_ANSWER,
  SENTENCE_ROUND_SHOW_ENGLISH,
  SENTENCE_ROUND_SKIP,
  SENTENCE_ROUND_SKIP_CONFIRM,
  SENTENCE_ROUND_SKIP_CONFIRM_NO,
  SENTENCE_ROUND_SKIP_CONFIRM_YES,
  SENTENCE_ROUND_TITLE,
  SENTENCE_ROUND_TRY_AGAIN,
  exercisesFromLog,
  pickListenRoundExercises,
  listenRoundIntro,
  sentenceRoundProgress as roundProgressOf,
  LISTEN_ROUND_SELF_CHECK_NOTE,
  LISTEN_ROUND_SHOW_CHINESE,
  LISTEN_ROUND_SELF_RIGHT,
  LISTEN_ROUND_SELF_WRONG,
  exerciseAsRead,
  listenActiveId,
  type RoundExercise,
} from '@shared/study/sentenceRound';
import { useSentencesByEar } from '../../services/hardModePrefs';
import { isAudioCached } from '../../services/audioCache';
import { SentenceListenExercise } from './SentenceListenExercise';
import { RoundChinese } from './RoundChinese';
import { roundTakeFeel } from '@shared/study/hardMode';
import { studyFeel } from '../../services/studyFeel';
import { sentencePractiseResult } from '@shared/study/sentencePractise';
import {
  roundTakeDifference,
  roundTakeView,
  DIFFERENCE_CONTINUE,
  DIFFERENCE_HOLD_NOTE,
  DIFFERENCE_SAY_AGAIN,
  DIFFERENCE_TITLE,
  type DifferenceReason,
} from '@shared/study/answerDifference';
import {
  SENTENCES_COMING_NOTE,
  SENTENCE_HIDDEN_TOAST,
  SENTENCE_HIDE_TITLE,
  sentenceHistoryKey,
  moreSentencesWanted,
  sentencesComingShown,
  type SentenceHideReason,
} from '@shared/study/sentenceHistory';
import { hideSentence, recordSentenceAttempt, requestMoreSentences, unhideSentence, useSentenceStats } from '../../services/sentencePractice';
import { useLongPress } from '../chat/useLongPress';
import { UndoToast } from '../upNext/UpNextBoard';
import { SentenceHideSheet } from './SentenceHideSheet';
import { practiseBlockNote, practiseMicEnabled } from '@shared/coach';
import type { Note } from '../../types';
import { fetchNoteSentences, API_BASE } from '../../api/client';
import {
  cacheSentenceAudio,
  ensureSentenceAudio,
  getCachedClueTranslation,
  getClueTranslation,
  getLocalNoteSentences,
  putLocalNoteSentences,
} from '../../services/sentence-sets';
import { devicePinyinLine } from '../../utils/autoPinyin';
import { useNoteAudio } from '../../hooks/useAudio';
import { track } from '../../services/analytics';
import { useNetwork } from '../../contexts/NetworkContext';
import { Confetti } from '../Confetti';
import { SentenceMicButton, SentencePractiseOutcome, SentenceStopBar, useSentencePractise, type PractiseRow, type RowTake } from './SentencePractise';
import './DifferenceCompare.css';
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
export function useRoundSentences(note: NoteSentenceFields, enabled: boolean, opts: { fetchClueEnglish?: boolean } = {}): RoundSentenceRow[] | null {
  const fetchClueEnglish = !!opts.fetchClueEnglish;
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
    // The listening card's round asks for English sentences: the card's own one, when its English isn't on
    // the device yet, is fetched once online (cached by text, like the rows').
    void getCachedClueTranslation(clue)
      .then((t) => t ?? (fetchClueEnglish && navigator.onLine !== false ? getClueTranslation({ hanzi: clue, pinyin: note.sentence_clue_pinyin ?? null }) : null))
      .then((t) => {
        if (live && t) setClueEnglish(t);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clue, note.sentence_clue_translation, enabled, fetchClueEnglish]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /** Skip to the answer, once confirmed (the gate still applies there). */
  onSkip: () => void;
  /** The cheer once enough are right, in place of the session's "Good and Easy unlocked" (the homework pass: "Got it unlocked"). */
  doneCheer?: (got: number, needed: number) => string;
  /** The exercises of this showing's round shown before (resume): the same ones come back. */
  initialIds?: readonly string[];
  /** The exercises as picked (the answer side marks their sentences, in this order). */
  onPicked?: (ids: string[]) => void;
  /** A take on an exercise was judged (its last result; the answer side's outline). */
  onResult?: (id: string, result: 'right' | 'close' | 'wrong') => void;
  /** Analytics: the regular session or the homework pass. */
  where?: 'session' | 'homework';
  /**
   * 'listen' = the listening card's round: only "🔁 Say it in Chinese", over the English sentences that carry
   * `word` (`pickListenRoundExercises`); offline / no microphone → say it aloud, show the Chinese, check yourself.
   */
  kind?: 'card' | 'listen';
  /** The card's word (the listening round's sentences carry it). */
  word?: string;
}

/** Set rows whose missing clip was already asked for in this session. */
const askedClips = new Set<string>();

export function SentenceRound({ showingKey, noteId, question, questionIsChinese, sentences, right, onRight, onDone, onSkip, initialIds, onPicked, onResult, doneCheer, where = 'session', kind = 'card', word = '' }: SentenceRoundProps) {
  const listen = kind === 'listen';
  const stats = useSentenceStats(noteId);
  const { isOnline } = useNetwork();
  // Sentences by ear (Settings → Study, on by default): the read slots become listen exercises where the
  // sentence can be heard — a clip, streamed online or on the device offline (shared/study/sentenceRound.ts).
  const byEar = useSentencesByEar() && !listen;
  const [cachedClips, setCachedClips] = useState<Record<string, boolean> | null>(null);
  const needCacheCheck = byEar && !isOnline;
  useEffect(() => {
    if (!needCacheCheck || !sentences || cachedClips) return;
    let live = true;
    const urls = sentences.map((s) => s.audio_url).filter((u): u is string => !!u);
    void Promise.all(urls.map((u) => isAudioCached(u).then((ok) => [u, ok] as const).catch(() => [u, false] as const))).then((pairs) => {
      if (live) setCachedClips(Object.fromEntries(pairs));
    });
    return () => { live = false; };
  }, [needCacheCheck, sentences, cachedClips]);
  // A set row with no clip yet: asked for in the background (the rows' ensure-audio path), so it can be
  // heard next time; this round reads it.
  useEffect(() => {
    if (!byEar || !isOnline || !sentences) return;
    for (const s of sentences) {
      if (s.audio_url || s.key.startsWith('clue:') || askedClips.has(s.key)) continue;
      askedClips.add(s.key);
      void Promise.resolve().then(() => ensureSentenceAudio(s.key)).catch(() => {});
    }
  }, [byEar, isOnline, sentences]);
  // The exercises are picked ONCE per showing (from the history as it stood): a take written meanwhile
  // must not reshuffle the round under his finger. A sentence hidden now leaves it.
  const [picked, setPicked] = useState<RoundExercise[] | null>(null);
  useEffect(() => {
    if (picked || !sentences || !stats) return;
    if (needCacheCheck && !cachedClips) return;
    const hidden = (key: string) => !!stats.get(sentenceHistoryKey(key))?.hidden;
    const withAudio = sentences.map((s) => ({ ...s, audio: !!s.audio_url && (isOnline || !!cachedClips?.[s.audio_url]) }));
    const next = (initialIds?.length ? exercisesFromLog(sentences, initialIds, hidden) : null)
      ?? (listen ? pickListenRoundExercises(sentences, word, stats) : pickRoundExercises(withAudio, stats, { byEar, online: isOnline }));
    setPicked(next);
    onPicked?.(next.map((e) => e.id));
  }, [picked, sentences, stats, cachedClips]); // eslint-disable-line react-hooks/exhaustive-deps
  const isHidden = (key: string) => !!stats?.get(sentenceHistoryKey(key))?.hidden;
  const exercises = useMemo(() => (picked ?? []).filter((e) => !isHidden(e.key)), [picked, stats]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleKeys = useMemo(() => (sentences ?? []).filter((s) => !isHidden(s.key)).map((s) => s.key), [sentences, stats]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => new Map((sentences ?? []).map((s) => [s.key, s])), [sentences]);
  const progress = sentenceRoundProgress(exercises, right, visibleKeys);
  // More sentences for this word, made in the background before the fresh ones run out (a buffer of
  // sentences he has never practised; `moreSentencesWanted`). The note shows only when this round is short.
  // Checked again after each take (stats change): the buffer is refilled as soon as this round uses it
  // up; requestMoreSentences asks at most every ten minutes per word.
  const [coming, setComing] = useState(false);
  const notedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!sentences || !stats) return;
    const want = moreSentencesWanted(sentences, stats);
    if (want) requestMoreSentences(noteId, { reason: want.reason, count: want.count });
    if (notedFor.current !== noteId) {
      notedFor.current = noteId;
      setComing(sentencesComingShown(want));
    }
  }, [sentences, stats, noteId]);
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
  // A sentence with no English on the note (the card's own, MCP-added / older notes): fetched once it
  // is shown (the rows' `getClueTranslation`, cached by text — offline once fetched).
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const [fetchFailed, setFetchFailed] = useState<Record<string, boolean>>({});
  const fetching = useRef(new Set<string>());
  const wantEnglish = (key: string) => {
    const row = rows.get(key);
    if (!row || row.translation?.trim() || fetched[key] || fetchFailed[key] || fetching.current.has(key)) return;
    fetching.current.add(key);
    void getCachedClueTranslation(row.hanzi)
      .then((cached) => cached ?? (navigator.onLine === false ? null : getClueTranslation({ hanzi: row.hanzi, pinyin: row.pinyin })))
      .then((t) => { if (t) setFetched((p) => ({ ...p, [key]: t })); })
      .catch(() => setFetchFailed((p) => ({ ...p, [key]: true })))
      .finally(() => fetching.current.delete(key));
  };
  const exerciseKey = useRef(new Map<string, string>());
  exerciseKey.current = new Map((picked ?? []).map((e) => [e.id, e.key]));
  // The exercise said right last: when it was right in other words, the round waits for Continue.
  const lastRight = useRef<string | null>(null);
  // The feel of a take: the one that makes the count = round_done (Good and Easy open), else round_right.
  const feelState = useRef({ exercises: [] as RoundExercise[], right: [] as readonly string[], visibleKeys: [] as string[] });
  feelState.current = { exercises, right, visibleKeys };
  const practise = useSentencePractise({
    feel: (id, result) => {
      const f = feelState.current;
      const before = roundProgressOf(f.exercises, f.right, f.visibleKeys);
      const after = roundProgressOf(f.exercises, result === 'right' ? [...f.right, id] : f.right, f.visibleKeys);
      studyFeel(roundTakeFeel(result, after.done && !before.done));
    },
    showingKey: `${showingKey}:round`,
    onRight: (id) => {
      lastRight.current = id;
      onRight(id);
    },
    // Every judged take goes into the sentence's practice history.
    onResult: (id, mode, result) => {
      const key = exerciseKey.current.get(id);
      if (key) recordSentenceAttempt(noteId, key, mode, result);
    },
  });

  /** Right but not the model sentence (shared/study/answerDifference.ts): why, else null. */
  const differenceOf = (ex: RoundExercise | undefined): DifferenceReason | null => {
    const t = ex ? practise.takes[ex.id] : undefined;
    const row = ex ? rows.get(ex.key) : undefined;
    if (!ex || ex.mode === 'listen' || !t || !row || t.claude?.status === 'checking') return null;
    return roundTakeDifference({
      mode: ex.mode,
      said: t.take.practised.said,
      model: row.hanzi,
      local: t.take.practised.result.state,
      claude: t.claude?.status === 'done' ? t.claude.check.verdict : null,
    });
  };
  // Enough right, the last one in other words: stay on it (docs/STUDY_SESSION.md "Right, but said differently").
  const heldId = progress.done && lastRight.current && differenceOf(exercises.find((e) => e.id === lastRight.current)) ? lastRight.current : null;
  // Once held, or once he said an accepted one again, the round waits for Continue for good: a better
  // retake (now identical) must not send him on by itself.
  const [stayPut, setStayPut] = useState(false);
  useEffect(() => {
    if (heldId) setStayPut(true);
  }, [heldId]);

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
      // A judged take shows its English again, whatever EN said before it (Hide applies until the next take).
      setEnglish((prev) => {
        if (!(ex.id in prev)) return prev;
        const next = { ...prev };
        delete next[ex.id];
        return next;
      });
      const result = sentencePractiseResult(t.take.practised, t.claude?.status === 'done' ? t.claude.check.verdict : null);
      if (result === 'right' || result === 'close' || result === 'wrong') onResultRef.current?.(ex.id, result);
      track('study.sentence_round', { action: result === 'right' ? 'right' : 'miss', index, mode: ex.mode, got: progress.got, needed: progress.needed });
      const reason = result === 'right' ? differenceOf(ex) : null;
      if (reason) {
        track('study.round_difference_shown', {
          kind: 'translate',
          reason,
          verdict: t.claude?.status === 'done' ? t.claude.check.verdict : t.take.practised.result.state,
          where,
          held: progress.done,
        });
      }
    });
  }, [practise.takes, exercises, progress.got, progress.needed]); // eslint-disable-line react-hooks/exhaustive-deps

  // A cheer when the count goes up; the answer once enough are right.
  const [cheer, setCheer] = useState<string | null>(null);
  const lastGot = useRef(progress.got);
  useEffect(() => {
    if (progress.got > lastGot.current) {
      setCheer(progress.done && doneCheer ? doneCheer(progress.got, progress.needed) : sentenceRoundCheer(progress));
      if (progress.done) track('study.sentence_round', { action: 'done', got: progress.got, needed: progress.needed });
    }
    lastGot.current = progress.got;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.got]);
  useEffect(() => {
    if (!progress.done || !cheer || heldId || stayPut) return;
    const id = window.setTimeout(() => latest.current.onDone(), 1400);
    return () => window.clearTimeout(id);
  }, [progress.done, cheer, heldId, stayPut]);

  // Skip asks first ("Skip this exercise?" · Skip / Keep going).
  const [confirmSkip, setConfirmSkip] = useState(false);

  const blocked = practise.dictation.state.blocked;
  // The listening round with no microphone (offline, blocked): say it aloud, show the Chinese, check yourself.
  const selfCheck = listen && !practiseMicEnabled(blocked);
  const blockNote = selfCheck ? LISTEN_ROUND_SELF_CHECK_NOTE : practiseMicEnabled(blocked) ? null : practiseBlockNote(blocked);
  const [selfShown, setSelfShown] = useState<Record<string, boolean>>({});
  const [selfResult, setSelfResult] = useState<Record<string, 'right' | 'wrong'>>({});
  const selfCheckTake = (ex: RoundExercise, index: number, said: boolean) => {
    const result = said ? 'right' : 'wrong';
    const before = sentenceRoundProgress(exercises, right, visibleKeys);
    setSelfResult((p) => ({ ...p, [ex.id]: result }));
    onResult?.(ex.id, result);
    recordSentenceAttempt(noteId, ex.key, ex.mode, result);
    if (said) {
      lastRight.current = ex.id;
      onRight(ex.id);
    }
    const after = sentenceRoundProgress(exercises, said ? [...right, ex.id] : right, visibleKeys);
    studyFeel(roundTakeFeel(result, after.done && !before.done));
    track('study.sentence_round', { action: said ? 'right' : 'miss', index, mode: ex.mode, got: after.got, needed: after.needed });
  };

  // Sentences by ear: the listen exercise with the floor (its clip plays, its box is open) — the one he
  // chose, else the first one not yet answered (`listenActiveId`).
  const [chosenListen, setChosenListen] = useState<string | null>(null);
  const [listenAnswered, setListenAnswered] = useState<string[]>([]);
  const activeListen = listenActiveId(exercises, listenAnswered, chosenListen);
  const listenJudged = (ex: RoundExercise, index: number, result: 'right' | 'close' | 'wrong') => {
    const before = sentenceRoundProgress(exercises, right, visibleKeys);
    onResult?.(ex.id, result);
    recordSentenceAttempt(noteId, ex.key, 'listen', result);
    if (result === 'right') {
      lastRight.current = ex.id;
      onRight(ex.id);
    }
    const after = sentenceRoundProgress(exercises, result === 'right' ? [...right, ex.id] : right, visibleKeys);
    studyFeel(roundTakeFeel(result, after.done && !before.done));
    track('study.sentence_round', { action: result === 'right' ? 'right' : 'miss', index, mode: 'listen', got: after.got, needed: after.needed });
  };
  /** The clip won't play here after all: the same sentence, read (the round keeps its place). */
  const listenUnavailable = (ex: RoundExercise) => {
    setPicked((prev) => {
      if (!prev) return prev;
      const next = prev.map((e) => (e.id === ex.id ? exerciseAsRead(e) : e));
      onPicked?.(next.map((e) => e.id));
      return next;
    });
    track('study.sentence_listen', { fallback: true, where });
  };

  const playRow = (key: string, row: RoundSentenceRow) => {
    setPlaying(key);
    play(row.audio_url, row.hanzi, API_BASE);
  };

  // Read exercises showing English they don't have yet (filled while rendering, fetched after it).
  const needEnglish: string[] = [];
  useEffect(() => {
    needEnglish.forEach(wantEnglish);
  });

  const renderExercise = (ex: RoundExercise, index: number) => {
    const row = rows.get(ex.key);
    if (!row) return null;
    if (ex.mode === 'listen') {
      return (
        <SentenceListenExercise
          key={ex.id}
          ex={ex}
          index={index}
          row={row}
          active={activeListen === ex.id}
          onActivate={() => setChosenListen(ex.id)}
          onRevealed={() => setListenAnswered((p) => (p.includes(ex.id) ? p : [...p, ex.id]))}
          isRight={right.includes(ex.id)}
          online={isOnline}
          micBusy={practise.listening || practise.finishing}
          onJudged={(result) => listenJudged(ex, index, result)}
          onUnavailable={() => listenUnavailable(ex)}
          onMore={() => setHiding(ex)}
          longPress={longPress.bind(() => setHiding(ex))}
          suppressTap={longPress.suppressTap}
          where={where}
        />
      );
    }
    const practiseRow: PractiseRow = { key: ex.id, hanzi: row.hanzi, pinyin: row.pinyin, translation: row.translation };
    const takeMode = ex.mode;
    const take = practise.takes[ex.id];
    const mine = practise.active?.row.key === ex.id;
    const busy = mine && (practise.listening || practise.finishing);
    const result = take && take.claude?.status !== 'checking'
      ? sentencePractiseResult(take.take.practised, take.claude?.status === 'done' ? take.claude.check.verdict : null)
      : null;
    const isRight = right.includes(ex.id);
    const self = selfResult[ex.id];
    const status: 'right' | 'close' | 'wrong' | null = isRight ? 'right' : result === 'close' || result === 'wrong' ? result : self === 'wrong' ? 'wrong' : null;
    const answered = isRight || !!take || !!selfShown[ex.id];
    // Claude's check whole: "You said" vs the model answer carries the Chinese, its pinyin and ▶ — unless
    // it was correct in the very same words (`roundTakeView`): then the sentence shows once, here.
    const fullCheck = ex.mode === 'translate' && take?.claude?.status === 'done' && roundTakeView({
      mode: ex.mode,
      said: take.take.practised.said,
      model: row.hanzi,
      local: take.take.practised.result.state,
      claude: take.claude.check.verdict,
    }).compare;
    const difference = differenceOf(ex);
    const showChinese = ex.mode === 'read' || (answered && !fullCheck);
    const showEnglish = roundEnglishShown(ex.mode, status, answered, english[ex.id]);
    const readEnglish = row.translation?.trim() || fetched[ex.key] || null;
    if (ex.mode === 'read' && showEnglish && !readEnglish) needEnglish.push(ex.key);
    return (
      <li
        key={ex.id}
        {...longPress.bind(() => setHiding(ex))}
        onContextMenu={(e) => { e.preventDefault(); setHiding(ex); }}
        className={`sentence-round-ex${status ? ` is-${status}` : ''}${busy ? ' is-active' : ''}`}
        data-testid="sentence-round-exercise"
        data-mode={ex.mode}
        data-status={status ?? 'open'}
        data-difference={difference ?? undefined}
        data-held={heldId === ex.id ? 'true' : undefined}
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
              // Once answered, every word opens the language explorer (+ Add as card → "From example sentences").
              <RoundChinese text={row.hanzi} explorable={answered && !busy} suppressTap={longPress.suppressTap} />
            )}
            {answered && !fullCheck && row.pinyin && <p className="sentence-round-pinyin">{row.pinyin}</p>}
            {ex.mode === 'read' && showEnglish && (readEnglish ? (
              <p className="sentence-round-en is-after" data-testid="sentence-round-read-english">{readEnglish}</p>
            ) : (
              <p className="sentence-round-en is-after is-pending" data-testid="sentence-round-english-pending">
                {fetchFailed[ex.key]
                  ? SENTENCE_ROUND_TRANSLATION_FAILED
                  : !isOnline
                    ? SENTENCE_ROUND_TRANSLATION_OFFLINE
                    : SENTENCE_ROUND_TRANSLATING}
              </p>
            ))}
          </div>
          <div className="sentence-round-ex-tools">
            {ex.mode === 'read' && (
              <button
                type="button"
                className={`sentence-round-en-chip${showEnglish ? ' is-on' : ''}`}
                onClick={() => setEnglish((prev) => ({ ...prev, [ex.id]: !showEnglish }))}
                aria-pressed={showEnglish}
                aria-label={showEnglish ? SENTENCE_ROUND_HIDE_ENGLISH : SENTENCE_ROUND_SHOW_ENGLISH}
                title={showEnglish ? SENTENCE_ROUND_HIDE_ENGLISH : SENTENCE_ROUND_SHOW_ENGLISH}
                data-testid="sentence-round-english-toggle"
              >
                <span className="sentence-round-en-chip-dot" aria-hidden="true">{SENTENCE_ROUND_ENGLISH_CHIP}</span>
              </button>
            )}
            {selfCheck ? (!selfShown[ex.id] && (
              <button
                type="button"
                className="btn btn-secondary btn-sm sentence-round-show-chinese"
                onClick={() => setSelfShown((p) => ({ ...p, [ex.id]: true }))}
                data-testid="listen-round-show-chinese"
              >
                {LISTEN_ROUND_SHOW_CHINESE}
              </button>
            )) : (!isRight || busy) && <SentenceMicButton practise={practise} row={practiseRow} mode={ex.mode} />}
            {answered && !fullCheck && (
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
        {difference && !busy && (
          <p className="difference-title" data-testid="round-difference-title">{DIFFERENCE_TITLE[difference]}</p>
        )}
        <SentencePractiseOutcome
          practise={practise}
          row={practiseRow}
          full
          onPlayModel={() => playRow(ex.id, row)}
          speak={(text) => play(null, text, API_BASE)}
        />
        {selfCheck && selfShown[ex.id] && !isRight && (
          <div className="sentence-round-ex-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => selfCheckTake(ex, index, false)} data-testid="listen-round-self-wrong">
              ✗ {LISTEN_ROUND_SELF_WRONG}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => selfCheckTake(ex, index, true)} data-testid="listen-round-self-right">
              ✓ {LISTEN_ROUND_SELF_RIGHT}
            </button>
          </div>
        )}
        {answered && !selfCheck && (
          <div className="sentence-round-ex-actions">
            {(status === 'close' || status === 'wrong') && !busy && (
              <button
                type="button"
                className="btn btn-secondary btn-sm sentence-round-retry"
                disabled={!practiseMicEnabled(blocked) || practise.listening || practise.finishing}
                onClick={() => {
                  track('study.sentence_round', { action: 'retry', index, mode: ex.mode, got: progress.got, needed: progress.needed });
                  practise.toggle(practiseRow, takeMode);
                }}
                data-testid="sentence-round-retry"
              >
                🔁 {SENTENCE_ROUND_TRY_AGAIN}
              </button>
            )}
            {isRight && !busy && (
              <button
                type="button"
                className="btn btn-secondary btn-sm sentence-round-retry"
                disabled={!practiseMicEnabled(blocked) || practise.listening || practise.finishing}
                onClick={() => {
                  track('study.sentence_round', { action: 'say_again', index, mode: ex.mode, got: progress.got, needed: progress.needed });
                  setStayPut(true);
                  practise.toggle(practiseRow, takeMode);
                }}
                data-testid="sentence-round-say-again"
              >
                🎤 {DIFFERENCE_SAY_AGAIN}
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
        <p className="sentence-round-intro">{listen ? listenRoundIntro(progress, exercises.length) : sentenceRoundIntro(progress, exercises.length)}</p>
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
          <>
            <button type="button" className="btn btn-primary btn-block" onClick={() => onDone()} data-testid="sentence-round-continue" data-held={heldId ? 'true' : undefined}>
              {heldId || stayPut ? DIFFERENCE_CONTINUE : SENTENCE_ROUND_SEE_ANSWER} →
            </button>
            {heldId && <p className="sentence-round-skip-note" role="status" data-testid="difference-hold-note">{DIFFERENCE_HOLD_NOTE}</p>}
          </>
        ) : (
          <>
            {/* Quiet on purpose: it shouldn't invite a tap, and it asks first. */}
            <button
              type="button"
              className="sentence-round-skip"
              onClick={() => setConfirmSkip(true)}
              aria-haspopup="dialog"
              data-testid="sentence-round-skip"
            >
              {SENTENCE_ROUND_SKIP}
            </button>
          </>
        )}
      </div>
      <SentenceStopBar practise={practise} />
      {confirmSkip && (
        <SkipConfirm
          onKeepGoing={() => {
            setConfirmSkip(false);
            track('study.sentence_round', { action: 'skip_cancel', got: progress.got, needed: progress.needed });
          }}
          onSkip={() => {
            setConfirmSkip(false);
            track('study.sentence_round', { action: 'skip', got: progress.got, needed: progress.needed });
            onSkip();
          }}
        />
      )}
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

/** "Skip this exercise?" — a small pop-up; Keep going (the default) leaves the round as it was. */
function SkipConfirm({ onSkip, onKeepGoing }: { onSkip: () => void; onKeepGoing: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const latest = useRef(onKeepGoing);
  latest.current = onKeepGoing;
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-overlay" onClick={onKeepGoing} role="presentation">
      <div
        className="modal sentence-round-skip-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sentence-round-skip-confirm-title"
        onClick={(e) => e.stopPropagation()}
        data-testid="sentence-round-skip-confirm"
      >
        <h3 id="sentence-round-skip-confirm-title" className="sentence-round-skip-confirm-title">{SENTENCE_ROUND_SKIP_CONFIRM}</h3>
        <div className="sentence-round-skip-confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={onSkip} data-testid="sentence-round-skip-yes">
            {SENTENCE_ROUND_SKIP_CONFIRM_YES}
          </button>
          <button ref={keepRef} type="button" className="btn btn-primary" onClick={onKeepGoing} data-testid="sentence-round-skip-no">
            {SENTENCE_ROUND_SKIP_CONFIRM_NO}
          </button>
        </div>
      </div>
    </div>
  );
}
