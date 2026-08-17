import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalNoteSentence } from '../db/database';
import {
  getLocalNoteSentences,
  generateAndStoreSentenceSet,
  putLocalNoteSentences,
  clearLocalNoteSentences,
  cacheSentenceAudio,
  resetSentenceSetSyncCursor,
  getSentenceExplanation,
} from '../services/sentence-sets';
import { SentenceBriefExplanation } from '../types';
import { fetchNoteSentences, deleteNoteSentenceSet, API_BASE } from '../api/client';
import { useNoteAudio } from '../hooks/useAudio';
import { useNetwork } from '../contexts/NetworkContext';

/**
 * A note's sentence set: several example sentences for one word, ordered from
 * a very simple structure to a properly complex one, with a couple of them
 * deliberately placing the word in the language (a word sharing a character,
 * an easily-confused neighbour, its usual collocation).
 *
 * Reads come from IndexedDB so the whole set — audio included — works offline.
 * Only generation needs a connection.
 */

const FOCUS_LABELS: Record<string, string> = {
  core: 'Core',
  shared_character: 'Shared character',
  contrast: 'Contrast',
  collocation: 'Collocation',
  complex: 'Complex',
};

const COUNT_OPTIONS = [5, 10];

/** Read the explanation cached on a synced row, if it has one. */
function parseCachedExplanation(raw: string | null): SentenceBriefExplanation | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SentenceBriefExplanation;
  } catch {
    return null;
  }
}

interface SentenceSetProps {
  noteId: string;
  /** Rendered inside the study card (tighter, starts collapsed). */
  compact?: boolean;
  /** Start with the list expanded (deck/edit views). */
  defaultOpen?: boolean;
}

export function SentenceSet({ noteId, compact = false, defaultOpen = false }: SentenceSetProps) {
  const { isOnline } = useNetwork();
  const { isPlaying, play } = useNoteAudio();

  const [sentences, setSentences] = useState<LocalNoteSentence[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(defaultOpen);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  // Explanations fetched this session, keyed by sentence id ('error' = failed)
  const [explanations, setExplanations] = useState<
    Record<string, SentenceBriefExplanation | 'error'>
  >({});
  const [explaining, setExplaining] = useState<Set<string>>(new Set());

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
    setExpanded(new Set());
    setExplanations({});
    setShowAll(false);
    setError(null);
    setOpen(defaultOpen);
    void load();
  }, [noteId, defaultOpen, load]);

  const handleGenerate = useCallback(
    async (options: { count?: number; keepExisting?: boolean } = {}) => {
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

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const playSentence = (sentence: LocalNoteSentence) => {
    setPlayingId(sentence.id);
    play(sentence.audio_url, sentence.hanzi, API_BASE);
  };

  const handleExplain = useCallback(async (sentenceId: string) => {
    setExplaining((prev) => new Set(prev).add(sentenceId));
    try {
      const explanation = await getSentenceExplanation(sentenceId);
      setExplanations((prev) => ({ ...prev, [sentenceId]: explanation }));
    } catch (err) {
      console.error('[SentenceSet] Explain failed:', err);
      setExplanations((prev) => ({ ...prev, [sentenceId]: 'error' }));
    } finally {
      setExplaining((prev) => {
        const next = new Set(prev);
        next.delete(sentenceId);
        return next;
      });
    }
  }, []);

  /**
   * The per-sentence breakdown: a word list plus a line on the construction.
   * Cached rows render straight from IndexedDB, so a second look is instant
   * and works offline.
   */
  const renderExplanation = (sentence: LocalNoteSentence) => {
    const state = explanations[sentence.id] ?? parseCachedExplanation(sentence.explanation);
    const isLoading = explaining.has(sentence.id);

    if (!state) {
      return (
        <button
          className="sentence-set-explain"
          onClick={() => handleExplain(sentence.id)}
          disabled={isLoading || !isOnline}
          title={!isOnline ? 'Requires internet connection' : 'Break this sentence down'}
        >
          {isLoading ? 'Explaining...' : 'What’s going on here?'}
        </button>
      );
    }

    if (state === 'error') {
      return (
        <button className="sentence-set-explain" onClick={() => handleExplain(sentence.id)}>
          Explain failed — tap to retry
        </button>
      );
    }

    return (
      <div className="sentence-set-explanation">
        <ul className="sentence-set-words">
          {state.words.map((word, i) => (
            <li key={i}>
              <span className="hanzi">{word.hanzi}</span>
              <span className="sentence-set-word-pinyin">{word.pinyin}</span>
              <span className="sentence-set-word-gloss">{word.gloss}</span>
            </li>
          ))}
        </ul>
        {state.construction && (
          <p className="sentence-set-construction">{state.construction}</p>
        )}
      </div>
    );
  };

  const hasSet = sentences.length > 0;

  if (loading && !hasSet) {
    return null;
  }

  // Empty state: one button that generates the whole set.
  if (!hasSet) {
    return (
      <div className={`sentence-set sentence-set--empty${compact ? ' sentence-set--compact' : ''}`}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => handleGenerate({ count: 6 })}
          disabled={generating || !isOnline}
          title={!isOnline ? 'Requires internet connection' : 'Generate a graded set of example sentences'}
        >
          {generating ? 'Generating sentences...' : '✨ Generate sentence set'}
        </button>
        {error && <div className="sentence-set-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className={`sentence-set${compact ? ' sentence-set--compact' : ''}`}>
      <div className="sentence-set-header">
        <button
          className="sentence-set-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="sentence-set-caret">{open ? '▾' : '▸'}</span>
          <span className="sentence-set-title">Sentences</span>
          <span className="sentence-set-count">{sentences.length}</span>
        </button>

        {open && (
          <div className="sentence-set-actions">
            <button
              className="sentence-set-action"
              onClick={() => setShowAll((v) => !v)}
              title={showAll ? 'Hide pinyin and translations' : 'Show pinyin and translations'}
            >
              {showAll ? 'Hide all' : 'Show all'}
            </button>
            <div className="sentence-set-menu-wrap">
              <button
                className="sentence-set-action"
                onClick={() => setShowMenu((v) => !v)}
                disabled={generating || !isOnline}
                title={!isOnline ? 'Requires internet connection' : 'Regenerate the set'}
              >
                {generating ? '...' : '↻'}
              </button>
              {showMenu && (
                <div className="regen-menu">
                  {COUNT_OPTIONS.map((count) => (
                    <button
                      key={count}
                      className="regen-menu-item"
                      onClick={() => handleGenerate({ count })}
                    >
                      New set of {count}
                    </button>
                  ))}
                  <button
                    className="regen-menu-item"
                    onClick={() => handleGenerate({ count: 5, keepExisting: true })}
                  >
                    Add 5 more
                  </button>
                  <button className="regen-menu-item" onClick={handleClear}>
                    Clear set
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <div className="sentence-set-error">{error}</div>}

      {open && (
        <ol className="sentence-set-list">
          {sentences.map((sentence, index) => {
            const isExpanded = showAll || expanded.has(sentence.id);
            const focusLabel = sentence.focus ? FOCUS_LABELS[sentence.focus] : null;
            const showFocus = focusLabel && sentence.focus !== 'core';
            return (
              <li key={sentence.id} className="sentence-set-row">
                <span
                  className="sentence-set-step"
                  title={`Difficulty ${index + 1} of ${sentences.length}`}
                >
                  {index + 1}
                </span>
                <div className="sentence-set-body">
                  {/* Collapsed rows stay blank on purpose: listen first, then
                      tap to check yourself against the characters. */}
                  <button
                    className={isExpanded ? 'sentence-set-hanzi hanzi' : 'sentence-set-hidden'}
                    onClick={() => toggleRow(sentence.id)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? sentence.hanzi : 'Tap to reveal'}
                  </button>
                  {isExpanded && (
                    <div className="sentence-set-details">
                      {sentence.pinyin && (
                        <div className="sentence-set-pinyin">{sentence.pinyin}</div>
                      )}
                      {sentence.translation && (
                        <div className="sentence-set-translation">{sentence.translation}</div>
                      )}
                      {(showFocus || sentence.focus_note) && (
                        <div className="sentence-set-focus">
                          {showFocus && <span className="sentence-set-badge">{focusLabel}</span>}
                          {sentence.focus_note && <span>{sentence.focus_note}</span>}
                        </div>
                      )}
                      {renderExplanation(sentence)}
                    </div>
                  )}
                </div>
                <button
                  className="sentence-set-play"
                  onClick={() => playSentence(sentence)}
                  disabled={isPlaying && playingId === sentence.id}
                  title="Play sentence"
                >
                  {isPlaying && playingId === sentence.id ? '⏸' : '▶'}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default SentenceSet;
