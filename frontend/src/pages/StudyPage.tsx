import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  askAboutNote,
  startSession,
  API_BASE,
  NoteQuestionWithTools,
  AskToolResult,
  ReadOnlyToolCall,
  getMyRelationships,
  createConversation,
  initiateAIConversation,
  createTutorReviewRequest,
  generateNoteAudio,
  GenerateAudioOptions,
  getNoteAudioRecordings,
  generateNoteAudioRecording,
  generateSentenceClue,
  generateMultipleChoice,
  updateNote,
  generateFunFact,
  createNote,
  getOverviewStats,
  textToFlashcard,
} from '../api/client';
import { Loading } from '../components/Loading';
import { Confetti } from '../components/Confetti';
import { WordDefinitionPopup } from '../components/WordDefinitionPopup';
import {
  CardWithNote,
  Rating,
  CARD_TYPE_INFO,
  RATING_INFO,
  QueueCounts,
  IntervalPreview,
  TutorRelationshipWithUsers,
  getOtherUserInRelationship,
  isClaudeUser,
  MINIMAX_VOICES,
  DEFAULT_MINIMAX_VOICE,
  Note,
  OverviewStats,
} from '../types';
import { useAudioRecorder, useNoteAudio } from '../hooks/useAudio';
import { useTranscription, usePronunciationAssessment } from '../hooks/useTranscription';
import { useNetwork } from '../contexts/NetworkContext';
import { useAuth } from '../contexts/AuthContext';
import CardEditModal from '../components/CardEditModal';
import { syncService } from '../services/sync';
import { useStudySession, SessionStats } from '../hooks/useStudySession';
import { getCardReviewEvents, LocalReviewEvent, db } from '../db/database';
import { useLiveQuery } from 'dexie-react-hooks';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { pinyin } from 'pinyin-pro';

// Friendly labels for read-only tool names
const TOOL_LABELS: Record<string, string> = {
  search_cards: 'Searched cards',
  list_conversations: 'Checked conversations',
  get_deck_info: 'Looked up deck info',
  get_note_cards: 'Checked card details',
  get_note_history: 'Checked review history',
  get_deck_progress: 'Checked deck progress',
  get_due_cards: 'Checked due cards',
  get_overall_stats: 'Checked study stats',
};

function ToolCallsCollapsible({ calls }: { calls: ReadOnlyToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="claude-tool-calls-collapsible">
      <button
        className="claude-tool-calls-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="claude-tool-calls-icon">{expanded ? '▾' : '▸'}</span>
        <span className="claude-tool-calls-summary">
          Used {calls.length} tool{calls.length !== 1 ? 's' : ''}
        </span>
      </button>
      {expanded && (
        <div className="claude-tool-calls-details">
          {calls.map((call, idx) => (
            <div key={idx} className="claude-tool-call-item">
              <span className="claude-tool-call-name">
                {TOOL_LABELS[call.tool] || call.tool}
              </span>
              {call.input && Object.keys(call.input).length > 0 && (
                <span className="claude-tool-call-input">
                  ({Object.entries(call.input).map(([k, v]) => `${k}: ${v}`).join(', ')})
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Character diff component for typed answers (Anki-style)
function AnswerDiff({ userAnswer, correctAnswer, onCharacterClick }: { userAnswer: string; correctAnswer: string; onCharacterClick?: (char: string) => void }) {
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

  const clickable = onCharacterClick ? ' diff-char-clickable' : '';

  if (isFullyCorrect) {
    return (
      <div className="answer-diff">
        <div className="answer-diff-row">
          {userChars.map((c, i) => (
            <span key={i} className={`diff-char diff-correct${clickable}`} onClick={() => onCharacterClick?.(c.char)}>{c.char}</span>
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
          <span key={i} className={`diff-char ${c.correct ? 'diff-correct' : 'diff-wrong'}${clickable}`} onClick={() => onCharacterClick?.(c.char)}>{c.char}</span>
        ))}
      </div>
      <div className="answer-diff-pinyin">{userPinyin}</div>
      <div className="answer-diff-arrow">↓</div>
      <div className="answer-diff-row">
        {correctChars.map((c, i) => (
          <span key={i} className={`diff-char ${c.matched ? 'diff-correct' : 'diff-expected'}${clickable}`} onClick={() => onCharacterClick?.(c.char)}>{c.char}</span>
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
    <div>
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

  // Error handling for orphaned cards (cards with missing notes)
  const [dataError, setDataError] = useState<string | null>(null);

  // Ask Claude state
  const [showAskClaude, setShowAskClaude] = useState(false);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState<NoteQuestionWithTools[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [cardDeleted, setCardDeleted] = useState(false);
  const [pendingToolResults, setPendingToolResults] = useState<AskToolResult[] | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);

  // Message-to-flashcard state (for Ask Claude modal)
  const [flashcardMsgIdx, setFlashcardMsgIdx] = useState<number | null>(null);
  const [flashcardData, setFlashcardData] = useState<{ hanzi: string; pinyin: string; english: string; fun_facts?: string } | null>(null);
  const [isGeneratingFlashcard, setIsGeneratingFlashcard] = useState(false);
  const [flashcardSaved, setFlashcardSaved] = useState(false);

  // Card edit modal state
  const [showEditModal, setShowEditModal] = useState(false);

  // Use in Conversation state
  const [isInitiatingConversation, setIsInitiatingConversation] = useState(false);
  const navigate = useNavigate();

  // Audio recording cycling state
  const queryClient = useQueryClient();
  const recordingsQuery = useQuery({
    queryKey: ['noteRecordings', card.note.id],
    queryFn: () => getNoteAudioRecordings(card.note.id),
  });
  const recordings = recordingsQuery.data || [];
  const [recordingIndex, setRecordingIndex] = useState(0);
  const [isGeneratingStudyAudio, setIsGeneratingStudyAudio] = useState(false);

  // Reset recording index and MC ready state when card changes
  useEffect(() => {
    setRecordingIndex(0);
    setMcReady(false);
    setMcError(null);
  }, [card.id]);

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

  // Sentence clue state
  const [showSentenceClue, setShowSentenceClue] = useState(false);
  const [isGeneratingSentence, setIsGeneratingSentence] = useState(false);
  const [showSentenceHanzi, setShowSentenceHanzi] = useState(false);
  const [showSentencePinyin, setShowSentencePinyin] = useState(false);
  const [showSentenceTranslation, setShowSentenceTranslation] = useState(false);

  // Multiple choice state
  const [showMultipleChoice, setShowMultipleChoice] = useState(false);
  const [mcReady, setMcReady] = useState(false); // MC loaded but hidden (for audio cards)
  const [isGeneratingMC, setIsGeneratingMC] = useState(false);
  const [mcError, setMcError] = useState<string | null>(null);
  const [skipMcForCard, setSkipMcForCard] = useState(false);
  const [isGeneratingFunFact, setIsGeneratingFunFact] = useState(false);
  const [mcSelections, setMcSelections] = useState<(string | null)[]>([]);
  const [mcSubmitted, setMcSubmitted] = useState(false);
  const [shuffledMcOptions, setShuffledMcOptions] = useState<{ correct: string; options: string[] }[] | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);

  const { isRecording, audioBlob, audioLevel, startRecording, stopRecording, clearRecording } =
    useAudioRecorder();
  const { isPlaying, play: playAudio } = useNoteAudio();
  const {
    isTranscribing,
    comparison: transcriptionComparison,
    isOffline: transcriptionOffline,
    error: transcriptionError,
    transcribe,
    reset: resetTranscription,
  } = useTranscription();

  // Azure pronunciation assessment
  const {
    isAssessing: isAzureAssessing,
    result: azureResult,
    error: azureError,
    assess: azureAssess,
    reset: resetAzure,
  } = usePronunciationAssessment();
  const [useAzure, setUseAzure] = useState(false);

  // Microphone device selection (persisted in localStorage)
  const [micDeviceId, setMicDeviceId] = useState<string>(() =>
    localStorage.getItem('preferredMicDeviceId') || ''
  );
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);

  // Track initial 0.5s delay to prevent accidental stop clicks
  const [isRecordingDelayActive, setIsRecordingDelayActive] = useState(false);
  const recordingDelayTimeoutRef = useRef<number | null>(null);

  // Enhanced startRecording with 0.5s delay
  const startRecordingWithDelay = useCallback((skipDelay = false) => {
    // Clear any existing timeout
    if (recordingDelayTimeoutRef.current) {
      clearTimeout(recordingDelayTimeoutRef.current);
    }

    // Start recording with selected device
    startRecording(micDeviceId || undefined);

    // Only enable delay flag if not skipping
    if (!skipDelay) {
      setIsRecordingDelayActive(true);

      // Clear delay after 500ms
      recordingDelayTimeoutRef.current = window.setTimeout(() => {
        setIsRecordingDelayActive(false);
        recordingDelayTimeoutRef.current = null;
      }, 500);
    }
  }, [startRecording, micDeviceId]);

  // Enhanced stopRecording that clears delay state
  const stopRecordingWithDelay = useCallback(() => {
    // Clear any active delay timeout
    if (recordingDelayTimeoutRef.current) {
      clearTimeout(recordingDelayTimeoutRef.current);
      recordingDelayTimeoutRef.current = null;
    }
    setIsRecordingDelayActive(false);
    stopRecording();
  }, [stopRecording]);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (recordingDelayTimeoutRef.current) {
        clearTimeout(recordingDelayTimeoutRef.current);
      }
    };
  }, []);

  // Track which card we've played audio for to prevent re-triggering
  const playedAudioForRef = useRef<string | null>(null);

  const cardInfo = CARD_TYPE_INFO[card.card_type];
  const isTypingCard = cardInfo.action === 'type';
  const isSpeakingCard = cardInfo.action === 'speak';

  // Keep a ref to recordings so callbacks always see the latest
  const recordingsRef = useRef(recordings);
  recordingsRef.current = recordings;

  // Play audio from recording at given index, or fall back to note's primary audio
  const playRecordingAtIndex = useCallback((index: number) => {
    const recs = recordingsRef.current;
    if (recs.length > 0) {
      const rec = recs[index % recs.length];
      playAudio(rec.audio_url, card.note.hanzi, API_BASE);
    } else {
      playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE, card.note.updated_at);
    }
  }, [card.note.audio_url, card.note.hanzi, card.note.updated_at, playAudio]);

  // Cycle to next recording and play it
  const cycleAndPlay = useCallback(() => {
    const recs = recordingsRef.current;
    if (recs.length > 0) {
      const nextIndex = recs.length > 1 ? (recordingIndex + 1) % recs.length : 0;
      setRecordingIndex(nextIndex);
      playRecordingAtIndex(nextIndex);
    } else {
      playRecordingAtIndex(0);
    }
  }, [recordingIndex, playRecordingAtIndex]);

  // Generate new audio with random MiniMax voice and speed
  const generateStudyAudio = useCallback(async () => {
    setIsGeneratingStudyAudio(true);
    try {
      const randomVoice = MINIMAX_VOICES[Math.floor(Math.random() * MINIMAX_VOICES.length)];
      const randomSpeed = Math.round((0.8 + Math.random() * 0.2) * 100) / 100; // 0.8 to 1.0
      const voiceName = randomVoice.name.replace(/\s*\(.*\)$/, '');
      const speedLabel = randomSpeed !== 1.0 ? ` ${randomSpeed.toFixed(1)}x` : '';
      const newRecording = await generateNoteAudioRecording(card.note.id, 'minimax', {
        speed: randomSpeed,
        voiceId: randomVoice.id,
        speakerName: `${voiceName}${speedLabel}`,
      });
      // Invalidate and refetch recordings list so React re-renders with new data
      await queryClient.invalidateQueries({ queryKey: ['noteRecordings', card.note.id] });
      // Play the newly generated recording immediately using its URL
      playAudio(newRecording.audio_url, card.note.hanzi, API_BASE);
    } catch (error) {
      console.error('Failed to generate study audio:', error);
    } finally {
      setIsGeneratingStudyAudio(false);
    }
  }, [card.note.id, card.note.hanzi, queryClient, playAudio]);

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
        playRecordingAtIndex(0);
      }
    }
  }, [card.id, card.card_type, card.note.hanzi, flipped, playRecordingAtIndex]);

  // Reset the played audio ref when card changes
  useEffect(() => {
    return () => {
      playedAudioForRef.current = null;
    };
  }, [card.id]);

  // Auto-generate audio if note has no audio_url
  const generatingAudioForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!card.note.audio_url && isOnline && generatingAudioForRef.current !== card.note.id) {
      generatingAudioForRef.current = card.note.id;
      generateNoteAudio(card.note.id).then((updatedNote) => {
        if (updatedNote.audio_url) {
          onUpdateNote({ audio_url: updatedNote.audio_url, audio_provider: updatedNote.audio_provider });
        }
      }).catch((err) => {
        console.error('[StudyCard] Auto-generate audio failed:', err);
      });
    }
  }, [card.note.id, card.note.audio_url, isOnline, onUpdateNote]);

  // Load review history and enumerate mics when debug modal opens
  useEffect(() => {
    if (showDebug) {
      getCardReviewEvents(card.id).then(setReviewHistory);
      // Enumerate audio input devices
      navigator.mediaDevices.enumerateDevices()
        .then(devices => setAvailableMics(devices.filter(d => d.kind === 'audioinput')))
        .catch(() => {});
    }
  }, [showDebug, card.id]);


  // Trigger transcription when speaking card is flipped with a recording
  useEffect(() => {
    if (flipped && isSpeakingCard && audioBlob) {
      transcribe(audioBlob, card.note.hanzi, card.note.pinyin);
      // Also run Azure pronunciation assessment if enabled
      if (useAzure) {
        azureAssess(audioBlob, card.note.hanzi);
      }
    }
  }, [flipped, isSpeakingCard, audioBlob, card.note.hanzi, card.note.pinyin, transcribe, useAzure, azureAssess]);

  // Auto-play audio when answer is revealed
  useEffect(() => {
    if (flipped) {
      // Small delay to ensure any previous audio is fully stopped
      const timer = setTimeout(() => {
        playRecordingAtIndex(0);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [flipped, playRecordingAtIndex]);

  const handleFlip = () => {
    if (!flipped) {
      setFlipped(true);
    }
  };

  const [showRegenMenu, setShowRegenMenu] = useState(false);
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [customPromptText, setCustomPromptText] = useState('');

  const handleGenerateSentenceClue = async (
    options?: { modifier?: 'simple' | 'complex' | 'variation' | 'custom'; customPrompt?: string }
  ) => {
    setIsGeneratingSentence(true);
    setShowRegenMenu(false);
    setShowCustomPrompt(false);
    try {
      const updatedNote = await generateSentenceClue(card.note.id, options);
      // Update the local card with the new sentence clue
      onUpdateNote(updatedNote);
      // Also update IndexedDB
      await db.notes.update(card.note.id, {
        sentence_clue: updatedNote.sentence_clue,
        sentence_clue_pinyin: updatedNote.sentence_clue_pinyin,
        sentence_clue_translation: updatedNote.sentence_clue_translation,
        sentence_clue_audio_url: updatedNote.sentence_clue_audio_url,
      });
      setShowSentenceClue(true);
      // Reset progressive reveal states so regenerated content is hidden
      setShowSentenceHanzi(false);
      setShowSentencePinyin(false);
      setShowSentenceTranslation(false);
      setAddedSentenceAsCard(false);
    } catch (error) {
      console.error('Failed to generate sentence clue:', error);
      if (error instanceof Error && error.message === 'Note not found') {
        setDataError('This card has a missing note in the database. Please skip this card.');
      }
    } finally {
      setIsGeneratingSentence(false);
    }
  };

  const [addedSentenceAsCard, setAddedSentenceAsCard] = useState(false);
  const [isAddingSentenceCard, setIsAddingSentenceCard] = useState(false);
  const [showDeckPicker, setShowDeckPicker] = useState(false);

  // Get all decks for the deck picker
  const allDecks = useLiveQuery(() => db.decks.toArray(), []);

  const handleAddSentenceAsCard = async (deckId: string) => {
    if (!card.note.sentence_clue || !card.note.sentence_clue_pinyin || !card.note.sentence_clue_translation) return;
    setIsAddingSentenceCard(true);
    setShowDeckPicker(false);
    try {
      await createNote(deckId, {
        hanzi: card.note.sentence_clue,
        pinyin: card.note.sentence_clue_pinyin,
        english: card.note.sentence_clue_translation,
      });
      setAddedSentenceAsCard(true);
    } catch (error) {
      console.error('Failed to add sentence as card:', error);
    } finally {
      setIsAddingSentenceCard(false);
    }
  };

  const handleGenerateFunFact = async () => {
    setIsGeneratingFunFact(true);
    try {
      const updatedNote = await generateFunFact(card.note.id);
      onUpdateNote(updatedNote);
      await db.notes.update(card.note.id, { fun_facts: updatedNote.fun_facts });
    } catch (error) {
      console.error('Failed to generate fun fact:', error);
      if (error instanceof Error && error.message === 'Note not found') {
        setDataError('This card has a missing note in the database. Please skip this card.');
      }
    } finally {
      setIsGeneratingFunFact(false);
    }
  };

  // Auto-generate fun facts and sentence clues in background when missing
  const bgGenTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOnline || bgGenTriggeredRef.current === card.note.id) return;
    bgGenTriggeredRef.current = card.note.id;

    const bgGenerate = async () => {
      // Generate fun fact if missing
      if (!card.note.fun_facts) {
        try {
          const updatedNote = await generateFunFact(card.note.id);
          onUpdateNote(updatedNote);
          await db.notes.update(card.note.id, { fun_facts: updatedNote.fun_facts });
        } catch (error) {
          console.error('[bg] Failed to generate fun fact:', error);
          if (error instanceof Error && error.message === 'Note not found') {
            setDataError('This card has a missing note in the database. Please skip this card.');
          }
        }
      }
      // Generate sentence clue if missing
      if (!card.note.sentence_clue) {
        try {
          const updatedNote = await generateSentenceClue(card.note.id);
          onUpdateNote(updatedNote);
          await db.notes.update(card.note.id, {
            sentence_clue: updatedNote.sentence_clue,
            sentence_clue_pinyin: updatedNote.sentence_clue_pinyin,
            sentence_clue_translation: updatedNote.sentence_clue_translation,
            sentence_clue_audio_url: updatedNote.sentence_clue_audio_url,
          });
        } catch (error) {
          console.error('[bg] Failed to generate sentence clue:', error);
          if (error instanceof Error && error.message === 'Note not found') {
            setDataError('This card has a missing note in the database. Please skip this card.');
          }
        }
      }
    };
    bgGenerate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.note.id, isOnline]);

  // Shuffle options for each row so users don't memorize positions
  const shuffleOptions = (options: { correct: string; options: string[] }[]) => {
    return options.map(charData => {
      const shuffled = [...charData.options];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return { correct: charData.correct, options: shuffled };
    });
  };

  const handleShowMultipleChoice = async (hideInitially = false) => {
    if (card.note.multiple_choice_options) {
      const options = JSON.parse(card.note.multiple_choice_options) as { correct: string; options: string[] }[];
      const shuffled = shuffleOptions(options);
      setShuffledMcOptions(shuffled);
      // Auto-select punctuation (single-option entries)
      setMcSelections(shuffled.map(o => o.options.length === 1 ? o.options[0] : null));
      setMcSubmitted(false);
      if (hideInitially) {
        setMcReady(true);
      } else {
        setShowMultipleChoice(true);
      }
      return;
    }
    setIsGeneratingMC(true);
    setMcError(null);
    try {
      // Add a 30-second timeout to prevent infinite loading
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Generation timed out')), 30000)
      );
      const updatedNote = await Promise.race([
        generateMultipleChoice(card.note.id),
        timeoutPromise,
      ]);
      onUpdateNote(updatedNote);
      await db.notes.update(card.note.id, {
        multiple_choice_options: updatedNote.multiple_choice_options,
      });
      if (updatedNote.multiple_choice_options) {
        const options = JSON.parse(updatedNote.multiple_choice_options) as { correct: string; options: string[] }[];
        const shuffled = shuffleOptions(options);
        setShuffledMcOptions(shuffled);
        // Auto-select punctuation (single-option entries)
        setMcSelections(shuffled.map(o => o.options.length === 1 ? o.options[0] : null));
        setMcSubmitted(false);
        if (hideInitially) {
          setMcReady(true);
        } else {
          setShowMultipleChoice(true);
        }
      }
    } catch (error) {
      console.error('Failed to generate multiple choice options:', error);
      if (error instanceof Error && error.message === 'Note not found') {
        setDataError('This card has a missing note in the database. Please skip this card.');
      } else if (error instanceof Error && error.message === 'Generation timed out') {
        setMcError('Generation timed out. You can retry or type instead.');
      } else {
        setMcError('Failed to generate options. You can retry or type instead.');
      }
    } finally {
      setIsGeneratingMC(false);
    }
  };

  const revealMultipleChoice = () => {
    setMcReady(false);
    setShowMultipleChoice(true);
  };

  // Auto-show multiple choice for pinyin-only cards or audio_to_hanzi cards
  const autoMcTriggeredRef = useRef<string | null>(null);
  const isAudioCard = card.card_type === 'audio_to_hanzi';
  const shouldAutoMC = (card.note.pinyin_only && card.card_type === 'meaning_to_hanzi') || isAudioCard;
  useEffect(() => {
    if (shouldAutoMC && !showMultipleChoice && !mcReady && autoMcTriggeredRef.current !== card.id) {
      autoMcTriggeredRef.current = card.id;
      // Audio cards: load MC in background but keep hidden until user reveals
      handleShowMultipleChoice(isAudioCard);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, shouldAutoMC]);


  const handleRegenerateMC = async () => {
    setIsGeneratingMC(true);
    setMcError(null);
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Generation timed out')), 30000)
      );
      const updatedNote = await Promise.race([
        generateMultipleChoice(card.note.id),
        timeoutPromise,
      ]);
      onUpdateNote(updatedNote);
      await db.notes.update(card.note.id, {
        multiple_choice_options: updatedNote.multiple_choice_options,
      });
      if (updatedNote.multiple_choice_options) {
        const options = JSON.parse(updatedNote.multiple_choice_options) as { correct: string; options: string[] }[];
        const shuffled = shuffleOptions(options);
        setShuffledMcOptions(shuffled);
        // Auto-select punctuation (single-option entries)
        setMcSelections(shuffled.map(o => o.options.length === 1 ? o.options[0] : null));
        setMcSubmitted(false);
      }
    } catch (error) {
      console.error('Failed to regenerate multiple choice options:', error);
      if (error instanceof Error && error.message === 'Generation timed out') {
        setMcError('Regeneration timed out. Try again.');
      } else {
        setMcError('Failed to regenerate options. Try again.');
      }
    } finally {
      setIsGeneratingMC(false);
    }
  };

  const playSentenceClue = () => {
    if (card.note.sentence_clue_audio_url) {
      playAudio(card.note.sentence_clue_audio_url, card.note.sentence_clue || '', API_BASE);
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
              sentence_clue: note.sentence_clue,
              sentence_clue_pinyin: note.sentence_clue_pinyin,
              sentence_clue_translation: note.sentence_clue_translation,
              sentence_clue_audio_url: note.sentence_clue_audio_url,
              updated_at: note.updated_at,
            });
            // Also update in IndexedDB for offline consistency
            db.notes.update(card.note.id, {
              hanzi: note.hanzi ?? card.note.hanzi,
              pinyin: note.pinyin ?? card.note.pinyin,
              english: note.english ?? card.note.english,
              fun_facts: note.fun_facts ?? card.note.fun_facts,
              sentence_clue: note.sentence_clue ?? card.note.sentence_clue,
              sentence_clue_pinyin: note.sentence_clue_pinyin ?? card.note.sentence_clue_pinyin,
              sentence_clue_translation: note.sentence_clue_translation ?? card.note.sentence_clue_translation,
              sentence_clue_audio_url: note.sentence_clue_audio_url ?? card.note.sentence_clue_audio_url,
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
          // Trigger an incremental sync so they appear in IndexedDB immediately.
          syncService.incrementalSync().catch(console.error);
          break;
        }
      }
    }
  };

  const approveToolResults = () => {
    if (pendingToolResults) {
      processToolResults(pendingToolResults);
      setPendingToolResults(null);
    }
  };

  const rejectToolResults = () => {
    setPendingToolResults(null);
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

      // Store tool results as pending for user approval
      if (response.toolResults && response.toolResults.length > 0) {
        setPendingToolResults(response.toolResults);
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
            <div className="study-audio-controls">
              <button
                className={`btn btn-secondary${isPlaying ? ' playing' : ''}`}
                onClick={cycleAndPlay}
                disabled={isPlaying}
              >
                Play Audio{recordings.length > 1 ? ` (${recordingIndex + 1}/${recordings.length})` : ''}
              </button>
              {isOnline && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={generateStudyAudio}
                  disabled={isGeneratingStudyAudio}
                  title="Generate new audio with random voice"
                >
                  {isGeneratingStudyAudio ? '...' : '+ New Voice'}
                </button>
              )}
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
          {!isMatch && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                resetTranscription();
                resetAzure();
                clearRecording();
                setTimeout(() => startRecordingWithDelay(true), 100);
              }}
              style={{ marginTop: '0.375rem', fontSize: '0.75rem' }}
            >
              Try Again
            </button>
          )}
        </div>
      );
    }

    return null;
  };

  const renderAzureResult = () => {
    if (!useAzure || !isSpeakingCard || !audioBlob) return null;

    if (isAzureAssessing) {
      return (
        <div style={{
          padding: '0.5rem 0.75rem',
          borderRadius: '6px',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          fontSize: '0.875rem',
          marginBottom: '0.5rem',
        }}>
          Azure assessing pronunciation...
        </div>
      );
    }

    if (azureError) {
      return (
        <div style={{
          padding: '0.5rem 0.75rem',
          borderRadius: '6px',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fontSize: '0.8125rem',
          marginBottom: '0.5rem',
        }}>
          Azure: {azureError}
        </div>
      );
    }

    if (azureResult?.NBest?.[0]) {
      const best = azureResult.NBest[0];
      const scoreColor = (score: number) =>
        score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';

      return (
        <div style={{
          padding: '0.5rem 0.75rem',
          borderRadius: '6px',
          backgroundColor: 'rgba(139, 92, 246, 0.08)',
          border: '1px solid rgba(139, 92, 246, 0.2)',
          fontSize: '0.8125rem',
          marginBottom: '0.5rem',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: '#7c3aed' }}>
            Azure Pronunciation Assessment
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <span>Overall: <strong style={{ color: scoreColor(best.PronScore) }}>{Math.round(best.PronScore)}</strong></span>
            <span>Accuracy: <strong style={{ color: scoreColor(best.AccuracyScore) }}>{Math.round(best.AccuracyScore)}</strong></span>
            <span>Fluency: <strong style={{ color: scoreColor(best.FluencyScore) }}>{Math.round(best.FluencyScore)}</strong></span>
            <span>Completeness: <strong style={{ color: scoreColor(best.CompletenessScore) }}>{Math.round(best.CompletenessScore)}</strong></span>
          </div>
          {best.Words && best.Words.length > 0 && (
            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
              {best.Words.map((w, i) => (
                <span key={i} style={{
                  padding: '0.125rem 0.375rem',
                  borderRadius: '4px',
                  backgroundColor: w.ErrorType === 'None'
                    ? 'rgba(34, 197, 94, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                  fontSize: '0.8125rem',
                }}>
                  {w.Word} <span style={{ color: scoreColor(w.AccuracyScore), fontWeight: 600 }}>{Math.round(w.AccuracyScore)}</span>
                  {w.ErrorType !== 'None' && <span style={{ color: '#ef4444', fontSize: '0.75rem' }}> ({w.ErrorType})</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  const handleCharacterClick = (char: string) => {
    // Only look up actual Chinese characters, not punctuation or whitespace
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)) {
      setSelectedCharacter(char);
    }
  };

  const handleSaveCharacterAsNote = async (definition: { hanzi: string; pinyin: string; english: string; fun_facts?: string }) => {
    try {
      await createNote(card.note.deck_id, {
        hanzi: definition.hanzi,
        pinyin: definition.pinyin,
        english: definition.english,
        fun_facts: definition.fun_facts,
      });
      setSelectedCharacter(null);
    } catch (err) {
      console.error('Failed to save character as note:', err);
    }
  };

  const renderBackMain = () => {
    return (
      <div className="text-center">
        {isTypingCard && userAnswer ? (
          // Show character-by-character diff for typed answers
          <div className="mb-3">
            <AnswerDiff userAnswer={userAnswer.trim()} correctAnswer={card.note.hanzi} onCharacterClick={handleCharacterClick} />
          </div>
        ) : (
          // Show just the hanzi for non-typing cards - each character is clickable
          <div className="hanzi hanzi-large mb-1">
            {[...card.note.hanzi].map((char, i) => (
              <span key={i} className="hanzi-char-clickable" onClick={() => handleCharacterClick(char)}>{char}</span>
            ))}
          </div>
        )}

        {selectedCharacter && (
          <WordDefinitionPopup
            hanzi={selectedCharacter}
            context={card.note.hanzi}
            onSave={handleSaveCharacterAsNote}
            onClose={() => setSelectedCharacter(null)}
          />
        )}

        {renderTranscriptionResult()}
        {renderAzureResult()}

        {/* Show recording controls on the answer screen when retrying */}
        {flipped && isSpeakingCard && !audioBlob && !transcriptionComparison && (
          <div style={{ marginBottom: '0.5rem' }}>
            {isRecording ? (
              isRecordingDelayActive ? (
                <div style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  fontSize: '0.875rem',
                }}>
                  Transcribing...
                </div>
              ) : (
                <button className="btn btn-error btn-sm" onClick={stopRecordingWithDelay}>
                  Stop Recording
                </button>
              )
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => startRecordingWithDelay()}>
                Record Again
              </button>
            )}
          </div>
        )}

        <div className="pinyin mb-1">{card.note.pinyin}</div>
        <div style={{ fontSize: '1.25rem' }}>{card.note.english}</div>

        {card.note.fun_facts ? (
          <div
            className="mt-3 text-light claude-response"
            style={{
              fontSize: '0.8125rem',
              backgroundColor: '#f3f4f6',
              padding: '0.5rem',
              borderRadius: '6px',
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.note.fun_facts}</ReactMarkdown>
          </div>
        ) : isOnline ? (
          <button
            className="btn btn-sm mt-2"
            style={{ fontSize: '0.75rem', opacity: 0.7 }}
            onClick={handleGenerateFunFact}
            disabled={isGeneratingFunFact}
          >
            {isGeneratingFunFact ? 'Generating...' : 'Generate Fun Fact'}
          </button>
        ) : null}
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

      // Store tool results as pending for user approval
      if (response.toolResults && response.toolResults.length > 0) {
        setPendingToolResults(response.toolResults);
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

            {/* Microphone Settings */}
            {isSpeakingCard && (
              <div style={{ padding: '0.75rem', backgroundColor: '#f0fdf4', borderRadius: '6px' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>Microphone Settings</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ minWidth: '50px' }}>Device:</label>
                    <select
                      value={micDeviceId}
                      onChange={(e) => {
                        setMicDeviceId(e.target.value);
                        localStorage.setItem('preferredMicDeviceId', e.target.value);
                      }}
                      style={{ flex: 1, padding: '0.25rem' }}
                    >
                      <option value="">System Default</option>
                      {availableMics.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Microphone ${device.deviceId.slice(0, 8)}...`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      try {
                        // Request permission first (needed for device labels)
                        await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
                        const devices = await navigator.mediaDevices.enumerateDevices();
                        setAvailableMics(devices.filter(d => d.kind === 'audioinput'));
                      } catch {
                        setAvailableMics([]);
                      }
                    }}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Refresh Devices
                  </button>
                </div>
              </div>
            )}

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
      { label: 'Check my answer', question: 'Is my answer grammatically and semantically correct? Please explain any errors.' },
      { label: 'Verify my answer', question: 'Is my answer correct? If not, what\'s wrong with it and how can I improve?' },
      { label: 'Explain grammar', question: 'Can you explain the grammar of this sentence and break down each word?' },
      { label: 'Add a fun fact', question: 'Add a brief, interesting fun fact or cultural context to this card.' },
      ...(card.note.sentence_clue ? [{ label: 'Explain sentence', question: 'Please explain the example sentence for this card. Break down the grammar, explain each word, and provide any cultural context.' }] : []),
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

            {conversation.map((qa, qaIdx) => {
              const isLatest = qaIdx === conversation.length - 1;
              const hasPending = isLatest && pendingToolResults !== null;
              return (
                <div key={qa.id} className="claude-message-pair">
                  <div className="claude-user-message" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div style={{ flex: 1 }}>{qa.question}</div>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem', flexShrink: 0, lineHeight: 1 }}
                      title="Create flashcard from this message"
                      disabled={isGeneratingFlashcard}
                      onClick={async () => {
                        if (flashcardMsgIdx === qaIdx) {
                          setFlashcardMsgIdx(null);
                          setFlashcardData(null);
                          setFlashcardSaved(false);
                          return;
                        }
                        setFlashcardMsgIdx(qaIdx);
                        setFlashcardData(null);
                        setFlashcardSaved(false);
                        setIsGeneratingFlashcard(true);
                        try {
                          const result = await textToFlashcard(qa.question);
                          setFlashcardData(result);
                        } catch (err) {
                          console.error('Failed to generate flashcard:', err);
                        } finally {
                          setIsGeneratingFlashcard(false);
                        }
                      }}
                    >+</button>
                  </div>
                  {flashcardMsgIdx === qaIdx && (
                    <div className="flashcard-from-message" style={{ padding: '0.5rem 0.75rem', margin: '0.25rem 0', background: 'var(--color-bg-secondary, #f8fafc)', borderRadius: '0.5rem', fontSize: '0.85rem' }}>
                      {isGeneratingFlashcard ? (
                        <div style={{ color: '#64748b' }}>Generating flashcard...</div>
                      ) : flashcardSaved ? (
                        <div style={{ color: '#22c55e' }}>Flashcard saved!</div>
                      ) : flashcardData ? (
                        <>
                          <div><strong>{flashcardData.hanzi}</strong> ({flashcardData.pinyin}) — {flashcardData.english}</div>
                          {flashcardData.fun_facts && <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.25rem' }}>{flashcardData.fun_facts}</div>}
                          <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {allDecks?.map((d) => (
                              <button
                                key={d.id}
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: '0.75rem' }}
                                onClick={async () => {
                                  try {
                                    await createNote(d.id, {
                                      hanzi: flashcardData.hanzi,
                                      pinyin: flashcardData.pinyin,
                                      english: flashcardData.english,
                                      fun_facts: flashcardData.fun_facts,
                                    });
                                    setFlashcardSaved(true);
                                  } catch (err) {
                                    console.error('Failed to save flashcard:', err);
                                  }
                                }}
                              >
                                {d.name}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div style={{ color: '#ef4444' }}>Failed to generate flashcard. Try again.</div>
                      )}
                    </div>
                  )}
                  {qa.readOnlyToolCalls && qa.readOnlyToolCalls.length > 0 && (
                    <ToolCallsCollapsible calls={qa.readOnlyToolCalls} />
                  )}
                  <div className="claude-response">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{qa.answer}</ReactMarkdown>
                    {qa.toolResults && qa.toolResults.length > 0 && (
                      <div className="claude-tool-results">
                        {hasPending ? (
                          /* Pending approval UI */
                          <div className="tool-approval-box">
                            <div className="tool-approval-header">Claude wants to make changes:</div>
                            {qa.toolResults.map((tr, idx) => (
                              <div key={idx} className="tool-approval-item">
                                {tr.tool === 'edit_current_card' && tr.success && (
                                  <div>
                                    <span className="tool-approval-icon">&#9998;</span>
                                    <strong>Edit card</strong>
                                    {tr.data?.changes ? (
                                      <div className="tool-approval-changes">
                                        {Object.entries(tr.data.changes as Record<string, unknown>).map(([field, value]) => (
                                          <div key={field} className="tool-approval-change">
                                            <span className="tool-approval-field">{field}:</span> {String(value)}
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                                {tr.tool === 'create_flashcards' && tr.success && (
                                  <div>
                                    <span className="tool-approval-icon">&#43;</span>
                                    <strong>Create {(tr.data?.count as number) || 0} new card{(tr.data?.count as number) !== 1 ? 's' : ''}</strong>
                                  </div>
                                )}
                                {tr.tool === 'delete_current_card' && tr.success && (
                                  <div>
                                    <span className="tool-approval-icon">&#128465;</span>
                                    <strong>Delete this card</strong>
                                  </div>
                                )}
                                {!tr.success && (
                                  <div>Action failed: {tr.error || 'Unknown error'}</div>
                                )}
                              </div>
                            ))}
                            <div className="tool-approval-buttons">
                              <button className="btn btn-success btn-sm" onClick={approveToolResults}>
                                Approve
                              </button>
                              <button className="btn btn-secondary btn-sm" onClick={rejectToolResults}>
                                Reject
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* Already applied tool results */
                          qa.toolResults.map((tr, idx) => (
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
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isAsking && (
              <div className="claude-loading">Thinking...</div>
            )}
          </div>

          {!cardDeleted && (
            <div className="claude-input-row">
              <textarea
                ref={questionInputRef}
                className="form-input claude-autogrow-input"
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                placeholder={pendingToolResults ? "Approve or reject changes first..." : "Ask a question..."}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAskClaude();
                  }
                }}
                disabled={isAsking || !!pendingToolResults}
                rows={1}
              />
              <button
                className="btn btn-primary"
                onClick={handleAskClaude}
                disabled={!question.trim() || isAsking || !!pendingToolResults}
              >
                Ask
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Find Claude relationship for "Use in Conversation"
  const claudeRelationship = tutors.find(
    t => isClaudeUser(t.requester.id) || isClaudeUser(t.recipient.id)
  );

  const handleUseInConversation = async () => {
    if (!claudeRelationship || isInitiatingConversation) return;
    setIsInitiatingConversation(true);
    try {
      const conv = await createConversation(claudeRelationship.id, {
        title: `Practice: ${card.note.hanzi}`,
        scenario: `The student is practicing the word/phrase: ${card.note.hanzi} (${card.note.pinyin}) meaning "${card.note.english}". Start a conversation that naturally uses this vocabulary. Keep it at a beginner-intermediate level.`,
        user_role: 'Chinese language student practicing vocabulary',
        ai_role: 'Friendly Chinese conversation partner',
      });
      // Trigger Claude's opening message
      await initiateAIConversation(conv.id);
      // Navigate to the chat
      navigate(`/connections/${claudeRelationship.id}/chat/${conv.id}`);
    } catch (err) {
      console.error('[StudyCard] Failed to initiate conversation:', err);
    } finally {
      setIsInitiatingConversation(false);
    }
  };

  const renderBackActions = () => {
    return (
      <div className="study-back-actions">
        <div className="study-back-buttons">
          <button
            className={`btn btn-secondary btn-sm${isPlaying ? ' playing' : ''}`}
            onClick={cycleAndPlay}
            disabled={isPlaying}
          >
            Play Audio{recordings.length > 1 ? ` (${recordingIndex + 1}/${recordings.length})` : ''}
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
          {claudeRelationship && isOnline && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleUseInConversation}
              disabled={isInitiatingConversation}
              title="Practice this word in a conversation with Claude"
            >
              {isInitiatingConversation ? 'Starting...' : 'Roleplay Word'}
            </button>
          )}
          {isOnline && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                setIsRegeneratingAudio(true);
                try {
                  const options: GenerateAudioOptions = {
                    speed: audioSpeed,
                    provider: 'minimax',
                    voiceId: selectedVoice || DEFAULT_MINIMAX_VOICE,
                  };
                  const updatedNote = await generateNoteAudio(card.note.id, options);
                  await db.notes.update(card.note.id, {
                    audio_url: updatedNote.audio_url,
                    audio_provider: updatedNote.audio_provider,
                    updated_at: updatedNote.updated_at,
                  });
                  onUpdateNote({
                    audio_url: updatedNote.audio_url,
                    audio_provider: updatedNote.audio_provider,
                    updated_at: updatedNote.updated_at,
                  });
                  playAudio(updatedNote.audio_url, card.note.hanzi, API_BASE, Date.now().toString());
                } catch (error) {
                  console.error('Failed to regenerate audio:', error);
                } finally {
                  setIsRegeneratingAudio(false);
                }
              }}
              disabled={isRegeneratingAudio}
              title="Regenerate audio with MiniMax"
            >
              {isRegeneratingAudio ? '...' : 'Regen Audio'}
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowEditModal(true)}
            title="Edit card"
          >
            ✏️
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowDebug(true)}
            title="Show debug info"
          >
            🔍
          </button>
        </div>

        {/* Card options row */}
        <div className="study-back-options">
          <label className="study-back-option">
            <input
              type="checkbox"
              checked={!!card.note.pinyin_only}
              onChange={async (e) => {
                const val = e.target.checked ? 1 : 0;
                try {
                  await updateNote(card.note.id, { pinyin_only: val });
                  onUpdateNote({ pinyin_only: val });
                  await db.notes.update(card.note.id, { pinyin_only: val });
                } catch (err) {
                  console.error('Failed to update pinyin_only:', err);
                }
              }}
              className="form-checkbox"
              disabled={!isOnline}
            />
            <span>Multi-choice default</span>
          </label>
          {tutors.length > 0 && isOnline && (
            <label className="study-back-option">
              <input
                type="checkbox"
                checked={flagForTutor}
                onChange={(e) => setFlagForTutor(e.target.checked)}
                className="form-checkbox"
              />
              <span>Flag for tutor</span>
            </label>
          )}
          {isSpeakingCard && isOnline && (
            <label className="study-back-option">
              <input
                type="checkbox"
                checked={useAzure}
                onChange={(e) => setUseAzure(e.target.checked)}
                className="form-checkbox"
              />
              <span>Azure pronunciation</span>
            </label>
          )}
        </div>
      </div>
    );
  };

  const renderSpeakingCardButtons = () => {
    if (isRecording) {
      // During the initial 0.5s delay, show "Transcribing..." instead of clickable button
      if (isRecordingDelayActive) {
        return (
          <div style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fontSize: '0.875rem',
          }}>
            Transcribing...
          </div>
        );
      }

      return (
        <div className="flex flex-col gap-2 items-center" style={{ width: '100%' }}>
          {/* Audio level indicator */}
          <div style={{
            width: '80%',
            height: '6px',
            backgroundColor: 'rgba(0,0,0,0.1)',
            borderRadius: '3px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.min(audioLevel * 200, 100)}%`,
              height: '100%',
              backgroundColor: audioLevel > 0.4 ? '#ef4444' : audioLevel > 0.15 ? '#22c55e' : '#94a3b8',
              transition: 'width 0.1s, background-color 0.2s',
              borderRadius: '3px',
            }} />
          </div>
          <button className="btn btn-error" onClick={stopRecordingWithDelay}>
            Stop Recording
          </button>
        </div>
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
        <button className="btn btn-primary" onClick={() => startRecordingWithDelay()}>
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

  // Render the multiple choice grid
  const renderMultipleChoiceGrid = () => {
    if (!shuffledMcOptions) return null;
    const options = shuffledMcOptions;

    const allSelected = mcSelections.every(s => s !== null);

    const handleMcSubmit = () => {
      setMcSubmitted(true);
      // Set userAnswer to the selected characters for the answer diff
      setUserAnswer(mcSelections.join(''));
    };

    return (
      <div style={{ width: '100%' }}>
        {options.map((charData, rowIdx) => (
          charData.options.length === 1 ? (
            // Punctuation: render as plain text, no interactive button
            <div key={rowIdx} style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '0.5rem',
              fontSize: '1.5rem',
              padding: '0.5rem',
            }}>
              {charData.correct}
            </div>
          ) : (
          <div key={rowIdx} style={{
            display: 'flex',
            gap: '0.5rem',
            justifyContent: 'center',
            marginBottom: '0.5rem',
          }}>
            {charData.options.map((opt, colIdx) => {
              const isSelected = mcSelections[rowIdx] === opt;
              const isCorrect = opt === charData.correct;
              let btnStyle: React.CSSProperties = {
                minWidth: '3rem',
                fontSize: '1.5rem',
                padding: '0.5rem',
                border: '2px solid var(--border-color, #444)',
                borderRadius: '8px',
                background: 'transparent',
                color: 'inherit',
                cursor: mcSubmitted ? 'default' : 'pointer',
              };
              if (mcSubmitted) {
                if (isCorrect) {
                  btnStyle = { ...btnStyle, borderColor: '#4caf50', background: 'rgba(76, 175, 80, 0.2)' };
                } else if (isSelected && !isCorrect) {
                  btnStyle = { ...btnStyle, borderColor: '#f44336', background: 'rgba(244, 67, 54, 0.2)' };
                }
              } else if (isSelected) {
                btnStyle = { ...btnStyle, borderColor: 'var(--primary-color, #4a9eff)', background: 'rgba(74, 158, 255, 0.15)' };
              }
              return (
                <button
                  key={colIdx}
                  style={btnStyle}
                  onClick={() => {
                    if (mcSubmitted) return;
                    setMcSelections(prev => {
                      const next = [...prev];
                      next[rowIdx] = opt;
                      return next;
                    });
                  }}
                  disabled={mcSubmitted}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          )
        ))}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '0.75rem' }}>
          {!mcSubmitted ? (
            <button
              className="btn btn-primary btn-block"
              onClick={handleMcSubmit}
              disabled={!allSelected}
            >
              Check Answer
            </button>
          ) : (
            <button className="btn btn-primary btn-block" onClick={handleFlip}>
              Continue
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '0.5rem' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setShowMultipleChoice(false);
              setMcSubmitted(false);
              setUserAnswer('');
            }}
          >
            Type Instead
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleRegenerateMC}
            disabled={isGeneratingMC || !isOnline}
          >
            {isGeneratingMC ? 'Regenerating...' : 'Regenerate'}
          </button>
        </div>
      </div>
    );
  };

  // Render typing input and button for typing cards (inside card flow)
  const renderTypingActions = () => {
    // Show multiple choice grid if active
    if (showMultipleChoice && (card.card_type === 'meaning_to_hanzi' || card.card_type === 'audio_to_hanzi')) {
      return (
        <div className="study-card-actions">
          {renderMultipleChoiceGrid()}
        </div>
      );
    }

    // Audio cards: MC is ready but hidden — show a reveal button
    if (isAudioCard && mcReady && !showMultipleChoice) {
      return (
        <div className="study-card-actions" style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
          <button className="btn btn-primary" onClick={revealMultipleChoice}>
            Show Options
          </button>
        </div>
      );
    }

    // If this card will auto-show MC, don't flash the text input while loading
    if (shouldAutoMC && !showMultipleChoice && !mcReady && !skipMcForCard) {
      return (
        <div className="study-card-actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', padding: '1rem' }}>
          {mcError ? (
            <>
              <span style={{ fontSize: '0.875rem', color: '#ef4444' }}>{mcError}</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => { setMcError(null); handleShowMultipleChoice(isAudioCard); }}
                  disabled={!isOnline}
                >
                  Retry
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSkipMcForCard(true)}
                >
                  Type instead
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="spinner" />
              <span className="text-light">{isGeneratingMC ? 'Generating options...' : 'Loading...'}</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setSkipMcForCard(true)}
              >
                Type instead
              </button>
            </>
          )}
        </div>
      );
    }

    const placeholder = card.card_type === 'audio_to_hanzi' ? 'Type what you hear...' : 'Type in Chinese...';
    return (
      <div className="study-card-actions">
        <input
          ref={inputRef}
          type="text"
          lang="zh-CN"
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

        {/* Data error banner */}
        {dataError && (
          <div style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '0.5rem',
            padding: '1rem',
            margin: '1rem',
            color: '#991b1b'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>⚠️ Data Error</div>
            <div style={{ marginBottom: '0.75rem' }}>{dataError}</div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onRate(0, Date.now() - startTime)}
              style={{ marginRight: '0.5rem' }}
            >
              Skip Card (Rate as "Again")
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setDataError(null)}
            >
              Dismiss Warning
            </button>
          </div>
        )}

        {/* Card content */}
        <div className="study-card-content">
          {!flipped ? (
            <>
              <div className={`study-card-main ${isTypingCard ? 'study-card-main--typing' : ''}`}>
                {renderFront()}
              </div>

              {/* Sentence clue section */}
              {!flipped && (
                <div className="mt-3 mb-3" style={{ textAlign: 'center' }}>
                  {!showSentenceClue ? (
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          if (card.note.sentence_clue) {
                            setShowSentenceClue(true);
                          } else {
                            handleGenerateSentenceClue();
                          }
                        }}
                        disabled={isGeneratingSentence || !isOnline}
                        title={!isOnline ? 'Requires internet connection' : ''}
                      >
                        {isGeneratingSentence ? 'Generating...' : 'Use in Sentence'}
                      </button>
                      {(card.card_type === 'meaning_to_hanzi' || card.card_type === 'audio_to_hanzi') && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleShowMultipleChoice()}
                          disabled={isGeneratingMC || !isOnline}
                          title={!isOnline ? 'Requires internet connection' : ''}
                        >
                          {isGeneratingMC ? 'Loading...' : 'Multiple Choice'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '0.75rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '8px',
                        display: 'inline-block',
                        minWidth: '200px',
                      }}
                    >
                      {/* On the clue side, only show modalities that match the clue type:
                          - hanzi_to_meaning: clue is hanzi text → show sentence text, hide audio (audio reveals pronunciation)
                          - meaning_to_hanzi / audio_to_hanzi: answer is hanzi → show audio only (text reveals the answer) */}
                      {card.card_type === 'hanzi_to_meaning' && (
                        <div className="hanzi" style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
                          {card.note.sentence_clue}
                        </div>
                      )}
                      {card.card_type !== 'hanzi_to_meaning' && card.note.sentence_clue_audio_url && (
                        <div style={{ marginBottom: '0.5rem' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={playSentenceClue}
                            disabled={isPlaying}
                          >
                            Play Sentence
                          </button>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setShowSentenceClue(false)}
                        >
                          Hide
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleGenerateSentenceClue()}
                          disabled={isGeneratingSentence || !isOnline}
                          title="Regenerate sentence with pinyin and translation"
                        >
                          {isGeneratingSentence ? '...' : '↻'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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

                {/* Sentence clue section with progressive reveal */}
                <div className="mt-3" style={{ textAlign: 'center' }}>
                  {card.note.sentence_clue ? (
                    <div className="sentence-clue-box">
                      <div className="sentence-clue-header">
                        {card.note.sentence_clue_audio_url && (
                          <button
                            className="sentence-clue-play"
                            onClick={playSentenceClue}
                            disabled={isPlaying}
                            title="Play sentence"
                          >
                            {isPlaying ? '⏸' : '▶'}
                          </button>
                        )}
                        <span className="sentence-clue-label">Example Sentence</span>
                        {card.note.sentence_clue_pinyin && card.note.sentence_clue_translation && (
                          <div style={{ position: 'relative' }}>
                            <button
                              className="sentence-clue-add"
                              onClick={() => !addedSentenceAsCard && setShowDeckPicker(!showDeckPicker)}
                              disabled={isAddingSentenceCard || addedSentenceAsCard || !isOnline}
                              title={addedSentenceAsCard ? 'Added to deck' : 'Add sentence as a new card'}
                            >
                              {isAddingSentenceCard ? '...' : addedSentenceAsCard ? '✓' : '+'}
                            </button>
                            {showDeckPicker && allDecks && (
                              <div className="regen-menu" style={{ left: '50%', right: 'auto', transform: 'translateX(-50%)' }}>
                                <div style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', opacity: 0.5, fontWeight: 600 }}>Add to deck</div>
                                {allDecks.map((d) => (
                                  <button
                                    key={d.id}
                                    className="regen-menu-item"
                                    onClick={() => handleAddSentenceAsCard(d.id)}
                                  >
                                    {d.name}{d.id === card.note.deck_id ? ' (current)' : ''}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{ position: 'relative' }}>
                          <button
                            className="sentence-clue-regen"
                            onClick={() => setShowRegenMenu(!showRegenMenu)}
                            disabled={isGeneratingSentence || !isOnline}
                            title="Regenerate sentence"
                          >
                            {isGeneratingSentence ? '...' : '↻'}
                          </button>
                          {showRegenMenu && (
                            <div className="regen-menu">
                              <button className="regen-menu-item" onClick={() => handleGenerateSentenceClue()}>
                                New sentence
                              </button>
                              <button className="regen-menu-item" onClick={() => handleGenerateSentenceClue({ modifier: 'simple' })}>
                                Simple
                              </button>
                              <button className="regen-menu-item" onClick={() => handleGenerateSentenceClue({ modifier: 'complex' })}>
                                Complex
                              </button>
                              <button className="regen-menu-item" onClick={() => handleGenerateSentenceClue({ modifier: 'variation' })}>
                                Variation
                              </button>
                              <button className="regen-menu-item" onClick={() => { setShowRegenMenu(false); setShowCustomPrompt(true); }}>
                                Custom...
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {showCustomPrompt && (
                        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.375rem' }}>
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Describe the sentence you want..."
                            value={customPromptText}
                            onChange={(e) => setCustomPromptText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && customPromptText.trim()) {
                                handleGenerateSentenceClue({ modifier: 'custom', customPrompt: customPromptText.trim() });
                                setCustomPromptText('');
                              }
                            }}
                            autoFocus
                            style={{ fontSize: '0.75rem' }}
                          />
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              if (customPromptText.trim()) {
                                handleGenerateSentenceClue({ modifier: 'custom', customPrompt: customPromptText.trim() });
                                setCustomPromptText('');
                              }
                            }}
                            disabled={!customPromptText.trim()}
                            style={{ fontSize: '0.7rem', padding: '0.125rem 0.5rem' }}
                          >
                            Go
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setShowCustomPrompt(false); setCustomPromptText(''); }}
                            style={{ fontSize: '0.7rem', padding: '0.125rem 0.5rem' }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      <div style={{ position: 'relative' }}>
                        {isGeneratingSentence && (
                          <div className="sentence-clue-loading">
                            <div className="sentence-clue-spinner" />
                            <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Generating new sentence...</span>
                          </div>
                        )}
                        <div style={{ opacity: isGeneratingSentence ? 0.3 : 1, transition: 'opacity 0.2s', pointerEvents: isGeneratingSentence ? 'none' : 'auto' }}>
                          <div
                            className="sentence-clue-row"
                            style={{ cursor: showSentenceHanzi ? 'default' : 'pointer' }}
                            onClick={() => !showSentenceHanzi && setShowSentenceHanzi(true)}
                          >
                            {showSentenceHanzi ? (
                              <span className="hanzi" style={{ fontSize: '1.125rem' }}>{card.note.sentence_clue}</span>
                            ) : (
                              <span className="sentence-clue-tap">Tap to show Chinese</span>
                            )}
                          </div>
                          {card.note.sentence_clue_pinyin && (
                            <div
                              className="sentence-clue-row"
                              style={{ cursor: showSentencePinyin ? 'default' : 'pointer' }}
                              onClick={() => !showSentencePinyin && setShowSentencePinyin(true)}
                            >
                              {showSentencePinyin ? (
                                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{card.note.sentence_clue_pinyin}</span>
                              ) : (
                                <span className="sentence-clue-tap">Tap to show pinyin</span>
                              )}
                            </div>
                          )}
                          {card.note.sentence_clue_translation && (
                            <div
                              className="sentence-clue-row"
                              style={{ cursor: showSentenceTranslation ? 'default' : 'pointer' }}
                              onClick={() => !showSentenceTranslation && setShowSentenceTranslation(true)}
                            >
                              {showSentenceTranslation ? (
                                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{card.note.sentence_clue_translation}</span>
                              ) : (
                                <span className="sentence-clue-tap">Tap to show translation</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleGenerateSentenceClue()}
                      disabled={isGeneratingSentence || !isOnline}
                      title={!isOnline ? 'Requires internet connection' : ''}
                    >
                      {isGeneratingSentence ? 'Generating...' : 'Generate Sentence'}
                    </button>
                  )}
                </div>
              </div>
              <div className="study-card-actions">
                {renderBackActions()}
              </div>
            </>
          )}
        </div>
        {flipped && (
          <div className="study-rating-sticky">
            <RatingButtons
              intervalPreviews={intervalPreviews}
              onRate={handleRate}
              disabled={isRating}
            />
          </div>
        )}
      </div>

      {/* Ask Claude Modal */}
      {renderAskClaudeModal()}

      {/* Debug Modal */}
      {renderDebugModal()}

      {/* Card Edit Modal */}
      {showEditModal && (
        <CardEditModal
          card={card}
          onClose={() => {
            setShowEditModal(false);
            // Refresh recordings in case user added/removed recordings in the modal
            queryClient.invalidateQueries({ queryKey: ['noteRecordings', card.note.id] });
          }}
          onSave={(updatedNote) => {
            onUpdateNote(updatedNote);
            // Also update IndexedDB for offline consistency
            db.notes.update(card.note.id, {
              hanzi: updatedNote.hanzi,
              pinyin: updatedNote.pinyin,
              english: updatedNote.english,
              fun_facts: updatedNote.fun_facts,
              audio_url: updatedNote.audio_url,
              sentence_clue: updatedNote.sentence_clue,
              sentence_clue_pinyin: updatedNote.sentence_clue_pinyin,
              sentence_clue_translation: updatedNote.sentence_clue_translation,
              sentence_clue_audio_url: updatedNote.sentence_clue_audio_url,
            });
            // Refresh recordings list
            queryClient.invalidateQueries({ queryKey: ['noteRecordings', card.note.id] });
          }}
          onDeleteCard={() => {
            // Remove from IndexedDB and move to next card
            db.notes.delete(card.note.id);
            db.cards.where('note_id').equals(card.note.id).delete();
            onDeleteCurrentCard();
          }}
        />
      )}
    </>
  );
}

function SessionRecap({ stats, dayStats }: { stats: SessionStats; dayStats?: OverviewStats | null }) {
  if (stats.totalReviews === 0) return null;

  const accuracy = Math.round((stats.correctCount / stats.totalReviews) * 100);
  const timeSpentMs = Date.now() - stats.timeStarted;
  const minutes = Math.floor(timeSpentMs / 60000);
  const seconds = Math.floor((timeSpentMs % 60000) / 1000);
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  const leechCount = stats.cardsRatedAgainMultiple.size;

  return (
    <div className="session-recap">
      <h3>Session Recap</h3>
      <div className="recap-grid">
        <div className="recap-stat">
          <div className="recap-stat-value">{stats.totalReviews}</div>
          <div className="recap-stat-label">Reviews</div>
        </div>
        <div className="recap-stat">
          <div className="recap-stat-value">{accuracy}%</div>
          <div className="recap-stat-label">Accuracy</div>
        </div>
        <div className="recap-stat">
          <div className="recap-stat-value">{timeStr}</div>
          <div className="recap-stat-label">Time Spent</div>
        </div>
        <div className="recap-stat">
          <div className="recap-stat-value">{stats.bestStreak}</div>
          <div className="recap-stat-label">Best Streak</div>
        </div>
        {leechCount > 0 && (
          <div className="recap-stat recap-attention">
            <div className="recap-stat-value">{leechCount}</div>
            <div className="recap-stat-label">Cards needing attention</div>
          </div>
        )}
      </div>
      {dayStats && (
        <>
          <h3 style={{ marginTop: '1rem' }}>Today's Progress</h3>
          <div className="recap-grid">
            <div className="recap-stat">
              <div className="recap-stat-value">{dayStats.cards_studied_today}</div>
              <div className="recap-stat-label">Total Reviews Today</div>
            </div>
            <div className="recap-stat">
              <div className="recap-stat-value">{dayStats.cards_due_today}</div>
              <div className="recap-stat-label">Still Due</div>
            </div>
          </div>
        </>
      )}
    </div>
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
    cardVersion,
    counts,
    intervalPreviews,
    hasMoreNewCards,
    isRating,
    sessionStats,
    rateCard,
    reloadQueue,
    selectNextCard,
    updateCurrentNote,
  } = useStudySession({
    deckId,
    bonusNewCards,
    enabled: studyStarted,
  });

  // Pre-fetch day stats when queue is nearly empty (3 or fewer cards) for instant "All Done" display
  const isAllDone = !isLoading && !currentCard && counts.new === 0 && counts.learning === 0 && counts.review === 0;
  const isNearlyDone = counts.new + counts.learning + counts.review <= 3;
  const [dayStats, setDayStats] = useState<OverviewStats | null>(null);
  const dayStatsFetchedRef = useRef(false);
  useEffect(() => {
    if ((isAllDone || isNearlyDone) && isOnline && !dayStatsFetchedRef.current) {
      dayStatsFetchedRef.current = true;
      getOverviewStats().then(setDayStats).catch(() => {});
    }
  }, [isAllDone, isNearlyDone, isOnline]);

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

  // Study complete - check that ALL queues are empty, not just that currentCard is null
  if (!isLoading && !currentCard && counts.new === 0 && counts.learning === 0 && counts.review === 0) {
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
            <SessionRecap stats={sessionStats} dayStats={dayStats} />
            <div className="flex flex-col gap-3 items-center mt-4">
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
          key={`${currentCard.id}-${cardVersion}`}
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
