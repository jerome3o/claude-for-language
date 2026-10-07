import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocalNoteSentence } from '../db/database';
import {
  getLocalNoteSentences,
  generateAndStoreSentenceSet,
  putLocalNoteSentences,
  clearLocalNoteSentences,
  cacheSentenceAudio,
  resetSentenceSetSyncCursor,
  getSentenceExplanation,
  getTextExplanation,
  getCachedTextExplanation,
  getClueTranslation,
  getCachedClueTranslation,
  awaitSentenceAudio,
  ensureSentenceAudio,
  SENTENCE_AUDIO_COMING_LABEL,
} from '../services/sentence-sets';
import { devicePinyinLine } from '../utils/autoPinyin';
import { isEffectivelyOffline } from '../services/offlineMode';
import { SentenceBriefExplanation } from '../types';
import { fetchNoteSentences, deleteNoteSentenceSet, API_BASE } from '../api/client';
import { useNoteAudio } from '../hooks/useAudio';
import { useNetwork } from '../contexts/NetworkContext';
import { AddChunkModal, Chunk } from './AddChunkModal';
import { SentenceWordBreakdown } from './SentenceWordBreakdown';
import { track } from '../services/analytics';

/**
 * A note's sentence set: several example sentences for one word, ordered from
 * a very simple structure to a properly complex one, with a couple of them
 * deliberately placing the word in the language (a word sharing a character,
 * an easily-confused neighbour, its usual collocation).
 *
 * Reads come from IndexedDB so the whole set — audio included — works offline.
 * Only generation needs a connection.
 *
 * On the study card the list is always there, under the meaning, but every
 * row starts blank: you listen first (▶ on the right), then tap the row to
 * uncover the Chinese, then the pinyin, then the English — a listening
 * exercise by default. The EN button on the left flips a row to English-first
 * for the reverse exercise: the translation goes up alone, and the taps then
 * uncover the Chinese and pinyin so you translate back before checking.
 * "Show all" opens everything for the current card.
 */

const FOCUS_LABELS: Record<string, string> = {
  from_card: 'From the card',
  core: 'Core',
  shared_character: 'Shared character',
  contrast: 'Contrast',
  collocation: 'Collocation',
  complex: 'Complex',
};

const COUNT_OPTIONS = [5, 10];

/**
 * Progressive reveal: you hear the sentence, then uncover it a line at a time
 * — characters, then pinyin, then the English — so each one gets read before
 * the next is there to read instead. Steps a row hasn't got are skipped.
 */
type RevealStep = 'hanzi' | 'pinyin' | 'translation';

/**
 * The steps a row still has to uncover. In English-first mode the translation
 * is already on screen as the prompt, so it drops out of the chain rather than
 * being shown twice.
 */
function revealSteps(
  row: { pinyin: string | null; translation: string | null; fetchTranslation?: boolean },
  englishFirst = false
): RevealStep[] {
  const steps: RevealStep[] = ['hanzi'];
  if (row.pinyin) steps.push('pinyin');
  // The card's own sentence always has an English step: when the note carries
  // no translation it is fetched as the row opens (see getClueTranslation).
  if ((row.translation || row.fetchTranslation) && !englishFirst) steps.push('translation');
  return steps;
}

/** Read the explanation cached on a synced row, if it has one. */
function parseCachedExplanation(raw: string | null): SentenceBriefExplanation | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SentenceBriefExplanation;
  } catch {
    return null;
  }
}

/** The card's own example sentence, which lives on the note, not in the set. */
export interface CardSentence {
  hanzi: string;
  pinyin: string | null;
  translation: string | null;
  audio_url: string | null;
}

/** A row in the rendered list — either the card's sentence or a set row. */
interface DisplayRow {
  /** Set-row id, or `clue:<noteId>` for the card's own sentence */
  key: string;
  /** null for the card's own sentence: it has no row to cache against */
  sentenceId: string | null;
  hanzi: string;
  pinyin: string | null;
  translation: string | null;
  audio_url: string | null;
  focus: string | null;
  focus_note: string | null;
  explanation: string | null;
  fromCard: boolean;
  /** The card's sentence with no translation on the note: the English is fetched on demand. */
  fetchTranslation: boolean;
}

interface SentenceSetProps {
  noteId: string;
  /**
   * The card's own example sentence. It leads the list, so there is one place
   * to look for sentences rather than two stacked panels.
   */
  cardSentence?: CardSentence | null;
  /** Rendered inside the study card: always open, tighter spacing. */
  compact?: boolean;
  /** Start with the list expanded (non-compact only; the study card is always open). */
  defaultOpen?: boolean;
  /**
   * The homework pass's calm version: the same rows (▶, tap to reveal, "What's
   * going on here?", + Add as card), but the Chinese is already up — taps add the
   * pinyin, then the English — with no header, no EN exercise, no generating, and
   * the generated set behind "+ N more sentences".
   */
  variant?: 'card' | 'pass';
}

export function SentenceSet({
  noteId,
  cardSentence,
  compact = false,
  defaultOpen = true,
  variant = 'card',
}: SentenceSetProps) {
  const pass = variant === 'pass';
  // How much a row shows before any tap: nothing on the study card (listen
  // first), the Chinese in the pass.
  const startStage = pass ? 1 : 0;
  const { isOnline } = useNetwork();
  const { isPlaying, play } = useNoteAudio('sentence-set');

  const [sentences, setSentences] = useState<LocalNoteSentence[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(compact || defaultOpen);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // How much of each row is showing: 0 = nothing, then one line per tap.
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  // Rows put into English-first mode: the translation leads, the Chinese is
  // hidden until a tap, so the row reads as a translate-into-Chinese prompt.
  const [englishFirst, setEnglishFirst] = useState<Record<string, boolean>>({});
  // Everything open for this card (resets on the next one, so the default
  // stays listen-first).
  const [showAll, setShowAll] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  // ▶ on a set row whose clip isn't made yet: asking the server / queued ("Audio coming…").
  const [audioWait, setAudioWait] = useState<Record<string, 'asking' | 'coming'>>({});
  // Explanations fetched this session, keyed by sentence id ('error' = failed)
  const [explanations, setExplanations] = useState<
    Record<string, SentenceBriefExplanation | 'error'>
  >({});
  const [explaining, setExplaining] = useState<Set<string>>(new Set());
  const [showCustom, setShowCustom] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  // Whatever the learner tapped to turn into its own card: a whole sentence
  // or a single word out of a breakdown.
  const [addingChunk, setAddingChunk] = useState<Chunk | null>(null);
  // The pass: the generated set folded away under the card's own sentence.
  const [showMore, setShowMore] = useState(false);
  // The card's own sentence has no row to cache its breakdown on: the one this
  // device already holds (study card, Coach) shows at once, offline too.
  const [cachedClue, setCachedClue] = useState<SentenceBriefExplanation | null>(null);
  // Many card sentences were written without an English line: the one fetched
  // (or cached on this device) for it, and how that is going.
  const [clueTranslation, setClueTranslation] = useState<string | null>(null);
  const [clueTranslating, setClueTranslating] = useState(false);
  const [clueTranslateFailed, setClueTranslateFailed] = useState(false);

  // Guard against a slow fetch landing after the user moved to another card
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;

  const load = useCallback(async () => {
    setLoading(true);
    const local = await getLocalNoteSentences(noteId);
    if (noteIdRef.current !== noteId) return;
    setSentences(local);
    setLoading(false);

    // Nothing cached yet but we're online: the set may exist server-side
    // (generated on another device) and simply not have synced down yet.
    if (local.length === 0 && navigator.onLine) {
      try {
        const remote = await fetchNoteSentences(noteId);
        if (noteIdRef.current !== noteId || remote.length === 0) return;
        const stored = await putLocalNoteSentences(noteId, remote);
        cacheSentenceAudio(stored);
        setSentences(stored);
      } catch {
        // Offline or transient failure — the local (empty) set is fine
      }
    }
  }, [noteId]);

  useEffect(() => {
    setRevealed({});
    setAudioWait({});
    setEnglishFirst({});
    setShowAll(false);
    setExplanations({});
    setShowCustom(false);
    setShowMenu(false);
    setCustomPrompt('');
    setError(null);
    setShowMore(false);
    setOpen(compact || defaultOpen);
    void load();
  }, [noteId, compact, defaultOpen, load]);

  const clueHanzi = cardSentence?.hanzi ?? null;
  useEffect(() => {
    setCachedClue(null);
    setClueTranslation(null);
    setClueTranslating(false);
    setClueTranslateFailed(false);
    if (!clueHanzi) return;
    let live = true;
    void getCachedTextExplanation(clueHanzi).then((cached) => {
      if (live) setCachedClue(cached);
    });
    void getCachedClueTranslation(clueHanzi).then((cached) => {
      if (live && cached) setClueTranslation(cached);
    });
    return () => {
      live = false;
    };
  }, [clueHanzi]);

  // A card sentence written without pinyin gets the device's own (like every
  // automatic pinyin), so it reveals hanzi → pinyin → English like the set rows.
  const cluePinyin = useMemo(() => {
    if (!clueHanzi) return null;
    if (cardSentence?.pinyin?.trim()) return cardSentence.pinyin;
    return devicePinyinLine(clueHanzi) || null;
  }, [clueHanzi, cardSentence?.pinyin]);

  const handleGenerate = useCallback(
    async (options: { count?: number; keepExisting?: boolean; customPrompt?: string } = {}) => {
      setShowMenu(false);
      setGenerating(true);
      setError(null);
      try {
        const stored = await generateAndStoreSentenceSet(noteId, options);
        if (noteIdRef.current !== noteId) return;
        setSentences(stored);
        setOpen(true);
      } catch (err) {
        console.error('[SentenceSet] Generation failed:', err);
        if (noteIdRef.current === noteId) {
          setError('Could not generate sentences. Try again in a moment.');
        }
      } finally {
        if (noteIdRef.current === noteId) setGenerating(false);
      }
    },
    [noteId]
  );

  const handleClear = useCallback(async () => {
    setShowMenu(false);
    try {
      await deleteNoteSentenceSet(noteId);
    } catch {
      // Offline: the server still has the set and its rows are older than our
      // sync cursor, so they'd never come back on an incremental sync. Drop
      // the cursor instead so the next sync re-reconciles from scratch.
      resetSentenceSetSyncCursor();
    }
    await clearLocalNoteSentences(noteId);
    setSentences([]);
  }, [noteId]);

  /** One more tap, one more line — and a tap on a fully open row hides it again. */
  const advanceRow = (row: DisplayRow) => {
    const total = revealSteps(row, englishFirst[row.key]).length;
    const first = englishFirst[row.key] ? 0 : startStage;
    const current = revealed[row.key] ?? first;
    if (current < total) track('study.sentence_reveal', { step: current + 1 });
    setRevealed((prev) => {
      const stage = prev[row.key] ?? first;
      return { ...prev, [row.key]: stage >= total ? first : stage + 1 };
    });
  };

  /**
   * The reverse exercise: show only the English and hide the Chinese, so the
   * sentence can be translated back from memory. Turning it on re-collapses
   * the row — there's nothing to work out if the answer is already up.
   */
  const toggleEnglishFirst = (row: DisplayRow) => {
    const next = !englishFirst[row.key];
    setEnglishFirst((prev) => ({ ...prev, [row.key]: next }));
    setRevealed((prev) => ({ ...prev, [row.key]: 0 }));
    if (next) setShowAll(false);
  };

  const playSentence = (row: DisplayRow) => {
    const sentenceId = row.sentenceId;
    // A new set's rows get their clips a moment after the set: wait for the real
    // clip instead of reading the row in the device voice (Lab: SentenceAudioWait).
    if (!row.audio_url && sentenceId && isOnline && !isEffectivelyOffline()) {
      if (audioWait[row.key]) return;
      const forNote = noteId;
      const done = () => setAudioWait((prev) => {
        const next = { ...prev };
        delete next[row.key];
        return next;
      });
      setAudioWait((prev) => ({ ...prev, [row.key]: 'asking' }));
      void awaitSentenceAudio(() => ensureSentenceAudio(sentenceId), {
        onComing: () => setAudioWait((prev) => ({ ...prev, [row.key]: 'coming' })),
        stopped: () => noteIdRef.current !== forNote,
      }).then((result) => {
        if (noteIdRef.current !== forNote) return;
        done();
        if (result.kind === 'ready') {
          setSentences((prev) => prev.map((s) => (s.id === sentenceId ? { ...s, audio_url: result.url } : s)));
          setPlayingId(row.key);
          play(result.url, row.hanzi, API_BASE);
        } else if (result.kind === 'unavailable') {
          setPlayingId(row.key);
          play(null, row.hanzi, API_BASE);
        }
      });
      return;
    }
    setPlayingId(row.key);
    play(row.audio_url, row.hanzi, API_BASE);
  };

  const handleExplain = useCallback(async (row: DisplayRow) => {
    setExplaining((prev) => new Set(prev).add(row.key));
    try {
      // Set rows cache their breakdown server-side; the card's own sentence
      // has no row, so it goes through the by-text path instead.
      const explanation = row.sentenceId
        ? await getSentenceExplanation(row.sentenceId)
        : await getTextExplanation({
            hanzi: row.hanzi,
            pinyin: row.pinyin,
            translation: row.translation,
          });
      setExplanations((prev) => ({ ...prev, [row.key]: explanation }));
      track('study.sentence_explain');
    } catch (err) {
      console.error('[SentenceSet] Explain failed:', err);
      setExplanations((prev) => ({ ...prev, [row.key]: 'error' }));
    } finally {
      setExplaining((prev) => {
        const next = new Set(prev);
        next.delete(row.key);
        return next;
      });
    }
  }, []);

  /**
   * The per-sentence breakdown: a word list plus a line on the construction.
   * Cached rows render straight from IndexedDB, so a second look is instant
   * and works offline.
   */
  const renderExplanation = (row: DisplayRow) => {
    const state = explanations[row.key] ?? parseCachedExplanation(row.explanation) ?? (row.fromCard ? cachedClue : null);
    if (!state || state === 'error') return null;
    return (
      <SentenceWordBreakdown explanation={state} sentence={row.hanzi} />
    );
  };

  /** The row's quiet tools line: breakdown · add as card. */
  const renderTools = (row: DisplayRow) => {
    const state = explanations[row.key] ?? parseCachedExplanation(row.explanation) ?? (row.fromCard ? cachedClue : null);
    const isLoading = explaining.has(row.key);
    const retryEnglish = row.fetchTranslation && !row.translation && clueTranslateFailed && isOnline;
    return (
      <div className="sentence-set-tools">
        {retryEnglish && (
          <button className="sentence-set-tool" onClick={() => setClueTranslateFailed(false)}>
            Retry English
          </button>
        )}
        {!state || state === 'error' ? (
          <button
            className="sentence-set-tool"
            onClick={() => handleExplain(row)}
            disabled={isLoading || !isOnline}
            title={!isOnline ? 'Requires internet connection' : 'Break this sentence down'}
          >
            {isLoading
              ? 'Explaining…'
              : state === 'error'
                ? 'Explain failed — retry'
                : 'What’s going on here?'}
          </button>
        ) : null}
        {row.pinyin && row.translation && (
          <button
            className="sentence-set-tool"
            onClick={() =>
              setAddingChunk({
                hanzi: row.hanzi,
                pinyin: row.pinyin || '',
                english: row.translation || '',
              })
            }
            title="Add this sentence as a card"
          >
            + Add as card
          </button>
        )}
      </div>
    );
  };

  /**
   * One list for the learner: the card's own example sentence first, then the
   * generated set. The card's sentence is rendered from the note rather than
   * copied into the set, so editing it stays reflected here and there is only
   * ever one copy of it.
   */
  const rows: DisplayRow[] = [];
  const ownTranslation = cardSentence?.translation?.trim() || null;
  if (cardSentence?.hanzi && !sentences.some((s) => s.hanzi === cardSentence.hanzi)) {
    rows.push({
      key: `clue:${noteId}`,
      sentenceId: null,
      hanzi: cardSentence.hanzi,
      pinyin: cluePinyin,
      translation: ownTranslation || cachedClue?.translation?.trim() || clueTranslation,
      audio_url: cardSentence.audio_url,
      focus: 'from_card',
      focus_note: null,
      explanation: null,
      fromCard: true,
      fetchTranslation: !ownTranslation,
    });
  }
  for (const sentence of sentences) {
    rows.push({
      key: sentence.id,
      sentenceId: sentence.id,
      hanzi: sentence.hanzi,
      pinyin: sentence.pinyin,
      translation: sentence.translation,
      audio_url: sentence.audio_url,
      focus: sentence.focus,
      focus_note: sentence.focus_note,
      explanation: sentence.explanation,
      fromCard: false,
      fetchTranslation: false,
    });
  }

  // The card's sentence has no English yet: fetch it as soon as the row starts
  // opening, so it is there by the time the learner taps through to it.
  const clueRow = rows[0]?.fromCard ? rows[0] : null;
  const clueStage = clueRow ? (showAll ? Infinity : revealed[clueRow.key] ?? startStage) : 0;
  const clueNeedsFetch = !!clueRow && clueRow.fetchTranslation && !clueRow.translation;
  useEffect(() => {
    if (!clueNeedsFetch || !clueHanzi || clueStage < 1 || !isOnline || clueTranslating || clueTranslateFailed) return;
    let live = true;
    setClueTranslating(true);
    getClueTranslation({ hanzi: clueHanzi, pinyin: cluePinyin })
      .then((translation) => {
        if (live) setClueTranslation(translation);
      })
      .catch((err) => {
        console.warn('[SentenceSet] Could not get the English for the card sentence:', err);
        if (live) setClueTranslateFailed(true);
      })
      .finally(() => {
        if (live) setClueTranslating(false);
      });
    return () => {
      live = false;
      setClueTranslating(false);
    };
    // clueTranslating is set here; re-running on it would cancel the request it started.
  }, [clueNeedsFetch, clueHanzi, clueStage >= 1, isOnline, clueTranslateFailed, cluePinyin]);

  const hasSet = sentences.length > 0;
  const rootClass = `sentence-set${compact ? ' sentence-set--compact' : ''}`;

  if (loading && rows.length === 0) {
    return null;
  }

  // The pass never generates: no sentence, nothing to show.
  if (pass && rows.length === 0) return null;

  // Nothing at all yet: a single quiet button that generates the set.
  if (rows.length === 0) {
    return (
      <div className={`${rootClass} sentence-set--empty`} data-testid="sentence-set">
        <button
          className="sentence-set-more"
          onClick={() => handleGenerate({ count: 6 })}
          disabled={generating || !isOnline}
          title={!isOnline ? 'Requires internet connection' : 'Generate a graded set of example sentences'}
        >
          {generating ? 'Generating sentences…' : '✨ Generate example sentences'}
        </button>
        {error && <div className="sentence-set-error">{error}</div>}
        {addingChunk && (
          <AddChunkModal source="breakdown" chunk={addingChunk} onClose={() => setAddingChunk(null)} />
        )}
      </div>
    );
  }

  const regenMenu = (
    <div className="sentence-set-menu-wrap">
      <button
        className="sentence-set-action"
        onClick={() => setShowMenu((v) => !v)}
        disabled={generating || !isOnline}
        aria-haspopup="menu"
        aria-expanded={showMenu}
        aria-label="Sentence options"
        title={!isOnline ? 'Requires internet connection' : 'Regenerate the set'}
      >
        {generating ? '…' : '⋯'}
      </button>
      {showMenu && (
        <div className="regen-menu" role="menu">
          {COUNT_OPTIONS.map((count) => (
            <button
              key={count}
              className="regen-menu-item"
              onClick={() => handleGenerate({ count })}
            >
              {hasSet ? `New set of ${count}` : `Generate ${count}`}
            </button>
          ))}
          {hasSet && (
            <button
              className="regen-menu-item"
              onClick={() => handleGenerate({ count: 5, keepExisting: true })}
            >
              Add 5 more
            </button>
          )}
          <button
            className="regen-menu-item"
            onClick={() => {
              setShowMenu(false);
              setShowCustom(true);
            }}
          >
            Custom…
          </button>
          {hasSet && (
            <button className="regen-menu-item" onClick={handleClear}>
              Clear set
            </button>
          )}
        </div>
      )}
    </div>
  );

  // The pass shows the card's own sentence; the rest wait behind "+ N more".
  const visibleRows = pass && !showMore ? rows.slice(0, 1) : rows;
  const moreCount = rows.length - 1;

  return (
    <div className={`${rootClass}${pass ? ' sentence-set--pass' : ''}`} data-testid="sentence-set">
      {!pass && (
      <div className="sentence-set-header">
        {compact ? (
          <span className="sentence-set-title">Example sentences</span>
        ) : (
          <button
            className="sentence-set-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <span className="sentence-set-caret">{open ? '▾' : '▸'}</span>
            <span className="sentence-set-title">Sentences</span>
            <span className="sentence-set-count">{rows.length}</span>
          </button>
        )}

        {open && (
          <div className="sentence-set-actions">
            <button
              className={`sentence-set-action sentence-set-action--text${showAll ? ' is-active' : ''}`}
              onClick={() => setShowAll((v) => !v)}
              aria-pressed={showAll}
              title={showAll ? 'Hide everything again' : 'Show every sentence with pinyin and English'}
            >
              {showAll ? 'Hide all' : 'Show all'}
            </button>
            {regenMenu}
          </div>
        )}
      </div>
      )}

      {error && <div className="sentence-set-error">{error}</div>}

      {open && showCustom && (
        <div className="sentence-set-custom">
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="Describe the sentences you want…"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customPrompt.trim()) {
                handleGenerate({ count: 6, customPrompt: customPrompt.trim() });
                setCustomPrompt('');
                setShowCustom(false);
              }
            }}
            autoFocus
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (!customPrompt.trim()) return;
              handleGenerate({ count: 6, customPrompt: customPrompt.trim() });
              setCustomPrompt('');
              setShowCustom(false);
            }}
            disabled={!customPrompt.trim()}
          >
            Go
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setShowCustom(false);
              setCustomPrompt('');
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {open && (
        <ul className="sentence-set-list">
          {visibleRows.map((row) => {
            const isEnglishFirst = !pass && !!englishFirst[row.key];
            const steps = revealSteps(row, isEnglishFirst);
            const stage = showAll ? steps.length : revealed[row.key] ?? (isEnglishFirst ? 0 : startStage);
            const shown = (step: RevealStep) => {
              const at = steps.indexOf(step);
              return at !== -1 && at < stage;
            };
            const isFullyShown = stage >= steps.length;
            const isBlank = stage === 0 && !isEnglishFirst;
            const focusLabel = row.focus ? FOCUS_LABELS[row.focus] : null;
            const showFocus = focusLabel && row.focus !== 'core';
            const isThisPlaying = isPlaying && playingId === row.key;
            return (
              <li
                key={row.key}
                className={`sentence-set-row${isFullyShown ? ' is-open' : ''}${row.fromCard ? ' is-from-card' : ''}`}
              >
                {/* Left: the reverse exercise — English up alone, translate it
                    back into Chinese before revealing. (Not in the calm pass.) */}
                {!pass && (
                <button
                  className={`sentence-set-en${isEnglishFirst ? ' is-active' : ''}`}
                  onClick={() => toggleEnglishFirst(row)}
                  disabled={!row.translation}
                  aria-pressed={isEnglishFirst}
                  title={
                    !row.translation
                      ? 'No translation for this sentence'
                      : isEnglishFirst
                        ? 'Back to listening first'
                        : 'Show the English only — translate it back into Chinese'
                  }
                >
                  EN
                </button>
                )}
                <div className="sentence-set-body">
                  {/* The card's own sentence: a small badge on its own line at the
                      top right, never where the lines it uncovers go. */}
                  {row.fromCard && <span className="sentence-set-badge sentence-set-corner">From the card</span>}
                  {/* A row starts blank on purpose: listen first, then uncover
                      one line per tap so each is read before the next lands. */}
                  <button
                    className={isBlank ? 'sentence-set-hidden' : 'sentence-set-reveal'}
                    onClick={() => advanceRow(row)}
                    aria-expanded={stage > 0}
                    aria-label={isBlank ? 'Reveal the sentence' : undefined}
                    title={
                      isFullyShown
                        ? 'Hide again'
                        : stage === 0
                          ? (isEnglishFirst ? 'Reveal the Chinese' : 'Reveal the sentence')
                          : steps[stage] === 'pinyin'
                            ? 'Reveal the pinyin'
                            : 'Reveal the English'
                    }
                  >
                    {isEnglishFirst && row.translation && (
                      <span className="sentence-set-prompt">{row.translation}</span>
                    )}
                    {shown('hanzi') && <span className="sentence-set-hanzi hanzi">{row.hanzi}</span>}
                    {shown('pinyin') && row.pinyin && (
                      <span className="sentence-set-pinyin">{row.pinyin}</span>
                    )}
                    {shown('translation') &&
                      (row.translation ? (
                        <span className="sentence-set-translation">{row.translation}</span>
                      ) : (
                        <span className="sentence-set-translation is-pending" data-testid="sentence-set-translation-pending">
                          {!isOnline
                            ? 'Translation needs a connection'
                            : clueTranslateFailed
                              ? 'Couldn’t get the English'
                              : 'Translating…'}
                        </span>
                      ))}
                    {isBlank && <span className="sentence-set-blank" aria-hidden="true" />}
                    {pass && stage > 0 && !isFullyShown && (
                      <span className="sentence-set-next">
                        {steps[stage] === 'pinyin' ? 'Tap for pinyin' : 'Tap for English'}
                      </span>
                    )}
                  </button>
                  {audioWait[row.key] === 'coming' && (
                    <span className="sentence-set-audio-coming" data-testid="sentence-audio-coming">
                      {SENTENCE_AUDIO_COMING_LABEL}
                    </span>
                  )}
                  {isFullyShown && ((showFocus && !row.fromCard) || row.focus_note) && (
                    <div className="sentence-set-focus">
                      {showFocus && !row.fromCard && (
                        <span className="sentence-set-badge">{focusLabel}</span>
                      )}
                      {row.focus_note && <span>{row.focus_note}</span>}
                    </div>
                  )}
                  {isFullyShown && renderTools(row)}
                  {isFullyShown && renderExplanation(row)}
                </div>
                {/* Right: hear it — the first thing to do on a blank row. */}
                <button
                  className={`sentence-set-play${isThisPlaying ? ' is-playing' : ''}${audioWait[row.key] ? ' is-waiting' : ''}`}
                  onClick={() => playSentence(row)}
                  disabled={isThisPlaying || !!audioWait[row.key]}
                  aria-label="Play sentence"
                  title={audioWait[row.key] ? SENTENCE_AUDIO_COMING_LABEL : 'Play sentence'}
                >
                  {audioWait[row.key] ? '…' : isThisPlaying ? '⏸' : '▶'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pass && moreCount > 0 && (
        <button
          className="sentence-set-more"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          data-testid="sentence-set-show-more"
        >
          {showMore ? 'Fewer sentences' : `+ ${moreCount} more ${moreCount === 1 ? 'sentence' : 'sentences'}`}
        </button>
      )}

      {open && !pass && (
        <button
          className="sentence-set-more"
          onClick={() =>
            handleGenerate(hasSet ? { count: 5, keepExisting: true } : { count: 6 })
          }
          disabled={generating || !isOnline}
          title={!isOnline ? 'Requires internet connection' : 'Generate more example sentences'}
        >
          {generating ? 'Generating…' : hasSet ? '+ 5 more sentences' : '✨ Generate example sentences'}
        </button>
      )}

      {addingChunk && <AddChunkModal source="breakdown" chunk={addingChunk} onClose={() => setAddingChunk(null)} />}
    </div>
  );
}

export default SentenceSet;
