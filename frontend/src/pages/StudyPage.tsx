import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import {
  startSession,
  API_BASE,
  AskToolResult,
  getMyRelationships,
  createConversation,
  initiateAIConversation,
  generateNoteAudio,
  GenerateAudioOptions,
  getNoteAudioRecordings,
  generateNoteAudioRecording,
  generateSentenceClue,
  generateMultipleChoice,
  generateFunFact,
  getLocalDateString,
  analyzeSentence,
} from '../api/client';
import { AskClaudeSheet } from '../components/askClaude/AskClaudeSheet';
import { useAskClaude } from '../components/askClaude/useAskClaude';
import { useAskLanguage } from '../services/askClaudeLanguage';
import { useAskListening } from '../services/askClaudeListening';
import { createAudioPlayer } from '../utils/audioPlayback';
import { AddChunkModal, Chunk } from '../components/AddChunkModal';
import { BumpBadge } from '../components/bumps/BumpButton';
import { useBumps } from '../services/studyBumps';
import { SentenceChunk } from '../types';
import './RoleplayPage.css';
import { Loading } from '../components/Loading';
import { Confetti } from '../components/Confetti';
import { ExplorableText } from '../components/explorer/ExplorableText';
import { useExplorer } from '../components/explorer/ExplorerContext';
import { isLookupChar } from '../services/charDict';
import {
  CardWithNote,
  Rating,
  CARD_TYPE_INFO,
  RATING_INFO,
  QueueCounts,
  IntervalPreview,
  TutorRelationshipWithUsers,
  isClaudeUser,
  MINIMAX_VOICES,
  DEFAULT_MINIMAX_VOICE,
  Note,
} from '../types';
import { useAudioRecorder, useNoteAudio } from '../hooks/useAudio';
import { ensureAudioForNote, isPending, nextAskInMs, reportBrokenClip } from '../services/noteAudioEnsure';
import { useNativeOutputHold } from '../hooks/useNativeOutputHold';
import { FirstCardExplainer } from '../components/onboarding/FirstCardExplainer';
import { useTranscription } from '../hooks/useTranscription';
import { getLiveSession, LiveTranscriber, liveSessionUnavailable, prefetchLiveSession } from '../services/liveTranscription';
import { useNetwork } from '../contexts/NetworkContext';
import { useManualOfflineMode, resolveOfflineMode } from '../services/offlineMode';
import { SyncBadge } from '../components/OfflineBanner';
import './StudyPage.css';
import { StudyActionRow, NEEDS_INTERNET } from '../components/study/StudyActionRow';
import { StudyMenuItem } from '../components/study/StudyMoreMenu';
import { OfflineAudioNote } from '../components/study/OfflineAudioNote';
import { TutorNoteLine } from '../components/study/TutorNoteLine';
import { OfflineModeToggle } from '../components/study/OfflineModeToggle';
import { isPeekTap, type PressPoint } from '../components/study/peekFlip';
import { isDebugConsoleEnabled } from '../utils/debugConsole';
import { getUnseenRecordingNotesForCard, markRecordingNoteSeen } from '../services/recording-notes';
import { getRememberedTutors, humanTutors, rememberTutors, type RememberedTutor } from '../services/cardFlags';
import { FlagCardSheet } from '../components/study/FlagCardSheet';
import { WritingSheet } from '../components/strokes/WritingSheet';
import { writableCharacters } from '@shared/strokes';
import { useAuth } from '../contexts/AuthContext';
import {
  loadMultipleChoice,
  shuffleMcOptions,
  initialMcSelections,
  isEnglishEntry,
  parseMcOptions,
  mcSubmitLabel,
  mcSubmittedAnswer,
  mcAnswerSlots,
  isMcCompact,
  nextUnansweredRow,
  McOptionRow,
  McAnswerSlot,
} from '../services/multipleChoice';
import CardEditModal from '../components/CardEditModal';
import { QueueCountsHeader } from '../components/QueueCountsHeader';
import { RatingButtons } from '../components/RatingButtons';
import { StudyReader } from '../components/StudyReader';
import { StudyGrammar } from '../components/StudyGrammar';
import { StudyCustomLesson } from '../components/StudyCustomLesson';
import { SentenceSet } from '../components/SentenceSet';
import { copyTextToClipboard } from '../utils/clipboard';
import { syncService } from '../services/sync';
import { syncCustomLessons, prefetchCustomLessonMedia } from '../services/custom-lesson-study';
import { useStudySession } from '../hooks/useStudySession';
import { getCardReviewEvents, LocalReviewEvent, LocalRecordingNote, db, removeNotesLocally } from '../db/database';
import { readBonus, writeBonus } from '../utils/bonusNewCards';
import { resumeElapsedMs, studyScope, todayStudyLine, type StudyResumePoint } from '@shared/study';
import {
  claimCelebration,
  clearResumePoint,
  resumeExtras,
  saveResumeExtras,
  saveResumePoint,
  setCoachReturn,
  type ResumeMcState,
} from '../services/studyResume';
import { activeMsToday, reportStudyTimeIfDue } from '../services/studyTime';
import { useActiveStudyTime } from '../hooks/useActiveStudyTime';
import { track } from '../services/analytics';
import { playFanfare } from '../utils/fanfare';
import { getTodayReviewSummary } from '../db/database';
import { DEFAULT_TTS_SPEED } from '../types';
import { useLiveQuery } from 'dexie-react-hooks';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { pinyin } from 'pinyin-pro';
import { hanziAnswerKey, stripAnswerPunctuation } from '../utils/numberHanzi';
import { typedAnswerDiff, type DiffCell } from '../utils/answerDiff';

/** A word short enough to write by hand (sentence cards are skipped). */
function canWriteHanzi(hanzi: string): boolean {
  const n = writableCharacters(hanzi).length;
  return n >= 1 && n <= 6;
}

function normalizeHanzi(s: string) { return s.trim().toLowerCase(); }

const EMPTY_TUTOR_NOTES: LocalRecordingNote[] = [];

/** Analytics names for a rating / a card's queue (shared/analytics/events.ts). */
const RATING_KEYS = ['again', 'hard', 'good', 'easy'] as const;
const QUEUE_KEYS = ['new', 'learning', 'review', 'relearning'] as const;

function formatAddedDate(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null;
  const iso = createdAt + (createdAt.endsWith('Z') ? '' : 'Z');
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return `Added ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
}

// Character diff component for typed answers (Anki-style)
function AnswerDiff({ userAnswer, correctAnswer, alternatives, onCharacterClick }: { userAnswer: string; correctAnswer: string; alternatives?: string[]; onCharacterClick?: (char: string) => void }) {
  const normalizedUser = normalizeHanzi(userAnswer);
  const normalizedCorrect = normalizeHanzi(correctAnswer);
  const isFullyCorrect = normalizedUser === normalizedCorrect;

  // A punctuation-only difference (e.g. a missing trailing 。) is functionally
  // correct — the hanzi are identical. Treat it like a full match and show a
  // single green row rather than the "your answer / canonical answer" diff.
  const isPunctuationOnlyMatch = !isFullyCorrect &&
    stripAnswerPunctuation(userAnswer) === stripAnswerPunctuation(correctAnswer);

  // Equivalence key: numbers normalized to hanzi (typing "7" matches 七),
  // 两/二 treated the same, punctuation ignored (missing trailing 。 is fine).
  const userKey = hanziAnswerKey(userAnswer);

  // Check if user matched the answer up to number/punctuation equivalence,
  // or an acceptable alternative (exact or equivalent).
  const matchedAlternative = isFullyCorrect
    ? null
    : userKey === hanziAnswerKey(correctAnswer)
      ? correctAnswer
      : alternatives?.find(alt => normalizeHanzi(alt) === normalizedUser || hanziAnswerKey(alt) === userKey) ?? null;

  const userChars = [...userAnswer];

  // Generate pinyin for user's answer
  const userPinyin = pinyin(userAnswer, { toneType: 'symbol', type: 'string' });
  const canonicalPinyin = pinyin(correctAnswer, { toneType: 'symbol', type: 'string' });

  const clickable = onCharacterClick ? ' diff-char-clickable' : '';

  if (isFullyCorrect || isPunctuationOnlyMatch) {
    // Single green row. For a punctuation-only difference, show the canonical
    // answer (with its proper punctuation) rather than the user's variant.
    const greenChars = isFullyCorrect ? userChars : [...correctAnswer];
    const greenPinyin = isFullyCorrect ? userPinyin : canonicalPinyin;
    return (
      <div className="answer-diff">
        <div className="answer-diff-row">
          {greenChars.map((ch, i) => (
            <span key={i} className={`diff-char diff-correct${clickable}`} onClick={() => onCharacterClick?.(ch)}>{ch}</span>
          ))}
        </div>
        <div className="answer-diff-pinyin">{greenPinyin}</div>
      </div>
    );
  }

  if (matchedAlternative !== null) {
    // User answered with an accepted alternative — show all-green + canonical below
    const canonicalChars = [...correctAnswer];
    return (
      <div className="answer-diff">
        <div className="answer-diff-row">
          {userChars.map((c, i) => (
            <span key={i} className={`diff-char diff-correct${clickable}`} onClick={() => onCharacterClick?.(c)}>{c}</span>
          ))}
        </div>
        <div className="answer-diff-pinyin">{userPinyin}</div>
        <div className="answer-diff-alternative-label">Also accepted — canonical answer:</div>
        <div className="answer-diff-row">
          {canonicalChars.map((c, i) => (
            <span key={i} className={`diff-char diff-expected${clickable}`} onClick={() => onCharacterClick?.(c)}>{c}</span>
          ))}
        </div>
        <div className="answer-diff-pinyin">{canonicalPinyin}</div>
      </div>
    );
  }

  // A wrong answer: character by character against the canonical answer
  const diff = typedAnswerDiff(userAnswer, correctAnswer);
  return (
    <div className="answer-diff" data-testid="typed-answer-diff">
      <div className="answer-diff-row">
        {diff.typed.map((c, i) => <DiffCellView key={i} cell={c} clickable={clickable} onCharacterClick={onCharacterClick} />)}
      </div>
      <div className="answer-diff-pinyin">{userPinyin}</div>
      <div className="answer-diff-arrow">↓</div>
      <div className="answer-diff-row">
        {diff.expected.map((c, i) => (
          <span key={i} className={`diff-char ${c.matched ? 'diff-correct' : 'diff-expected'}${clickable}`} onClick={() => onCharacterClick?.(c.char)}>{c.char}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * One character of the answer as typed / picked: green when right; red with a solid
 * underline when wrong (or extra); a muted "?" with a dashed underline when missing —
 * so the marks read without relying on colour (see utils/answerDiff.ts).
 */
function DiffCellView({ cell, status, clickable, onCharacterClick }: { cell: DiffCell; status?: string; clickable: string; onCharacterClick?: (char: string) => void }) {
  if (cell.mark === 'missing') {
    return <span className="diff-char diff-skipped" data-status="skipped" aria-label="missing">?</span>;
  }
  const wrong = cell.mark === 'wrong';
  return (
    <span
      className={`diff-char ${wrong ? 'diff-wrong' : 'diff-correct'}${clickable}`}
      data-status={status ?? (wrong ? 'wrong' : 'right')}
      aria-label={wrong ? `${cell.char}, wrong` : undefined}
      onClick={() => onCharacterClick?.(cell.char)}
    >
      {cell.char}
    </span>
  );
}

/**
 * A multiple-choice answer, row by row. Partial answers are allowed, so a
 * position-by-position diff would shift after a skipped row: instead each
 * row's pick is green / red, a skipped row is a dashed "?", and the answer
 * below marks the rows that were missed.
 */
function McAnswerDiff({ slots, onCharacterClick }: { slots: McAnswerSlot[]; onCharacterClick?: (char: string) => void }) {
  const clickable = onCharacterClick ? ' diff-char-clickable' : '';
  const picked = slots.map(s => s.chosen ?? '').join('');
  const choiceRows = slots.filter(s => s.status !== 'given').length;
  const skipped = slots.filter(s => s.status === 'skipped').length;
  return (
    <div className="answer-diff" data-testid="mc-answer-diff">
      <div className="answer-diff-row">
        {slots.map((s, i) => (
          <DiffCellView
            key={i}
            cell={s.chosen == null ? { char: '', mark: 'missing' } : { char: s.chosen, mark: s.status === 'wrong' ? 'wrong' : 'correct' }}
            status={s.status}
            clickable={clickable}
            onCharacterClick={onCharacterClick}
          />
        ))}
      </div>
      {picked && <div className="answer-diff-pinyin">{pinyin(picked, { toneType: 'symbol', type: 'string' })}</div>}
      {skipped > 0 && (
        <div className="answer-diff-alternative-label">{skipped} of {choiceRows} left blank</div>
      )}
      <div className="answer-diff-arrow">↓</div>
      <div className="answer-diff-row">
        {slots.map((s, i) => (
          <span
            key={i}
            className={`diff-char ${s.status === 'right' || s.status === 'given' ? 'diff-correct' : 'diff-expected'}${clickable}`}
            onClick={() => onCharacterClick?.(s.correct)}
          >
            {s.correct}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The study card (front, reveal, back, rating). Also used by the tutor-notes practice (pages/TutorNotesPracticePage.tsx). */
export function StudyCard({
  card,
  cardIsSecondaryNew,
  intervalPreviews,
  counts,
  tutors,
  isRating,
  canUndo,
  onRate,
  onUndo,
  onEnd,
  onUpdateNote,
  onDeleteCurrentCard,
  resume,
  scope,
  pinnedTutorNotes,
  banner,
  bumped,
}: {
  card: CardWithNote;
  cardIsSecondaryNew: boolean;
  intervalPreviews: Record<Rating, IntervalPreview>;
  counts: QueueCounts;
  tutors: TutorRelationshipWithUsers[];
  isRating: boolean;
  canUndo: boolean;
  onRate: (rating: Rating, timeSpentMs: number, userAnswer?: string, recordingBlob?: Blob) => void;
  onUndo: () => void;
  onEnd: () => void;
  onUpdateNote: (updatedNote: Partial<Note>) => void;
  onDeleteCurrentCard: () => void;
  /** Coming back to this card after leaving Study: start where it was (docs/STUDY_SESSION.md). */
  resume?: StudyResumePoint | null;
  /** The Study screen's deck scope; unset (e.g. practising from the Tutor notes page) = nothing to resume. */
  scope?: string;
  /** Tutor notes to show on the back even though already seen (practising from the Tutor notes page). */
  pinnedTutorNotes?: LocalRecordingNote[];
  /** A quiet line under the top bar (the practice view says whether the rating counts). */
  banner?: ReactNode;
  /** From the "⚡ Study it today" pocket (shared/decks/bumps.ts): a small ⚡ badge. */
  bumped?: { fromName: string | null } | null;
}) {
  const { isOnline } = useNetwork();

  // What this card was left with (resume point + in-memory extras), read once at mount.
  const [restored] = useState(() => {
    const point = resume && resume.card_id === card.id ? resume : null;
    const extras = point ? resumeExtras(card.id) : null;
    return { point, recording: extras?.recording ?? null, mc: (extras?.mc ?? null) as (ResumeMcState<McOptionRow> & { showing?: boolean }) | null };
  });
  // Set once the card is rated / removed, so leaving doesn't save it back as "to resume".
  const doneWithCardRef = useRef(false);

  const [flipped, setFlipped] = useState(() => !!restored.point?.revealed);
  // Peek: once revealed, a tap on the card's empty space shows the question again and a
  // tap on the question returns to the answer — view only (components/study/peekFlip.ts).
  const [peeking, setPeeking] = useState(false);
  const [peekFlips, setPeekFlips] = useState(0);
  const pressRef = useRef<PressPoint | null>(null);
  const cardContentRef = useRef<HTMLDivElement>(null);
  const backScrollRef = useRef(0);
  const [userAnswer, setUserAnswer] = useState(() => restored.point?.answer ?? '');
  const [startTime] = useState(() => Date.now() - resumeElapsedMs(restored.point));
  const inputRef = useRef<HTMLInputElement>(null);

  // Error handling for orphaned cards (cards with missing notes)
  const [dataError, setDataError] = useState<string | null>(null);

  // Ask Claude (components/askClaude): Chinese answers by default, the chat's word chips and
  // long-press menu. The conversation (useAskClaude below) lives with the card, so closing the
  // sheet keeps it.
  const [showAskClaude, setShowAskClaude] = useState(false);
  const [cardDeleted, setCardDeleted] = useState(false);
  const [askLanguage, setAskLanguage] = useAskLanguage();
  const [askListening, setAskListening] = useAskListening();

  // Card edit modal state
  const [showEditModal, setShowEditModal] = useState(false);

  // Use in Conversation state
  const [isInitiatingConversation, setIsInitiatingConversation] = useState(false);
  const navigate = useNavigate();

  // Offline mode: automatic from NetworkContext, with the user's forced flag
  // on top (spotty connections). When effectively offline, audio comes from
  // the cache or device TTS and every AI button is disabled.
  const manualOffline = useManualOfflineMode();
  const effectiveOffline = resolveOfflineMode({ forced: manualOffline, isOnline }).effectiveOffline;
  const aiAvailable = !effectiveOffline;

  // Tutor notes on my recordings of this card ("second tone, not fourth"),
  // shown once under the pinyin; marked seen when the card is rated.
  const unseenTutorNotes: LocalRecordingNote[] = useLiveQuery(
    () => getUnseenRecordingNotesForCard(card.id, card.note.id),
    [card.id, card.note.id]
  ) ?? EMPTY_TUTOR_NOTES;
  const tutorNotes = useMemo(() => {
    if (!pinnedTutorNotes?.length) return unseenTutorNotes;
    const ids = new Set(unseenTutorNotes.map(n => n.id));
    return [...unseenTutorNotes, ...pinnedTutorNotes.filter(n => !ids.has(n.id))];
  }, [unseenTutorNotes, pinnedTutorNotes]);

  // Flag for tutor: the sheet under ⋯. Human tutors only; the list is
  // mirrored to localStorage so the item is still there offline.
  const [showFlagSheet, setShowFlagSheet] = useState(false);
  // Handwriting practice for this card's hanzi (⋯ → Write it; preview).
  const [showWriting, setShowWriting] = useState(false);
  // What the writing sheet practises: the card's hanzi (⋯ → Write it) or one character (character sheet).
  const [writingText, setWritingText] = useState<string | null>(null);
  const { user } = useAuth();
  const flagTutors: RememberedTutor[] = useMemo(() => {
    const live = user ? humanTutors(tutors, user.id) : [];
    if (live.length > 0) rememberTutors(live);
    return live.length > 0 ? live : getRememberedTutors();
  }, [tutors, user]);


  // Audio recording cycling state
  const queryClient = useQueryClient();
  const recordingsQuery = useQuery({
    queryKey: ['noteRecordings', card.note.id],
    queryFn: () => getNoteAudioRecordings(card.note.id),
    enabled: aiAvailable,
  });
  const recordings = recordingsQuery.data || [];
  const [recordingIndex, setRecordingIndex] = useState(0);
  const [isGeneratingStudyAudio, setIsGeneratingStudyAudio] = useState(false);

  // Reset recording index and MC state when card changes; stop any in-progress
  // audio. Multiple-choice mode is per card: it never carries over.
  useEffect(() => {
    stopAudio();
    setRecordingIndex(0);
    if (restored.mc) return; // a resumed card keeps its grid as it was left
    setMcReady(false);
    setShowMultipleChoice(false);
    setSkipMcForCard(false);
    setMcFallbackNote(null);
  }, [card.id]); // eslint-disable-line react-hooks/exhaustive-deps


  // Debug modal state
  const [showDebug, setShowDebug] = useState(false);
  const [reviewHistory, setReviewHistory] = useState<LocalReviewEvent[]>([]);
  const [debugCopyMsg, setDebugCopyMsg] = useState<string | null>(null);
  const [isRegeneratingAudio, setIsRegeneratingAudio] = useState(false);
  const [audioSpeed, setAudioSpeed] = useState(DEFAULT_TTS_SPEED);
  const [audioProvider, setAudioProvider] = useState<'minimax' | 'gtts' | ''>('');
  const [selectedVoice, setSelectedVoice] = useState<string>(DEFAULT_MINIMAX_VOICE);

  // Get deck info for debug modal
  const deckInfo = useLiveQuery(
    () => card.note.deck_id ? db.decks.get(card.note.deck_id) : undefined,
    [card.note.deck_id]
  );

  // Sentence clue state
  const [showSentenceClue, setShowSentenceClue] = useState(false);
  const [isGeneratingSentence, setIsGeneratingSentence] = useState(false);
  const [addingChunk, setAddingChunk] = useState<Chunk | null>(null);
  const [sentenceChunkCache, setSentenceChunkCache] = useState<Record<string, SentenceChunk[]>>({});

  // Multiple choice state (per card — see the reset effect above)
  const [showMultipleChoice, setShowMultipleChoice] = useState(() => !!restored.mc?.showing && !restored.point?.revealed);
  const [mcReady, setMcReady] = useState(false); // MC loaded but hidden (for audio cards)
  const [isGeneratingMC, setIsGeneratingMC] = useState(false);
  // One-line note above the typing input when options could not be had
  // (offline, timed out, failed) and the card fell back to typing.
  const [mcFallbackNote, setMcFallbackNote] = useState<string | null>(null);
  const [skipMcForCard, setSkipMcForCard] = useState(false);
  const [isGeneratingFunFact, setIsGeneratingFunFact] = useState(false);
  const [mcSelections, setMcSelections] = useState<(string | null)[]>(() => restored.mc?.selections ?? []);
  // The answer on the back came from the grid (render it row by row).
  const [mcAnswered, setMcAnswered] = useState(() => !!restored.mc?.answered);
  const [shuffledMcOptions, setShuffledMcOptions] = useState<McOptionRow[] | null>(() => restored.mc?.rows ?? null);
  const mcRowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { isRecording, audioBlob, audioLevel, error: recorderError, startRecording, stopRecording, cancelRecording, clearRecording } =
    useAudioRecorder(restored.recording);
  // Record again (answer side): the card turns to the question while the new take records, so
  // the word is read from the hanzi alone; a tap anywhere on the card (or Stop) stops it and
  // turns back to the answer, where the new take is transcribed. Back / Esc / Cancel drops the
  // new take and keeps the previous one with its "You said".
  const [reRecording, setReRecording] = useState(false);
  const [reRecordSeconds, setReRecordSeconds] = useState(0);
  const reRecordStartedRef = useRef(false);
  // Set while a Record again is under way: once its new take is saved (and the card has turned
  // back to the answer), the card's own clip plays, like on the reveal. Cancel / a microphone
  // that never opened clears it, so nothing plays then.
  const replayAfterReRecordRef = useRef(false);

  // Resume point (shared/study/resume.ts): the card on screen, revealed or not, its answer and
  // time so far — saved as it changes and when leaving, so coming back to Study (from the coach,
  // Home, a reload) shows this card again as it was. Cleared once it is rated.
  const savePoint = useCallback(() => {
    if (doneWithCardRef.current || !scope) return;
    saveResumePoint({
      day: getLocalDateString(),
      scope,
      card_id: card.id,
      revealed: flipped,
      answer: userAnswer,
      elapsed_ms: Date.now() - startTime,
    });
  }, [scope, card.id, flipped, userAnswer, startTime]);
  const savePointRef = useRef(savePoint);
  savePointRef.current = savePoint;
  useEffect(() => { savePoint(); }, [savePoint]);
  useEffect(() => {
    if (doneWithCardRef.current || !scope) return;
    saveResumeExtras({
      cardId: card.id,
      recording: audioBlob,
      mc: shuffledMcOptions ? { rows: shuffledMcOptions, selections: mcSelections, answered: mcAnswered, showing: showMultipleChoice } as ResumeMcState : null,
    });
  }, [scope, card.id, audioBlob, shuffledMcOptions, mcSelections, mcAnswered, showMultipleChoice]);
  useEffect(() => () => savePointRef.current(), []);
  // A clip that fails to load is reported, and the card asks for it again (docs/AUDIO.md).
  const [brokenTick, setBrokenTick] = useState(0);
  const { isPlaying, play: playAudio, stop: stopAudio } = useNoteAudio('note', {
    onBroken: useCallback((url: string) => {
      reportBrokenClip(card.note.id, url);
      setBrokenTick((t) => t + 1);
    }, [card.note.id]),
  });
  // Separate player for the user's own recording so it never fights with the
  // note audio for the single reusable element.
  const recordingPlayerRef = useRef(createAudioPlayer());
  useEffect(() => {
    const player = recordingPlayerRef.current;
    return () => player.dispose();
  }, []);
  const {
    isTranscribing,
    comparison: transcriptionComparison,
    isOffline: transcriptionOffline,
    error: transcriptionError,
    transcribe,
    retry: retryTranscription,
  } = useTranscription();

  // Microphone device selection (persisted in localStorage)
  const [micDeviceId, setMicDeviceId] = useState<string>(() =>
    localStorage.getItem('preferredMicDeviceId') || ''
  );
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);

  // Track initial 0.5s delay to prevent accidental stop clicks
  const [isRecordingDelayActive, setIsRecordingDelayActive] = useState(false);
  const recordingDelayTimeoutRef = useRef<number | null>(null);

  // Live transcription (Soniox): the take streams while the learner speaks, so the
  // transcript is final right after Stop. `liveAllowedRef` = online and not forced offline.
  const liveAllowedRef = useRef(false);
  const liveRef = useRef<LiveTranscriber | null>(null);
  const livePromiseRef = useRef<Promise<string> | null>(null);
  useEffect(() => () => { liveRef.current?.abort(); }, []);

  // Enhanced startRecording with 0.5s delay
  const startRecordingWithDelay = useCallback((skipDelay = false, keepPrevious = false) => {
    // Clear any existing timeout
    if (recordingDelayTimeoutRef.current) {
      clearTimeout(recordingDelayTimeoutRef.current);
    }

    liveRef.current?.abort();
    liveRef.current = null;
    livePromiseRef.current = null;
    const live = liveAllowedRef.current && !liveSessionUnavailable() ? new LiveTranscriber(getLiveSession()) : null;
    liveRef.current = live;

    // Start recording with selected device
    startRecording(micDeviceId || undefined, live ? {
      onChunk: (chunk) => live.push(chunk),
      onStop: () => {
        const p = live.finish();
        p.catch(() => { /* falls back to the upload in useTranscription */ });
        livePromiseRef.current = p;
      },
    } : undefined, keepPrevious);

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

  const askTyped = useMemo(
    () => (isTypingCard && userAnswer ? { userAnswer, correctAnswer: card.note.hanzi } : null),
    [isTypingCard, userAnswer, card.note.hanzi],
  );
  const askChat = useAskClaude({ noteId: card.note.id, cardType: card.card_type, typed: askTyped, aiAvailable, language: askLanguage, listening: askListening });

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
      playAudio(card.note.audio_url || null, card.note.hanzi, API_BASE);
    }
  }, [card.note.audio_url, card.note.hanzi, playAudio]);

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

  // Generate new audio with a random MiniMax voice at the default speed
  const generateStudyAudio = useCallback(async () => {
    setIsGeneratingStudyAudio(true);
    try {
      const randomVoice = MINIMAX_VOICES[Math.floor(Math.random() * MINIMAX_VOICES.length)];
      const voiceName = randomVoice.name.replace(/\s*\(.*\)$/, '');
      const newRecording = await generateNoteAudioRecording(card.note.id, 'minimax', {
        speed: DEFAULT_TTS_SPEED,
        voiceId: randomVoice.id,
        speakerName: voiceName,
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
  // Note: useStudySession guarantees card.note_id === card.note.id (data consistency)
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

  // Auto-audio (docs/AUDIO.md; the web twin of the Lab's NoteAudioFixer): a card
  // without its word / sentence clip — or whose clip failed to load — asks the
  // server to make it (interactive priority; queued when MiniMax is busy) and
  // checks back while the card is up. Skipped offline: no network calls then.
  const [audioComing, setAudioComing] = useState(false);
  const onUpdateNoteRef = useRef(onUpdateNote);
  onUpdateNoteRef.current = onUpdateNote;
  useEffect(() => {
    setAudioComing(false);
  }, [card.note.id]);
  useEffect(() => {
    if (!aiAvailable) return;
    const noteId = card.note.id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      ensureAudioForNote({
        id: noteId,
        audio_url: card.note.audio_url,
        sentence_clue: card.note.sentence_clue,
        sentence_clue_audio_url: card.note.sentence_clue_audio_url,
      }).then((res) => {
        if (cancelled) return;
        if (!res) {
          setAudioComing(false);
          return;
        }
        if (Object.keys(res.patch).length > 0) onUpdateNoteRef.current({ id: noteId, ...res.patch });
        const pending = isPending(res.response.word) || isPending(res.response.sentence);
        setAudioComing(pending);
        const wait = nextAskInMs(noteId);
        if (pending && wait !== null) timer = setTimeout(ask, Math.max(wait, 1000));
      }).catch((err) => {
        if (!cancelled) setAudioComing(false);
        console.error('[StudyCard] ensure-audio failed:', err);
      });
    };
    ask();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [card.note.id, card.note.audio_url, card.note.sentence_clue, card.note.sentence_clue_audio_url, aiAvailable, brokenTick]);
  // The word's own clip is the one we wait for; the sentence row shows its own ▶ when it lands.
  const wordAudioComing = audioComing && !card.note.audio_url;

  // Load review history and enumerate mics when debug modal opens
  useEffect(() => {
    if (showDebug) {
      setDebugCopyMsg(null);
      getCardReviewEvents(card.id).then(setReviewHistory);
      // Enumerate audio input devices
      navigator.mediaDevices.enumerateDevices()
        .then(devices => setAvailableMics(devices.filter(d => d.kind === 'audioinput')))
        .catch(() => {});
    }
  }, [showDebug, card.id]);


  // Transcribe as soon as a take exists (not on flip), so "You said" is usually ready by the
  // time the answer shows: the live (Soniox) result when it streamed, else the upload.
  liveAllowedRef.current = isSpeakingCard && aiAvailable;
  useEffect(() => {
    if (isSpeakingCard && aiAvailable) prefetchLiveSession();
  }, [isSpeakingCard, aiAvailable]);
  useEffect(() => {
    if (isSpeakingCard && audioBlob) {
      transcribe(audioBlob, card.note.hanzi, card.note.pinyin, livePromiseRef.current);
    }
  }, [isSpeakingCard, audioBlob, card.note.hanzi, card.note.pinyin, transcribe]);

  // Auto-play audio when answer is revealed. While the real clip is on its way,
  // wait for it instead of reading the word in the device's robotic voice: the
  // effect runs again (and plays) when the clip arrives. A tap on ▶ still
  // falls back to the device voice.
  useEffect(() => {
    if (flipped) {
      if (wordAudioComing && recordingsRef.current.length === 0) return;
      // Small delay to ensure any previous audio is fully stopped
      const timer = setTimeout(() => {
        playRecordingAtIndex(0);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [flipped, playRecordingAtIndex, wordAudioComing]);

  // After a Record again: the new take has been saved and the card is back on the answer —
  // the reveal's auto-play once more (the same clip, recordings in turn), so the right
  // pronunciation follows straight after his own. His own take's playback stops for it; a
  // clip still on its way is left to the reveal effect above, which plays it when it lands.
  const playAfterReRecordRef = useRef(() => {});
  playAfterReRecordRef.current = () => {
    recordingPlayerRef.current.stop();
    if (wordAudioComing && recordingsRef.current.length === 0) return;
    playRecordingAtIndex(0);
  };
  const replayTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (replayTimerRef.current) clearTimeout(replayTimerRef.current); }, []);
  useEffect(() => {
    if (!replayAfterReRecordRef.current || !audioBlob || !flipped) return;
    replayAfterReRecordRef.current = false;
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    replayTimerRef.current = window.setTimeout(() => {
      replayTimerRef.current = null;
      playAfterReRecordRef.current();
    }, 50);
  }, [audioBlob, flipped]);

  const handleFlip = () => {
    if (!flipped) {
      setFlipped(true);
    }
  };

  const handleCardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pressRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!flipped) return; // unrevealed: the card's own buttons do the revealing
    if (reRecording) {
      // Record again: a tap anywhere on the card stops the take (and turns back to the answer).
      pressRef.current = null;
      if (isRecording) stopRecordingWithDelay();
      return;
    }
    const down = pressRef.current;
    pressRef.current = null;
    const tap = isPeekTap({
      target: e.target,
      container: e.currentTarget,
      down,
      up: { x: e.clientX, y: e.clientY, t: e.timeStamp },
      selection: window.getSelection?.()?.toString() ?? '',
    });
    if (!tap) return;
    if (!peeking) backScrollRef.current = e.currentTarget.scrollTop;
    setPeeking(!peeking);
    setPeekFlips((n) => n + 1);
  };

  // The answer side comes back where it was scrolled to; the question starts at the top.
  useLayoutEffect(() => {
    const el = cardContentRef.current;
    if (!el || !flipped) return;
    el.scrollTop = peeking ? 0 : backScrollRef.current;
  }, [peeking, flipped]);

  // Cancel a Record again: the new take is thrown away, the previous one stays as it was.
  const cancelReRecord = useCallback(() => {
    replayAfterReRecordRef.current = false;
    liveRef.current?.abort();
    liveRef.current = null;
    livePromiseRef.current = null;
    cancelRecording();
  }, [cancelRecording]);
  const cancelReRecordRef = useRef(cancelReRecord);
  cancelReRecordRef.current = cancelReRecord;

  // Record again: the question side as recording starts, the answer side once it stops
  // (saved or cancelled). The microphone failing to open leaves the answer where it was.
  useEffect(() => {
    if (!reRecording) return;
    if (isRecording) {
      if (!reRecordStartedRef.current) {
        reRecordStartedRef.current = true;
        backScrollRef.current = cardContentRef.current?.scrollTop ?? 0;
        setReRecordSeconds(0);
        setPeeking(true);
        setPeekFlips((n) => n + 1);
      }
    } else if (reRecordStartedRef.current) {
      reRecordStartedRef.current = false;
      setReRecording(false);
      setPeeking(false);
      setPeekFlips((n) => n + 1);
    }
  }, [reRecording, isRecording]);
  useEffect(() => {
    if (recorderError && reRecording && !reRecordStartedRef.current) {
      replayAfterReRecordRef.current = false;
      setReRecording(false);
    }
  }, [recorderError, reRecording]);
  // The time so far, on the question side.
  useEffect(() => {
    if (!reRecording || !isRecording) return;
    const id = window.setInterval(() => setReRecordSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [reRecording, isRecording]);
  // Back (the Android back gesture in the app, the browser's back) and Esc cancel a Record
  // again instead of leaving Study: a history entry is pushed for the take and popped after.
  useEffect(() => {
    if (!reRecording) return;
    window.history.pushState({ ...(window.history.state ?? {}), studyRerecord: true }, '');
    let popped = false;
    const onPop = () => { popped = true; cancelReRecordRef.current(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelReRecordRef.current(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      if (!popped && (window.history.state as { studyRerecord?: boolean } | null)?.studyRerecord) window.history.back();
    };
  }, [reRecording]);


  const handleGenerateSentenceClue = async (
    options?: { modifier?: 'simple' | 'complex' | 'variation' | 'custom'; customPrompt?: string }
  ) => {
    setIsGeneratingSentence(true);
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
    } catch (error) {
      console.error('Failed to generate sentence clue:', error);
      if (error instanceof Error && error.message === 'Note not found') {
        setDataError('This card has a missing note in the database. Please skip this card.');
      }
    } finally {
      setIsGeneratingSentence(false);
    }
  };


  // Fetch sentence chunks for clickable words whenever sentence_clue changes
  const sentenceClueForChunks = card.note.sentence_clue;
  const noteIdForChunks = card.note.id;
  useEffect(() => {
    if (!sentenceClueForChunks || !isOnline) return;
    const cacheKey = `${noteIdForChunks}:${sentenceClueForChunks}`;
    if (sentenceChunkCache[cacheKey]) return;
    analyzeSentence(sentenceClueForChunks)
      .then((breakdown) => {
        setSentenceChunkCache((prev) => ({ ...prev, [cacheKey]: breakdown.chunks }));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIdForChunks, sentenceClueForChunks, isOnline]);


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
          // Silently skip Note not found — note may have been deleted on server.
          // The card still works; it just won't have a fun fact.
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
          // Silently skip Note not found — note may have been deleted on server.
        }
      }
    };
    bgGenerate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.note.id, isOnline]);

  const applyMcOptions = (rows: McOptionRow[], hideInitially: boolean) => {
    const shuffled = shuffleMcOptions(rows);
    setShuffledMcOptions(shuffled);
    setMcSelections(initialMcSelections(shuffled));
    setMcAnswered(false);
    if (hideInitially) {
      setMcReady(true);
    } else {
      setShowMultipleChoice(true);
    }
  };

  // Generate options on the server and cache them on the note. Wrapped by
  // loadMultipleChoice, which applies the 8s timeout and the offline rule.
  const generateMcOptions = async (): Promise<string | null> => {
    const updatedNote = await generateMultipleChoice(card.note.id);
    onUpdateNote(updatedNote);
    await db.notes.update(card.note.id, {
      multiple_choice_options: updatedNote.multiple_choice_options,
    });
    return updatedNote.multiple_choice_options ?? null;
  };

  /**
   * Show (or, for audio cards, pre-load) multiple choice. Cached options are
   * used offline; otherwise a generation request that times out at 8s. On any
   * failure the card falls back to typing with a one-line note — never a
   * spinner that hangs, and never a mode that sticks to the next card.
   */
  const handleShowMultipleChoice = async (hideInitially = false, options: { forceCached?: boolean } = {}) => {
    const cardIdAtStart = card.id;
    setIsGeneratingMC(true);
    setMcFallbackNote(null);
    try {
      const result = await loadMultipleChoice({
        cachedOptions: options.forceCached ? null : card.note.multiple_choice_options,
        online: aiAvailable,
        generate: generateMcOptions,
      });
      if (cardIdAtStart !== card.id) return;
      if (result.status === 'ready') {
        applyMcOptions(result.options, hideInitially);
      } else {
        setSkipMcForCard(true);
        setShowMultipleChoice(false);
        setMcFallbackNote(result.message);
      }
    } finally {
      setIsGeneratingMC(false);
    }
  };

  const revealMultipleChoice = () => {
    setMcReady(false);
    setShowMultipleChoice(true);
  };

  // Auto-show multiple choice for pinyin-only cards or audio_to_hanzi cards.
  // Offline with nothing cached: straight to typing, no pre-load, no spinner.
  const autoMcTriggeredRef = useRef<string | null>(restored.mc || restored.point?.revealed ? card.id : null);
  const isAudioCard = card.card_type === 'audio_to_hanzi';
  const hasCachedMc = parseMcOptions(card.note.multiple_choice_options) !== null;
  const shouldAutoMC = (card.note.pinyin_only && card.card_type === 'meaning_to_hanzi') || isAudioCard;
  useEffect(() => {
    if (shouldAutoMC && !showMultipleChoice && !mcReady && autoMcTriggeredRef.current !== card.id) {
      autoMcTriggeredRef.current = card.id;
      if (!aiAvailable && !hasCachedMc) {
        setSkipMcForCard(true);
        return;
      }
      // Audio cards: load MC in background but keep hidden until user reveals
      handleShowMultipleChoice(isAudioCard);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, shouldAutoMC]);

  const handleRegenerateMC = () => handleShowMultipleChoice(false, { forceCached: true });

  const playSentenceClue = () => {
    if (card.note.sentence_clue_audio_url) {
      playAudio(card.note.sentence_clue_audio_url, card.note.sentence_clue || '', API_BASE);
    }
  };

  const handleRate = (rating: Rating) => {
    doneWithCardRef.current = true;
    const timeSpent = Date.now() - startTime;
    // The tutor's note was on screen for this review — show it once only.
    for (const note of tutorNotes) {
      markRecordingNoteSeen(note.id).catch(() => {});
    }
    track('study.card_rated', { rating: RATING_KEYS[rating], card_type: card.card_type, queue: QUEUE_KEYS[card.queue] ?? null, time_ms: timeSpent, recorded: !!audioBlob, multiple_choice: showMultipleChoice });
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
          // Remove from IndexedDB (note, cards, checkpoints, sentences)
          removeNotesLocally([card.note.id]).catch(err => console.error('[Study] local removal failed', err));
          // Advance after a short delay so user can see the confirmation
          doneWithCardRef.current = true;
          clearResumePoint(card.id);
          setTimeout(() => onDeleteCurrentCard(), 2000);
          break;
        }
        case 'create_flashcards': {
          // Cards are already created on the server side.
          // Trigger an incremental sync so they appear in IndexedDB immediately.
          syncService.incrementalSync().catch(console.error);
          break;
        }
        case 'create_custom_lesson': {
          // The lesson is already created server-side — pull it into the
          // local cache (and prefetch its media) so it can join a session
          // right away instead of waiting for the next background sync.
          syncCustomLessons()
            .then(() => prefetchCustomLessonMedia())
            .catch(console.error);
          break;
        }
      }
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
            </div>
            {wordAudioComing && recordings.length === 0 && (
              <p className="audio-coming-note" role="status">
                <span className="audio-coming-dot" aria-hidden="true" /> Audio coming… (the device voice plays meanwhile)
              </p>
            )}
            {/* "+ New Voice" lives in the ⋯ menu on the back now (D8) */}
            <OfflineAudioNote audioUrl={card.note.audio_url} effectiveOffline={effectiveOffline} />
          </div>
        );
    }
  };

  const playUserRecording = () => {
    if (audioBlob) {
      recordingPlayerRef.current.play(audioBlob);
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
      // Never silent: the recording is saved either way, and a tap sends the same take again.
      return (
        <button
          type="button"
          className="transcription-result transcription-failed"
          data-testid="transcription-retry"
          onClick={(e) => { e.stopPropagation(); retryTranscription(); }}
        >
          Couldn’t transcribe — tap to retry
          <span className="transcription-failed-note">Your recording is saved</span>
        </button>
      );
    }

    if (transcriptionComparison) {
      const { transcribedHanzi, transcribedPinyin, isMatch, containsExpected } = transcriptionComparison;
      const boxColor = isMatch
        ? { bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.3)' }
        : containsExpected
          ? { bg: 'rgba(249, 115, 22, 0.12)', border: 'rgba(249, 115, 22, 0.4)' }
          : { bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)' };

      return (
        <div className="transcription-result" style={{
          padding: '0.5rem 0.75rem',
          borderRadius: '6px',
          backgroundColor: boxColor.bg,
          border: `1px solid ${boxColor.border}`,
          fontSize: '0.875rem',
          marginBottom: '0.5rem',
        }}>
          <div style={{ fontWeight: 500 }}>
            You said: {transcribedPinyin} ({transcribedHanzi}) {isMatch ? '\u2705' : containsExpected ? '\u2705' : '\u274C'}
          </div>
          {containsExpected && !isMatch && (
            <div style={{ fontSize: '0.75rem', color: '#c2650a', marginTop: '0.125rem' }}>
              Answer found in your sentence
            </div>
          )}
          {/* "Record again" under the meaning covers the retry — no second button here */}
        </div>
      );
    }

    return null;
  };

  // Re-record from the back: start straight away, keeping the last take (and its "You said")
  // until the new one is saved; the card shows the question while recording (effect below).
  const recordAgain = () => {
    stopAudio();
    recordingPlayerRef.current.stop();
    replayAfterReRecordRef.current = true;
    setReRecording(true);
    startRecordingWithDelay(true, true);
  };

  // The language explorer (docs/LANGUAGE_EXPLORER.md): a tapped character opens its Character
  // view — card-independent dictionary data, offline once cached — and the learner can walk on
  // to its words and their characters. "✍️ Write it" opens this card's writing pad.
  const explorer = useExplorer();
  const writeChar = (ch: string) => {
    setWritingText(ch);
    setShowWriting(true);
  };
  const handleCharacterClick = (char: string) => {
    if (isLookupChar(char)) explorer.open({ kind: 'char', char }, { source: 'study', cardHanzi: card.note.hanzi, onWrite: writeChar });
  };

  // A multiple-choice answer that isn't fully right is shown row by row; a
  // fully right one goes through AnswerDiff like a typed answer (one green row).
  const mcBackSlots = (() => {
    if (!mcAnswered || !shuffledMcOptions) return null;
    const slots = mcAnswerSlots(shuffledMcOptions, mcSelections);
    return slots.every(s => s.status === 'right' || s.status === 'given') ? null : slots;
  })();

  const renderBackMain = () => {
    return (
      <div className="text-center">
        {isTypingCard && userAnswer && mcBackSlots ? (
          // Multiple-choice answer (possibly partial): row by row
          <div className="mb-3">
            <McAnswerDiff slots={mcBackSlots} onCharacterClick={handleCharacterClick} />
          </div>
        ) : isTypingCard && userAnswer ? (
          // Show character-by-character diff for typed answers
          <div className="mb-3">
            <AnswerDiff
                userAnswer={userAnswer.trim()}
                correctAnswer={card.note.hanzi}
                alternatives={card.note.alternatives ? JSON.parse(card.note.alternatives) : undefined}
                onCharacterClick={handleCharacterClick}
              />
          </div>
        ) : (
          // Show just the hanzi for non-typing cards - each character is clickable
          <div className="hanzi hanzi-large mb-1">
            <ExplorableText
              text={card.note.hanzi}
              source="study"
              tapClassName="hanzi-char-clickable"
              cardHanzi={card.note.hanzi}
              onWrite={writeChar}
            />
          </div>
        )}

        {renderTranscriptionResult()}

        <div className="pinyin mb-1">{card.note.pinyin}</div>
        <TutorNoteLine notes={tutorNotes} />
        <div className="study-back-meaning">{card.note.english}</div>

        {/* Play · Record again — the only controls between the meaning and the action row */}
        <div className="study-back-pills">
          <button
            className={`study-pill${isPlaying ? ' playing' : ''}`}
            onClick={cycleAndPlay}
            disabled={isPlaying}
            aria-label="Play audio"
          >
            <span aria-hidden="true">🔊</span> Play{recordings.length > 1 ? ` (${recordingIndex + 1}/${recordings.length})` : ''}
          </button>
          {wordAudioComing && recordings.length === 0 && (
            <span className="study-pill study-pill--pending" role="status" title="The clip is being made — tap Play for the device voice meanwhile">
              <span className="audio-coming-dot" aria-hidden="true" /> Audio coming…
            </span>
          )}
          {isSpeakingCard && (
            isRecording ? (
              isRecordingDelayActive ? (
                <span className="study-pill study-pill--recording" aria-live="polite">Recording…</span>
              ) : (
                <button className="study-pill study-pill--recording" onClick={stopRecordingWithDelay}>
                  <span aria-hidden="true">⏹</span> Stop recording
                </button>
              )
            ) : (
              <button className="study-pill" onClick={recordAgain} aria-label="Record again">
                <span aria-hidden="true">🎤</span> Record again
              </button>
            )
          )}
        </div>

        <OfflineAudioNote audioUrl={card.note.audio_url} effectiveOffline={effectiveOffline} />

        {card.note.fun_facts && (
          <div className="study-fun-fact text-light claude-response">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.note.fun_facts}</ReactMarkdown>
          </div>
        )}
        {/* "Generate fun fact" and "Added <date>" moved into the ⋯ menu (D2, D5) */}
      </div>
    );
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

    // Copy the full card debug info (state, previews, review history) as JSON
    const copyCardDebugInfo = async () => {
      const info = {
        generated_at: new Date().toISOString(),
        note: {
          id: card.note.id,
          hanzi: card.note.hanzi,
          pinyin: card.note.pinyin,
          english: card.note.english,
        },
        card: {
          id: card.id,
          card_type: card.card_type,
          deck: deckInfo?.name || null,
          queue: queueNames[card.queue],
          learning_step: card.learning_step,
          stability: card.stability,
          difficulty: card.difficulty,
          lapses: card.lapses,
          ease_factor: card.ease_factor,
          interval: card.interval,
          repetitions: card.repetitions,
          next_review_at: card.next_review_at,
          due_timestamp: card.due_timestamp ? new Date(card.due_timestamp).toISOString() : null,
          last_reviewed_at: card.last_reviewed_at ?? null,
          created_at: card.created_at,
          updated_at: card.updated_at,
        },
        rating_previews: currentPreviews
          ? Object.fromEntries(([0, 1, 2, 3] as Rating[]).map(r => [
              ratingNames[r],
              { interval: currentPreviews[r].intervalText, queue: queueNames[currentPreviews[r].queue] },
            ]))
          : null,
        review_history: reviewHistory.map(e => ({
          reviewed_at: e.reviewed_at,
          rating: ratingNames[e.rating],
          time_spent_ms: e.time_spent_ms,
          user_answer: e.user_answer,
        })),
      };
      const text = JSON.stringify(info, null, 1);
      if (await copyTextToClipboard(text)) {
        setDebugCopyMsg('Copied to clipboard ✓');
        return;
      }
      try {
        await navigator.share({ text });
        setDebugCopyMsg('Sent to share sheet ✓');
      } catch {
        console.log('[cardDebugInfo]', text);
        setDebugCopyMsg('Clipboard unavailable — printed to console');
      }
    };

    return (
      <div className="modal-overlay" onClick={() => setShowDebug(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
          <div className="modal-header">
            <div className="modal-title">Debug Info: {card.note.hanzi}</div>
            <button className="modal-close" onClick={() => setShowDebug(false)}>×</button>
          </div>

          <div className="modal-body" style={{ fontSize: '0.8125rem' }}>
            {/* Copy everything for debugging */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <button className="btn btn-sm" onClick={copyCardDebugInfo}>
                📋 Copy Info
              </button>
              {debugCopyMsg && (
                <span style={{ fontSize: '0.75rem', color: '#16a34a' }}>{debugCopyMsg}</span>
              )}
            </div>

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
                <div><strong>Stability:</strong> {card.stability?.toFixed(1)}d</div>
                <div><strong>Difficulty:</strong> {card.difficulty?.toFixed(1)}</div>
                <div><strong>Lapses:</strong> {card.lapses}</div>
                <div><strong>Last Review:</strong> {card.last_reviewed_at ? formatTime(card.last_reviewed_at) : 'unknown'}</div>
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
                        playAudio(updatedNote.audio_url, card.note.hanzi, API_BASE);
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
    return (
      <AskClaudeSheet
        hanzi={card.note.hanzi}
        chat={askChat}
        typedAnswer={!!askTyped}
        hasSentence={!!card.note.sentence_clue}
        cardDeleted={cardDeleted}
        aiAvailable={aiAvailable}
        language={askLanguage}
        onLanguage={(l) => void setAskLanguage(l, 'sheet')}
        listening={askListening}
        onListening={(on) => void setAskListening(on, 'sheet')}
        onApprove={processToolResults}
        onClose={() => setShowAskClaude(false)}
      />
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

  // 🔊↻ — regenerate this word's clip with the default MiniMax voice
  const regenerateAudio = async () => {
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
      playAudio(updatedNote.audio_url, card.note.hanzi, API_BASE);
    } catch (error) {
      console.error('Failed to regenerate audio:', error);
    } finally {
      setIsRegeneratingAudio(false);
    }
  };

  /**
   * The one action row (D1): Ask Claude · Sentences · ⋯. Everything that used
   * to be a button on the back is still reachable — under ⋯ (D2, D5, D8), so
   * we can see what gets used before culling anything.
   */
  const renderBackActions = () => {
    const needsInternet = aiAvailable ? undefined : NEEDS_INTERNET;
    const menuItems: StudyMenuItem[] = [
      ...(!card.note.fun_facts
        ? [{ key: 'fun-fact', label: 'Generate fun fact', icon: '💡', hint: needsInternet, disabled: !aiAvailable, busy: isGeneratingFunFact, onSelect: handleGenerateFunFact }]
        : []),
      { key: 'regen-audio', label: 'Regenerate audio', icon: '🔊', hint: needsInternet, disabled: !aiAvailable, busy: isRegeneratingAudio, onSelect: regenerateAudio },
      { key: 'new-voice', label: 'New voice', icon: '🗣️', hint: needsInternet, disabled: !aiAvailable, busy: isGeneratingStudyAudio, onSelect: generateStudyAudio },
      ...(claudeRelationship
        ? [{ key: 'roleplay', label: 'Roleplay this word', icon: '🎭', hint: needsInternet, disabled: !aiAvailable, busy: isInitiatingConversation, onSelect: handleUseInConversation }]
        : []),
      {
        // To the coach and back: this card stays as it is (resume point) and the coach's
        // "Back to your card" returns here. Prefilled with the card's sentence, not sent.
        key: 'coach', label: 'Sentence coach', icon: '✏️', hint: needsInternet, onSelect: () => {
          savePointRef.current();
          track('study.sentence_coach');
          if (scope) setCoachReturn(`/study?autostart=true${scope !== 'all' ? `&deck=${encodeURIComponent(scope)}` : ''}`);
          navigate(`/coach?draft=${encodeURIComponent(card.note.sentence_clue || card.note.hanzi)}&focus=1`);
        },
      },
      ...(canWriteHanzi(card.note.hanzi)
        ? [{ key: 'write', label: 'Write it', icon: '✍️', hint: 'Preview', onSelect: () => { track('study.write_it'); setShowWriting(true); } }]
        : []),
      ...(flagTutors.length > 0
        ? [{ key: 'flag', label: 'Flag for tutor', icon: '🚩', onSelect: () => setShowFlagSheet(true) }]
        : []),
      ...(audioBlob
        ? [{ key: 'my-recording', label: 'Play my recording', icon: '🎙️', onSelect: playUserRecording }]
        : []),
      ...(isDebugConsoleEnabled()
        ? [{ key: 'debug', label: 'Debug info', icon: '🔍', onSelect: () => setShowDebug(true) }]
        : []),
    ];

    return (
      <StudyActionRow
        onAskClaude={() => setShowAskClaude(!showAskClaude)}
        askClaudeOpen={showAskClaude}
        onEditCard={() => { track('study.edit_card'); setShowEditModal(true); }}
        aiDisabled={!aiAvailable}
        menuItems={menuItems}
        menuFooter={formatAddedDate(card.note.created_at)}
      />
    );
  };

  // Record again, on the question side: pulsing mic, time, level, "Tap anywhere to stop",
  // Stop and Cancel. Any other tap on the card stops it too (handleCardClick).
  const renderReRecordPanel = () => (
    <div className="study-rerecord" data-testid="study-rerecord" aria-live="polite">
      <div className="study-rerecord-status">
        <span className="study-rerecord-mic" aria-hidden="true">🎤</span>
        <span>Recording · {Math.floor(reRecordSeconds / 60)}:{String(reRecordSeconds % 60).padStart(2, '0')}</span>
      </div>
      <div className="study-rerecord-level" aria-hidden="true">
        <div
          className="study-rerecord-level-bar"
          style={{
            width: `${Math.max(3, Math.min(audioLevel * 200, 100))}%`,
            backgroundColor: audioLevel > 0.4 ? '#ef4444' : audioLevel > 0.15 ? '#22c55e' : '#94a3b8',
          }}
        />
      </div>
      <p className="study-rerecord-hint">Tap anywhere to stop</p>
      <div className="study-rerecord-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={(e) => { e.stopPropagation(); cancelReRecord(); }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-error"
          onClick={(e) => { e.stopPropagation(); stopRecordingWithDelay(); }}
        >
          <span aria-hidden="true">⏹</span> Stop
        </button>
      </div>
    </div>
  );

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
              onClick={playUserRecording}
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
        {/* The most-used control on the front — a real 44px button, not a link (D6) */}
        <button className="btn btn-secondary" onClick={handleFlip} data-testid="skip-recording">
          Skip recording
        </button>
      </div>
    );
  };

  // Render the multiple choice grid. One tap: the button flips the card at
  // once, with whatever has been picked so far (nothing picked = show answer).
  const renderMultipleChoiceGrid = () => {
    if (!shuffledMcOptions) return null;
    const options = shuffledMcOptions;

    const handleMcSubmit = () => {
      // The review's user_answer: the picks in row order, skipped rows left out
      // ('' when nothing was picked — same as an empty typed answer).
      setUserAnswer(mcSubmittedAnswer(options, mcSelections));
      setMcAnswered(true);
      handleFlip();
    };

    // A long answer (a whole sentence: a dozen rows) scrolls inside the grid while the
    // prompt above and the submit button below stay on screen; a pick brings the next
    // unanswered row into view, and past MC_COMPACT_AFTER_ROWS the tiles shrink (≥ 44px).
    const compact = isMcCompact(options);
    const pick = (rowIdx: number, opt: string) => {
      const next = [...mcSelections];
      next[rowIdx] = opt;
      setMcSelections(next);
      const upcoming = nextUnansweredRow(options, next, rowIdx);
      if (upcoming != null) {
        mcRowRefs.current[upcoming]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }
    };

    return (
      <div className={`mc-grid${compact ? ' mc-grid--compact' : ''}`} data-testid="mc-grid">
        <div className="mc-rows" data-testid="mc-rows">
        {options.map((charData, rowIdx) => (
          charData.options.length === 1 || isEnglishEntry(charData.correct) ? (
            // Punctuation or English text: given, so a slim line — no buttons
            <div
              key={rowIdx}
              ref={el => { mcRowRefs.current[rowIdx] = el; }}
              className={`mc-given${isEnglishEntry(charData.correct) ? ' mc-given--text' : ''}`}
            >
              {charData.correct}
            </div>
          ) : (
          <div key={rowIdx} ref={el => { mcRowRefs.current[rowIdx] = el; }} className="mc-row">
            {charData.options.map((opt, colIdx) => {
              const isSelected = mcSelections[rowIdx] === opt;
              return (
                <button
                  key={colIdx}
                  className={`mc-option${isSelected ? ' mc-option--selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => pick(rowIdx, opt)}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          )
        ))}
        </div>
        <div className="mc-footer">
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '0.75rem' }}>
          <button
            className="btn btn-primary btn-block"
            onClick={handleMcSubmit}
            data-testid="mc-submit"
          >
            {mcSubmitLabel(options, mcSelections)}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '0.5rem' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setShowMultipleChoice(false);
              setMcAnswered(false);
              setUserAnswer('');
            }}
          >
            Type Instead
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleRegenerateMC}
            disabled={isGeneratingMC || !aiAvailable}
            title={!aiAvailable ? NEEDS_INTERNET : 'Build a fresh set of options'}
          >
            {isGeneratingMC ? 'Regenerating...' : 'Regenerate'}
          </button>
        </div>
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

    // If this card will auto-show MC, don't flash the text input while the
    // (at most 8s) generation is in flight. Failure lands in the typing
    // fallback below with its one-line note — no retry loop, no hang.
    if (shouldAutoMC && !showMultipleChoice && !mcReady && !skipMcForCard && isGeneratingMC) {
      return (
        <div className="study-card-actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', padding: '1rem' }}>
          <div className="spinner" />
          <span className="text-light">Generating options...</span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setSkipMcForCard(true)}
          >
            Type instead
          </button>
        </div>
      );
    }

    const placeholder = card.card_type === 'audio_to_hanzi' ? 'Type what you hear...' : 'Type in Chinese...';
    return (
      <div className="study-card-actions">
        {mcFallbackNote && (
          <p className="study-mc-note" data-testid="mc-fallback-note">{mcFallbackNote}</p>
        )}
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
        {/* Top bar with close button, queue counts, sync status, and offline toggle */}
        <div className="study-topbar">
          <QueueCountsHeader counts={counts} activeQueue={card.queue} activeIsSecondary={cardIsSecondaryNew} />
          <div className="study-topbar-controls">
            {/* Offline, the pill already says so (and carries the pending count) */}
            {!effectiveOffline && <SyncBadge inline />}
            <button
              className="study-close-btn study-undo-btn"
              onClick={onUndo}
              disabled={!canUndo}
              aria-label="Undo last review"
              title="Undo last review"
            >
              ↺
            </button>
            {/* D3: automatic from NetworkContext, manual override kept; label says which */}
            <OfflineModeToggle />
            <button
              className="study-close-btn"
              onClick={onEnd}
              aria-label="Leave study (you can come back to this card)"
              data-testid="study-close"
            >
              ✕
            </button>
          </div>
        </div>
        {banner}
        {bumped && (
          <div className="study-bump-row" data-testid="study-bump-badge">
            <BumpBadge fromName={bumped.fromName} />
          </div>
        )}

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
              onClick={() => { doneWithCardRef.current = true; onRate(0, Date.now() - startTime); }}
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
        <div
          className={`study-card-content${!flipped && showMultipleChoice && isTypingCard && shuffledMcOptions ? ' study-card-content--mc' : ''}`}
          ref={cardContentRef}
          onPointerDown={handleCardPointerDown}
          onClick={handleCardClick}
        >
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
                        disabled={isGeneratingSentence || (!card.note.sentence_clue && !aiAvailable)}
                        title={!card.note.sentence_clue && !aiAvailable ? NEEDS_INTERNET : ''}
                      >
                        {isGeneratingSentence ? 'Generating...' : 'Use in Sentence'}
                      </button>
                      {(card.card_type === 'meaning_to_hanzi' || card.card_type === 'audio_to_hanzi') && !showMultipleChoice && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setSkipMcForCard(false); handleShowMultipleChoice(); }}
                          disabled={isGeneratingMC || (!hasCachedMc && !aiAvailable)}
                          title={!hasCachedMc && !aiAvailable ? NEEDS_INTERNET : ''}
                        >
                          {isGeneratingMC ? 'Building options…' : 'Multiple Choice'}
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
                          {(() => {
                            const cacheKey = `${card.note.id}:${card.note.sentence_clue}`;
                            const chunks = sentenceChunkCache[cacheKey];
                            return chunks && chunks.length > 0
                              ? chunks.map((c, i) => (
                                  <button key={i} className="rp-chunk" onClick={() => setAddingChunk(c)}>
                                    {c.hanzi}
                                  </button>
                                ))
                              : card.note.sentence_clue;
                          })()}
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
                          disabled={isGeneratingSentence || !aiAvailable}
                          title={!aiAvailable ? NEEDS_INTERNET : 'Regenerate sentence with pinyin and translation'}
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
              {peeking && (
                <div className="study-card-main study-card-main--peek study-face-flip" data-testid="study-peek-front">
                  {renderFront()}
                  {reRecording ? renderReRecordPanel() : <p className="study-peek-hint">Tap to see the answer</p>}
                </div>
              )}
              {/* Hidden, not unmounted, while peeking: opened sentence rows and the
                  answer diff survive the round trip. */}
              <div
                className={`study-card-main study-card-main--back${peekFlips > 0 ? ' study-face-flip' : ''}`}
                data-testid="study-card-back"
                style={peeking ? { display: 'none' } : undefined}
              >
                {renderBackMain()}

                {/* One list of sentences for this word, always there under
                    the meaning: the card's own example sentence first, then
                    the generated set. It scrolls under the action row and
                    the ratings, which stay put in the footer. */}
                <div className="study-sentences" data-testid="study-sentences">
                  <SentenceSet
                    noteId={card.note.id}
                    cardSentence={
                      card.note.sentence_clue
                        ? {
                            hanzi: card.note.sentence_clue,
                            pinyin: card.note.sentence_clue_pinyin,
                            translation: card.note.sentence_clue_translation,
                            audio_url: card.note.sentence_clue_audio_url,
                          }
                        : null
                    }
                    compact
                  />
                </div>
              </div>
            </>
          )}
        </div>
        {flipped && (
          <div className="study-rating-sticky">
            <div className="study-card-actions study-card-actions--footer">
              {renderBackActions()}
            </div>
            <RatingButtons
              intervalPreviews={intervalPreviews}
              onRate={handleRate}
              disabled={isRating}
            />
          </div>
        )}
      </div>

      {/* Add word to deck modal */}
      {addingChunk && (
        <AddChunkModal source="breakdown" chunk={addingChunk} onClose={() => setAddingChunk(null)} />
      )}

      {/* Ask Claude Modal */}
      {renderAskClaudeModal()}

      {/* Handwriting practice (⋯ → Write it) */}
      {showWriting && (
        <WritingSheet
          text={writingText ?? card.note.hanzi}
          pinyin={writingText ? null : card.note.pinyin}
          english={writingText ? null : card.note.english}
          onClose={() => {
            setShowWriting(false);
            setWritingText(null);
          }}
        />
      )}

      {/* Flag for tutor (⋯ menu) */}
      {showFlagSheet && (
        <FlagCardSheet
          tutors={flagTutors}
          noteId={card.note.id}
          cardId={card.id}
          hanzi={card.note.hanzi}
          onClose={() => setShowFlagSheet(false)}
        />
      )}

      {/* Debug Modal */}
      {renderDebugModal()}

      {/* Floating audio replay button for thumb-reach on the FRONT of audio cards.
          The back has its own play button in the reveal area, and a fixed FAB
          there sat on top of the rating buttons. */}
      {isAudioCard && !flipped && (
        <button
          className={`audio-replay-fab${isPlaying ? ' audio-replay-fab--playing' : ''}`}
          onClick={cycleAndPlay}
          disabled={isPlaying}
          aria-label="Replay audio"
          title="Replay audio"
        >
          🔊
        </button>
      )}

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
            track('deck.note_edit', { where: 'study' });
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
              alternatives: updatedNote.alternatives,
            });
            // Refresh recordings list
            queryClient.invalidateQueries({ queryKey: ['noteRecordings', card.note.id] });
          }}
          onDeleteCard={() => {
            // CardEditModal already removed the note locally; just move on.
            doneWithCardRef.current = true;
            clearResumePoint(card.id);
            onDeleteCurrentCard();
          }}
        />
      )}
    </>
  );
}

export function StudyPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isOnline } = useNetwork();
  // Clips play a few seconds apart all session; keep the output warm between them.
  useNativeOutputHold();

  const deckId = searchParams.get('deck') || undefined;
  const autostart = searchParams.get('autostart') === 'true';
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [studyStarted, setStudyStarted] = useState(autostart);

  // In-SPA navigation to /study?autostart=true (e.g. from the Android widget
  // while the app is warm) changes the param without remounting — honor it.
  useEffect(() => {
    if (autostart) {
      setStudyStarted(true);
    }
  }, [autostart]);

  // Tutor relationships (used for the "Roleplay Word" action on the card back)
  const { data: relationships } = useQuery({
    queryKey: ['relationships'],
    queryFn: getMyRelationships,
    enabled: isOnline,
    staleTime: 5 * 60 * 1000,
  });
  const tutors = useMemo(() => relationships?.tutors || [], [relationships?.tutors]);

  // Bonus new cards - persisted in localStorage per deck, resets daily
  const [bonusNewCards, setBonusNewCards] = useState(() => readBonus(deckId));

  useEffect(() => {
    setBonusNewCards(readBonus(deckId));
  }, [deckId]);

  useEffect(() => {
    try {
      // Clean up keys from previous days
      const todayDate = new Date().toISOString().slice(0, 10);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('bonusNewCards_') && !key.endsWith(todayDate)) {
          localStorage.removeItem(key);
        }
      }
      writeBonus(deckId, bonusNewCards);
    } catch {
      // localStorage might be unavailable
    }
  }, [bonusNewCards, deckId]);

  // Use the new study session hook
  const {
    isLoading,
    currentCard,
    currentReader,
    currentGrammar,
    currentCustomLesson,
    currentCardIsSecondaryNew,
    bumpedCardIds,
    cardVersion,
    counts,
    dailyReaderPending,
    grammarPending,
    intervalPreviews,
    customLessonIntervalPreviews,
    hasMoreNewCards,
    isRating,
    resume,
    flushWrites,
    canUndo,
    rateCard,
    finishReader,
    completeGrammar,
    completeCustomLesson,
    undoLastReview,
    reloadQueue,
    removeNoteFromSession,
    updateCurrentNote,
  } = useStudySession({
    deckId,
    bonusNewCards,
    enabled: studyStarted,
  });
  // Bumped notes (for the ⚡ badge's "from <tutor>").
  const bumps = useBumps();

  // Active study time: counted while this screen is in front and used (docs/STUDY_SESSION.md "Time").
  useActiveStudyTime(studyStarted);

  // Today is the session: the queue is always today's, so there is nothing to "end".
  const isAllDone = !isLoading && !currentCard && !currentReader && !currentGrammar && !currentCustomLesson && counts.new === 0 && counts.secondaryNew === 0 && counts.learning === 0 && counts.review === 0;

  // Today's numbers for the All done screen, and the celebration: once a day, again only
  // when more cards became due and were cleared too (shared/study/celebration.ts).
  const [today, setToday] = useState<{ reviews: number; correct: number; activeMs: number; celebrate: boolean } | null>(null);
  useEffect(() => {
    if (!isAllDone) {
      setToday(null);
      return;
    }
    let cancelled = false;
    (async () => {
      await flushWrites();
      const { reviews, correct } = await getTodayReviewSummary().catch(() => ({ reviews: 0, correct: 0 }));
      if (cancelled) return;
      const celebrate = claimCelebration(reviews, true);
      if (celebrate) {
        playFanfare();
        track('study.celebration', { reviews, active_ms: activeMsToday() });
      }
      setToday({ reviews, correct, activeMs: activeMsToday(), celebrate });
      // Other devices' time for today (and this device's reported), when online.
      await reportStudyTimeIfDue(true);
      if (!cancelled) setToday(t => (t ? { ...t, activeMs: activeMsToday() } : t));
    })();
    return () => { cancelled = true; };
  }, [isAllDone, flushWrites]);

  // Auto-start session creation when autostart param is present. Best-effort and kept only for
  // older servers / clients (POST /api/study/sessions); nothing reads it for time any more.
  useEffect(() => {
    if (autostart && studyStarted && !sessionId && isOnline) {
      startSession(deckId)
        .then(session => setSessionId(session.id))
        .catch(() => {});
    }
  }, [autostart, studyStarted, sessionId, isOnline, deckId]);

  // Analytics: one study.session_start when the queue has loaded with something to do, one
  // study.session_end when Study is left (or the queue empties).
  const sessionTrackRef = useRef<{ startedAt: number; reviews: number; ended: boolean } | null>(null);
  useEffect(() => {
    if (!studyStarted || isLoading || sessionTrackRef.current || isAllDone) return;
    sessionTrackRef.current = { startedAt: Date.now(), reviews: 0, ended: false };
    track('study.session_start', {
      scope: deckId ? 'deck' : 'all',
      due: counts.new + counts.secondaryNew + counts.learning + counts.review,
      new_cards: counts.new + counts.secondaryNew,
      offline: !isOnline,
    });
  }, [studyStarted, isLoading, isAllDone, deckId, counts, isOnline]);
  useEffect(() => {
    const t = sessionTrackRef.current;
    if (isAllDone && t && !t.ended) {
      t.ended = true;
      track('study.session_end', { reviews: t.reviews, duration_ms: Date.now() - t.startedAt, reason: 'all_done' });
    }
  }, [isAllDone]);
  useEffect(() => () => {
    const t = sessionTrackRef.current;
    if (t && !t.ended) {
      t.ended = true;
      track('study.session_end', { reviews: t.reviews, duration_ms: Date.now() - t.startedAt, reason: 'leave' });
    }
  }, []);

  // Handle rating a card (called from StudyCard)
  const handleRateCard = useCallback((rating: Rating, timeSpentMs: number, userAnswer?: string, recordingBlob?: Blob) => {
    if (sessionTrackRef.current) sessionTrackRef.current.reviews++;
    rateCard(rating, timeSpentMs, userAnswer, recordingBlob);
  }, [rateCard]);

  // The close button just leaves: nothing ends. The card on screen (revealed or not, its answer,
  // a recording) and the undo are kept, and Study picks up right there next time
  // (services/studyResume.ts).
  // It goes BACK to whatever was open before Study (Home, a deck, the coach…). It used to push a
  // new "/" on top, which left Study underneath: the phone's back gesture from Home brought the
  // same study screen up again, once per visit. Opened straight into Study (a link, the widget):
  // Home replaces it.
  const leaveStudy = useCallback(() => {
    // react-router keeps the in-app history index in history.state.idx (0 = the page load's entry).
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (location.key !== 'default' && typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  }, [navigate, location.key]);

  // If study hasn't started (no autostart), redirect to home
  // The home page now handles deck selection and study initiation
  useEffect(() => {
    if (!studyStarted && !autostart) {
      navigate('/', { replace: true });
    }
  }, [studyStarted, autostart, navigate]);

  // Show loading while redirecting or loading data
  if (!studyStarted) {
    return <Loading />;
  }

  // Today's queue is empty - check that ALL queues are empty, not just that currentCard is null
  if (isAllDone) {
    // Number of bonus cards to add each time the user clicks "Study More"
    const BONUS_NEW_CARDS_INCREMENT = 10;

    const handleStudyMoreNewCards = () => {
      // Add more new cards to today's limit and reload the queue
      track('study.study_more', { count: BONUS_NEW_CARDS_INCREMENT });
      setBonusNewCards(prev => prev + BONUS_NEW_CARDS_INCREMENT);
      // Note: reloadQueue will be called when bonusNewCards changes via useEffect in the hook
      reloadQueue();
    };

    const accuracy = today && today.reviews > 0 ? Math.round((today.correct / today.reviews) * 100) : null;
    // 🎉 + confetti only for the finish being celebrated now (shared/study/celebration.ts).
    const quiet = !today?.celebrate;
    const title = today && today.reviews === 0 ? 'Nothing due right now' : quiet ? 'All done for now' : 'All Done!';

    return (
      <div className="page">
        {today?.celebrate && <Confetti />}
        <div className="container">
          <div className="card text-center study-done" style={{ padding: '1rem' }} data-testid="study-done">
            <div style={{ fontSize: '3rem' }}>{quiet ? '✅' : '🎉'}</div>
            <h1 className="mt-1">{title}</h1>
            <p className="text-light mt-1" style={{ fontSize: '0.875rem' }}>
              {hasMoreNewCards
                ? `You've finished your daily limit${bonusNewCards > 0 ? ` (+${bonusNewCards} bonus)` : ''}. Want to study more?`
                : 'Nothing else is due today. 明天见！'}
            </p>
            {today && today.reviews > 0 && (
              <div className="study-today" data-testid="study-today">
                <div className="study-today-line">{todayStudyLine(today.activeMs, today.reviews)}</div>
                {accuracy != null && <div className="study-today-sub text-light">{accuracy}% right today</div>}
              </div>
            )}
            <div className="flex flex-col gap-3 items-center mt-4">
              {canUndo && (
                <button
                  className="btn btn-secondary btn-block"
                  onClick={undoLastReview}
                >
                  ↺ Undo Last Review
                </button>
              )}
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
                onClick={leaveStudy}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active study - fullscreen mode
  return (
    <div className="study-page-fullscreen">
      {!isLoading && currentCard && <FirstCardExplainer />}
      {isLoading ? (
        <Loading />
      ) : currentCustomLesson && customLessonIntervalPreviews ? (
        <StudyCustomLesson
          key={`${currentCustomLesson.id}-${cardVersion}`}
          lesson={currentCustomLesson}
          intervalPreviews={customLessonIntervalPreviews}
          counts={counts}
          onComplete={completeCustomLesson}
          onEnd={leaveStudy}
        />
      ) : currentGrammar ? (
        <StudyGrammar
          key={`${currentGrammar.grammar_point_id}-${cardVersion}`}
          lesson={currentGrammar}
          counts={counts}
          onComplete={completeGrammar}
          onEnd={leaveStudy}
        />
      ) : currentReader ? (
        <StudyReader
          key={`${currentReader.id}-${cardVersion}`}
          reader={currentReader}
          counts={counts}
          isFinishing={false}
          onFinish={finishReader}
          onEnd={leaveStudy}
        />
      ) : currentCard && intervalPreviews ? (
        <StudyCard
          key={`${currentCard.id}-${cardVersion}`}
          card={currentCard}
          cardIsSecondaryNew={currentCardIsSecondaryNew}
          bumped={bumpedCardIds.has(currentCard.id) ? { fromName: bumps.get(currentCard.note.id)?.bumped_by_name ?? null } : null}
          intervalPreviews={intervalPreviews}
          counts={counts}
          tutors={tutors}
          isRating={isRating}
          canUndo={canUndo}
          onRate={handleRateCard}
          onUndo={undoLastReview}
          onEnd={leaveStudy}
          onUpdateNote={updateCurrentNote}
          onDeleteCurrentCard={() => removeNoteFromSession(currentCard.note.id)}
          resume={resume}
          scope={studyScope(deckId)}
        />
      ) : dailyReaderPending || grammarPending ? (
        // Cards are done but today's story/lesson is still being generated —
        // hold the session open; polling swaps this in when it's ready.
        <div className="container" style={{ textAlign: 'center', paddingTop: '3rem' }}>
          <div style={{ fontSize: '3rem' }}>{dailyReaderPending ? '✍️' : '🧩'}</div>
          <h2 className="mt-2">{dailyReaderPending ? "Writing today's story…" : "Preparing today's grammar lesson…"}</h2>
          <p className="text-light mt-1" style={{ fontSize: '0.875rem' }}>
            {dailyReaderPending
              ? 'Your graded reader is being generated and will appear here in a minute or two.'
              : 'Exercises are being generated and will appear here in a minute or two.'}
          </p>
          <span className="spinner" style={{ width: '28px', height: '28px', marginTop: '1rem' }} />
          <div className="mt-4">
            <button className="btn btn-secondary" onClick={leaveStudy}>
              Finish for today
            </button>
          </div>
        </div>
      ) : null}

    </div>
  );
}
