import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import {
  getDueCards,
  getDecks,
  startSession,
  recordReview,
  completeSession,
  uploadRecording,
  API_BASE,
} from '../api/client';
import { Loading, EmptyState } from '../components/Loading';
import { CardWithNote, Rating, CARD_TYPE_INFO, RATING_INFO } from '../types';
import { useAudioRecorder, useNoteAudio } from '../hooks/useAudio';

function StudyCard({
  card,
  sessionId,
  onComplete,
}: {
  card: CardWithNote;
  sessionId: string;
  onComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const [flipped, setFlipped] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [startTime] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  const { isRecording, audioBlob, startRecording, stopRecording, clearRecording } =
    useAudioRecorder();
  const { isPlaying, play: playAudio, stop: stopAudio } = useNoteAudio();

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

  const reviewMutation = useMutation({
    mutationFn: async (rating: Rating) => {
      const timeSpent = Date.now() - startTime;
      const result = await recordReview(sessionId, {
        card_id: card.id,
        rating,
        time_spent_ms: timeSpent,
        user_answer: userAnswer || undefined,
      });

      // Upload recording if exists
      if (audioBlob && result.review.id) {
        await uploadRecording(result.review.id, audioBlob);
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dueCards'] });
      onComplete();
    },
  });

  const handleFlip = () => {
    if (isTypingCard && !flipped) {
      // Check answer before flipping
      setFlipped(true);
    } else if (!flipped) {
      setFlipped(true);
    }
  };

  const handleRate = (rating: Rating) => {
    reviewMutation.mutate(rating);
  };

  const renderFront = () => {
    switch (card.card_type) {
      case 'hanzi_to_meaning':
        return (
          <div className="text-center">
            <p className="text-light mb-2">{cardInfo.prompt}</p>
            <div className="hanzi hanzi-large">{card.note.hanzi}</div>
            {isSpeakingCard && (
              <div className="mt-4">
                {isRecording ? (
                  <button className="btn btn-error" onClick={stopRecording}>
                    Stop Recording
                  </button>
                ) : audioBlob ? (
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
                ) : (
                  <button className="btn btn-primary" onClick={startRecording}>
                    Record Your Pronunciation
                  </button>
                )}
              </div>
            )}
          </div>
        );

      case 'meaning_to_hanzi':
        return (
          <div className="text-center">
            <p className="text-light mb-2">{cardInfo.prompt}</p>
            <div style={{ fontSize: '2rem', fontWeight: 500 }}>{card.note.english}</div>
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
        <div style={{ fontSize: '1.25rem' }}>{card.note.english}</div>

        <button
          className="btn btn-secondary mt-3"
          onClick={() => playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE)}
          disabled={isPlaying}
        >
          {isPlaying ? 'Playing...' : 'Play Audio'}
        </button>

        {card.note.fun_facts && (
          <div
            className="mt-3 text-light"
            style={{
              fontSize: '0.875rem',
              backgroundColor: '#f3f4f6',
              padding: '0.75rem',
              borderRadius: '8px',
            }}
          >
            {card.note.fun_facts}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card" style={{ minHeight: '400px' }}>
      <div className="study-card">
        {!flipped ? (
          <>
            {renderFront()}
            <div className="mt-4 text-center">
              <button className="btn btn-primary btn-lg" onClick={handleFlip}>
                {isTypingCard ? 'Check Answer' : 'Show Answer'}
              </button>
            </div>
          </>
        ) : (
          <>
            {renderBack()}
            <div className="mt-4">
              <p className="text-center text-light mb-2">How well did you know this?</p>
              <div className="rating-buttons">
                {([0, 1, 2, 3] as Rating[]).map((rating) => (
                  <button
                    key={rating}
                    className={`rating-btn ${RATING_INFO[rating].label.toLowerCase()}`}
                    onClick={() => handleRate(rating)}
                    disabled={reviewMutation.isPending}
                  >
                    {RATING_INFO[rating].label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function StudyPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const deckId = searchParams.get('deck') || undefined;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cards, setCards] = useState<CardWithNote[]>([]);
  const [completed, setCompleted] = useState(false);

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
  });

  const dueCardsQuery = useQuery({
    queryKey: ['dueCards', deckId],
    queryFn: () => getDueCards({ deckId, limit: 50 }),
    enabled: !sessionId,
  });

  const startSessionMutation = useMutation({
    mutationFn: () => startSession(deckId),
    onSuccess: (session) => {
      setSessionId(session.id);
      setCards(dueCardsQuery.data || []);
    },
  });

  const completeSessionMutation = useMutation({
    mutationFn: () => completeSession(sessionId!),
    onSuccess: () => {
      setCompleted(true);
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const handleStartStudy = () => {
    startSessionMutation.mutate();
  };

  const handleCardComplete = () => {
    if (currentIndex < cards.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      completeSessionMutation.mutate();
    }
  };

  // Show deck selection if no session started
  if (!sessionId) {
    if (dueCardsQuery.isLoading || decksQuery.isLoading) {
      return <Loading />;
    }

    const decks = decksQuery.data || [];
    const dueCards = dueCardsQuery.data || [];

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
                    <span>{dueCards.length} cards due</span>
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
          {dueCards.length === 0 ? (
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
              <h2 className="mb-2">{dueCards.length} cards due</h2>
              <p className="text-light mb-4">
                {deckId
                  ? `From "${decks.find((d) => d.id === deckId)?.name || 'this deck'}"`
                  : 'From all decks'}
              </p>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleStartStudy}
                disabled={startSessionMutation.isPending}
              >
                {startSessionMutation.isPending ? 'Starting...' : 'Start Studying'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Study completed
  if (completed) {
    return (
      <div className="page">
        <div className="container">
          <div className="card text-center">
            <div style={{ fontSize: '4rem' }}>🎉</div>
            <h1 className="mt-2">Session Complete!</h1>
            <p className="text-light mt-2">
              You studied {cards.length} card{cards.length !== 1 ? 's' : ''}
            </p>
            <div className="flex gap-2 justify-center mt-4">
              <Link to={`/study/review/${sessionId}`} className="btn btn-secondary">
                Review Session
              </Link>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSessionId(null);
                  setCurrentIndex(0);
                  setCards([]);
                  setCompleted(false);
                  queryClient.invalidateQueries({ queryKey: ['dueCards'] });
                }}
              >
                Study More
              </button>
              <Link to="/" className="btn btn-secondary">
                Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active study session
  const currentCard = cards[currentIndex];

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '600px' }}>
        {/* Progress */}
        <div className="flex justify-between items-center mb-4">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (confirm('End this study session?')) {
                completeSessionMutation.mutate();
              }
            }}
          >
            End Session
          </button>
          <div className="text-light">
            {currentIndex + 1} / {cards.length}
          </div>
        </div>

        {/* Progress bar */}
        <div
          style={{
            height: '4px',
            backgroundColor: '#e5e7eb',
            borderRadius: '2px',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              height: '100%',
              backgroundColor: 'var(--color-primary)',
              borderRadius: '2px',
              width: `${((currentIndex + 1) / cards.length) * 100}%`,
              transition: 'width 0.3s',
            }}
          />
        </div>

        {/* Current Card */}
        {currentCard && (
          <StudyCard
            key={currentCard.id + currentIndex}
            card={currentCard}
            sessionId={sessionId}
            onComplete={handleCardComplete}
          />
        )}
      </div>
    </div>
  );
}
