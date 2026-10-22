import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalNoteSentence } from '../../db/database';
import {
  getLocalNoteSentences,
  putLocalNoteSentences,
  cacheSentenceAudio,
  generateAndStoreSentenceSet,
  awaitSentenceAudio,
  ensureSentenceAudio,
  topUpListeningSentences,
  SENTENCE_AUDIO_COMING_LABEL,
} from '../../services/sentence-sets';
import { isAudioCached } from '../../services/audioCache';
import { fetchNoteSentences } from '../../api/client';
import { track } from '../../services/analytics';
import './listenContext.css';
import {
  LISTEN_CONTEXT_COPY as COPY,
  isPlayableRow,
  listenAutoplay,
  listenContextRows,
  listenRowLabel,
  listenRowState,
  moreSentencesCount,
  wordTapAction,
  type ListenRow,
  type ListenRowState,
} from '@shared/study/listenContext';

/**
 * "Listen in context" — the question side of a listening card (audio → hanzi;
 * docs/STUDY_SESSION.md, rules in shared/study/listenContext.ts, Lab
 * `ui/study/ListenContext.kt`).
 *
 * The note's sentences — the card's own sentence first, then the generated
 * set — as AUDIO-ONLY rows: ▶, the row's number, ✓ once heard. The Chinese,
 * pinyin and English stay hidden (they would give the answer away); EN shows
 * just the English. "+ More sentences" writes more (online). At the bottom
 * "▶ The word": before any sentence was played it first asks "Try the
 * sentences first?" — [Play the word anyway] [Play a sentence].
 *
 * Auto-play (the card used to read the word as it showed): the first sentence
 * whose clip is ready, else the word.
 */

const WORD_KEY = '__word__';

export interface ListenContextStats {
  sentencesPlayed: number;
  wordFirstPromptShown: boolean;
  playedWordAnyway: boolean;
}

export interface ListenContextProps {
  noteId: string;
  /** The card's own example sentence (on the note). */
  cardSentence: { hanzi?: string | null; translation?: string | null; audio_url?: string | null } | null;
  /** Online and not forced offline: clips stream, ensure-audio and generation are possible. */
  online: boolean;
  /** The study card's one player (a sentence and the word never overlap). */
  playAudio: (audioUrl: string | null, text: string) => void;
  isPlaying: boolean;
  /** ▶ The word: the note's clip (its recordings in turn). */
  onPlayWord: () => void;
  /** The word as auto-played (the first voice); defaults to onPlayWord. */
  onAutoplayWord?: () => void;
  /** "The word" label suffix, e.g. " (2/3)" when the note has several voices. */
  wordSuffix?: string;
  /** Under the word button (Audio coming… / not downloaded). */
  wordNote?: React.ReactNode;
  /** Auto-play once, as the card shows (not on a peek back at the question). */
  autoplay: boolean;
  onAutoplayed?: () => void;
  /** The current numbers, for `study.listen_context` when the card is answered. */
  onStats?: (stats: ListenContextStats) => void;
}

export function ListenContext({
  noteId,
  cardSentence,
  online,
  playAudio,
  isPlaying,
  onPlayWord,
  onAutoplayWord,
  wordSuffix = '',
  wordNote,
  autoplay,
  onAutoplayed,
  onStats,
}: ListenContextProps) {
  const [sentences, setSentences] = useState<LocalNoteSentence[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Which clips are on the device (only matters offline).
  const [cached, setCached] = useState<Record<string, boolean>>({});
  // Heard on this card — by the sentence's text, so a regenerated set keeps its ✓s.
  const [played, setPlayed] = useState<Set<string>>(new Set());
  const [englishShown, setEnglishShown] = useState<Set<string>>(new Set());
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [audioWait, setAudioWait] = useState<Record<string, 'asking' | 'coming'>>({});
  const [prompt, setPrompt] = useState(false);
  const [promptShown, setPromptShown] = useState(false);
  const [anyway, setAnyway] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef(noteId);
  noteRef.current = noteId;

  // Local first (offline), then the server when nothing is on the device yet.
  useEffect(() => {
    let live = true;
    setLoaded(false);
    setSentences([]);
    void (async () => {
      const local = await getLocalNoteSentences(noteId).catch(() => [] as LocalNoteSentence[]);
      if (!live) return;
      setSentences(local);
      setLoaded(true);
      if (local.length === 0 && online) {
        try {
          const remote = await fetchNoteSentences(noteId);
          if (!live || remote.length === 0) return;
          const stored = await putLocalNoteSentences(noteId, remote);
          cacheSentenceAudio(stored);
          if (live) setSentences(stored);
        } catch {
          // The (empty) local set is fine.
        }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const rows = useMemo(
    () => listenContextRows(noteId, cardSentence, sentences),
    [noteId, cardSentence, sentences],
  );

  // Background top-up: fewer than five sentences in total → more queued (once per note per session).
  useEffect(() => {
    if (!loaded || !online) return;
    topUpListeningSentences([noteId]).catch(() => {});
  }, [loaded, online, noteId]);

  // Which clips this device holds (offline they are the only ones that play).
  const urlsKey = rows.map((r) => r.audioUrl ?? '').join('|');
  useEffect(() => {
    let live = true;
    const urls = rows.map((r) => r.audioUrl).filter((u): u is string => !!u);
    Promise.all(urls.map((u) => isAudioCached(u).then((ok) => [u, ok] as const).catch(() => [u, false] as const))).then(
      (pairs) => {
        if (live) setCached(Object.fromEntries(pairs));
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  const states: ListenRowState[] = rows.map((r) =>
    listenRowState(r, { online, cached: !!(r.audioUrl && cached[r.audioUrl]) }),
  );
  const playable = states.filter(isPlayableRow).length;

  useEffect(() => {
    if (!isPlaying) setPlayingKey(null);
  }, [isPlaying]);

  useEffect(() => {
    onStats?.({ sentencesPlayed: played.size, wordFirstPromptShown: promptShown, playedWordAnyway: anyway });
  }, [played, promptShown, anyway, onStats]);

  const markPlayed = (row: ListenRow) =>
    setPlayed((prev) => (prev.has(row.hanzi) ? prev : new Set(prev).add(row.hanzi)));

  const playRow = useCallback(
    (row: ListenRow, state: ListenRowState) => {
      if (state === 'unavailable') return;
      setPrompt(false);
      markPlayed(row);
      if (state === 'fetch' && row.sentenceId) {
        if (audioWait[row.key]) return;
        const forNote = noteId;
        const sentenceId = row.sentenceId;
        const done = () =>
          setAudioWait((prev) => {
            const next = { ...prev };
            delete next[row.key];
            return next;
          });
        setAudioWait((prev) => ({ ...prev, [row.key]: 'asking' }));
        void awaitSentenceAudio(() => ensureSentenceAudio(sentenceId), {
          onComing: () => setAudioWait((prev) => ({ ...prev, [row.key]: 'coming' })),
          stopped: () => noteRef.current !== forNote,
        }).then((result) => {
          if (noteRef.current !== forNote) return;
          done();
          if (result.kind === 'ready') {
            setSentences((prev) => prev.map((s) => (s.id === sentenceId ? { ...s, audio_url: result.url } : s)));
            setPlayingKey(row.key);
            playAudio(result.url, row.hanzi);
          } else if (result.kind === 'unavailable') {
            setPlayingKey(row.key);
            playAudio(null, row.hanzi);
          }
        });
        return;
      }
      setPlayingKey(row.key);
      playAudio(state === 'ready' ? row.audioUrl : null, row.hanzi);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audioWait, noteId, playAudio],
  );

  // Auto-play once the rows are known: the first ready sentence, else the word.
  const autoplayedRef = useRef(false);
  const cacheKnown = online || rows.every((r) => !r.audioUrl || r.audioUrl in cached);
  useEffect(() => {
    if (!autoplay || autoplayedRef.current || !loaded || !cacheKnown) return;
    autoplayedRef.current = true;
    onAutoplayed?.();
    const choice = listenAutoplay(true, states);
    if (choice.kind === 'sentence') playRow(rows[choice.index], states[choice.index]);
    else if (choice.kind === 'word') {
      setPlayingKey(WORD_KEY);
      (onAutoplayWord ?? onPlayWord)();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, loaded, cacheKnown]);


  const playWord = () => {
    setPlayingKey(WORD_KEY);
    onPlayWord();
  };
  const wordPlaying = isPlaying && playingKey === WORD_KEY;

  const tapWord = () => {
    const action = wordTapAction({ sentencesPlayed: played.size, playableSentences: playable, playedWordAnyway: anyway });
    if (action === 'prompt') {
      setPrompt(true);
      setPromptShown(true);
      return;
    }
    setPrompt(false);
    playWord();
  };

  const playAnyway = () => {
    setAnyway(true);
    setPrompt(false);
    playWord();
  };

  const playFirstSentence = () => {
    const index = states.findIndex(isPlayableRow);
    setPrompt(false);
    if (index >= 0) playRow(rows[index], states[index]);
  };

  const toggleEnglish = (row: ListenRow) =>
    setEnglishShown((prev) => {
      const next = new Set(prev);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });

  const more = async () => {
    setGenerating(true);
    setError(null);
    const forNote = noteId;
    try {
      const stored = await generateAndStoreSentenceSet(noteId, { count: moreSentencesCount(rows.length), keepExisting: true });
      if (noteRef.current !== forNote) return;
      setSentences(stored);
      track('study.listen_more_sentences', { before: rows.length, after: listenContextRows(noteId, cardSentence, stored).length });
    } catch (err) {
      console.error('[ListenContext] More sentences failed:', err);
      if (noteRef.current === forNote) setError(COPY.moreFailed);
    } finally {
      if (noteRef.current === forNote) setGenerating(false);
    }
  };

  return (
    <section className="listen-context" data-testid="listen-context">
      {rows.length > 0 ? (
        <>
          <h3 className="listen-context-head">{COPY.heading}</h3>
          <ol className="listen-context-rows">
            {rows.map((row, i) => {
              const state = states[i];
              const heard = played.has(row.hanzi);
              const wait = audioWait[row.key];
              const isRowPlaying = playingKey === row.key && isPlaying;
              const showEn = englishShown.has(row.key);
              return (
                <li key={row.key} className={`listen-row listen-row--${state}${heard ? ' listen-row--played' : ''}`} data-testid="listen-row">
                  <div className="listen-row-line">
                    <button
                      type="button"
                      className={`listen-row-play${isRowPlaying ? ' playing' : ''}`}
                      onClick={() => playRow(row, state)}
                      disabled={state === 'unavailable'}
                      aria-label={listenRowLabel(i, heard)}
                      data-testid="listen-row-play"
                    >
                      <span className="listen-row-icon" aria-hidden="true">{isRowPlaying ? '■' : '▶'}</span>
                      <span className="listen-row-num">{i + 1}</span>
                      <span className="listen-row-status">
                        {wait
                          ? SENTENCE_AUDIO_COMING_LABEL
                          : state === 'unavailable'
                            ? COPY.unavailable
                            : heard
                              ? <span className="listen-row-check" aria-hidden="true">✓</span>
                              : null}
                      </span>
                    </button>
                    {row.translation && (
                      <button
                        type="button"
                        className={`listen-row-en${showEn ? ' listen-row-en--on' : ''}`}
                        onClick={() => toggleEnglish(row)}
                        aria-pressed={showEn}
                        aria-label={showEn ? 'Hide the English' : 'Show the English'}
                        data-testid="listen-row-en"
                      >
                        EN
                      </button>
                    )}
                  </div>
                  {showEn && <p className="listen-row-translation" data-testid="listen-row-translation">{row.translation}</p>}
                </li>
              );
            })}
          </ol>
        </>
      ) : loaded ? (
        <p className="listen-context-empty">{COPY.noSentences}</p>
      ) : null}

      {online && loaded && (
        <button
          type="button"
          className="listen-context-more"
          onClick={() => void more()}
          disabled={generating}
          data-testid="listen-more"
        >
          {generating ? COPY.generating : COPY.more}
        </button>
      )}
      {error && <p className="listen-context-error" role="alert">{error}</p>}

      {prompt && (
        <div className="listen-word-prompt" role="alertdialog" aria-labelledby="listen-word-prompt-title" data-testid="listen-word-prompt">
          <p id="listen-word-prompt-title" className="listen-word-prompt-title">{COPY.promptTitle}</p>
          <p className="listen-word-prompt-body">{COPY.promptBody}</p>
          <div className="listen-word-prompt-actions">
            <button type="button" className="btn btn-secondary" onClick={playAnyway} data-testid="listen-word-anyway">
              {COPY.promptAnyway}
            </button>
            <button type="button" className="btn btn-primary" onClick={playFirstSentence} data-testid="listen-word-sentence">
              {COPY.promptSentence}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className={`btn btn-secondary listen-word${wordPlaying ? ' playing' : ''}`}
        onClick={tapWord}
        data-testid="listen-word"
      >
        <span aria-hidden="true">{wordPlaying ? '■' : '▶'}</span> {COPY.word}{wordSuffix}
      </button>
      {wordNote}
    </section>
  );
}
