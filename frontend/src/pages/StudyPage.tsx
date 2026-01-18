import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import {
  uploadRecording,
  askAboutNote,
  startSession,
  API_BASE,
  NoteQuestion,
} from '../api/client';
import { Loading, EmptyState } from '../components/Loading';
import {
  CardWithNote,
  Rating,
  CARD_TYPE_INFO,
  RATING_INFO,
  QueueCounts,
  IntervalPreview,
} from '../types';
import { useAudioRecorder, useNoteAudio } from '../hooks/useAudio';
import { useNetwork } from '../contexts/NetworkContext';
import {
  useOfflineDecks,
  useOfflineNextCard,
  useOfflineQueueCounts,
  useSubmitReviewOffline,
  useHasMoreNewCards,
} from '../hooks/useOfflineData';

// Queue counts header component
function QueueCountsHeader({ counts, activeQueue }: { counts: QueueCounts; activeQueue?: number }) {
  const total = counts.new + counts.learning + counts.review;

  if (total === 0) {
    return null;
  }

  // CardQueue.NEW = 0, CardQueue.LEARNING = 1, CardQueue.REVIEW = 2, CardQueue.RELEARNING = 3
  const isNewActive = activeQueue === 0;
  const isLearningActive = activeQueue === 1 || activeQueue === 3; // Learning or Relearning
  const isReviewActive = activeQueue === 2;

  return (
    <div className="queue-counts">
      <span className={`count-new ${isNewActive ? 'count-active' : ''}`} title="New cards">{counts.new}</span>
      <span className="count-separator">+</span>
      <span className={`count-learning ${isLearningActive ? 'count-active' : ''}`} title="Learning cards">{counts.learning}</span>
      <span className="count-separator">+</span>
      <span className={`count-review ${isReviewActive ? 'count-active' : ''}`} title="Review cards">{counts.review}</span>
    </div>
  );
}

// Rating buttons with interval previews from backend
function RatingButtons({
  intervalPreviews,
  onRate,
  disabled,
}: {
  intervalPreviews: Record<Rating, IntervalPreview>;
  onRate: (rating: Rating) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-3">
      <p className="text-center text-light mb-1" style={{ fontSize: '0.8125rem' }}>How well did you know this?</p>
      <div className="rating-buttons">
        {([0, 1, 2, 3] as Rating[]).map((rating) => (
          <button
            key={rating}
            className={`rating-btn ${RATING_INFO[rating].label.toLowerCase()}`}
            onClick={() => onRate(rating)}
            disabled={disabled}
          >
            <span className="rating-label">{RATING_INFO[rating].label}</span>
            <span className="rating-interval">{intervalPreviews[rating].intervalText}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StudyCard({
  card,
  intervalPreviews,
  sessionId,
  counts,
  onComplete,
  onEnd,
}: {
  card: CardWithNote;
  intervalPreviews: Record<Rating, IntervalPreview>;
  sessionId: string | null;
  counts: QueueCounts;
  onComplete: () => void;
  onEnd: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [startTime] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  // Ask Claude state
  const [showAskClaude, setShowAskClaude] = useState(false);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState<NoteQuestion[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const questionInputRef = useRef<HTMLInputElement>(null);

  const { isRecording, audioBlob, startRecording, stopRecording, clearRecording } =
    useAudioRecorder();
  const { isPlaying, play: playAudio, stop: stopAudio } = useNoteAudio();

  // Review submission (always uses offline/local-first approach)
  const reviewMutation = useSubmitReviewOffline();

  const cardInfo = CARD_TYPE_INFO[card.card_type];
  const isTypingCard = cardInfo.action === 'type';
  const isSpeakingCard = cardInfo.action === 'speak';

  // Focus input for typing cards
  useEffect(() => {
    if (isTypingCard && inputRef.current && !flipped) {
      inputRef.current.focus();
    }
  }, [isTypingCard, flipped]);

  // Play audio for audio cards on front
  useEffect(() => {
    if (card.card_type === 'audio_to_hanzi' && !flipped) {
      playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE);
    }
    return () => stopAudio();
  }, [card, flipped, playAudio, stopAudio]);

  // Auto-play audio when answer is revealed
  useEffect(() => {
    if (flipped) {
      // Small delay to ensure any previous audio is fully stopped
      const timer = setTimeout(() => {
        playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [flipped, card.note.audio_url, card.note.hanzi, playAudio]);

  const handleFlip = () => {
    if (!flipped) {
      setFlipped(true);
    }
  };

  const handleRate = async (rating: Rating) => {
    const timeSpent = Date.now() - startTime;
    await reviewMutation.mutateAsync({
      cardId: card.id,
      rating,
      timeSpentMs: timeSpent,
      userAnswer: userAnswer || undefined,
      sessionId: sessionId || undefined,
    });

    // Upload recording if exists (best-effort, non-blocking)
    if (audioBlob) {
      uploadRecording(card.id, audioBlob).catch(console.error);
    }

    onComplete();
  };

  const handleAskClaude = async () => {
    if (!question.trim() || isAsking) return;

    setIsAsking(true);
    try {
      // Include user's answer context for typing cards
      const context = isTypingCard && userAnswer ? {
        userAnswer: userAnswer,
        correctAnswer: card.note.hanzi,
        cardType: card.card_type,
      } : undefined;

      const response = await askAboutNote(card.note.id, question.trim(), context);
      setConversation((prev) => [...prev, response]);
      setQuestion('');
    } catch (error) {
      console.error('Failed to ask Claude:', error);
    } finally {
      setIsAsking(false);
    }
  };

  const renderFront = () => {
    switch (card.card_type) {
      case 'hanzi_to_meaning':
        return (
          <div className="text-center">
            <p className="text-light mb-1" style={{ fontSize: '0.875rem' }}>{cardInfo.prompt}</p>
            <div className="hanzi hanzi-large">{card.note.hanzi}</div>
          </div>
        );

      case 'meaning_to_hanzi':
        return (
          <div className="text-center">
            <p className="text-light mb-1" style={{ fontSize: '0.875rem' }}>{cardInfo.prompt}</p>
            <div style={{ fontSize: '1.5rem', fontWeight: 500 }}>{card.note.english}</div>
            <div className="mt-3">
              <input
                ref={inputRef}
                type="text"
                className="form-input"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder="Type in Chinese..."
                style={{ fontSize: '1.25rem', textAlign: 'center', maxWidth: '280px' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFlip();
                }}
              />
            </div>
          </div>
        );

      case 'audio_to_hanzi':
        return (
          <div className="text-center">
            <p className="text-light mb-1" style={{ fontSize: '0.875rem' }}>{cardInfo.prompt}</p>
            <button
              className="btn btn-secondary mb-3"
              onClick={() => playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE)}
              disabled={isPlaying}
            >
              {isPlaying ? 'Playing...' : 'Play Audio'}
            </button>
            <div>
              <input
                ref={inputRef}
                type="text"
                className="form-input"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder="Type what you hear..."
                style={{ fontSize: '1.25rem', textAlign: 'center', maxWidth: '280px' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFlip();
                }}
              />
            </div>
          </div>
        );
    }
  };

  const playUserRecording = () => {
    if (audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      new Audio(url).play();
    }
  };

  const renderBackMain = () => {
    const isCorrect =
      isTypingCard &&
      userAnswer.trim().toLowerCase() === card.note.hanzi.toLowerCase();

    return (
      <div className="text-center">
        {isTypingCard && userAnswer && (
          <div className={`mb-2 ${isCorrect ? 'text-success' : 'text-error'}`} style={{ fontSize: '0.875rem' }}>
            {isCorrect ? 'Correct!' : `Your answer: ${userAnswer}`}
          </div>
        )}

        <div className="hanzi hanzi-large mb-1">{card.note.hanzi}</div>
        <div className="pinyin mb-1">{card.note.pinyin}</div>
        <div style={{ fontSize: '1.25rem' }}>{card.note.english}</div>

        {card.note.fun_facts && (
          <div
            className="mt-3 text-light"
            style={{
              fontSize: '0.8125rem',
              backgroundColor: '#f3f4f6',
              padding: '0.5rem',
              borderRadius: '6px',
            }}
          >
            {card.note.fun_facts}
          </div>
        )}
      </div>
    );
  };

  const renderAskClaudeModal = () => {
    if (!showAskClaude) return null;

    return (
      <div className="modal-overlay" onClick={() => setShowAskClaude(false)}>
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '90%', width: '500px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        >
          <div className="modal-header">
            <div className="modal-title">Ask about: {card.note.hanzi}</div>
            <button className="modal-close" onClick={() => setShowAskClaude(false)}>×</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem' }}>
            {conversation.length === 0 && (
              <p className="text-light" style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                Ask a question about this word - grammar, usage, examples, etc.
              </p>
            )}

            {conversation.map((qa) => (
              <div key={qa.id} style={{ marginBottom: '1rem' }}>
                <div
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    color: 'white',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    marginBottom: '0.5rem',
                    fontSize: '0.875rem',
                  }}
                >
                  {qa.question}
                </div>
                <div
                  style={{
                    backgroundColor: '#f9fafb',
                    padding: '0.75rem 1rem',
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

          <div className="flex gap-2">
            <input
              ref={questionInputRef}
              type="text"
              className="form-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAskClaude();
              }}
              disabled={isAsking}
            />
            <button
              className="btn btn-primary"
              onClick={handleAskClaude}
              disabled={!question.trim() || isAsking}
            >
              {isAsking ? '...' : 'Ask'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderBackActions = () => {
    return (
      <div className="flex gap-1 justify-center flex-wrap mb-3">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE)}
          disabled={isPlaying}
        >
          {isPlaying ? 'Playing...' : 'Play Audio'}
        </button>
        {audioBlob && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={playUserRecording}
          >
            My Recording
          </button>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setShowAskClaude(!showAskClaude);
            if (!showAskClaude) {
              setTimeout(() => questionInputRef.current?.focus(), 100);
            }
          }}
        >
          {showAskClaude ? 'Hide' : 'Ask Claude'}
        </button>
      </div>
    );
  };

  const renderSpeakingCardButtons = () => {
    if (isRecording) {
      return (
        <button className="btn btn-error" onClick={stopRecording}>
          Stop Recording
        </button>
      );
    }

    if (audioBlob) {
      return (
        <div className="flex flex-col gap-2 items-center">
          <div className="flex gap-1 justify-center">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const url = URL.createObjectURL(audioBlob);
                new Audio(url).play();
              }}
            >
              Play Recording
            </button>
            <button className="btn btn-secondary btn-sm" onClick={clearRecording}>
              Re-record
            </button>
          </div>
          <button className="btn btn-primary" onClick={handleFlip}>
            Check Answer
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2 items-center">
        <button className="btn btn-primary" onClick={startRecording}>
          Record Your Pronunciation
        </button>
        <button
          className="btn-link text-light"
          onClick={handleFlip}
          style={{ fontSize: '0.8125rem' }}
        >
          Skip recording
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="study-fullscreen">
        {/* Top bar with close button and queue counts */}
        <div className="study-topbar">
          <button
            className="study-close-btn"
            onClick={onEnd}
            aria-label="End session"
          >
            ✕
          </button>
          <QueueCountsHeader counts={counts} activeQueue={card.queue} />
        </div>

        {/* Card content */}
        <div className="study-card-content">
          {!flipped ? (
            <>
              <div className="study-card-main">
                {renderFront()}
              </div>
              <div className="study-card-actions text-center">
                {isSpeakingCard ? (
                  renderSpeakingCardButtons()
                ) : (
                  <button className="btn btn-primary" onClick={handleFlip}>
                    {isTypingCard ? 'Check Answer' : 'Show Answer'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="study-card-main">
                {renderBackMain()}
              </div>
              <div className="study-card-actions">
                {renderBackActions()}
                <RatingButtons
                  intervalPreviews={intervalPreviews}
                  onRate={handleRate}
                  disabled={reviewMutation.isPending}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Ask Claude Modal */}
      {renderAskClaudeModal()}
    </>
  );
}

export function StudyPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isOnline } = useNetwork();

  const deckId = searchParams.get('deck') || undefined;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recentNotes, setRecentNotes] = useState<string[]>([]);
  const [studyStarted, setStudyStarted] = useState(false);
  const [ignoreDailyLimit, setIgnoreDailyLimit] = useState(false);

  // All data comes from offline/local-first hooks
  const { decks } = useOfflineDecks();
  const offlineQueueCounts = useOfflineQueueCounts(deckId, ignoreDailyLimit);
  const offlineNextCard = useOfflineNextCard(
    studyStarted ? deckId : undefined,
    recentNotes.slice(-5),
    ignoreDailyLimit
  );
  const hasMoreNewCards = useHasMoreNewCards(deckId);

  // Derive state from hooks
  const counts = offlineQueueCounts.counts;
  const currentCard = studyStarted ? offlineNextCard.card : null;
  const intervalPreviews = offlineNextCard.intervalPreviews;
  const isLoading = studyStarted ? offlineNextCard.isLoading : offlineQueueCounts.isLoading;

  const handleStartStudy = async () => {
    setStudyStarted(true);
    setRecentNotes([]);

    // Best-effort session creation (non-blocking)
    if (isOnline) {
      startSession(deckId)
        .then(session => setSessionId(session.id))
        .catch(() => {});
    }
  };

  const handleCardComplete = () => {
    // Update recent notes - hook reactively provides next card
    if (currentCard) {
      setRecentNotes(prev => [...prev.slice(-4), currentCard.note_id]);
    }
  };

  const handleEndSession = () => {
    setStudyStarted(false);
    setSessionId(null);
    setRecentNotes([]);
    setIgnoreDailyLimit(false);
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  // Show deck selection if study hasn't started
  if (!studyStarted) {
    if (isLoading) {
      return <Loading />;
    }

    const totalDue = counts.new + counts.learning + counts.review;

    return (
      <div className="page">
        <div className="container">
          <h1 className="mb-4">Study</h1>

          {/* Deck Selection */}
          {!deckId && (
            <div className="card mb-4">
              <h2 className="mb-3">Select a Deck</h2>
              <div className="flex flex-col gap-2">
                <Link to="/study" className="deck-card">
                  <div className="deck-card-title">All Decks</div>
                  <div className="deck-card-stats">
                    <QueueCountsHeader counts={counts} />
                  </div>
                </Link>
                {decks.map((deck) => (
                  <Link key={deck.id} to={`/study?deck=${deck.id}`} className="deck-card">
                    <div className="deck-card-title">{deck.name}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Start Study */}
          {totalDue === 0 ? (
            <EmptyState
              icon="🎉"
              title="No cards due!"
              description="You're all caught up. Check back later or add more cards."
              action={
                <Link to="/decks" className="btn btn-primary">
                  View Decks
                </Link>
              }
            />
          ) : (
            <div className="card text-center">
              <QueueCountsHeader counts={counts} />
              <h2 className="mt-3 mb-2">{totalDue} cards to study</h2>
              <p className="text-light mb-4">
                {deckId
                  ? `From "${decks.find((d) => d.id === deckId)?.name || 'this deck'}"`
                  : 'From all decks'}
              </p>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleStartStudy}
              >
                Start Studying
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Study complete
  if (!isLoading && !currentCard) {
    const handleStudyMoreNewCards = () => {
      // Setting ignoreDailyLimit will reactively show more cards via hooks
      setIgnoreDailyLimit(true);
      setRecentNotes([]);
    };

    return (
      <div className="page">
        <div className="container">
          <div className="card text-center">
            <div style={{ fontSize: '4rem' }}>🎉</div>
            <h1 className="mt-2">All Done!</h1>
            <p className="text-light mt-2">
              {hasMoreNewCards
                ? "You've finished your daily limit. Want to study more new cards?"
                : "No more cards due right now."}
            </p>
            <div className="flex flex-col gap-3 items-center mt-4">
              {hasMoreNewCards && (
                <button
                  className="btn btn-primary btn-lg"
                  onClick={handleStudyMoreNewCards}
                >
                  Study More New Cards
                </button>
              )}
              <div className="flex gap-2 justify-center">
                <button
                  className={hasMoreNewCards ? "btn btn-secondary" : "btn btn-primary"}
                  onClick={() => {
                    handleEndSession();
                    queryClient.invalidateQueries({ queryKey: ['stats'] });
                  }}
                >
                  Back to Decks
                </button>
                <Link to="/" className="btn btn-secondary">
                  Home
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active study - fullscreen mode
  return (
    <div className="study-page-fullscreen">
      {isLoading ? (
        <Loading />
      ) : currentCard && intervalPreviews ? (
        <StudyCard
          key={currentCard.id}
          card={currentCard}
          intervalPreviews={intervalPreviews}
          sessionId={sessionId}
          counts={counts}
          onComplete={handleCardComplete}
          onEnd={handleEndSession}
        />
      ) : null}
    </div>
  );
}
