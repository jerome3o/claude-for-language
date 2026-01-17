import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getDecks,
  getNextCard,
  submitReview,
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
    <div className="mt-4">
      <p className="text-center text-light mb-2">How well did you know this?</p>
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
  onComplete,
  isOffline,
}: {
  card: CardWithNote;
  intervalPreviews: Record<Rating, IntervalPreview>;
  sessionId: string | null;
  onComplete: (counts: QueueCounts) => void;
  isOffline?: boolean;
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

  // Offline review submission
  const offlineReviewMutation = useSubmitReviewOffline();

  const cardInfo = CARD_TYPE_INFO[card.card_type];
  const isTypingCard = cardInfo.action === 'type';
  const isSpeakingCard = cardInfo.action === 'speak';

  // Focus input for typing cards
  useEffect(() => {
    if (isTypingCard && inputRef.current && !flipped) {
      inputRef.current.focus();
    }
  }, [isTypingCard, flipped]);

  // Play audio for audio cards
  useEffect(() => {
    if (card.card_type === 'audio_to_hanzi' && !flipped) {
      playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE);
    }
    return () => stopAudio();
  }, [card, flipped, playAudio, stopAudio]);

  // Online review mutation
  const onlineReviewMutation = useMutation({
    mutationFn: async (rating: Rating) => {
      const timeSpent = Date.now() - startTime;
      const result = await submitReview({
        card_id: card.id,
        rating,
        time_spent_ms: timeSpent,
        user_answer: userAnswer || undefined,
        session_id: sessionId || undefined,
      });

      // Upload recording if exists
      if (audioBlob && result.review?.id) {
        await uploadRecording(result.review.id, audioBlob);
      }

      return result;
    },
    onSuccess: (result) => {
      onComplete(result.counts);
    },
  });

  // Combined mutation that handles both online and offline
  const reviewMutation = {
    mutate: async (rating: Rating) => {
      if (isOffline) {
        // Use offline mutation
        await offlineReviewMutation.mutateAsync({
          cardId: card.id,
          rating,
          timeSpentMs: Date.now() - startTime,
          userAnswer: userAnswer || undefined,
          sessionId: sessionId || undefined,
        });
        // Call onComplete with placeholder - the offline hooks will update counts
        onComplete({ new: 0, learning: 0, review: 0 });
      } else {
        // Use online mutation
        onlineReviewMutation.mutate(rating);
      }
    },
    isPending: onlineReviewMutation.isPending || offlineReviewMutation.isPending,
  };

  const handleFlip = () => {
    if (!flipped) {
      setFlipped(true);
    }
  };

  const handleRate = (rating: Rating) => {
    reviewMutation.mutate(rating);
  };

  const handleAskClaude = async () => {
    if (!question.trim() || isAsking) return;

    setIsAsking(true);
    try {
      const response = await askAboutNote(card.note.id, question.trim());
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
            <p className="text-light mb-2">{cardInfo.prompt}</p>
            <div className="hanzi hanzi-large">{card.note.hanzi}</div>
          </div>
        );

      case 'meaning_to_hanzi':
        return (
          <div className="text-center">
            <p className="text-light mb-2">{cardInfo.prompt}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 500 }}>{card.note.english}</div>
            <div className="mt-4">
              <input
                ref={inputRef}
                type="text"
                className="form-input"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder="Type in Chinese..."
                style={{ fontSize: '1.5rem', textAlign: 'center', maxWidth: '300px' }}
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
            <p className="text-light mb-2">{cardInfo.prompt}</p>
            <button
              className="btn btn-lg btn-secondary mb-4"
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
                style={{ fontSize: '1.5rem', textAlign: 'center', maxWidth: '300px' }}
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

  const renderBack = () => {
    const isCorrect =
      isTypingCard &&
      userAnswer.trim().toLowerCase() === card.note.hanzi.toLowerCase();

    return (
      <div className="text-center">
        {isTypingCard && userAnswer && (
          <div className={`mb-3 ${isCorrect ? 'text-success' : 'text-error'}`}>
            {isCorrect ? 'Correct!' : `Your answer: ${userAnswer}`}
          </div>
        )}

        <div className="hanzi hanzi-large mb-2">{card.note.hanzi}</div>
        <div className="pinyin mb-2">{card.note.pinyin}</div>
        <div style={{ fontSize: '1.75rem', fontWeight: 500 }}>{card.note.english}</div>

        <div className="flex gap-2 justify-center flex-wrap mt-3">
          <button
            className="btn btn-secondary"
            onClick={() => playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE)}
            disabled={isPlaying}
          >
            {isPlaying ? 'Playing...' : 'Play Audio'}
          </button>
          {audioBlob && (
            <button
              className="btn btn-secondary"
              onClick={playUserRecording}
            >
              Play My Recording
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => {
              setShowAskClaude(!showAskClaude);
              if (!showAskClaude) {
                setTimeout(() => questionInputRef.current?.focus(), 100);
              }
            }}
          >
            {showAskClaude ? 'Hide Chat' : 'Ask Claude'}
          </button>
        </div>

        {card.note.fun_facts && (
          <div
            className="mt-3 text-light"
            style={{
              fontSize: '0.875rem',
              backgroundColor: '#f3f4f6',
              padding: '0.5rem',
              borderRadius: '4px',
            }}
          >
            {card.note.fun_facts}
          </div>
        )}

        {/* Ask Claude Chat */}
        {showAskClaude && (
          <div
            className="mt-3"
            style={{
              textAlign: 'left',
              backgroundColor: '#f9fafb',
              padding: '0.75rem',
              borderRadius: '4px',
              maxHeight: '300px',
              overflowY: 'auto',
            }}
          >
            {conversation.length === 0 && (
              <p className="text-light" style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                Ask a question about this word...
              </p>
            )}

            {conversation.map((qa) => (
              <div key={qa.id} style={{ marginBottom: '0.75rem' }}>
                <div
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    color: 'white',
                    padding: '0.375rem 0.5rem',
                    borderRadius: '4px',
                    marginBottom: '0.375rem',
                    fontSize: '0.875rem',
                  }}
                >
                  {qa.question}
                </div>
                <div
                  style={{
                    backgroundColor: 'white',
                    padding: '0.375rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.875rem',
                    whiteSpace: 'pre-wrap',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  {qa.answer}
                </div>
              </div>
            ))}

            <div className="flex gap-2" style={{ marginTop: '0.5rem' }}>
              <input
                ref={questionInputRef}
                type="text"
                className="form-input"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g., How do I use this in a sentence?"
                style={{ fontSize: '0.875rem', flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAskClaude();
                }}
                disabled={isAsking}
              />
              <button
                className="btn btn-primary"
                onClick={handleAskClaude}
                disabled={!question.trim() || isAsking}
                style={{ padding: '0.375rem 0.75rem' }}
              >
                {isAsking ? '...' : 'Ask'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSpeakingCardButtons = () => {
    if (isRecording) {
      return (
        <button className="btn btn-error btn-lg" onClick={stopRecording}>
          Stop Recording
        </button>
      );
    }

    if (audioBlob) {
      return (
        <div className="flex flex-col gap-3 items-center">
          <div className="flex gap-2 justify-center">
            <button
              className="btn btn-secondary"
              onClick={() => {
                const url = URL.createObjectURL(audioBlob);
                new Audio(url).play();
              }}
            >
              Play Recording
            </button>
            <button className="btn btn-secondary" onClick={clearRecording}>
              Re-record
            </button>
          </div>
          <button className="btn btn-primary btn-lg" onClick={handleFlip}>
            Check Answer
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3 items-center">
        <button className="btn btn-primary btn-lg" onClick={startRecording}>
          Record Your Pronunciation
        </button>
        <button
          className="btn-link text-light"
          onClick={handleFlip}
          style={{ fontSize: '0.875rem' }}
        >
          Skip recording
        </button>
      </div>
    );
  };

  return (
    <div className="card" style={{ minHeight: '350px' }}>
      <div className="study-card">
        {!flipped ? (
          <>
            {renderFront()}
            <div className="mt-4 text-center">
              {isSpeakingCard ? (
                renderSpeakingCardButtons()
              ) : (
                <button className="btn btn-primary btn-lg" onClick={handleFlip}>
                  {isTypingCard ? 'Check Answer' : 'Show Answer'}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {renderBack()}
            <RatingButtons
              intervalPreviews={intervalPreviews}
              onRate={handleRate}
              disabled={reviewMutation.isPending}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function StudyPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isOnline, isInitialized } = useNetwork();

  const deckId = searchParams.get('deck') || undefined;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentCard, setCurrentCard] = useState<CardWithNote | null>(null);
  const [intervalPreviews, setIntervalPreviews] = useState<Record<Rating, IntervalPreview> | null>(null);
  const [counts, setCounts] = useState<QueueCounts>({ new: 0, learning: 0, review: 0 });
  const [recentNotes, setRecentNotes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [studyStarted, setStudyStarted] = useState(false);
  const [useOfflineMode, setUseOfflineMode] = useState(false);
  const [hasMoreNewCards, setHasMoreNewCards] = useState(false);
  const [ignoreDailyLimit, setIgnoreDailyLimit] = useState(false);

  // Online data hooks
  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
    enabled: isOnline,
  });

  // Offline data hooks
  const { decks: offlineDecks } = useOfflineDecks();
  const offlineQueueCounts = useOfflineQueueCounts(deckId);
  const offlineNextCard = useOfflineNextCard(
    studyStarted && useOfflineMode ? deckId : undefined,
    recentNotes.slice(-5)
  );

  // Decide which data to use
  const decks = isOnline && decksQuery.data ? decksQuery.data : offlineDecks;

  // Load next card (online mode)
  const loadNextCard = useCallback(async () => {
    if (useOfflineMode) {
      // In offline mode, data comes from hooks
      return;
    }
    setIsLoading(true);
    try {
      const result = await getNextCard(deckId, recentNotes.slice(-5), ignoreDailyLimit);
      setCurrentCard(result.card);
      setCounts(result.counts);
      setHasMoreNewCards(result.hasMoreNewCards || false);
      if (result.intervalPreviews) {
        setIntervalPreviews(result.intervalPreviews);
      }
      if (result.card) {
        setRecentNotes(prev => [...prev.slice(-4), result.card!.note_id]);
      }
    } catch (error) {
      console.error('Failed to load next card:', error);
      // If online request fails, switch to offline mode
      if (!isOnline) {
        setUseOfflineMode(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [deckId, recentNotes, useOfflineMode, isOnline, ignoreDailyLimit]);

  // Handle offline mode card updates
  useEffect(() => {
    if (useOfflineMode && studyStarted && offlineNextCard.card) {
      setCurrentCard(offlineNextCard.card);
      setCounts(offlineNextCard.counts);
      if (offlineNextCard.intervalPreviews) {
        setIntervalPreviews(offlineNextCard.intervalPreviews);
      }
      setIsLoading(false);
    } else if (useOfflineMode && studyStarted && !offlineNextCard.isLoading && !offlineNextCard.card) {
      setCurrentCard(null);
      setIsLoading(false);
    }
  }, [useOfflineMode, studyStarted, offlineNextCard.card, offlineNextCard.counts, offlineNextCard.intervalPreviews, offlineNextCard.isLoading]);

  // Initial load of counts
  useEffect(() => {
    if (!studyStarted) {
      if (isOnline) {
        getNextCard(deckId, []).then(result => {
          setCounts(result.counts);
          setIsLoading(false);
        }).catch(() => {
          // Fall back to offline counts
          setCounts(offlineQueueCounts.counts);
          setIsLoading(false);
        });
      } else {
        // Offline - use IndexedDB counts
        setCounts(offlineQueueCounts.counts);
        setIsLoading(false);
        setUseOfflineMode(true);
      }
    }
  }, [deckId, studyStarted, isOnline, offlineQueueCounts.counts]);

  const handleStartStudy = async () => {
    setStudyStarted(true);
    setRecentNotes([]);

    if (isOnline && !useOfflineMode) {
      try {
        // Create a session for tracking (optional, for review history)
        const session = await startSession(deckId);
        setSessionId(session.id);
        await loadNextCard();
      } catch (error) {
        console.error('Failed to start session, switching to offline mode:', error);
        setUseOfflineMode(true);
        setIsLoading(false);
      }
    } else {
      // Offline mode - no session needed
      setUseOfflineMode(true);
      setIsLoading(false);
    }
  };

  const handleCardComplete = (newCounts: QueueCounts) => {
    if (useOfflineMode) {
      // In offline mode, update recent notes and let the hook handle the next card
      if (currentCard) {
        setRecentNotes(prev => [...prev.slice(-4), currentCard.note_id]);
      }
      // Counts will be updated by the hook
    } else {
      setCounts(newCounts);
      loadNextCard();
    }
  };

  const handleEndSession = () => {
    setStudyStarted(false);
    setSessionId(null);
    setCurrentCard(null);
    setRecentNotes([]);
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  // Show deck selection if study hasn't started
  if (!studyStarted) {
    if (isLoading || (isOnline && decksQuery.isLoading && !isInitialized)) {
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
    const handleStudyMoreNewCards = async () => {
      setIgnoreDailyLimit(true);
      setIsLoading(true);
      try {
        const result = await getNextCard(deckId, [], true);
        setCurrentCard(result.card);
        setCounts(result.counts);
        setHasMoreNewCards(result.hasMoreNewCards || false);
        if (result.intervalPreviews) {
          setIntervalPreviews(result.intervalPreviews);
        }
        if (result.card) {
          setRecentNotes([result.card.note_id]);
        }
      } finally {
        setIsLoading(false);
      }
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

  // Active study
  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '600px' }}>
        {/* Header with queue counts */}
        <div className="flex justify-between items-center mb-4">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (confirm('End this study session?')) {
                handleEndSession();
              }
            }}
          >
            End
          </button>
          <QueueCountsHeader counts={counts} activeQueue={currentCard?.queue} />
        </div>

        {/* Current Card */}
        {isLoading ? (
          <Loading />
        ) : currentCard && intervalPreviews ? (
          <StudyCard
            key={currentCard.id}
            card={currentCard}
            intervalPreviews={intervalPreviews}
            sessionId={sessionId}
            onComplete={handleCardComplete}
            isOffline={useOfflineMode}
          />
        ) : null}
      </div>
    </div>
  );
}
