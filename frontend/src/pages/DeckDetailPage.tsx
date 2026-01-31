import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getDeck, createNote, updateNote, deleteNote, deleteDeck, getDeckStats, getNoteHistory, getNoteQuestions, generateNoteAudio, regenerateNoteAudio, getAudioUrl, updateDeckSettings, updateDeck, API_BASE, getMyRelationships, getDeckTutorShares, studentShareDeck, unshareStudentDeck } from '../api/client';
import { useNoteAudio } from '../hooks/useAudio';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { Note, Deck, Card, CardQueue, NoteWithCards, CardType, getOtherUserInRelationship } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { db, LocalCard, LocalDeck, getNewCardsStudiedToday, LocalReviewEvent } from '../db/database';

const RATING_LABELS = ['Again', 'Hard', 'Good', 'Easy'];
const CARD_TYPE_LABELS: Record<string, string> = {
  hanzi_to_meaning: 'Hanzi → Meaning',
  meaning_to_hanzi: 'Meaning → Hanzi',
  audio_to_hanzi: 'Audio → Hanzi',
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTime(ms: number | null): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatInterval(days: number): string {
  if (days === 0) return 'New';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

// Short card type labels for the status display
const CARD_TYPE_SHORT: Record<string, string> = {
  hanzi_to_meaning: 'H→M',
  meaning_to_hanzi: 'M→H',
  audio_to_hanzi: 'A→H',
};

function getCardStatus(card: Card): { label: string; color: string; priority: number } {
  const now = new Date();

  if (card.queue === CardQueue.NEW) {
    return { label: 'New', color: '#3b82f6', priority: 3 }; // blue
  }

  if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
    // Check if due now
    if (card.due_timestamp && card.due_timestamp <= Date.now()) {
      return { label: 'Due', color: '#ef4444', priority: 0 }; // red
    }
    // Still learning but not due yet
    const dueIn = card.due_timestamp ? Math.ceil((card.due_timestamp - Date.now()) / 60000) : 0;
    return { label: dueIn > 0 ? `${dueIn}m` : 'Learning', color: '#f97316', priority: 1 }; // orange
  }

  if (card.queue === CardQueue.REVIEW) {
    const nextReview = card.next_review_at ? new Date(card.next_review_at) : null;
    if (!nextReview || nextReview <= now) {
      return { label: 'Due', color: '#22c55e', priority: 0 }; // green
    }
    // Calculate days until due
    const daysUntil = Math.ceil((nextReview.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil === 1) {
      return { label: '1d', color: '#22c55e', priority: 2 };
    }
    if (daysUntil < 7) {
      return { label: `${daysUntil}d`, color: '#22c55e', priority: 2 };
    }
    if (daysUntil < 30) {
      return { label: `${Math.round(daysUntil / 7)}w`, color: '#22c55e', priority: 2 };
    }
    if (daysUntil < 365) {
      return { label: `${Math.round(daysUntil / 30)}mo`, color: '#22c55e', priority: 2 };
    }
    return { label: `${(daysUntil / 365).toFixed(1)}y`, color: '#22c55e', priority: 2 };
  }

  return { label: '?', color: '#9ca3af', priority: 4 };
}

function getNoteLearningStatus(cards: Card[]): {
  nextDue: string | null;
  isDue: boolean;
  allNew: boolean;
  avgInterval: number;
  avgEase: number;
  totalReps: number;
} {
  const now = new Date();
  let earliestDue: Date | null = null;
  let isDue = false;
  let allNew = true;
  let totalInterval = 0;
  let totalEase = 0;
  let totalReps = 0;

  for (const card of cards) {
    if (card.queue !== CardQueue.NEW) {
      allNew = false;
    }

    totalInterval += card.interval;
    totalEase += card.ease_factor;
    totalReps += card.repetitions;

    // Check if due
    if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
      if (card.due_timestamp && card.due_timestamp <= Date.now()) {
        isDue = true;
      }
    } else if (card.queue === CardQueue.REVIEW && card.next_review_at) {
      const nextReview = new Date(card.next_review_at);
      if (nextReview <= now) {
        isDue = true;
      }
      if (!earliestDue || nextReview < earliestDue) {
        earliestDue = nextReview;
      }
    } else if (card.queue === CardQueue.NEW) {
      isDue = true;
    }
  }

  let nextDue: string | null = null;
  if (earliestDue && earliestDue > now) {
    const daysUntil = Math.ceil((earliestDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil === 0) {
      nextDue = 'Today';
    } else if (daysUntil === 1) {
      nextDue = 'Tomorrow';
    } else if (daysUntil < 7) {
      nextDue = `${daysUntil} days`;
    } else {
      nextDue = earliestDue.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
  }

  return {
    nextDue,
    isDue,
    allNew,
    avgInterval: cards.length > 0 ? Math.round(totalInterval / cards.length) : 0,
    avgEase: cards.length > 0 ? totalEase / cards.length : 2.5,
    totalReps,
  };
}

function NoteHistoryModal({
  note,
  onClose,
}: {
  note: Note;
  onClose: () => void;
}) {
  const historyQuery = useQuery({
    queryKey: ['noteHistory', note.id],
    queryFn: () => getNoteHistory(note.id),
  });

  const questionsQuery = useQuery({
    queryKey: ['noteQuestions', note.id],
    queryFn: () => getNoteQuestions(note.id),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <h2 className="modal-title">History: {note.hanzi}</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {(historyQuery.isLoading || questionsQuery.isLoading) && <Loading />}
        {(historyQuery.error || questionsQuery.error) && <ErrorMessage message="Failed to load history" />}

        {historyQuery.data && historyQuery.data.length === 0 && questionsQuery.data && questionsQuery.data.length === 0 && (
          <p className="text-light">No history yet. Study this card to see history.</p>
        )}

        {historyQuery.data && historyQuery.data.length > 0 && (
          <div className="flex flex-col gap-4">
            {historyQuery.data.map((cardHistory) => (
              <div key={cardHistory.card_type}>
                <div className="flex justify-between items-center" style={{ marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1rem', margin: 0 }}>
                    {CARD_TYPE_LABELS[cardHistory.card_type] || cardHistory.card_type}
                  </h3>
                  <div className="flex gap-2" style={{ fontSize: '0.75rem' }}>
                    <span className="text-light">
                      Interval: <strong>{formatInterval(cardHistory.card_stats.interval)}</strong>
                    </span>
                    <span className="text-light">
                      Ease: <strong>{(cardHistory.card_stats.ease_factor * 100).toFixed(0)}%</strong>
                    </span>
                    <span className="text-light">
                      Reps: <strong>{cardHistory.card_stats.repetitions}</strong>
                    </span>
                  </div>
                </div>
                {cardHistory.reviews.length === 0 ? (
                  <p className="text-light" style={{ fontSize: '0.875rem', fontStyle: 'italic' }}>
                    Not yet reviewed
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {cardHistory.reviews.map((review) => (
                      <div
                        key={review.id}
                        className="card"
                        style={{ padding: '0.75rem', background: 'var(--bg-elevated)' }}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="text-light">{formatDate(review.reviewed_at)}</span>
                            {review.time_spent_ms && (
                              <span className="text-light" style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                                ({formatTime(review.time_spent_ms)})
                              </span>
                            )}
                          </div>
                          <span
                            style={{
                              padding: '0.125rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.875rem',
                              background: review.rating >= 2 ? 'var(--success)' : 'var(--error)',
                              color: 'white',
                            }}
                          >
                            {RATING_LABELS[review.rating]}
                          </span>
                        </div>
                        {review.user_answer && (
                          <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                            Answer: <span className="hanzi">{review.user_answer}</span>
                          </p>
                        )}
                        {review.recording_url && (
                          <audio
                            controls
                            src={getAudioUrl(review.recording_url)}
                            style={{ marginTop: '0.5rem', width: '100%', height: '32px' }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Questions & Answers */}
        {questionsQuery.data && questionsQuery.data.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
              Questions Asked ({questionsQuery.data.length})
            </h3>
            <div className="flex flex-col gap-3">
              {questionsQuery.data.map((qa) => (
                <div
                  key={qa.id}
                  className="card"
                  style={{ padding: '0.75rem', background: 'var(--bg-elevated)' }}
                >
                  <div className="text-light" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                    {formatDate(qa.asked_at)}
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--color-primary)',
                      color: 'white',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      marginBottom: '0.5rem',
                      fontSize: '0.875rem',
                    }}
                  >
                    {qa.question}
                  </div>
                  <div
                    style={{
                      backgroundColor: 'white',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.875rem',
                      whiteSpace: 'pre-wrap',
                      border: '1px solid #e5e7eb',
                    }}
                  >
                    {qa.answer}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Debug Modal Types ============

interface CardDebugInfo {
  card: LocalCard;
  note: { hanzi: string; pinyin: string; english: string } | null;
  reviewCount: number;
  reviews: LocalReviewEvent[];
  lastReview: LocalReviewEvent | null;
  isDue: boolean;
  dueReason: string;
  notDueReason: string | null;
}

interface DeckDebugData {
  deck: LocalDeck | null;
  cards: CardDebugInfo[];
  newCardsStudiedToday: number;
  remainingNewCards: number;
  queues: {
    new: CardDebugInfo[];
    learning: CardDebugInfo[];
    relearning: CardDebugInfo[];
    review: CardDebugInfo[];
    reviewNotDue: CardDebugInfo[];
  };
  byCardType: {
    hanzi_to_meaning: CardDebugInfo[];
    meaning_to_hanzi: CardDebugInfo[];
    audio_to_hanzi: CardDebugInfo[];
  };
  issues: string[];
}

function DeckDebugModal({
  deckId,
  onClose,
}: {
  deckId: string;
  onClose: () => void;
}) {
  const [debugData, setDebugData] = useState<DeckDebugData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState<string | null>('summary');
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  // Reset all cards to NEW queue
  const resetAllToNew = async () => {
    if (!confirm('Reset ALL cards in this deck to NEW? This will erase all progress and let you start fresh.')) {
      return;
    }
    setIsResetting(true);
    setResetMessage(null);
    try {
      const cards = await db.cards.where('deck_id').equals(deckId).toArray();
      for (const card of cards) {
        await db.cards.update(card.id, {
          queue: CardQueue.NEW,
          learning_step: 0,
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
          next_review_at: null,
          due_timestamp: null,
          updated_at: new Date().toISOString(),
        });
      }
      setResetMessage(`✓ Reset ${cards.length} cards to NEW queue`);
      // Reload debug data
      loadDebugData();
    } catch (error) {
      console.error('Failed to reset cards:', error);
      setResetMessage('✗ Failed to reset cards');
    }
    setIsResetting(false);
  };

  // Make all REVIEW cards due now
  const makeAllDueNow = async () => {
    if (!confirm('Make all REVIEW cards due NOW? This will let you study them immediately.')) {
      return;
    }
    setIsResetting(true);
    setResetMessage(null);
    try {
      const cards = await db.cards.where('deck_id').equals(deckId).toArray();
      const reviewCards = cards.filter(c => c.queue === CardQueue.REVIEW);
      const now = new Date();
      now.setHours(0, 0, 0, 0); // Start of today
      for (const card of reviewCards) {
        await db.cards.update(card.id, {
          next_review_at: now.toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      setResetMessage(`✓ Made ${reviewCards.length} review cards due now`);
      // Reload debug data
      loadDebugData();
    } catch (error) {
      console.error('Failed to update cards:', error);
      setResetMessage('✗ Failed to update cards');
    }
    setIsResetting(false);
  };

  // Load debug data function (extracted to allow reloading)
  const loadDebugData = async () => {
    setLoading(true);
    try {
      const now = Date.now();
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const endOfTodayIso = today.toISOString();

      // Load deck
      const deck = await db.decks.get(deckId);
      if (!deck) {
        setDebugData(null);
        setLoading(false);
        return;
      }

      // Load all cards for this deck
      const cards = await db.cards.where('deck_id').equals(deckId).toArray();

      // Load all notes for this deck
      const notes = await db.notes.where('deck_id').equals(deckId).toArray();
      const noteMap = new Map(notes.map(n => [n.id, n]));

      // Get new cards studied today
      const newCardsStudiedTodayCount = await getNewCardsStudiedToday(deckId);
      const remainingNewCards = Math.max(0, deck.new_cards_per_day - newCardsStudiedTodayCount);

      // Build debug info for each card
      const cardDebugInfos: CardDebugInfo[] = [];
      const issues: string[] = [];

      // Track new cards counted so far (for daily limit)
      let newCardsCounted = 0;

      for (const card of cards) {
        const note = noteMap.get(card.note_id);

        // Get review events for this card
        const reviews = await db.reviewEvents
          .where('card_id')
          .equals(card.id)
          .sortBy('reviewed_at');

        const lastReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;

        // Determine if card is due and why
        let isDue = false;
        let dueReason = '';
        let notDueReason: string | null = null;

        if (card.queue === CardQueue.NEW) {
          if (newCardsCounted < remainingNewCards) {
            isDue = true;
            dueReason = `NEW card (${newCardsCounted + 1}/${remainingNewCards} remaining today)`;
            newCardsCounted++;
          } else {
            isDue = false;
            notDueReason = `Daily new card limit reached (${deck.new_cards_per_day}/day, ${newCardsStudiedTodayCount} studied today)`;
          }
        } else if (card.queue === CardQueue.LEARNING || card.queue === CardQueue.RELEARNING) {
          if (!card.due_timestamp || card.due_timestamp <= now) {
            isDue = true;
            const queueName = card.queue === CardQueue.LEARNING ? 'LEARNING' : 'RELEARNING';
            if (card.due_timestamp) {
              const agoMs = now - card.due_timestamp;
              const agoStr = agoMs < 60000
                ? `${Math.round(agoMs / 1000)}s ago`
                : `${Math.round(agoMs / 60000)}m ago`;
              dueReason = `${queueName} - due ${agoStr}`;
            } else {
              dueReason = `${queueName} - no due timestamp set`;
            }
          } else {
            isDue = false;
            const inMs = card.due_timestamp - now;
            const inStr = inMs < 60000
              ? `${Math.round(inMs / 1000)}s`
              : `${Math.round(inMs / 60000)}m`;
            notDueReason = `${card.queue === CardQueue.LEARNING ? 'LEARNING' : 'RELEARNING'} - due in ${inStr}`;
          }
        } else if (card.queue === CardQueue.REVIEW) {
          if (!card.next_review_at || card.next_review_at <= endOfTodayIso) {
            isDue = true;
            if (card.next_review_at) {
              const reviewDate = new Date(card.next_review_at);
              const diffDays = Math.floor((now - reviewDate.getTime()) / (1000 * 60 * 60 * 24));
              if (diffDays > 0) {
                dueReason = `REVIEW - ${diffDays}d overdue`;
              } else {
                dueReason = `REVIEW - due today`;
              }
            } else {
              dueReason = `REVIEW - no next_review_at set`;
            }
          } else {
            isDue = false;
            const reviewDate = new Date(card.next_review_at);
            const diffMs = reviewDate.getTime() - now;
            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            notDueReason = `REVIEW - due in ${diffDays}d (${card.next_review_at.slice(0, 10)})`;
          }
        } else {
          notDueReason = `Unknown queue: ${card.queue}`;
        }

        // Check for potential issues
        if (!note) {
          issues.push(`Card ${card.id.slice(0, 8)} has no matching note (note_id: ${card.note_id})`);
        }

        if (card.queue === CardQueue.REVIEW && card.interval === 0) {
          issues.push(`Card ${card.id.slice(0, 8)} is in REVIEW queue but has interval=0`);
        }

        if (card.queue === CardQueue.NEW && card.repetitions > 0) {
          issues.push(`Card ${card.id.slice(0, 8)} is in NEW queue but has ${card.repetitions} repetitions`);
        }

        cardDebugInfos.push({
          card,
          note: note ? { hanzi: note.hanzi, pinyin: note.pinyin, english: note.english } : null,
          reviewCount: reviews.length,
          reviews,
          lastReview,
          isDue,
          dueReason,
          notDueReason,
        });
      }

      // Check for notes without cards
      for (const note of notes) {
        const noteCards = cards.filter(c => c.note_id === note.id);
        if (noteCards.length === 0) {
          issues.push(`Note "${note.hanzi}" has no cards`);
        } else if (noteCards.length < 3) {
          issues.push(`Note "${note.hanzi}" only has ${noteCards.length}/3 cards`);
        }
      }

      // Group by queue
      const queues = {
        new: cardDebugInfos.filter(c => c.card.queue === CardQueue.NEW),
        learning: cardDebugInfos.filter(c => c.card.queue === CardQueue.LEARNING),
        relearning: cardDebugInfos.filter(c => c.card.queue === CardQueue.RELEARNING),
        review: cardDebugInfos.filter(c => c.card.queue === CardQueue.REVIEW && c.isDue),
        reviewNotDue: cardDebugInfos.filter(c => c.card.queue === CardQueue.REVIEW && !c.isDue),
      };

      // Group by card type
      const byCardType = {
        hanzi_to_meaning: cardDebugInfos.filter(c => c.card.card_type === 'hanzi_to_meaning'),
        meaning_to_hanzi: cardDebugInfos.filter(c => c.card.card_type === 'meaning_to_hanzi'),
        audio_to_hanzi: cardDebugInfos.filter(c => c.card.card_type === 'audio_to_hanzi'),
      };

      setDebugData({
        deck,
        cards: cardDebugInfos,
        newCardsStudiedToday: newCardsStudiedTodayCount,
        remainingNewCards,
        queues,
        byCardType,
        issues,
      });
    } catch (error) {
      console.error('Failed to load debug data:', error);
      setDebugData(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDebugData();
  }, [deckId]);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const renderQueueLabel = (queue: CardQueue) => {
    const colors: Record<number, string> = {
      [CardQueue.NEW]: '#3b82f6',
      [CardQueue.LEARNING]: '#ef4444',
      [CardQueue.REVIEW]: '#22c55e',
      [CardQueue.RELEARNING]: '#ef4444',
    };
    const names: Record<number, string> = {
      [CardQueue.NEW]: 'NEW',
      [CardQueue.LEARNING]: 'LEARNING',
      [CardQueue.REVIEW]: 'REVIEW',
      [CardQueue.RELEARNING]: 'RELEARNING',
    };
    return (
      <span style={{
        display: 'inline-block',
        padding: '0.125rem 0.375rem',
        borderRadius: '4px',
        backgroundColor: colors[queue],
        color: 'white',
        fontSize: '0.6875rem',
        fontWeight: 600,
      }}>
        {names[queue]}
      </span>
    );
  };

  const renderCardRow = (info: CardDebugInfo) => {
    const cardTypeShort: Record<CardType, string> = {
      hanzi_to_meaning: 'H→M',
      meaning_to_hanzi: 'M→H',
      audio_to_hanzi: 'A→H',
    };

    return (
      <div
        key={info.card.id}
        style={{
          padding: '0.5rem',
          backgroundColor: info.isDue ? '#f0fdf4' : '#fef2f2',
          borderRadius: '4px',
          marginBottom: '0.25rem',
          fontSize: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="hanzi" style={{ fontWeight: 600 }}>{info.note?.hanzi || '???'}</span>
            <span style={{ color: '#6b7280', fontSize: '0.6875rem' }}>{cardTypeShort[info.card.card_type]}</span>
            {renderQueueLabel(info.card.queue)}
          </div>
          <span style={{
            color: info.isDue ? '#16a34a' : '#dc2626',
            fontWeight: 500,
          }}>
            {info.isDue ? '✓ Due' : '✗ Not Due'}
          </span>
        </div>
        <div style={{ color: '#6b7280', fontSize: '0.6875rem' }}>
          {info.isDue ? info.dueReason : info.notDueReason}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0.25rem',
          marginTop: '0.25rem',
          fontSize: '0.625rem',
          color: '#9ca3af',
        }}>
          <span>Step: {info.card.learning_step}</span>
          <span>Ease: {(info.card.ease_factor * 100).toFixed(0)}%</span>
          <span>Int: {info.card.interval}d</span>
          <span>Reps: {info.card.repetitions}</span>
        </div>
        {/* Review history - show actual ratings */}
        {info.reviewCount > 0 && (
          <div style={{
            marginTop: '0.25rem',
            paddingTop: '0.25rem',
            borderTop: '1px dashed #e5e7eb',
            fontSize: '0.625rem',
            color: '#6b7280',
          }}>
            <span>Reviews ({info.reviewCount}): </span>
            <span style={{ display: 'inline-flex', gap: '0.125rem', flexWrap: 'wrap' }}>
              {info.reviews.map((review, idx) => {
                const ratingColors: Record<number, string> = {
                  0: '#ef4444', // Again - red
                  1: '#f97316', // Hard - orange
                  2: '#22c55e', // Good - green
                  3: '#3b82f6', // Easy - blue
                };
                const ratingLabels: Record<number, string> = {
                  0: 'A', 1: 'H', 2: 'G', 3: 'E'
                };
                const date = new Date(review.reviewed_at);
                const timeStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                return (
                  <span
                    key={review.id || idx}
                    title={`${['Again', 'Hard', 'Good', 'Easy'][review.rating]} on ${timeStr}`}
                    style={{
                      display: 'inline-block',
                      padding: '0 0.2rem',
                      borderRadius: '2px',
                      backgroundColor: ratingColors[review.rating],
                      color: 'white',
                      fontWeight: 600,
                      fontSize: '0.5625rem',
                    }}
                  >
                    {ratingLabels[review.rating]}
                  </span>
                );
              })}
            </span>
          </div>
        )}
      </div>
    );
  };

  const SectionHeader = ({ title, count, color, isOpen, onClick }: {
    title: string;
    count: number;
    color: string;
    isOpen: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.5rem',
        background: 'none',
        border: '1px solid #e5e7eb',
        borderRadius: '4px',
        cursor: 'pointer',
        marginBottom: '0.25rem',
      }}
    >
      <span style={{ fontWeight: 500 }}>
        {isOpen ? '▼' : '▶'} {title}
      </span>
      <span style={{
        backgroundColor: color,
        color: 'white',
        padding: '0.125rem 0.5rem',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 600,
      }}>
        {count}
      </span>
    </button>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '80vh' }}>
        <div className="modal-header">
          <h2 className="modal-title">Deck Debug View</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div style={{ overflowY: 'auto', maxHeight: 'calc(80vh - 120px)', padding: '0 1rem 1rem' }}>
          {loading && <Loading />}

          {!loading && !debugData && (
            <ErrorMessage message="Failed to load deck data from IndexedDB" />
          )}

          {!loading && debugData && (
            <>
              {/* Issues Alert */}
              {debugData.issues.length > 0 && (
                <div style={{
                  backgroundColor: '#fef3c7',
                  border: '1px solid #f59e0b',
                  borderRadius: '6px',
                  padding: '0.75rem',
                  marginBottom: '1rem',
                }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#b45309', fontSize: '0.875rem' }}>
                    ⚠️ Potential Issues ({debugData.issues.length})
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.75rem', color: '#92400e' }}>
                    {debugData.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Summary */}
              <SectionHeader
                title="Summary"
                count={debugData.cards.filter(c => c.isDue).length}
                color="#22c55e"
                isOpen={expandedSection === 'summary'}
                onClick={() => toggleSection('summary')}
              />
              {expandedSection === 'summary' && (
                <div style={{ padding: '0.75rem', backgroundColor: '#f9fafb', borderRadius: '6px', marginBottom: '0.5rem', fontSize: '0.8125rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div><strong>Total Cards:</strong> {debugData.cards.length}</div>
                    <div><strong>Due Now:</strong> {debugData.cards.filter(c => c.isDue).length}</div>
                    <div><strong>New Cards/Day:</strong> {debugData.deck?.new_cards_per_day}</div>
                    <div><strong>Studied Today:</strong> {debugData.newCardsStudiedToday}</div>
                    <div><strong>Remaining New:</strong> {debugData.remainingNewCards}</div>
                    <div><strong>Learning Steps:</strong> {debugData.deck?.learning_steps || '1 10'}</div>
                  </div>

                  <div style={{ marginTop: '0.75rem', padding: '0.5rem', backgroundColor: '#e0f2fe', borderRadius: '4px', fontSize: '0.75rem' }}>
                    <strong>How Due Cards Are Calculated:</strong>
                    <ul style={{ margin: '0.25rem 0 0 0', paddingLeft: '1rem' }}>
                      <li><strong>NEW:</strong> Limited by daily limit ({debugData.deck?.new_cards_per_day}/day)</li>
                      <li><strong>LEARNING/RELEARNING:</strong> Due when due_timestamp ≤ now</li>
                      <li><strong>REVIEW:</strong> Due when next_review_at ≤ end of today</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* NEW Queue */}
              <SectionHeader
                title="NEW Queue"
                count={debugData.queues.new.length}
                color="#3b82f6"
                isOpen={expandedSection === 'new'}
                onClick={() => toggleSection('new')}
              />
              {expandedSection === 'new' && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {debugData.queues.new.length === 0 ? (
                    <p style={{ color: '#6b7280', fontStyle: 'italic', fontSize: '0.75rem', padding: '0.5rem' }}>No cards in NEW queue</p>
                  ) : (
                    <>
                      <div style={{ padding: '0.5rem', backgroundColor: '#dbeafe', borderRadius: '4px', marginBottom: '0.5rem', fontSize: '0.75rem' }}>
                        <strong>NEW cards explained:</strong> Never been reviewed. Limited by daily limit.
                        <br />
                        Due: {debugData.queues.new.filter(c => c.isDue).length} / Not due (limit): {debugData.queues.new.filter(c => !c.isDue).length}
                      </div>
                      {debugData.queues.new.map(renderCardRow)}
                    </>
                  )}
                </div>
              )}

              {/* LEARNING Queue */}
              <SectionHeader
                title="LEARNING Queue"
                count={debugData.queues.learning.length}
                color="#f97316"
                isOpen={expandedSection === 'learning'}
                onClick={() => toggleSection('learning')}
              />
              {expandedSection === 'learning' && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {debugData.queues.learning.length === 0 ? (
                    <p style={{ color: '#6b7280', fontStyle: 'italic', fontSize: '0.75rem', padding: '0.5rem' }}>No cards in LEARNING queue</p>
                  ) : (
                    <>
                      <div style={{ padding: '0.5rem', backgroundColor: '#ffedd5', borderRadius: '4px', marginBottom: '0.5rem', fontSize: '0.75rem' }}>
                        <strong>LEARNING cards explained:</strong> Going through learning steps (e.g., 1m → 10m → graduate).
                        <br />
                        Due now: {debugData.queues.learning.filter(c => c.isDue).length} / Waiting: {debugData.queues.learning.filter(c => !c.isDue).length}
                      </div>
                      {debugData.queues.learning.map(renderCardRow)}
                    </>
                  )}
                </div>
              )}

              {/* RELEARNING Queue */}
              <SectionHeader
                title="RELEARNING Queue"
                count={debugData.queues.relearning.length}
                color="#ef4444"
                isOpen={expandedSection === 'relearning'}
                onClick={() => toggleSection('relearning')}
              />
              {expandedSection === 'relearning' && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {debugData.queues.relearning.length === 0 ? (
                    <p style={{ color: '#6b7280', fontStyle: 'italic', fontSize: '0.75rem', padding: '0.5rem' }}>No cards in RELEARNING queue</p>
                  ) : (
                    <>
                      <div style={{ padding: '0.5rem', backgroundColor: '#fee2e2', borderRadius: '4px', marginBottom: '0.5rem', fontSize: '0.75rem' }}>
                        <strong>RELEARNING cards explained:</strong> Previously graduated cards that got "Again" - going through relearning steps.
                      </div>
                      {debugData.queues.relearning.map(renderCardRow)}
                    </>
                  )}
                </div>
              )}

              {/* REVIEW Queue (Due) */}
              <SectionHeader
                title="REVIEW Queue (Due Today)"
                count={debugData.queues.review.length}
                color="#22c55e"
                isOpen={expandedSection === 'review'}
                onClick={() => toggleSection('review')}
              />
              {expandedSection === 'review' && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {debugData.queues.review.length === 0 ? (
                    <p style={{ color: '#6b7280', fontStyle: 'italic', fontSize: '0.75rem', padding: '0.5rem' }}>No review cards due today</p>
                  ) : (
                    <>
                      <div style={{ padding: '0.5rem', backgroundColor: '#dcfce7', borderRadius: '4px', marginBottom: '0.5rem', fontSize: '0.75rem' }}>
                        <strong>REVIEW cards explained:</strong> Graduated cards with spaced intervals. Due when next_review_at ≤ today.
                      </div>
                      {debugData.queues.review.map(renderCardRow)}
                    </>
                  )}
                </div>
              )}

              {/* REVIEW Queue (Not Due) */}
              <SectionHeader
                title="REVIEW Queue (Future)"
                count={debugData.queues.reviewNotDue.length}
                color="#9ca3af"
                isOpen={expandedSection === 'reviewFuture'}
                onClick={() => toggleSection('reviewFuture')}
              />
              {expandedSection === 'reviewFuture' && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {debugData.queues.reviewNotDue.length === 0 ? (
                    <p style={{ color: '#6b7280', fontStyle: 'italic', fontSize: '0.75rem', padding: '0.5rem' }}>No review cards scheduled for future</p>
                  ) : (
                    <>
                      <div style={{ padding: '0.5rem', backgroundColor: '#f3f4f6', borderRadius: '4px', marginBottom: '0.5rem', fontSize: '0.75rem' }}>
                        <strong>Future reviews:</strong> These cards are scheduled but not due until their next_review_at date.
                      </div>
                      {debugData.queues.reviewNotDue.map(renderCardRow)}
                    </>
                  )}
                </div>
              )}

              {/* By Card Type */}
              <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>By Card Type</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', fontSize: '0.75rem' }}>
                  <div style={{ padding: '0.5rem', backgroundColor: '#f9fafb', borderRadius: '4px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600 }}>Hanzi → Meaning</div>
                    <div>{debugData.byCardType.hanzi_to_meaning.filter(c => c.isDue).length} / {debugData.byCardType.hanzi_to_meaning.length}</div>
                  </div>
                  <div style={{ padding: '0.5rem', backgroundColor: '#f9fafb', borderRadius: '4px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600 }}>Meaning → Hanzi</div>
                    <div>{debugData.byCardType.meaning_to_hanzi.filter(c => c.isDue).length} / {debugData.byCardType.meaning_to_hanzi.length}</div>
                  </div>
                  <div style={{ padding: '0.5rem', backgroundColor: '#f9fafb', borderRadius: '4px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600 }}>Audio → Hanzi</div>
                    <div>{debugData.byCardType.audio_to_hanzi.filter(c => c.isDue).length} / {debugData.byCardType.audio_to_hanzi.length}</div>
                  </div>
                </div>
              </div>

              {/* Upcoming Reviews Timeline */}
              {debugData.queues.reviewNotDue.length > 0 && (
                <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Upcoming Reviews Timeline</h4>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    {(() => {
                      // Group by next_review_at date
                      const byDate = new Map<string, CardDebugInfo[]>();
                      for (const card of debugData.queues.reviewNotDue) {
                        const date = card.card.next_review_at?.slice(0, 10) || 'Unknown';
                        if (!byDate.has(date)) byDate.set(date, []);
                        byDate.get(date)!.push(card);
                      }
                      const sortedDates = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
                      return sortedDates.slice(0, 7).map(([date, cards]) => {
                        const dueDate = new Date(date);
                        const now = new Date();
                        const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        return (
                          <div key={date} style={{ padding: '0.25rem 0', borderBottom: '1px solid #f3f4f6' }}>
                            <strong>{date}</strong> ({diffDays}d): {cards.length} card{cards.length !== 1 ? 's' : ''} -
                            <span style={{ color: '#9ca3af' }}>
                              {' '}{cards.slice(0, 3).map(c => c.note?.hanzi || '?').join(', ')}
                              {cards.length > 3 ? ` +${cards.length - 3} more` : ''}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {/* Repair Actions */}
              <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Repair Actions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {resetMessage && (
                    <div style={{
                      padding: '0.5rem',
                      backgroundColor: resetMessage.startsWith('✓') ? '#dcfce7' : '#fee2e2',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                    }}>
                      {resetMessage}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-sm"
                      onClick={makeAllDueNow}
                      disabled={isResetting || debugData.queues.reviewNotDue.length === 0}
                      style={{ backgroundColor: '#f59e0b', color: 'white', border: 'none' }}
                    >
                      {isResetting ? 'Working...' : `Make ${debugData.queues.reviewNotDue.length} Review Cards Due Now`}
                    </button>
                    <button
                      className="btn btn-sm btn-error"
                      onClick={resetAllToNew}
                      disabled={isResetting}
                    >
                      {isResetting ? 'Working...' : 'Reset ALL to NEW (Start Fresh)'}
                    </button>
                  </div>
                  <p style={{ fontSize: '0.6875rem', color: '#9ca3af', margin: 0 }}>
                    <strong>Make Due Now:</strong> Keeps your progress but lets you study REVIEW cards immediately.
                    <br />
                    <strong>Reset to NEW:</strong> Erases all progress - cards go back to the NEW queue.
                  </p>
                </div>
              </div>

              {/* Raw Deck Settings */}
              <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Deck Settings (from IndexedDB)</h4>
                <pre style={{
                  backgroundColor: '#f3f4f6',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.625rem',
                  overflow: 'auto',
                  maxHeight: '150px',
                }}>
                  {JSON.stringify(debugData.deck, null, 2)}
                </pre>
              </div>
            </>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DeckSettingsModal({
  deck,
  onClose,
  onSave,
}: {
  deck: Deck;
  onClose: () => void;
  onSave: () => void;
}) {
  const queryClient = useQueryClient();
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Deck info
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description || '');

  // Basic settings
  const [newCardsPerDay, setNewCardsPerDay] = useState(deck.new_cards_per_day?.toString() || '20');
  const [learningSteps, setLearningSteps] = useState(deck.learning_steps || '1 10');
  const [graduatingInterval, setGraduatingInterval] = useState(deck.graduating_interval?.toString() || '1');
  const [easyInterval, setEasyInterval] = useState(deck.easy_interval?.toString() || '4');
  const [relearningSteps, setRelearningSteps] = useState(deck.relearning_steps || '10');

  // Advanced settings (stored as percentages in DB)
  const [startingEase, setStartingEase] = useState(((deck.starting_ease || 250) / 100).toString());
  const [minimumEase, setMinimumEase] = useState(((deck.minimum_ease || 130) / 100).toString());
  const [maximumEase, setMaximumEase] = useState(((deck.maximum_ease || 300) / 100).toString());
  const [intervalModifier, setIntervalModifier] = useState(((deck.interval_modifier || 100) / 100).toString());
  const [hardMultiplier, setHardMultiplier] = useState(((deck.hard_multiplier || 120) / 100).toString());
  const [easyBonus, setEasyBonus] = useState(((deck.easy_bonus || 130) / 100).toString());

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Update deck name and description
      await updateDeck(deck.id, { name, description: description || undefined });
      // Update SRS settings
      const updatedDeck = await updateDeckSettings(deck.id, {
        new_cards_per_day: parseInt(newCardsPerDay, 10) || 20,
        learning_steps: learningSteps,
        graduating_interval: parseInt(graduatingInterval, 10) || 1,
        easy_interval: parseInt(easyInterval, 10) || 4,
        relearning_steps: relearningSteps,
        starting_ease: Math.round(parseFloat(startingEase) * 100) || 250,
        minimum_ease: Math.round(parseFloat(minimumEase) * 100) || 130,
        maximum_ease: Math.round(parseFloat(maximumEase) * 100) || 300,
        interval_modifier: Math.round(parseFloat(intervalModifier) * 100) || 100,
        hard_multiplier: Math.round(parseFloat(hardMultiplier) * 100) || 120,
        easy_bonus: Math.round(parseFloat(easyBonus) * 100) || 130,
      });

      // Also update IndexedDB so offline queue counts reflect the new settings
      await db.decks.update(deck.id, {
        name,
        description: description || null,
        new_cards_per_day: updatedDeck.new_cards_per_day,
        learning_steps: updatedDeck.learning_steps,
        graduating_interval: updatedDeck.graduating_interval,
        easy_interval: updatedDeck.easy_interval,
        relearning_steps: updatedDeck.relearning_steps,
        starting_ease: updatedDeck.starting_ease,
        minimum_ease: updatedDeck.minimum_ease,
        maximum_ease: updatedDeck.maximum_ease,
        interval_modifier: updatedDeck.interval_modifier,
        hard_multiplier: updatedDeck.hard_multiplier,
        easy_bonus: updatedDeck.easy_bonus,
        updated_at: updatedDeck.updated_at,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deck', deck.id] });
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      onSave();
      onClose();
    },
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Deck Settings</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
          style={{ maxHeight: '70vh', overflowY: 'auto' }}
        >
          {/* Deck Info Section */}
          <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Deck Info</h3>

          <div className="form-group">
            <label className="form-label">Deck Name</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter deck name"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Description (optional)</label>
            <textarea
              className="form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter deck description"
              rows={2}
            />
          </div>

          {/* How SRS Works Section */}
          <div style={{ background: 'var(--bg-elevated)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <strong>How Spaced Repetition Works:</strong>
            <ul style={{ margin: '0.5rem 0 0 1rem', paddingLeft: '0.5rem' }}>
              <li><strong>New cards</strong> go through learning steps (1min → 10min → graduate)</li>
              <li><strong>Good</strong> advances to next step or graduates the card</li>
              <li><strong>Again</strong> resets to the first learning step</li>
              <li><strong>Graduated cards</strong> use the ease factor to calculate intervals</li>
              <li><strong>Ease factor</strong> adjusts based on your answers (harder = lower ease)</li>
            </ul>
          </div>

          <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Learning</h3>

          <div className="form-group">
            <label className="form-label">New cards per day</label>
            <input
              type="number"
              className="form-input"
              value={newCardsPerDay}
              onChange={(e) => setNewCardsPerDay(e.target.value)}
              min="0"
              max="1000"
            />
            <p className="text-light mt-1" style={{ fontSize: '0.8rem' }}>
              Maximum new cards introduced each day. Set to 0 to only review.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Learning steps (minutes)</label>
            <input
              type="text"
              className="form-input"
              value={learningSteps}
              onChange={(e) => setLearningSteps(e.target.value)}
              placeholder="1 10"
            />
            <p className="text-light mt-1" style={{ fontSize: '0.8rem' }}>
              Steps for new cards before graduating. "1 10" = see again in 1 min, then 10 min, then graduate.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Relearning steps (minutes)</label>
            <input
              type="text"
              className="form-input"
              value={relearningSteps}
              onChange={(e) => setRelearningSteps(e.target.value)}
              placeholder="10"
            />
            <p className="text-light mt-1" style={{ fontSize: '0.8rem' }}>
              Steps when you press "Again" on a review card. After completing, returns to review.
            </p>
          </div>

          <div className="grid grid-cols-2">
            <div className="form-group">
              <label className="form-label">Graduating interval</label>
              <input
                type="number"
                className="form-input"
                value={graduatingInterval}
                onChange={(e) => setGraduatingInterval(e.target.value)}
                min="1"
                max="365"
              />
              <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                Days after graduating (Good)
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Easy interval</label>
              <input
                type="number"
                className="form-input"
                value={easyInterval}
                onChange={(e) => setEasyInterval(e.target.value)}
                min="1"
                max="365"
              />
              <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                Days when pressing Easy on new card
              </p>
            </div>
          </div>

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              cursor: 'pointer',
              padding: '0.5rem 0',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            {showAdvanced ? '▼' : '▶'} Advanced Settings
          </button>

          {showAdvanced && (
            <>
              <div style={{ background: 'var(--bg-elevated)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                <strong>Ease Factor Explained:</strong>
                <p style={{ margin: '0.5rem 0 0 0' }}>
                  Each card has an "ease factor" (default 2.5). When you review:
                </p>
                <ul style={{ margin: '0.25rem 0 0 1rem', paddingLeft: '0.5rem' }}>
                  <li><strong>Good:</strong> next interval = current × ease (e.g., 10d × 2.5 = 25d)</li>
                  <li><strong>Hard:</strong> ease drops 15%, interval × hard multiplier</li>
                  <li><strong>Easy:</strong> ease rises 15%, interval × ease × easy bonus</li>
                  <li><strong>Again:</strong> ease drops 20%, card enters relearning</li>
                </ul>
              </div>

              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Ease Settings</h3>

              <div className="grid grid-cols-3">
                <div className="form-group">
                  <label className="form-label">Starting ease</label>
                  <input
                    type="number"
                    className="form-input"
                    value={startingEase}
                    onChange={(e) => setStartingEase(e.target.value)}
                    min="1.0"
                    max="5.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 2.5
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Minimum ease</label>
                  <input
                    type="number"
                    className="form-input"
                    value={minimumEase}
                    onChange={(e) => setMinimumEase(e.target.value)}
                    min="1.0"
                    max="5.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 1.3
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Maximum ease</label>
                  <input
                    type="number"
                    className="form-input"
                    value={maximumEase}
                    onChange={(e) => setMaximumEase(e.target.value)}
                    min="1.0"
                    max="5.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 3.0
                  </p>
                </div>
              </div>

              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Interval Multipliers</h3>

              <div className="grid grid-cols-3">
                <div className="form-group">
                  <label className="form-label">Interval modifier</label>
                  <input
                    type="number"
                    className="form-input"
                    value={intervalModifier}
                    onChange={(e) => setIntervalModifier(e.target.value)}
                    min="0.5"
                    max="2.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Multiplies all intervals
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Hard multiplier</label>
                  <input
                    type="number"
                    className="form-input"
                    value={hardMultiplier}
                    onChange={(e) => setHardMultiplier(e.target.value)}
                    min="1.0"
                    max="2.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 1.2
                  </p>
                </div>

                <div className="form-group">
                  <label className="form-label">Easy bonus</label>
                  <input
                    type="number"
                    className="form-input"
                    value={easyBonus}
                    onChange={(e) => setEasyBonus(e.target.value)}
                    min="1.0"
                    max="2.0"
                    step="0.1"
                  />
                  <p className="text-light mt-1" style={{ fontSize: '0.75rem' }}>
                    Default: 1.3
                  </p>
                </div>
              </div>

              <div style={{ background: 'var(--bg-elevated)', padding: '0.75rem', borderRadius: '8px', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                <strong>Example:</strong> Card at 10 days, ease 2.5, interval modifier 1.0:
                <ul style={{ margin: '0.25rem 0 0 1rem', paddingLeft: '0.5rem' }}>
                  <li>Good: 10 × 2.5 × 1.0 = 25 days</li>
                  <li>Hard: 10 × 1.2 × 1.0 = 12 days (ease → 2.35)</li>
                  <li>Easy: 10 × 2.5 × 1.3 × 1.0 = 33 days (ease → 2.65)</li>
                </ul>
              </div>
            </>
          )}

          <div className="modal-actions" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saveMutation.isPending || !name.trim()}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface NoteFormData {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts: string;
}

function NoteForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  initial?: NoteFormData;
  onSubmit: (data: NoteFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [hanzi, setHanzi] = useState(initial?.hanzi || '');
  const [pinyin, setPinyin] = useState(initial?.pinyin || '');
  const [english, setEnglish] = useState(initial?.english || '');
  const [funFacts, setFunFacts] = useState(initial?.fun_facts || '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ hanzi, pinyin, english, fun_facts: funFacts });
      }}
    >
      <div className="grid grid-cols-2">
        <div className="form-group">
          <label className="form-label">Hanzi (Chinese Characters)</label>
          <input
            type="text"
            className="form-input hanzi"
            value={hanzi}
            onChange={(e) => setHanzi(e.target.value)}
            placeholder="你好"
            required
            style={{ fontSize: '1.5rem' }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Pinyin</label>
          <input
            type="text"
            className="form-input"
            value={pinyin}
            onChange={(e) => setPinyin(e.target.value)}
            placeholder="ni3 hao3"
            required
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">English Meaning</label>
        <input
          type="text"
          className="form-input"
          value={english}
          onChange={(e) => setEnglish(e.target.value)}
          placeholder="Hello"
          required
        />
      </div>

      <div className="form-group">
        <label className="form-label">Fun Facts / Notes (optional)</label>
        <textarea
          className="form-textarea"
          value={funFacts}
          onChange={(e) => setFunFacts(e.target.value)}
          placeholder="Cultural context, usage notes, memory aids..."
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!hanzi.trim() || !pinyin.trim() || !english.trim() || isSubmitting}
        >
          {isSubmitting ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function NoteCard({
  note,
  onEdit,
  onDelete,
  onHistory,
  onAudioGenerated,
  isSelected,
  onToggleSelect,
  showSelect,
}: {
  note: NoteWithCards;
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onAudioGenerated: () => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  showSelect?: boolean;
}) {
  const { isPlaying, play } = useNoteAudio();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleGenerateAudio = async () => {
    setIsGenerating(true);
    try {
      await generateNoteAudio(note.id);
      onAudioGenerated();
    } catch (error) {
      console.error('Failed to generate audio:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateAudio = async () => {
    setIsRegenerating(true);
    try {
      await regenerateNoteAudio(note.id);
      onAudioGenerated();
    } catch (error) {
      console.error('Failed to regenerate audio:', error);
    } finally {
      setIsRegenerating(false);
    }
  };

  // Check if note can be regenerated (has audio)
  const canRegenerate = !!note.audio_url;

  // Get learning status for all cards
  const learningStatus = getNoteLearningStatus(note.cards || []);

  // Sort cards by card_type for consistent display order
  const sortedCards = [...(note.cards || [])].sort((a, b) => {
    const order = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
    return order.indexOf(a.card_type) - order.indexOf(b.card_type);
  });

  return (
    <div className="note-card">
      <div className="note-card-content">
        <div className="flex items-center gap-2">
          {showSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
          )}
          {note.audio_url ? (
            <>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => play(note.audio_url || null, note.hanzi, API_BASE, note.updated_at)}
                disabled={isPlaying}
                style={{ padding: '0.25rem 0.5rem', minWidth: 'auto' }}
              >
                {isPlaying ? '...' : '▶'}
              </button>
              {canRegenerate && !showSelect && (
                <button
                  className="btn btn-sm"
                  onClick={handleRegenerateAudio}
                  disabled={isRegenerating}
                  style={{
                    padding: '0.25rem 0.5rem',
                    minWidth: 'auto',
                    fontSize: '0.65rem',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                  }}
                  title="Regenerate audio with current settings"
                >
                  {isRegenerating ? '...' : '🔄'}
                </button>
              )}
              {note.audio_provider === 'minimax' && (
                <span
                  style={{
                    fontSize: '0.6rem',
                    padding: '0.1rem 0.3rem',
                    background: '#10b981',
                    color: 'white',
                    borderRadius: '3px',
                  }}
                  title="MiniMax HD audio"
                >
                  HD
                </span>
              )}
            </>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              onClick={handleGenerateAudio}
              disabled={isGenerating}
              style={{ padding: '0.25rem 0.5rem', minWidth: 'auto', fontSize: '0.7rem' }}
              title="Generate audio"
            >
              {isGenerating ? '...' : '🔊+'}
            </button>
          )}
          <div className="note-card-hanzi">{note.hanzi}</div>
        </div>
        <div className="note-card-details">
          <span className="pinyin">{note.pinyin}</span>
          <span> - </span>
          <span>{note.english}</span>
        </div>
        {note.fun_facts && (
          <p className="text-light mt-1" style={{ fontSize: '0.875rem' }}>
            {note.fun_facts}
          </p>
        )}

        {/* Learning Status */}
        {sortedCards.length > 0 && (
          <div className="note-learning-status">
            <div className="card-status-row">
              {sortedCards.map((card) => {
                const status = getCardStatus(card);
                return (
                  <div
                    key={card.id}
                    className="card-status-item"
                    title={`${CARD_TYPE_LABELS[card.card_type]}: ${status.label}${card.interval > 0 ? ` (${formatInterval(card.interval)} interval)` : ''}`}
                  >
                    <span className="card-type-label">{CARD_TYPE_SHORT[card.card_type]}</span>
                    <span
                      className="card-status-badge"
                      style={{ backgroundColor: status.color }}
                    >
                      {status.label}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Summary row */}
            <div className="note-status-summary">
              {learningStatus.allNew ? (
                <span className="text-light">Not started</span>
              ) : (
                <>
                  <span className="text-light">
                    {learningStatus.totalReps} reviews
                  </span>
                  <span className="text-light">
                    {Math.round(learningStatus.avgEase * 100)}% ease
                  </span>
                  {learningStatus.avgInterval > 0 && (
                    <span className="text-light">
                      ~{formatInterval(learningStatus.avgInterval)}
                    </span>
                  )}
                  {learningStatus.nextDue && !learningStatus.isDue && (
                    <span className="text-light">
                      Next: {learningStatus.nextDue}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="note-card-actions">
        <button className="btn btn-sm btn-secondary" onClick={onHistory}>
          History
        </button>
        <button className="btn btn-sm btn-secondary" onClick={onEdit}>
          Edit
        </button>
        <button className="btn btn-sm btn-error" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

export function DeckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingNote, setEditingNote] = useState<NoteWithCards | null>(null);
  const [historyNote, setHistoryNote] = useState<NoteWithCards | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [isGeneratingAllAudio, setIsGeneratingAllAudio] = useState(false);
  const [audioGenerationProgress, setAudioGenerationProgress] = useState({ done: 0, total: 0 });
  const [isRegeneratingAudio, setIsRegeneratingAudio] = useState(false);
  const [showShareTutorModal, setShowShareTutorModal] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());

  const deckQuery = useQuery({
    queryKey: ['deck', id],
    queryFn: () => getDeck(id!),
    enabled: !!id,
  });

  const statsQuery = useQuery({
    queryKey: ['deckStats', id],
    queryFn: () => getDeckStats(id!),
    enabled: !!id,
  });

  // Fetch which tutors this deck is shared with
  const tutorSharesQuery = useQuery({
    queryKey: ['deckTutorShares', id],
    queryFn: () => getDeckTutorShares(id!),
    enabled: !!id,
  });

  // Fetch user's relationships to find available tutors
  const relationshipsQuery = useQuery({
    queryKey: ['relationships'],
    queryFn: getMyRelationships,
    enabled: showShareTutorModal,
  });

  // Mutation to share deck with a tutor
  const shareTutorMutation = useMutation({
    mutationFn: (relationshipId: string) => studentShareDeck(relationshipId, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deckTutorShares', id] });
      setShowShareTutorModal(false);
    },
  });

  // Mutation to unshare deck from a tutor
  const unshareTutorMutation = useMutation({
    mutationFn: (relationshipId: string) => unshareStudentDeck(relationshipId, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deckTutorShares', id] });
    },
  });

  const createNoteMutation = useMutation({
    mutationFn: (data: NoteFormData) => createNote(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deck', id] });
      queryClient.invalidateQueries({ queryKey: ['deckStats', id] });
      setShowAddModal(false);
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ noteId, data }: { noteId: string; data: NoteFormData }) =>
      updateNote(noteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deck', id] });
      setEditingNote(null);
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deck', id] });
      queryClient.invalidateQueries({ queryKey: ['deckStats', id] });
    },
  });

  const deleteDeckMutation = useMutation({
    mutationFn: () => deleteDeck(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      navigate('/');
    },
  });

  const generateAllMissingAudio = async () => {
    if (!deckQuery.data) return;

    const notesWithoutAudio = deckQuery.data.notes.filter(note => !note.audio_url);
    if (notesWithoutAudio.length === 0) return;

    setIsGeneratingAllAudio(true);
    setAudioGenerationProgress({ done: 0, total: notesWithoutAudio.length });

    for (let i = 0; i < notesWithoutAudio.length; i++) {
      try {
        await generateNoteAudio(notesWithoutAudio[i].id);
        setAudioGenerationProgress({ done: i + 1, total: notesWithoutAudio.length });
      } catch (error) {
        console.error(`Failed to generate audio for ${notesWithoutAudio[i].hanzi}:`, error);
      }
    }

    setIsGeneratingAllAudio(false);
    queryClient.invalidateQueries({ queryKey: ['deck', id] });
  };

  const regenerateSelectedAudio = async () => {
    if (!deckQuery.data || selectedNotes.size === 0) return;

    const notesToRegenerate = deckQuery.data.notes.filter(n => selectedNotes.has(n.id));

    // Process sequentially with progress
    setIsRegeneratingAudio(true);
    setAudioGenerationProgress({ done: 0, total: notesToRegenerate.length });

    for (let i = 0; i < notesToRegenerate.length; i++) {
      try {
        await regenerateNoteAudio(notesToRegenerate[i].id);
        setAudioGenerationProgress({ done: i + 1, total: notesToRegenerate.length });
      } catch (error) {
        console.error(`Failed to regenerate audio for ${notesToRegenerate[i].hanzi}:`, error);
      }
    }

    setIsRegeneratingAudio(false);
    setSelectMode(false);
    setSelectedNotes(new Set());
    queryClient.invalidateQueries({ queryKey: ['deck', id] });
  };

  const toggleNoteSelection = (noteId: string) => {
    setSelectedNotes(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  const selectAllNotes = () => {
    if (!deckQuery.data) return;
    const allWithAudio = deckQuery.data.notes.filter(n => n.audio_url).map(n => n.id);
    setSelectedNotes(new Set(allWithAudio));
  };

  const deselectAllNotes = () => {
    setSelectedNotes(new Set());
  };

  // Count notes that have audio (can be regenerated)
  const notesWithAudio = deckQuery.data?.notes.filter(note => note.audio_url) || [];

  if (deckQuery.isLoading) {
    return <Loading />;
  }

  if (deckQuery.error || !deckQuery.data) {
    return <ErrorMessage message="Failed to load deck" />;
  }

  const deck = deckQuery.data;
  const stats = statsQuery.data;

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="mb-4">
          <Link to="/" className="text-light">
            &larr; Back
          </Link>
          <h1 className="mt-1">{deck.name}</h1>
          {deck.description && <p className="text-light mt-1">{deck.description}</p>}
          <div className="deck-actions mt-3">
            {stats && stats.cards_due > 0 && (
              <Link to={`/study?deck=${id}&autostart=true`} className="btn btn-primary">
                Study ({stats.cards_due} due)
              </Link>
            )}
            {deck.notes.filter(n => !n.audio_url).length > 0 && (
              <button
                className="btn btn-secondary"
                onClick={generateAllMissingAudio}
                disabled={isGeneratingAllAudio}
              >
                {isGeneratingAllAudio
                  ? `Generating Audio (${audioGenerationProgress.done}/${audioGenerationProgress.total})`
                  : `Generate All Audio (${deck.notes.filter(n => !n.audio_url).length})`}
              </button>
            )}
            {notesWithAudio.length > 0 && !selectMode && (
              <button
                className="btn"
                onClick={() => setSelectMode(true)}
                style={{
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                }}
                title="Select notes to regenerate audio"
              >
                Regenerate Audio
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => setShowShareTutorModal(true)}
            >
              Share with Tutor
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowSettings(true)}
            >
              Settings
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowDebug(true)}
              title="Debug deck scheduling"
            >
              🔍 Debug
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </button>
          </div>
        </div>

        {/* Tutor Shares */}
        {tutorSharesQuery.data && tutorSharesQuery.data.length > 0 && (
          <div className="card mb-4" style={{ padding: '1rem' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
              Shared with Tutors ({tutorSharesQuery.data.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {tutorSharesQuery.data.map((share) => (
                <div
                  key={share.relationship_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem',
                    backgroundColor: 'var(--bg-elevated)',
                    borderRadius: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {share.tutor.picture_url ? (
                      <img
                        src={share.tutor.picture_url}
                        alt=""
                        style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--color-primary)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        {(share.tutor.name || share.tutor.email || '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                        {share.tutor.name || 'Unknown'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                        Shared {new Date(share.shared_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      if (confirm(`Stop sharing this deck with ${share.tutor.name || share.tutor.email}?`)) {
                        unshareTutorMutation.mutate(share.relationship_id);
                      }
                    }}
                    disabled={unshareTutorMutation.isPending}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-light)',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.75rem',
                    }}
                  >
                    Unshare
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 mb-4">
            <div className="card stats-card">
              <div className="stats-value">{stats.total_notes}</div>
              <div className="stats-label">Notes</div>
            </div>
            <div className="card stats-card">
              <div className="stats-value">{stats.cards_due}</div>
              <div className="stats-label">Cards Due</div>
            </div>
            <div className="card stats-card">
              <div className="stats-value">{stats.cards_mastered}</div>
              <div className="stats-label">Mastered</div>
            </div>
          </div>
        )}

        {/* Select Mode Toolbar */}
        {selectMode && (
          <div
            className="card mb-4"
            style={{
              padding: '0.75rem 1rem',
              background: '#eff6ff',
              border: '1px solid #3b82f6',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontWeight: 500 }}>
                {selectedNotes.size} selected
              </span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={selectAllNotes}
                style={{ padding: '0.25rem 0.5rem' }}
              >
                Select All ({notesWithAudio.length})
              </button>
              {selectedNotes.size > 0 && (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={deselectAllNotes}
                  style={{ padding: '0.25rem 0.5rem' }}
                >
                  Deselect All
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-sm"
                onClick={regenerateSelectedAudio}
                disabled={selectedNotes.size === 0 || isRegeneratingAudio}
                style={{
                  background: selectedNotes.size === 0 ? '#9ca3af' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                }}
              >
                {isRegeneratingAudio
                  ? `Regenerating (${audioGenerationProgress.done}/${audioGenerationProgress.total})`
                  : `Regenerate ${selectedNotes.size > 0 ? `(${selectedNotes.size})` : ''}`}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  setSelectMode(false);
                  setSelectedNotes(new Set());
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <h2>Notes ({deck.notes.length})</h2>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              Add Note
            </button>
          </div>

          {deck.notes.length === 0 ? (
            <EmptyState
              icon="📝"
              title="No notes yet"
              description="Add vocabulary to this deck"
              action={
                <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                  Add Note
                </button>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {deck.notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onEdit={() => setEditingNote(note)}
                  onHistory={() => setHistoryNote(note)}
                  onDelete={() => {
                    if (confirm(`Delete "${note.hanzi}"?`)) {
                      deleteNoteMutation.mutate(note.id);
                    }
                  }}
                  onAudioGenerated={() => {
                    queryClient.invalidateQueries({ queryKey: ['deck', id] });
                  }}
                  showSelect={selectMode && !!note.audio_url}
                  isSelected={selectedNotes.has(note.id)}
                  onToggleSelect={() => toggleNoteSelection(note.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Add Note Modal */}
        {showAddModal && (
          <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Add Note</h2>
                <button className="modal-close" onClick={() => setShowAddModal(false)}>
                  &times;
                </button>
              </div>
              <NoteForm
                onSubmit={(data) => createNoteMutation.mutate(data)}
                onCancel={() => setShowAddModal(false)}
                isSubmitting={createNoteMutation.isPending}
              />
            </div>
          </div>
        )}

        {/* Edit Note Modal */}
        {editingNote && (
          <div className="modal-overlay" onClick={() => setEditingNote(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Edit Note</h2>
                <button className="modal-close" onClick={() => setEditingNote(null)}>
                  &times;
                </button>
              </div>
              <NoteForm
                initial={{
                  hanzi: editingNote.hanzi,
                  pinyin: editingNote.pinyin,
                  english: editingNote.english,
                  fun_facts: editingNote.fun_facts || '',
                }}
                onSubmit={(data) =>
                  updateNoteMutation.mutate({ noteId: editingNote.id, data })
                }
                onCancel={() => setEditingNote(null)}
                isSubmitting={updateNoteMutation.isPending}
              />
            </div>
          </div>
        )}

        {/* Note History Modal */}
        {historyNote && (
          <NoteHistoryModal note={historyNote} onClose={() => setHistoryNote(null)} />
        )}

        {/* Delete Deck Confirmation */}
        {showDeleteConfirm && (
          <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Delete Deck?</h2>
                <button className="modal-close" onClick={() => setShowDeleteConfirm(false)}>
                  &times;
                </button>
              </div>
              <p>
                Are you sure you want to delete "{deck.name}"? This will delete all{' '}
                {deck.notes.length} notes and their cards. This action cannot be undone.
              </p>
              <div className="modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-error"
                  onClick={() => deleteDeckMutation.mutate()}
                  disabled={deleteDeckMutation.isPending}
                >
                  {deleteDeckMutation.isPending ? 'Deleting...' : 'Delete Deck'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Deck Settings Modal */}
        {showSettings && (
          <DeckSettingsModal
            deck={deck}
            onClose={() => setShowSettings(false)}
            onSave={() => {
              queryClient.invalidateQueries({ queryKey: ['deck', id] });
            }}
          />
        )}

        {/* Deck Debug Modal */}
        {showDebug && id && (
          <DeckDebugModal
            deckId={id}
            onClose={() => setShowDebug(false)}
          />
        )}

        {/* Share with Tutor Modal */}
        {showShareTutorModal && (
          <div className="modal-overlay" onClick={() => setShowShareTutorModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Share with Tutor</h2>
                <button className="modal-close" onClick={() => setShowShareTutorModal(false)}>
                  &times;
                </button>
              </div>
              <p className="text-light" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
                Share this deck with a tutor so they can view your study progress.
              </p>
              {relationshipsQuery.isLoading ? (
                <Loading message="Loading tutors..." />
              ) : !relationshipsQuery.data || relationshipsQuery.data.tutors.length === 0 ? (
                <EmptyState
                  icon="👨‍🏫"
                  title="No tutors connected"
                  description="Connect with a tutor first to share decks"
                  action={
                    <Link to="/connections" className="btn btn-primary">
                      Find Tutors
                    </Link>
                  }
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {relationshipsQuery.data.tutors.map((rel) => {
                    const tutor = user ? getOtherUserInRelationship(rel, user.id) : null;
                    const alreadyShared = tutorSharesQuery.data?.some(
                      (share) => share.relationship_id === rel.id
                    );

                    if (!tutor) return null;

                    return (
                      <button
                        key={rel.id}
                        className="btn"
                        onClick={() => shareTutorMutation.mutate(rel.id)}
                        disabled={shareTutorMutation.isPending || alreadyShared}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.75rem',
                          backgroundColor: alreadyShared ? 'var(--bg-elevated)' : 'white',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          cursor: alreadyShared ? 'default' : 'pointer',
                          opacity: alreadyShared ? 0.6 : 1,
                          textAlign: 'left',
                          width: '100%',
                        }}
                      >
                        {tutor.picture_url ? (
                          <img
                            src={tutor.picture_url}
                            alt=""
                            style={{ width: '36px', height: '36px', borderRadius: '50%' }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              backgroundColor: 'var(--color-primary)',
                              color: 'white',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 600,
                            }}
                          >
                            {(tutor.name || tutor.email || '?')[0].toUpperCase()}
                          </div>
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500 }}>{tutor.name || 'Unknown'}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                            {tutor.email}
                          </div>
                        </div>
                        {alreadyShared && (
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--success)',
                              fontWeight: 500,
                            }}
                          >
                            Shared
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="modal-actions" style={{ marginTop: '1rem' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowShareTutorModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
