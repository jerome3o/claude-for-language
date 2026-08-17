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
  getTextExplanation,
} from '../services/sentence-sets';
import { SentenceBriefExplanation } from '../types';
import { fetchNoteSentences, deleteNoteSentenceSet, API_BASE } from '../api/client';
import { useNoteAudio } from '../hooks/useAudio';
import { useNetwork } from '../contexts/NetworkContext';
import { AddChunkModal, Chunk } from './AddChunkModal';

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
  from_card: 'From the card',
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
}

interface SentenceSetProps {
  noteId: string;
  /**
   * The card's own example sentence. It leads the list, so there is one place
   * to look for sentences rather than two stacked panels.
   */
  cardSentence?: CardSentence | null;
  /** Rendered inside the study card (tighter, starts collapsed). */
  compact?: boolean;
  /** Start with the list expanded (deck/edit views). */
  defaultOpen?: boolean;
}

export function SentenceSet({
  noteId,
  cardSentence,
  compact = false,
  defaultOpen = false,
}: SentenceSetProps) {
  const { isOnline } = useNetwork();
  const { isPlaying, play } = useNoteAudio('sentence-set');

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
  const [showCustom, setShowCustom] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  // Whatever the learner tapped to turn into its own card: a whole sentence
  // or a single word out of a breakdown.
  const [addingChunk, setAddingChunk] = useState<Chunk | null>(null);

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
    setShowCustom(false);
    setCustomPrompt('');
    setError(null);
    setOpen(defaultOpen);
    void load();
  }, [noteId, defaultOpen, load]);

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

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const playSentence = (row: DisplayRow) => {
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
    const state = explanations[row.key] ?? parseCachedExplanation(row.explanation);
    const isLoading = explaining.has(row.key);

    if (!state) {
      return (
        <button
          className="sentence-set-explain"
          onClick={() => handleExplain(row)}
          disabled={isLoading || !isOnline}
          title={!isOnline ? 'Requires internet connection' : 'Break this sentence down'}
        >
          {isLoading ? 'Explaining...' : 'What’s going on here?'}
        </button>
      );
    }

    if (state === 'error') {
      return (
        <button className="sentence-set-explain" onClick={() => handleExplain(row)}>
          Explain failed — tap to retry
        </button>
      );
    }

    return (
      <div className="sentence-set-explanation">
        {/* Each word is tappable: the breakdown doubles as the old
            tap-a-word-to-make-a-card affordance. */}
        <ul className="sentence-set-words">
          {state.words.map((word, i) => (
            <li key={i}>
              <button
                className="sentence-set-word"
                onClick={() =>
                  setAddingChunk({ hanzi: word.hanzi, pinyin: word.pinyin, english: word.gloss })
                }
                title="Add this word as a card"
              >
                <span className="hanzi">{word.hanzi}</span>
                <span className="sentence-set-word-pinyin">{word.pinyin}</span>
                <span className="sentence-set-word-gloss">{word.gloss}</span>
              </button>
            </li>
          ))}
        </ul>
        {state.construction && (
          <p className="sentence-set-construction">{state.construction}</p>
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
  if (cardSentence?.hanzi && !sentences.some((s) => s.hanzi === cardSentence.hanzi)) {
    rows.push({
      key: `clue:${noteId}`,
      sentenceId: null,
      hanzi: cardSentence.hanzi,
      pinyin: cardSentence.pinyin,
      translation: cardSentence.translation,
      audio_url: cardSentence.audio_url,
      focus: 'from_card',
      focus_note: null,
      explanation: null,
      fromCard: true,
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
    });
  }

  const hasSet = sentences.length > 0;

  if (loading && rows.length === 0) {
    return null;
  }

  // Nothing at all yet: a single button that generates the set.
  if (rows.length === 0) {
    return (
      <div className={`sentence-set sentence-set--empty${compact ? ' sentence-set--compact' : ''}`}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => handleGenerate({ count: 6 })}
          disabled={generating || !isOnline}
          title={!isOnline ? 'Requires internet connection' : 'Generate a graded set of example sentences'}
        >
          {generating ? 'Generating sentences...' : '✨ Generate sentences'}
        </button>
        {error && <div className="sentence-set-error">{error}</div>}
        {addingChunk && (
          <AddChunkModal chunk={addingChunk} onClose={() => setAddingChunk(null)} />
        )}
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
          <span className="sentence-set-count">{rows.length}</span>
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
                    Custom...
                  </button>
                  {hasSet && (
                    <button className="regen-menu-item" onClick={handleClear}>
                      Clear set
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <div className="sentence-set-error">{error}</div>}

      {open && showCustom && (
        <div className="sentence-set-custom">
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="Describe the sentences you want..."
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
        <ol className="sentence-set-list">
          {rows.map((row, index) => {
            const isExpanded = showAll || expanded.has(row.key);
            const focusLabel = row.focus ? FOCUS_LABELS[row.focus] : null;
            const showFocus = focusLabel && row.focus !== 'core';
            return (
              <li key={row.key} className="sentence-set-row">
                <span className="sentence-set-step" title={`Sentence ${index + 1} of ${rows.length}`}>
                  {index + 1}
                </span>
                <div className="sentence-set-body">
                  {/* Collapsed rows stay blank on purpose: listen first, then
                      tap to check yourself against the characters. */}
                  <button
                    className={isExpanded ? 'sentence-set-hanzi hanzi' : 'sentence-set-hidden'}
                    onClick={() => toggleRow(row.key)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? row.hanzi : 'Tap to reveal'}
                  </button>
                  {isExpanded && (
                    <div className="sentence-set-details">
                      {row.pinyin && <div className="sentence-set-pinyin">{row.pinyin}</div>}
                      {row.translation && (
                        <div className="sentence-set-translation">{row.translation}</div>
                      )}
                      {(showFocus || row.focus_note) && (
                        <div className="sentence-set-focus">
                          {showFocus && <span className="sentence-set-badge">{focusLabel}</span>}
                          {row.focus_note && <span>{row.focus_note}</span>}
                        </div>
                      )}
                      {renderExplanation(row)}
                    </div>
                  )}
                </div>
                <div className="sentence-set-row-actions">
                  <button
                    className="sentence-set-play"
                    onClick={() => playSentence(row)}
                    disabled={isPlaying && playingId === row.key}
                    title="Play sentence"
                  >
                    {isPlaying && playingId === row.key ? '⏸' : '▶'}
                  </button>
                  {isExpanded && row.pinyin && row.translation && (
                    <button
                      className="sentence-set-add"
                      onClick={() =>
                        setAddingChunk({
                          hanzi: row.hanzi,
                          pinyin: row.pinyin || '',
                          english: row.translation || '',
                        })
                      }
                      title="Add this sentence as a card"
                    >
                      +
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {addingChunk && <AddChunkModal chunk={addingChunk} onClose={() => setAddingChunk(null)} />}
    </div>
  );
}

export default SentenceSet;
