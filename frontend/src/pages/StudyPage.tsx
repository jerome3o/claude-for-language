import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import {
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
import ReactMarkdown from 'react-markdown';

// Character diff component for typed answers (Anki-style)
function AnswerDiff({ userAnswer, correctAnswer }: { userAnswer: string; correctAnswer: string }) {
  // Compare character by character
  const maxLen = Math.max(userAnswer.length, correctAnswer.length);
  const userChars: { char: string; correct: boolean }[] = [];
  const correctChars: { char: string; matched: boolean }[] = [];

  for (let i = 0; i < maxLen; i++) {
    const userChar = userAnswer[i] || '';
    const correctChar = correctAnswer[i] || '';
    const isMatch = userChar === correctChar;

    if (i < userAnswer.length) {
      userChars.push({ char: userChar, correct: isMatch });
    }
    if (i < correctAnswer.length) {
      correctChars.push({ char: correctChar, matched: isMatch });
    }
  }

  const isFullyCorrect = userAnswer === correctAnswer;

  if (isFullyCorrect) {
    return (
      <div className="answer-diff">
        <div className="answer-diff-row">
          {userChars.map((c, i) => (
            <span key={i} className="diff-char diff-correct">{c.char}</span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="answer-diff">
      <div className="answer-diff-row">
        {userChars.map((c, i) => (
          <span key={i} className={`diff-char ${c.correct ? 'diff-correct' : 'diff-wrong'}`}>{c.char}</span>
        ))}
      </div>
      <div className="answer-diff-arrow">↓</div>
      <div className="answer-diff-row">
        {correctChars.map((c, i) => (
          <span key={i} className={`diff-char ${c.matched ? 'diff-correct' : 'diff-expected'}`}>{c.char}</span>
        ))}
      </div>
    </div>
  );
}

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

// Deck row with its own queue counts (uses hook for reactive updates)
function DeckStudyRow({ deck }: { deck: { id: string; name: string } }) {
  const counts = useOfflineQueueCounts(deck.id, false);
  const totalDue = counts.counts.new + counts.counts.learning + counts.counts.review;

  return (
    <Link to={`/study?deck=${deck.id}`} className="deck-card">
      <div className="deck-card-title">{deck.name}</div>
      {totalDue > 0 && (
        <div className="deck-card-stats">
          <QueueCountsHeader counts={counts.counts} />
        </div>
      )}
    </Link>
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
  console.log('[StudyCard] Render', {
    cardId: card.id,
    cardType: card.card_type,
    noteId: card.note.id,
    hanzi: card.note.hanzi,
    timestamp: new Date().toISOString(),
  });

  const [flipped, setFlipped] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [startTime] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const typingFooterRef = useRef<HTMLDivElement>(null);

  // Ask Claude state
  const [showAskClaude, setShowAskClaude] = useState(false);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState<NoteQuestion[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const questionInputRef = useRef<HTMLInputElement>(null);

  const { isRecording, audioBlob, startRecording, stopRecording, clearRecording } =
    useAudioRecorder();
  const { isPlaying, play: playAudio } = useNoteAudio();

  // Track which card we've played audio for to prevent re-triggering
  const playedAudioForCardRef = useRef<string | null>(null);

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
  // Use ref to prevent re-triggering when component re-renders with same card
  useEffect(() => {
    console.log('[StudyCard] Audio effect running', {
      cardType: card.card_type,
      cardId: card.id,
      flipped,
      audioUrl: card.note.audio_url,
      alreadyPlayed: playedAudioForCardRef.current === card.id,
    });

    if (card.card_type === 'audio_to_hanzi' && !flipped) {
      // Only play if we haven't already played for this card
      if (playedAudioForCardRef.current !== card.id) {
        console.log('[StudyCard] Triggering auto-play for audio card');
        playedAudioForCardRef.current = card.id;
        playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE);
      } else {
        console.log('[StudyCard] Skipping auto-play, already played for this card');
      }
    }

    return () => {
      // Only stop audio if we're unmounting or switching cards
      // Don't stop on re-renders of the same card
    };
  }, [card.id, card.card_type, card.note.audio_url, card.note.hanzi, flipped, playAudio]);

  // Reset the played audio ref when card changes
  useEffect(() => {
    return () => {
      playedAudioForCardRef.current = null;
    };
  }, [card.id]);

  // Handle keyboard visibility for typing cards using VisualViewport API
  useEffect(() => {
    if (!isTypingCard || flipped) return;

    const footer = typingFooterRef.current;
    if (!footer) return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleViewportChange = () => {
      // Calculate how much the keyboard is covering
      const keyboardHeight = window.innerHeight - viewport.height;

      if (keyboardHeight > 100) {
        // Keyboard is open - move footer up
        // Account for any offset from the top (scrolled page)
        const offsetTop = viewport.offsetTop;
        footer.style.transform = `translateY(-${keyboardHeight - offsetTop}px)`;
      } else {
        // Keyboard is closed
        footer.style.transform = 'translateY(0)';
      }
    };

    viewport.addEventListener('resize', handleViewportChange);
    viewport.addEventListener('scroll', handleViewportChange);

    // Initial check
    handleViewportChange();

    return () => {
      viewport.removeEventListener('resize', handleViewportChange);
      viewport.removeEventListener('scroll', handleViewportChange);
      footer.style.transform = 'translateY(0)';
    };
  }, [isTypingCard, flipped]);

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
      recordingBlob: audioBlob || undefined, // Recording will be uploaded after sync
    });

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
    return (
      <div className="text-center">
        {isTypingCard && userAnswer ? (
          // Show character-by-character diff for typed answers
          <div className="mb-3">
            <AnswerDiff userAnswer={userAnswer.trim()} correctAnswer={card.note.hanzi} />
          </div>
        ) : (
          // Show just the hanzi for non-typing cards
          <div className="hanzi hanzi-large mb-1">{card.note.hanzi}</div>
        )}

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

  const sendQuickQuestion = async (questionText: string) => {
    setQuestion(questionText);
    // Need to call the API directly since setQuestion is async
    setIsAsking(true);
    try {
      const context = isTypingCard && userAnswer ? {
        userAnswer: userAnswer,
        correctAnswer: card.note.hanzi,
        cardType: card.card_type,
      } : undefined;

      const response = await askAboutNote(card.note.id, questionText, context);
      setConversation((prev) => [...prev, response]);
      setQuestion('');
    } catch (error) {
      console.error('Failed to ask Claude:', error);
    } finally {
      setIsAsking(false);
    }
  };

  const renderAskClaudeModal = () => {
    if (!showAskClaude) return null;

    const quickActions = [
      { label: 'Use in sentence', question: 'Please use this word in a few example sentences with pinyin and English translations.' },
      { label: 'Explain characters', question: 'Please break down each character in this word, explaining the radicals, components, and individual meanings.' },
      { label: 'Related words', question: 'What are some related words or phrases I should learn alongside this one?' },
    ];

    return (
      <div className="modal-overlay claude-modal-overlay">
        <div className="modal claude-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">Ask about: {card.note.hanzi}</div>
            <button className="modal-close" onClick={() => setShowAskClaude(false)}>×</button>
          </div>

          <div className="claude-modal-content">
            {conversation.length === 0 && !isAsking && (
              <div className="claude-quick-actions">
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    className="btn btn-secondary btn-sm"
                    onClick={() => sendQuickQuestion(action.question)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            {conversation.map((qa) => (
              <div key={qa.id} className="claude-message-pair">
                <div className="claude-user-message">
                  {qa.question}
                </div>
                <div className="claude-response">
                  <ReactMarkdown>{qa.answer}</ReactMarkdown>
                </div>
              </div>
            ))}

            {isAsking && (
              <div className="claude-loading">Thinking...</div>
            )}
          </div>

          <div className="claude-input-row">
            <input
              ref={questionInputRef}
              type="text"
              className="form-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
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
              Ask
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

  // Render typing footer (input + button) for typing cards
  const renderTypingFooter = () => {
    const placeholder = card.card_type === 'audio_to_hanzi' ? 'Type what you hear...' : 'Type in Chinese...';
    return (
      <div className="study-typing-footer" ref={typingFooterRef}>
        <input
          ref={inputRef}
          type="text"
          className="form-input"
          value={userAnswer}
          onChange={(e) => setUserAnswer(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFlip();
          }}
        />
        <button className="btn btn-primary" onClick={handleFlip}>
          Check Answer
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
        <div
          className="study-card-content"
          style={isTypingCard && !flipped ? { paddingBottom: '8rem' } : undefined}
        >
          {!flipped ? (
            <>
              <div className={`study-card-main ${isTypingCard ? 'study-card-main--typing' : ''}`}>
                {renderFront()}
              </div>
              {!isTypingCard && (
                <div className="study-card-actions text-center">
                  {isSpeakingCard ? (
                    renderSpeakingCardButtons()
                  ) : (
                    <button className="btn btn-primary" onClick={handleFlip}>
                      Show Answer
                    </button>
                  )}
                </div>
              )}
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

        {/* Typing footer - separate from card content, stays above keyboard */}
        {isTypingCard && !flipped && renderTypingFooter()}
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
  const { decks, triggerSync } = useOfflineDecks();
  const [isSyncing, setIsSyncing] = useState(false);
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

  // Debug logging
  console.log('[StudyPage] Render', {
    studyStarted,
    currentCardId: currentCard?.id,
    currentCardType: currentCard?.card_type,
    currentNoteHanzi: currentCard?.note?.hanzi,
    counts,
    recentNotesLength: recentNotes.length,
    isLoading,
    timestamp: new Date().toISOString(),
  });

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
                  <DeckStudyRow key={deck.id} deck={deck} />
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
                <div className="flex gap-2 justify-center">
                  <button
                    className="btn btn-secondary"
                    onClick={async () => {
                      setIsSyncing(true);
                      await triggerSync();
                      setIsSyncing(false);
                    }}
                    disabled={isSyncing}
                  >
                    {isSyncing ? 'Syncing...' : 'Refresh'}
                  </button>
                  <Link to="/decks" className="btn btn-primary">
                    View Decks
                  </Link>
                </div>
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
