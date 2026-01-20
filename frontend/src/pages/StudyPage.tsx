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
import { getCardReviewEvents, LocalReviewEvent } from '../db/database';
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
function DeckStudyRow({ deck, isSelected }: { deck: { id: string; name: string }; isSelected?: boolean }) {
  const counts = useOfflineQueueCounts(deck.id);
  const totalDue = counts.counts.new + counts.counts.learning + counts.counts.review;

  return (
    <Link
      to={`/study?deck=${deck.id}`}
      className="deck-card"
      style={isSelected ? { backgroundColor: '#e0e7ff', borderColor: '#6366f1' } : undefined}
    >
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

  // Debug modal state
  const [showDebug, setShowDebug] = useState(false);
  const [reviewHistory, setReviewHistory] = useState<LocalReviewEvent[]>([]);

  const { isRecording, audioBlob, startRecording, stopRecording, clearRecording } =
    useAudioRecorder();
  const { isPlaying, play: playAudio } = useNoteAudio();

  // Track which card we've played audio for to prevent re-triggering
  const playedAudioForRef = useRef<string | null>(null);

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
  // Note: useOfflineNextCard guarantees card.note_id === card.note.id (data consistency)
  useEffect(() => {
    if (card.card_type === 'audio_to_hanzi' && !flipped) {
      // Only play if we haven't already played for this card
      if (playedAudioForRef.current !== card.id) {
        console.log('[StudyCard] Auto-playing audio for card', {
          cardId: card.id,
          hanzi: card.note.hanzi,
        });
        playedAudioForRef.current = card.id;
        playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE, card.note.updated_at);
      }
    }
  }, [card.id, card.card_type, card.note.audio_url, card.note.hanzi, flipped, playAudio]);

  // Reset the played audio ref when card changes
  useEffect(() => {
    return () => {
      playedAudioForRef.current = null;
    };
  }, [card.id]);

  // Load review history when debug modal opens
  useEffect(() => {
    if (showDebug) {
      getCardReviewEvents(card.id).then(setReviewHistory);
    }
  }, [showDebug, card.id]);


  // Auto-play audio when answer is revealed
  useEffect(() => {
    if (flipped) {
      // Small delay to ensure any previous audio is fully stopped
      const timer = setTimeout(() => {
        playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE, card.note.updated_at);
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
              onClick={() => playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE, card.note.updated_at)}
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

  const renderDebugModal = () => {
    if (!showDebug) return null;

    const queueNames = ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'];
    const ratingNames = ['Again', 'Hard', 'Good', 'Easy'];

    // Format timestamp nicely
    const formatTime = (isoString: string) => {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
      return `${Math.floor(diffMins / 1440)}d ago`;
    };

    // Calculate what interval each rating would give from the CURRENT state
    const currentPreviews = intervalPreviews;

    return (
      <div className="modal-overlay" onClick={() => setShowDebug(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
          <div className="modal-header">
            <div className="modal-title">Debug Info: {card.note.hanzi}</div>
            <button className="modal-close" onClick={() => setShowDebug(false)}>×</button>
          </div>

          <div className="modal-body" style={{ fontSize: '0.8125rem' }}>
            {/* Current Card State */}
            <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#f3f4f6', borderRadius: '6px' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Current Card State</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                <div><strong>Card ID:</strong> {card.id.slice(0, 8)}...</div>
                <div><strong>Type:</strong> {card.card_type}</div>
                <div><strong>Queue:</strong> <span style={{
                  color: card.queue === 0 ? '#3b82f6' : card.queue === 2 ? '#22c55e' : '#ef4444',
                  fontWeight: 600
                }}>{queueNames[card.queue]}</span></div>
                <div><strong>Learning Step:</strong> {card.learning_step}</div>
                <div><strong>Ease:</strong> {(card.ease_factor * 100).toFixed(0)}%</div>
                <div><strong>Interval:</strong> {card.interval}d</div>
                <div><strong>Reps:</strong> {card.repetitions}</div>
                <div><strong>Due:</strong> {card.due_timestamp
                  ? formatTime(new Date(card.due_timestamp).toISOString())
                  : card.next_review_at
                    ? formatTime(card.next_review_at)
                    : 'N/A'
                }</div>
              </div>
            </div>

            {/* What each rating would do */}
            {currentPreviews && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef3c7', borderRadius: '6px' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Rating Preview (if rated now)</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', textAlign: 'center' }}>
                  {([0, 1, 2, 3] as Rating[]).map((r) => (
                    <div key={r} style={{
                      padding: '0.25rem',
                      backgroundColor: RATING_INFO[r].color + '20',
                      borderRadius: '4px'
                    }}>
                      <div style={{ fontWeight: 600 }}>{ratingNames[r]}</div>
                      <div>{currentPreviews[r].intervalText}</div>
                      <div style={{ fontSize: '0.7rem', color: '#666' }}>{queueNames[currentPreviews[r].queue]}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Review History */}
            <div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>
                Review History ({reviewHistory.length} reviews)
              </h4>
              {reviewHistory.length === 0 ? (
                <div style={{ color: '#666', fontStyle: 'italic' }}>No reviews yet</div>
              ) : (
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {reviewHistory.slice().reverse().map((event, idx) => (
                    <div
                      key={event.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.5rem',
                        backgroundColor: idx % 2 === 0 ? '#f9fafb' : 'white',
                        borderRadius: '4px'
                      }}
                    >
                      <div>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '4px',
                          backgroundColor: RATING_INFO[event.rating as Rating].color,
                          color: 'white',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          marginRight: '0.5rem'
                        }}>
                          {ratingNames[event.rating]}
                        </span>
                        {event.time_spent_ms && (
                          <span style={{ color: '#666' }}>
                            {(event.time_spent_ms / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>
                      <div style={{ color: '#666' }}>
                        {formatTime(event.reviewed_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
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
          onClick={() => playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE, card.note.updated_at)}
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
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setShowDebug(true)}
          title="Show debug info"
        >
          🔍
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

  // Render typing input and button for typing cards (inside card flow)
  const renderTypingActions = () => {
    const placeholder = card.card_type === 'audio_to_hanzi' ? 'Type what you hear...' : 'Type in Chinese...';
    return (
      <div className="study-card-actions">
        <input
          ref={inputRef}
          type="text"
          className="form-input study-typing-input"
          value={userAnswer}
          onChange={(e) => setUserAnswer(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFlip();
          }}
        />
        <button className="btn btn-primary btn-block" onClick={handleFlip}>
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
        <div className="study-card-content">
          {!flipped ? (
            <>
              <div className={`study-card-main ${isTypingCard ? 'study-card-main--typing' : ''}`}>
                {renderFront()}
              </div>
              <div className="study-card-actions text-center">
                {isTypingCard ? (
                  renderTypingActions()
                ) : isSpeakingCard ? (
                  renderSpeakingCardButtons()
                ) : (
                  <button className="btn btn-primary" onClick={handleFlip}>
                    Show Answer
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

      {/* Debug Modal */}
      {renderDebugModal()}
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

  // Bonus new cards - persisted in localStorage per deck, resets daily
  const getTodayKey = (forDeckId?: string) =>
    `bonusNewCards_${forDeckId || 'all'}_${new Date().toISOString().slice(0, 10)}`;

  const getStoredBonus = (forDeckId?: string): number => {
    try {
      const stored = localStorage.getItem(getTodayKey(forDeckId));
      return stored ? parseInt(stored, 10) || 0 : 0;
    } catch {
      return 0;
    }
  };

  const [bonusNewCards, setBonusNewCards] = useState(() => getStoredBonus(deckId));

  // Re-read bonus when deckId changes
  useEffect(() => {
    setBonusNewCards(getStoredBonus(deckId));
  }, [deckId]);

  // Persist bonus to localStorage whenever it changes
  useEffect(() => {
    try {
      // Clean up old keys (from previous days)
      const todayDate = new Date().toISOString().slice(0, 10);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('bonusNewCards_') && !key.endsWith(todayDate)) {
          localStorage.removeItem(key);
        }
      }
      // Save current bonus for this deck
      localStorage.setItem(getTodayKey(deckId), String(bonusNewCards));
    } catch {
      // localStorage might be unavailable
    }
  }, [bonusNewCards, deckId]);

  // All data comes from offline/local-first hooks
  const { decks, triggerSync } = useOfflineDecks();
  const [isSyncing, setIsSyncing] = useState(false);
  const offlineQueueCounts = useOfflineQueueCounts(deckId, bonusNewCards);
  const offlineNextCard = useOfflineNextCard(
    studyStarted ? deckId : undefined,
    recentNotes.slice(-5),
    bonusNewCards
  );
  const hasMoreNewCards = useHasMoreNewCards(deckId, bonusNewCards);

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
    // Note: bonusNewCards persists across sessions and resets at end of day
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

          {/* Deck Selection - always visible */}
          <div className="card mb-4">
            <h2 className="mb-3">Select a Deck</h2>
            <div className="flex flex-col gap-2">
              <Link
                to="/study"
                className="deck-card"
                style={!deckId ? { backgroundColor: '#e0e7ff', borderColor: '#6366f1' } : undefined}
              >
                <div className="deck-card-title">All Decks</div>
                <div className="deck-card-stats">
                  <QueueCountsHeader counts={counts} />
                </div>
              </Link>
              {decks.map((deck) => (
                <DeckStudyRow key={deck.id} deck={deck} isSelected={deckId === deck.id} />
              ))}
            </div>
          </div>

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
                  <Link to="/" className="btn btn-primary">
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
    // Number of bonus cards to add each time the user clicks "Study More"
    const BONUS_NEW_CARDS_INCREMENT = 10;

    console.log('[StudyPage] All Done screen - hasMoreNewCards:', hasMoreNewCards, 'bonusNewCards:', bonusNewCards);

    const handleStudyMoreNewCards = () => {
      console.log('[StudyPage] Study More button clicked - adding', BONUS_NEW_CARDS_INCREMENT, 'bonus new cards');
      // Add more new cards to today's limit
      setBonusNewCards(prev => prev + BONUS_NEW_CARDS_INCREMENT);
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
                ? `You've finished your daily limit${bonusNewCards > 0 ? ` (+${bonusNewCards} bonus)` : ''}. Want to study more?`
                : "No more cards due right now."}
            </p>
            <div className="flex flex-col gap-3 items-center mt-4">
              {hasMoreNewCards ? (
                <button
                  className="btn btn-primary btn-lg"
                  onClick={handleStudyMoreNewCards}
                >
                  Study {BONUS_NEW_CARDS_INCREMENT} More New Cards
                </button>
              ) : (
                <p className="text-light" style={{ fontSize: '0.75rem' }}>
                  (No additional new cards available)
                </p>
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
