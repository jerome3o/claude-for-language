import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  askAboutNote,
  startSession,
  API_BASE,
  NoteQuestionWithTools,
  AskToolResult,
  getMyRelationships,
  createTutorReviewRequest,
  generateNoteAudio,
  GenerateAudioOptions,
} from '../api/client';
import { Loading } from '../components/Loading';
import { Confetti } from '../components/Confetti';
import {
  CardWithNote,
  Rating,
  CARD_TYPE_INFO,
  RATING_INFO,
  QueueCounts,
  IntervalPreview,
  TutorRelationshipWithUsers,
  getOtherUserInRelationship,
  MINIMAX_VOICES,
  DEFAULT_MINIMAX_VOICE,
  Note,
} from '../types';
import { useAudioRecorder, useNoteAudio } from '../hooks/useAudio';
import { useTranscription } from '../hooks/useTranscription';
import { useNetwork } from '../contexts/NetworkContext';
import { useAuth } from '../contexts/AuthContext';
import { useStudySession } from '../hooks/useStudySession';
import { getCardReviewEvents, LocalReviewEvent, db } from '../db/database';
import { useLiveQuery } from 'dexie-react-hooks';
import ReactMarkdown from 'react-markdown';
import { pinyin } from 'pinyin-pro';

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

  // Generate pinyin for user's answer
  const userPinyin = pinyin(userAnswer, { toneType: 'symbol', type: 'string' });

  if (isFullyCorrect) {
    return (
      <div className="answer-diff">
        <div className="answer-diff-row">
          {userChars.map((c, i) => (
            <span key={i} className="diff-char diff-correct">{c.char}</span>
          ))}
        </div>
        <div className="answer-diff-pinyin">{userPinyin}</div>
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
      <div className="answer-diff-pinyin">{userPinyin}</div>
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
    <div className="mt-2">
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

// Data needed to show the flag modal (persisted in parent to survive card transitions)
interface FlagModalData {
  noteId: string;
  cardId: string;
  hanzi: string;
  pinyin: string;
  english: string;
  // Rating data to submit when modal closes
  rating: Rating;
  timeSpentMs: number;
  userAnswer?: string;
  recordingBlob?: Blob;
}

function StudyCard({
  card,
  intervalPreviews,
  counts,
  tutors,
  isRating,
  onRate,
  onEnd,
  onShowFlagModal,
  onUpdateNote,
  onDeleteCurrentCard,
}: {
  card: CardWithNote;
  intervalPreviews: Record<Rating, IntervalPreview>;
  counts: QueueCounts;
  tutors: TutorRelationshipWithUsers[];
  isRating: boolean;
  onRate: (rating: Rating, timeSpentMs: number, userAnswer?: string, recordingBlob?: Blob) => void;
  onEnd: () => void;
  onShowFlagModal: (data: FlagModalData) => void;
  onUpdateNote: (updatedNote: Partial<Note>) => void;
  onDeleteCurrentCard: () => void;
}) {
  const { isOnline } = useNetwork();

  const [flipped, setFlipped] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [startTime] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  // Ask Claude state
  const [showAskClaude, setShowAskClaude] = useState(false);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState<NoteQuestionWithTools[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [cardDeleted, setCardDeleted] = useState(false);
  const questionInputRef = useRef<HTMLInputElement>(null);

  // Debug modal state
  const [showDebug, setShowDebug] = useState(false);
  const [reviewHistory, setReviewHistory] = useState<LocalReviewEvent[]>([]);
  const [isRegeneratingAudio, setIsRegeneratingAudio] = useState(false);
  const [audioSpeed, setAudioSpeed] = useState(0.8);
  const [audioProvider, setAudioProvider] = useState<'minimax' | 'gtts' | ''>('');
  const [selectedVoice, setSelectedVoice] = useState<string>(DEFAULT_MINIMAX_VOICE);

  // Get deck info for debug modal
  const deckInfo = useLiveQuery(
    () => card.note.deck_id ? db.decks.get(card.note.deck_id) : undefined,
    [card.note.deck_id]
  );

  // Flag for tutor checkbox state (modal is handled by parent)
  const [flagForTutor, setFlagForTutor] = useState(false);

  const { isRecording, audioBlob, startRecording, stopRecording, clearRecording } =
    useAudioRecorder();
  const { isPlaying, play: playAudio } = useNoteAudio();
  const {
    isTranscribing,
    comparison: transcriptionComparison,
    isOffline: transcriptionOffline,
    error: transcriptionError,
    transcribe,
  } = useTranscription();

  // Track which card we've played audio for to prevent re-triggering
  const playedAudioForRef = useRef<string | null>(null);

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


  // Trigger transcription when speaking card is flipped with a recording
  useEffect(() => {
    if (flipped && isSpeakingCard && audioBlob) {
      transcribe(audioBlob, card.note.hanzi, card.note.pinyin);
    }
  }, [flipped, isSpeakingCard, audioBlob, card.note.hanzi, card.note.pinyin, transcribe]);

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

  const handleRate = (rating: Rating) => {
    const timeSpent = Date.now() - startTime;

    // If flag is checked, show modal in parent (survives card transition)
    if (flagForTutor && tutors.length > 0 && isOnline) {
      onShowFlagModal({
        noteId: card.note.id,
        cardId: card.id,
        hanzi: card.note.hanzi,
        pinyin: card.note.pinyin,
        english: card.note.english,
        rating,
        timeSpentMs: timeSpent,
        userAnswer: userAnswer || undefined,
        recordingBlob: audioBlob || undefined,
      });
      // The flag modal will call onRate when it closes
      return;
    }

    // Call parent's rate function - handles both state update and DB write
    onRate(rating, timeSpent, userAnswer || undefined, audioBlob || undefined);
  };

  const processToolResults = (toolResults: AskToolResult[]) => {
    for (const result of toolResults) {
      if (!result.success) continue;
      switch (result.tool) {
        case 'edit_current_card': {
          const note = result.data?.note as Partial<Note> | undefined;
          if (note) {
            onUpdateNote({
              hanzi: note.hanzi,
              pinyin: note.pinyin,
              english: note.english,
              fun_facts: note.fun_facts,
              updated_at: note.updated_at,
            });
            // Also update in IndexedDB for offline consistency
            db.notes.update(card.note.id, {
              hanzi: note.hanzi ?? card.note.hanzi,
              pinyin: note.pinyin ?? card.note.pinyin,
              english: note.english ?? card.note.english,
              fun_facts: note.fun_facts ?? card.note.fun_facts,
              updated_at: note.updated_at ?? card.note.updated_at,
            });
          }
          break;
        }
        case 'delete_current_card': {
          setCardDeleted(true);
          // Remove from IndexedDB
          db.notes.delete(card.note.id);
          db.cards.where('note_id').equals(card.note.id).delete();
          // Advance after a short delay so user can see the confirmation
          setTimeout(() => onDeleteCurrentCard(), 2000);
          break;
        }
        case 'create_flashcards': {
          // Cards are already created on the server side.
          // Trigger a sync so IndexedDB picks them up next time.
          break;
        }
      }
    }
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

      // Pass conversation history for multi-turn context
      const history = conversation.map(qa => ({
        question: qa.question,
        answer: qa.answer,
      }));

      const response = await askAboutNote(card.note.id, question.trim(), context, history);
      setConversation((prev) => [...prev, response]);
      setQuestion('');

      // Process any tool results
      if (response.toolResults) {
        processToolResults(response.toolResults);
      }
    } catch (error) {
      console.error('Failed to ask Claude:', error);
    } finally {
      setIsAsking(false);
    }
  };

  // Render context box if note has conversation context
  const renderContext = () => {
    if (!card.note.context) return null;
    return (
      <div
        className="mb-3 text-light"
        style={{
          fontSize: '0.75rem',
          maxHeight: '80px',
          overflowY: 'auto',
          padding: '0.5rem',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '4px',
          whiteSpace: 'pre-wrap',
          textAlign: 'left',
        }}
      >
        {card.note.context}
      </div>
    );
  };

  const renderFront = () => {
    switch (card.card_type) {
      case 'hanzi_to_meaning':
        return (
          <div className="text-center">
            {renderContext()}
            <p className="text-light mb-1" style={{ fontSize: '0.875rem' }}>{cardInfo.prompt}</p>
            <div className="hanzi hanzi-large">{card.note.hanzi}</div>
          </div>
        );

      case 'meaning_to_hanzi':
        return (
          <div className="text-center">
            {renderContext()}
            <p className="text-light mb-1" style={{ fontSize: '0.875rem' }}>{cardInfo.prompt}</p>
            <div style={{ fontSize: '1.5rem', fontWeight: 500 }}>{card.note.english}</div>
          </div>
        );

      case 'audio_to_hanzi':
        return (
          <div className="text-center">
            {renderContext()}
            <p className="text-light mb-1" style={{ fontSize: '0.875rem' }}>{cardInfo.prompt}</p>
            <button
              className={`btn btn-secondary mb-3${isPlaying ? ' playing' : ''}`}
              onClick={() => playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE, card.note.updated_at)}
              disabled={isPlaying}
            >
              Play Audio
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

  const renderTranscriptionResult = () => {
    if (!isSpeakingCard || !audioBlob) return null;

    if (isTranscribing) {
      return (
        <div className="transcription-result transcription-loading" style={{
          padding: '0.5rem 0.75rem',
          borderRadius: '6px',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fontSize: '0.875rem',
          marginBottom: '0.5rem',
        }}>
          Transcribing...
        </div>
      );
    }

    if (transcriptionOffline) {
      return (
        <div className="transcription-result" style={{
          padding: '0.5rem 0.75rem',
          borderRadius: '6px',
          backgroundColor: 'rgba(156, 163, 175, 0.15)',
          fontSize: '0.8125rem',
          color: '#6b7280',
          marginBottom: '0.5rem',
        }}>
          Recording saved, will transcribe when online
        </div>
      );
    }

    if (transcriptionError) {
      return null; // Fail silently — the recording is still saved
    }

    if (transcriptionComparison) {
      const { transcribedHanzi, transcribedPinyin, isMatch } = transcriptionComparison;
      return (
        <div className="transcription-result" style={{
          padding: '0.5rem 0.75rem',
          borderRadius: '6px',
          backgroundColor: isMatch ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${isMatch ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          fontSize: '0.875rem',
          marginBottom: '0.5rem',
        }}>
          <div style={{ fontWeight: 500 }}>
            You said: {transcribedPinyin} ({transcribedHanzi}) {isMatch ? '\u2705' : '\u274C'}
          </div>
        </div>
      );
    }

    return null;
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

        {renderTranscriptionResult()}

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

      // Process any tool results
      if (response.toolResults) {
        processToolResults(response.toolResults);
      }
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
                <div style={{ gridColumn: '1 / -1' }}><strong>Deck:</strong> {deckInfo?.name || 'Loading...'}</div>
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
                <div><strong>Audio:</strong> {card.note.audio_provider || 'none'}</div>
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
            <div style={{ marginBottom: '1rem' }}>
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

            {/* Regenerate Audio */}
            {isOnline && (
              <div style={{ padding: '0.75rem', backgroundColor: '#e0f2fe', borderRadius: '6px' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Regenerate Audio</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ minWidth: '50px' }}>Speed:</label>
                    <input
                      type="range"
                      min="0.3"
                      max="1.2"
                      step="0.1"
                      value={audioSpeed}
                      onChange={(e) => setAudioSpeed(parseFloat(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ minWidth: '35px', textAlign: 'right' }}>{audioSpeed.toFixed(1)}x</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ minWidth: '50px' }}>Provider:</label>
                    <select
                      value={audioProvider}
                      onChange={(e) => setAudioProvider(e.target.value as 'minimax' | 'gtts' | '')}
                      style={{ flex: 1, padding: '0.25rem' }}
                    >
                      <option value="">Auto (MiniMax first)</option>
                      <option value="minimax">MiniMax</option>
                      <option value="gtts">Google TTS</option>
                    </select>
                  </div>
                  {audioProvider !== 'gtts' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <label style={{ minWidth: '50px' }}>Voice:</label>
                      <select
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value)}
                        style={{ flex: 1, padding: '0.25rem' }}
                      >
                        {MINIMAX_VOICES.map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      setIsRegeneratingAudio(true);
                      try {
                        const options: GenerateAudioOptions = { speed: audioSpeed };
                        if (audioProvider) {
                          options.provider = audioProvider;
                        }
                        // Only pass voiceId for MiniMax provider
                        if (audioProvider !== 'gtts' && selectedVoice) {
                          options.voiceId = selectedVoice;
                        }
                        const updatedNote = await generateNoteAudio(card.note.id, options);

                        // Update local IndexedDB note so future plays use the new audio
                        await db.notes.update(card.note.id, {
                          audio_url: updatedNote.audio_url,
                          audio_provider: updatedNote.audio_provider,
                          updated_at: updatedNote.updated_at,
                        });

                        // Update the note in React state so Play Audio button uses new URL
                        onUpdateNote({
                          audio_url: updatedNote.audio_url,
                          audio_provider: updatedNote.audio_provider,
                          updated_at: updatedNote.updated_at,
                        });

                        // Trigger audio playback with the NEW audio URL and cache buster
                        playAudio(updatedNote.audio_url, card.note.hanzi, API_BASE, Date.now().toString());
                      } catch (error) {
                        console.error('Failed to regenerate audio:', error);
                      } finally {
                        setIsRegeneratingAudio(false);
                      }
                    }}
                    disabled={isRegeneratingAudio}
                    style={{ marginTop: '0.25rem' }}
                  >
                    {isRegeneratingAudio ? 'Regenerating...' : 'Regenerate Audio'}
                  </button>
                </div>
              </div>
            )}
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
                  {qa.toolResults && qa.toolResults.length > 0 && (
                    <div className="claude-tool-results">
                      {qa.toolResults.map((tr, idx) => (
                        <div key={idx} className={`claude-tool-result ${tr.success ? 'success' : 'error'}`}>
                          {tr.tool === 'edit_current_card' && tr.success && (
                            <span>Card updated{tr.data?.changes ? `: ${Object.keys(tr.data.changes as Record<string, unknown>).join(', ')} changed` : ''}</span>
                          )}
                          {tr.tool === 'create_flashcards' && tr.success && (
                            <span>{(tr.data?.count as number) || 0} new card{(tr.data?.count as number) !== 1 ? 's' : ''} created</span>
                          )}
                          {tr.tool === 'delete_current_card' && tr.success && (
                            <span>Card deleted — advancing to next card...</span>
                          )}
                          {!tr.success && (
                            <span>Action failed: {tr.error || 'Unknown error'}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isAsking && (
              <div className="claude-loading">Thinking...</div>
            )}
          </div>

          {!cardDeleted && (
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
          )}
        </div>
      </div>
    );
  };

  const renderBackActions = () => {
    return (
      <div className="study-back-actions">
        <div className="study-back-buttons">
          <button
            className={`btn btn-secondary btn-sm${isPlaying ? ' playing' : ''}`}
            onClick={() => playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE, card.note.updated_at)}
            disabled={isPlaying}
          >
            Play Audio
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

        {/* Flag for tutor review checkbox */}
        {tutors.length > 0 && isOnline && (
          <label className="flex items-center justify-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={flagForTutor}
              onChange={(e) => setFlagForTutor(e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-light">Flag for tutor review</span>
          </label>
        )}
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
                  disabled={isRating}
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
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const { user } = useAuth();

  const deckId = searchParams.get('deck') || undefined;
  const autostart = searchParams.get('autostart') === 'true';
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [studyStarted, setStudyStarted] = useState(autostart);

  // Flag modal state (lifted here to survive card transitions)
  const [flagModalData, setFlagModalData] = useState<FlagModalData | null>(null);
  const [selectedTutor, setSelectedTutor] = useState<TutorRelationshipWithUsers | null>(null);
  const [flagMessage, setFlagMessage] = useState('');
  const [isFlagging, setIsFlagging] = useState(false);
  const flagMessageRef = useRef<HTMLTextAreaElement>(null);

  // Fetch tutors for flag feature
  const { data: relationships } = useQuery({
    queryKey: ['relationships'],
    queryFn: getMyRelationships,
    enabled: isOnline,
    staleTime: 5 * 60 * 1000,
  });
  const tutors = useMemo(() => relationships?.tutors || [], [relationships?.tutors]);

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

  // Use the new study session hook
  const {
    isLoading,
    currentCard,
    counts,
    intervalPreviews,
    hasMoreNewCards,
    isRating,
    rateCard,
    reloadQueue,
    selectNextCard,
    updateCurrentNote,
  } = useStudySession({
    deckId,
    bonusNewCards,
    enabled: studyStarted,
  });


  // Auto-start session creation when autostart param is present
  useEffect(() => {
    if (autostart && studyStarted && !sessionId && isOnline) {
      startSession(deckId)
        .then(session => setSessionId(session.id))
        .catch(() => {});
    }
  }, [autostart, studyStarted, sessionId, isOnline, deckId]);

  // Handle rating a card (called from StudyCard or after flag modal)
  const handleRateCard = useCallback((rating: Rating, timeSpentMs: number, userAnswer?: string, recordingBlob?: Blob) => {
    rateCard(rating, timeSpentMs, userAnswer, recordingBlob);
  }, [rateCard]);

  // Flag modal handlers
  const handleShowFlagModal = useCallback((data: FlagModalData) => {
    setFlagModalData(data);
    // Auto-select first tutor if only one
    if (tutors.length === 1) {
      setSelectedTutor(tutors[0]);
    }
    setTimeout(() => flagMessageRef.current?.focus(), 100);
  }, [tutors]);

  const handleFlagSubmit = async () => {
    if (!selectedTutor || !flagMessage.trim() || isFlagging || !flagModalData) return;

    setIsFlagging(true);
    try {
      await createTutorReviewRequest({
        relationship_id: selectedTutor.id,
        note_id: flagModalData.noteId,
        card_id: flagModalData.cardId,
        message: flagMessage.trim(),
      });
    } catch (error) {
      console.error('Failed to create flag:', error);
    } finally {
      // Rate the card regardless of flag success
      handleRateCard(flagModalData.rating, flagModalData.timeSpentMs, flagModalData.userAnswer, flagModalData.recordingBlob);
      // Reset flag state
      setFlagModalData(null);
      setSelectedTutor(null);
      setFlagMessage('');
      setIsFlagging(false);
    }
  };

  const handleFlagCancel = () => {
    // Still rate the card when canceling
    if (flagModalData) {
      handleRateCard(flagModalData.rating, flagModalData.timeSpentMs, flagModalData.userAnswer, flagModalData.recordingBlob);
    }
    setFlagModalData(null);
    setSelectedTutor(null);
    setFlagMessage('');
  };

  const handleEndSession = useCallback(() => {
    setStudyStarted(false);
    setSessionId(null);
    // Navigate back to home
    navigate('/');
  }, [navigate]);

  // If study hasn't started (no autostart), redirect to home
  // The home page now handles deck selection and study initiation
  useEffect(() => {
    if (!studyStarted && !autostart) {
      navigate('/');
    }
  }, [studyStarted, autostart, navigate]);

  // Show loading while redirecting or loading data
  if (!studyStarted) {
    return <Loading />;
  }

  // Study complete
  if (!isLoading && !currentCard) {
    // Number of bonus cards to add each time the user clicks "Study More"
    const BONUS_NEW_CARDS_INCREMENT = 10;

    console.log('[StudyPage] All Done screen - hasMoreNewCards:', hasMoreNewCards, 'bonusNewCards:', bonusNewCards, 'counts:', counts);

    const handleStudyMoreNewCards = () => {
      console.log('[StudyPage] Study More button clicked - adding', BONUS_NEW_CARDS_INCREMENT, 'bonus new cards');
      // Add more new cards to today's limit and reload the queue
      setBonusNewCards(prev => prev + BONUS_NEW_CARDS_INCREMENT);
      // Note: reloadQueue will be called when bonusNewCards changes via useEffect in the hook
      reloadQueue();
    };

    return (
      <div className="page">
        <Confetti />
        <div className="container">
          <div className="card text-center" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '3rem' }}>🎉</div>
            <h1 className="mt-1">All Done!</h1>
            <p className="text-light mt-1" style={{ fontSize: '0.875rem' }}>
              {hasMoreNewCards
                ? `You've finished your daily limit${bonusNewCards > 0 ? ` (+${bonusNewCards} bonus)` : ''}. Want to study more?`
                : "No more cards due right now."}
            </p>
            <div className="flex flex-col gap-2 items-center mt-3">
              {hasMoreNewCards ? (
                <button
                  className="btn btn-primary btn-block"
                  onClick={handleStudyMoreNewCards}
                >
                  Study {BONUS_NEW_CARDS_INCREMENT} More New Cards
                </button>
              ) : (
                <p className="text-light" style={{ fontSize: '0.75rem' }}>
                  (No additional new cards available)
                </p>
              )}
              <button
                className={hasMoreNewCards ? "btn btn-secondary btn-block" : "btn btn-primary btn-block"}
                onClick={handleEndSession}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render flag modal (at page level to survive card transitions)
  const renderFlagModal = () => {
    if (!flagModalData) return null;

    return (
      <div className="modal-overlay" onClick={handleFlagCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
          <div className="modal-header">
            <div className="modal-title">Flag for Tutor Review</div>
            <button className="modal-close" onClick={handleFlagCancel}>×</button>
          </div>

          <div className="modal-body">
            {/* Card preview */}
            <div style={{
              backgroundColor: '#f3f4f6',
              padding: '0.75rem',
              borderRadius: '6px',
              marginBottom: '1rem',
              textAlign: 'center'
            }}>
              <div className="hanzi" style={{ fontSize: '1.5rem' }}>{flagModalData.hanzi}</div>
              <div className="pinyin" style={{ fontSize: '0.875rem' }}>{flagModalData.pinyin}</div>
              <div style={{ fontSize: '0.875rem', color: '#666' }}>{flagModalData.english}</div>
            </div>

            {/* Tutor selection (if multiple) */}
            {tutors.length > 1 && (
              <div className="form-group mb-3">
                <label className="form-label">Select Tutor</label>
                <select
                  className="form-input"
                  value={selectedTutor?.id || ''}
                  onChange={(e) => {
                    const tutor = tutors.find(t => t.id === e.target.value);
                    setSelectedTutor(tutor || null);
                  }}
                >
                  <option value="">Choose a tutor...</option>
                  {tutors.map((rel) => {
                    const tutor = user ? getOtherUserInRelationship(rel, user.id) : null;
                    return (
                      <option key={rel.id} value={rel.id}>
                        {tutor?.name || tutor?.email || 'Tutor'}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* Single tutor display */}
            {tutors.length === 1 && selectedTutor && (
              <div className="mb-3" style={{ fontSize: '0.875rem', color: '#666' }}>
                Sending to: <strong>
                  {user ? (getOtherUserInRelationship(selectedTutor, user.id)?.name ||
                    getOtherUserInRelationship(selectedTutor, user.id)?.email) : 'Tutor'}
                </strong>
              </div>
            )}

            {/* Message input */}
            <div className="form-group">
              <label className="form-label">What would you like help with?</label>
              <textarea
                ref={flagMessageRef}
                className="form-input"
                value={flagMessage}
                onChange={(e) => setFlagMessage(e.target.value)}
                placeholder="e.g., The audio sounds different than I expected..."
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              className="btn btn-secondary"
              onClick={handleFlagCancel}
              disabled={isFlagging}
            >
              Skip
            </button>
            <button
              className="btn btn-primary"
              onClick={handleFlagSubmit}
              disabled={!selectedTutor || !flagMessage.trim() || isFlagging}
            >
              {isFlagging ? 'Sending...' : 'Send to Tutor'}
            </button>
          </div>
        </div>
      </div>
    );
  };

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
          counts={counts}
          tutors={tutors}
          isRating={isRating}
          onRate={handleRateCard}
          onEnd={handleEndSession}
          onShowFlagModal={handleShowFlagModal}
          onUpdateNote={updateCurrentNote}
          onDeleteCurrentCard={selectNextCard}
        />
      ) : null}

      {/* Flag modal - rendered at page level to survive card transitions */}
      {renderFlagModal()}
    </div>
  );
}
