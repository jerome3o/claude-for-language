import type { NewCardOrderInfo, NewCardOrderUpdate, StudyBudget, StudyBudgetInfo, StudyBudgetUpdate } from '@shared/decks';
import type { CoachAction } from '@shared/coach';
import {
  Deck,
  LandingPage,
  Note,
  DeckWithNotes,
  NoteWithCards,
  CardWithNote,
  StudySession,
  SessionWithReviews,
  Rating,
  OverviewStats,
  DeckStats,
  GeneratedNote,
  AuthUser,
  AdminUser,
  QueueCounts,
  IntervalPreview,
  MyRelationships,
  TutorRelationshipWithUsers,
  RelationshipRole,
  ConversationWithLastMessage,
  Conversation,
  MessageWithSender,
  SharedDeckWithDetails,
  SharedDeckProgress,
  DeckProgress,
  StudentSharedDeckWithDetails,
  DeckTutorShare,
  StudentProgress,
  DailyActivitySummary,
  DayCardsDetail,
  CardReviewsDetail,
  MyDailyProgress,
  AIRespondResponse,
  ConversationTTSResponse,
  CheckMessageResponse,
  GeneratedNoteWithContext,
  SentenceBreakdown,
  SentenceCoachResult,
  SentenceExplanation,
  CoachConversation,
  CoachConversationListItem,
  CoachMessage,
  CoachToolResult,
  CreateRelationshipResult,
  GradedReader,
  GradedReaderWithPages,
  DifficultyLevel,
  NoteAudioRecording,
  ReaderPage,
  AppNotification,
  NoteSentence,
  SentenceBriefExplanation,
} from '../types';
import type { Quest, QuestSummary } from '@shared/quest';
import type { ConversationVoice, ConversationAudioPrefs } from '@shared/lesson';
import type { ConversationDelivery, TtsProviderId } from '@shared/tts';

export const API_BASE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : '';

/** Get the client's local date as YYYY-MM-DD (for timezone-correct daily limits). */
export function getLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const API_PATH = `${API_BASE}/api`;

// Session token for Authorization header (used when cookies don't work cross-origin)
let sessionToken: string | null = null;

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export function clearSessionToken() {
  sessionToken = null;
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }
  return headers;
}

export function getAuthToken(): string | null {
  return sessionToken;
}

// Event for handling unauthorized responses
export const authEvents = {
  onUnauthorized: () => {},
};

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers as Record<string, string>,
  };

  // Add Authorization header if we have a session token
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const response = await fetch(`${API_PATH}${url}`, {
    ...options,
    credentials: 'include', // Include cookies for authentication
    headers,
  });

  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw Object.assign(new Error(error.error || `HTTP ${response.status}`), { status: response.status });
  }

  return response.json();
}

/** The HTTP status of an error thrown by fetchJSON (undefined for a network error). */
export function apiErrorStatus(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

// ============ Auth ============

export async function getCurrentUser(): Promise<AuthUser> {
  return fetchJSON<AuthUser>('/auth/me');
}

export async function logout(): Promise<void> {
  await fetch(`${API_PATH}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

export function getLoginUrl(): string {
  return `${API_PATH}/auth/login`;
}

// ============ Admin ============

export async function getAdminUsers(): Promise<AdminUser[]> {
  return fetchJSON<AdminUser[]>('/admin/users');
}

export interface StorageStats {
  total_files: number;
  total_size_bytes: number;
  total_size_mb: number;
}

/** One registered R2 key prefix in a storage clean-up report (worker services/admin/storage-cleanup.ts). */
export interface StoragePrefixReport {
  prefix: string;
  what: string;
  /** Only collectable prefixes are ever deleted from. */
  collectable: boolean;
  protected_reason: string | null;
  objects: number;
  bytes: number;
  referenced: number;
  /** Unreferenced but younger than the minimum age — kept. */
  too_recent: number;
  unreferenced: number;
  unreferenced_bytes: number;
  sample_keys: string[];
}

/** Dry-run (or applied) storage clean-up report. */
export interface StorageCleanupReport {
  mode: 'dry_run' | 'applied' | 'refused';
  min_age_days: number;
  total: { objects: number; bytes: number };
  prefixes: StoragePrefixReport[];
  unknown: { objects: number; bytes: number; top_level: Record<string, number>; sample_keys: string[] };
  deletable: { count: number; bytes: number };
  warnings: string[];
  deleted: { count: number; bytes: number; failed: number };
}

export async function getStorageStats(): Promise<StorageStats> {
  return fetchJSON<StorageStats>('/admin/storage');
}

/** Dry run: what the clean-up would delete, per prefix. Deletes nothing. */
export async function getOrphanStats(): Promise<StorageCleanupReport> {
  return fetchJSON<StorageCleanupReport>('/admin/storage/orphans');
}

/** Actually delete the unreferenced, old-enough objects under collectable prefixes. */
export async function cleanupOrphans(): Promise<StorageCleanupReport> {
  return fetchJSON<StorageCleanupReport>('/admin/storage/cleanup?apply=1', { method: 'POST' });
}

// ============ Decks ============

export async function getDecks(): Promise<Deck[]> {
  return fetchJSON<Deck[]>('/decks');
}

export async function getDeck(id: string): Promise<DeckWithNotes> {
  return fetchJSON<DeckWithNotes>(`/decks/${id}`);
}

export async function createDeck(name: string, description?: string): Promise<Deck> {
  return fetchJSON<Deck>('/decks', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function updateDeck(
  id: string,
  updates: { name?: string; description?: string }
): Promise<Deck> {
  return fetchJSON<Deck>(`/decks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function updateDeckSettings(
  id: string,
  settings: {
    new_cards_per_day?: number;
    secondary_cards_per_day?: number;
    learning_steps?: string;
    graduating_interval?: number;
    easy_interval?: number;
    relearning_steps?: string;
    starting_ease?: number;
    minimum_ease?: number;
    maximum_ease?: number;
    interval_modifier?: number;
    hard_multiplier?: number;
    easy_bonus?: number;
  }
): Promise<Deck> {
  return fetchJSON<Deck>(`/decks/${id}/settings`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function deleteDeck(id: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/decks/${id}`, { method: 'DELETE' });
}

// ============ Notes ============

/** The learner's "long-term review" choice for one word (1 in, 0 out, null = follow the deck). Idempotent. */
export async function setNoteLongTermRemote(id: string, longTerm: 0 | 1 | null): Promise<{ id: string; long_term: 0 | 1 | null }> {
  return fetchJSON(`/notes/${encodeURIComponent(id)}/long-term`, {
    method: 'PUT',
    body: JSON.stringify({ long_term: longTerm }),
  });
}

export async function getNote(id: string): Promise<NoteWithCards> {
  return fetchJSON<NoteWithCards>(`/notes/${id}`);
}

export async function createNote(
  deckId: string,
  data: {
    hanzi: string;
    pinyin: string;
    english: string;
    fun_facts?: string;
    context?: string;
    sentence_clue?: string;
    sentence_clue_pinyin?: string;
    sentence_clue_translation?: string;
  },
  options: { skipCheck?: boolean } = {}
): Promise<NoteWithCards> {
  // The server makes the cards, the word and sentence clips, and queues the sentence set
  // (and a word check, unless the caller already checked the row — Paste a list's preview).
  return fetchJSON<NoteWithCards>(`/decks/${deckId}/notes${options.skipCheck ? '?check=none' : ''}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** One note in a batch create (`POST /api/decks/:deckId/notes/batch`). */
export interface BatchNoteInput {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
}

export interface BatchNotesResult {
  created: Array<{ id: string; hanzi: string }>;
  failed: Array<{ index: number; hanzi: string; error: string }>;
  /** With skipExisting: rows not added because the word is already in one of my decks. */
  existing?: Array<{ index: number; hanzi: string; note_id: string; deck_name: string }>;
}

/** Many notes in one call (≤ 500); per-row failures come back in `failed`. Audio is queued. */
export async function createNotesBatch(deckId: string, notes: BatchNoteInput[], opts: { skipExisting?: boolean } = {}): Promise<BatchNotesResult> {
  return fetchJSON<BatchNotesResult>(`/decks/${deckId}/notes/batch${opts.skipExisting ? '?skip_existing=1' : ''}`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export async function updateNote(
  id: string,
  updates: { hanzi?: string; pinyin?: string; english?: string; fun_facts?: string; sentence_clue?: string | null; sentence_clue_pinyin?: string | null; sentence_clue_translation?: string | null; sentence_clue_audio_url?: string | null; pinyin_only?: number; alternatives?: string | null }
): Promise<NoteWithCards> {
  return fetchJSON<NoteWithCards>(`/notes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export interface EnrichWordInput { hanzi: string; pinyin?: string; english?: string; fun_facts?: string; sentence_clue?: string }
export interface EnrichWordOutput { hanzi: string; fun_facts: string; sentence_clue: string; sentence_clue_pinyin: string; sentence_clue_translation: string }

/** Write the explanation + example sentence (card standard) for up to 30 pasted words; blanks only. */
export async function enrichWords(words: EnrichWordInput[]): Promise<EnrichWordOutput[]> {
  const res = await fetchJSON<{ words: EnrichWordOutput[] }>('/ai/enrich-words', {
    method: 'POST',
    body: JSON.stringify({ words }),
  });
  return res.words;
}

/** Fill in missing pinyin / English for pasted words (Haiku, one call, ≤100 words). */
export async function glossWords(
  words: Array<{ hanzi: string; pinyin?: string; english?: string }>
): Promise<Array<{ hanzi: string; pinyin: string; english: string }>> {
  const res = await fetchJSON<{ words: Array<{ hanzi: string; pinyin: string; english: string }> }>('/ai/gloss-words', {
    method: 'POST',
    body: JSON.stringify({ words }),
  });
  return res.words;
}

export interface DeckStudentShare {
  shared_deck_id: string;
  relationship_id: string;
  target_deck_id: string;
  shared_at: string;
  student_id: string;
  student_name: string;
  target_deleted: boolean;
  /** Words in this deck the student's copy does not have. */
  notes_missing: number;
  /** Words whose text was edited here after the copy was last touched. */
  notes_behind: number;
}

/** A tutor's copies of this deck in students' accounts (empty for a student's own deck). */
export async function getDeckStudentShares(deckId: string): Promise<DeckStudentShare[]> {
  const res = await fetchJSON<{ shares: DeckStudentShare[] }>(`/decks/${deckId}/student-shares`);
  return res.shares;
}

export interface GenerateAudioOptions {
  speed?: number; // 0.3 - 1.5, default 0.8 for MiniMax, 0.9 for Google
  provider?: 'minimax' | 'gtts'; // Prefer a specific provider
  voiceId?: string; // MiniMax voice ID (only used when provider is minimax)
}

export async function generateNoteAudio(noteId: string, options?: GenerateAudioOptions): Promise<Note> {
  return fetchJSON<Note>(`/notes/${noteId}/generate-audio`, {
    method: 'POST',
    body: options ? JSON.stringify(options) : undefined,
  });
}

/** What `POST /api/notes/:id/ensure-audio` did with each clip (docs/AUDIO.md). */
export type EnsureClipOutcome = 'ok' | 'copied' | 'generated' | 'queued' | 'failed' | 'none';

export interface EnsureNoteAudioResponse {
  note: Note | null;
  word: EnsureClipOutcome;
  sentence: EnsureClipOutcome;
}

/**
 * Make sure a note's word + example-sentence clips exist (idempotent). `broken`:
 * clip keys this device got an error for — only really missing ones are remade.
 * A clip MiniMax can't make right now comes back `queued`: it is coming.
 */
export async function ensureNoteAudio(noteId: string, broken: string[] = []): Promise<EnsureNoteAudioResponse> {
  return fetchJSON<EnsureNoteAudioResponse>(`/notes/${noteId}/ensure-audio`, {
    method: 'POST',
    body: JSON.stringify(broken.length ? { broken } : {}),
  });
}

export interface AudioQualityCounts {
  minimax: number;
  gtts: number;
  unknown: number;
}

export interface AudioQualityStats {
  notes: AudioQualityCounts;
  clues: AudioQualityCounts;
  sentences: AudioQualityCounts;
}

/** How many clips came from each TTS provider. gtts = the low-quality fallback. */
export async function getAudioQuality(): Promise<AudioQualityStats> {
  return fetchJSON<AudioQualityStats>('/audio-quality');
}

/** Work out the provider of clips stored before it was recorded (one batch). */
export async function classifyAudio(limit?: number): Promise<{ classified: number; found_fallback: number; remaining: boolean }> {
  return fetchJSON('/audio-quality/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
}

/** Queue replacement of Google-fallback clips with MiniMax (one batch). */
export async function regenerateFallbackAudio(limit?: number): Promise<{ queued: number; remaining: number }> {
  return fetchJSON('/audio-quality/regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
}

export async function regenerateNoteAudio(noteId: string): Promise<Note> {
  return fetchJSON<Note>(`/notes/${noteId}/regenerate-audio`, {
    method: 'POST',
  });
}

export async function generateSentenceClue(
  noteId: string,
  options?: { modifier?: 'simple' | 'complex' | 'variation' | 'custom'; customPrompt?: string }
): Promise<Note> {
  return fetchJSON<Note>(`/notes/${noteId}/generate-sentence-clue`, {
    method: 'POST',
    body: options ? JSON.stringify(options) : undefined,
  });
}

// ============ Sentence sets ============

export interface GenerateSentenceSetOptions {
  /** How many sentences to generate (3-10, default 6). */
  count?: number;
  /** Extra instructions from the learner. */
  customPrompt?: string;
  /** Append to the existing set instead of replacing it. */
  keepExisting?: boolean;
}

export async function fetchNoteSentences(noteId: string): Promise<NoteSentence[]> {
  const data = await fetchJSON<{ sentences: NoteSentence[] }>(`/notes/${noteId}/sentences`);
  return data.sentences || [];
}

/** `POST /api/sentences/:id/ensure-audio`: a set row's clip — ready (+ audio_url) · queued (ask again) · failed. */
export interface SentenceAudioAnswer {
  status: 'ready' | 'queued' | 'failed';
  audio_url: string | null;
}

export async function ensureSentenceAudio(sentenceId: string): Promise<SentenceAudioAnswer> {
  return fetchJSON<SentenceAudioAnswer>(`/sentences/${sentenceId}/ensure-audio`, { method: 'POST' });
}

export async function generateNoteSentenceSet(
  noteId: string,
  options?: GenerateSentenceSetOptions
): Promise<NoteSentence[]> {
  const data = await fetchJSON<{ sentences: NoteSentence[] }>(
    `/notes/${noteId}/sentences/generate`,
    {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }
  );
  return data.sentences || [];
}

export async function deleteNoteSentenceSet(noteId: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/notes/${noteId}/sentences`, { method: 'DELETE' });
}

export interface SentenceCoverageStats {
  notes: {
    total: number;
    with_clue: number;
    with_clue_audio: number;
    with_note_audio: number;
    with_set: number;
    with_full_set: number;
  };
  sentences: { total: number; with_audio: number; with_explanation: number };
  cards: { total: number; new: number; learning: number; review: number; relearning: number };
  jobs: { queued: number; done: number; error: number; stale_queued: number; exhausted: number };
  recent_errors: Array<{
    note_id: string;
    hanzi: string;
    attempts: number;
    error: string | null;
    updated_at: string;
  }>;
  decks: Array<{ id: string; name: string; notes: number; with_clue: number; with_set: number }>;
}

/**
 * Backfill audio for card sentences that have none. Queued server-side, so
 * this returns as soon as the batch is enqueued.
 */
export async function backfillClueAudio(
  limit?: number
): Promise<{ queued: number; remaining: number }> {
  return fetchJSON<{ queued: number; remaining: number }>('/sentences/clue-audio', {
    method: 'POST',
    body: JSON.stringify({ limit }),
  });
}

/** Coverage + background-job state for the sentence overview in settings. */
export async function getSentenceCoverageStats(): Promise<SentenceCoverageStats> {
  return fetchJSON<SentenceCoverageStats>('/sentences/stats');
}

/**
 * Ask the server to top up the backlog of notes without a sentence set.
 * `noteIds` are generated first — pass the notes the learner is about to see.
 */
export async function prefetchSentenceSets(
  noteIds: string[],
  limit?: number
): Promise<{ queued: number; remaining: number }> {
  return fetchJSON<{ queued: number; remaining: number }>('/sentences/prefetch', {
    method: 'POST',
    body: JSON.stringify({ note_ids: noteIds, limit }),
  });
}

/** Brief breakdown of one sentence. Cached server-side after the first call. */
export async function explainNoteSentence(
  sentenceId: string
): Promise<SentenceBriefExplanation> {
  const data = await fetchJSON<{ explanation: SentenceBriefExplanation }>(
    `/sentences/${sentenceId}/explain`,
    { method: 'POST' }
  );
  return data.explanation;
}

/**
 * Breakdown of a sentence that isn't a stored set row (the card's own example
 * sentence). Not cached server-side — there's no row to hang it on.
 */
export async function explainSentenceText(sentence: {
  hanzi: string;
  pinyin?: string | null;
  translation?: string | null;
}): Promise<SentenceBriefExplanation> {
  const data = await fetchJSON<{ explanation: SentenceBriefExplanation }>(
    '/sentences/explain-text',
    { method: 'POST', body: JSON.stringify(sentence) }
  );
  return data.explanation;
}

export async function fetchSentenceChanges(
  since: string | null
): Promise<{ sentences: NoteSentence[]; server_time: string }> {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  return fetchJSON<{ sentences: NoteSentence[]; server_time: string }>(
    `/sentences/changes${query}`
  );
}

export async function generateFunFact(noteId: string): Promise<Note> {
  return fetchJSON<Note>(`/notes/${noteId}/generate-fun-fact`, {
    method: 'POST',
  });
}

export async function generateMultipleChoice(noteId: string): Promise<Note> {
  return fetchJSON<Note>(`/notes/${noteId}/generate-multiple-choice`, {
    method: 'POST',
  });
}

export async function regenerateAllDeckAudio(deckId: string, noteIds?: string[]): Promise<{ regenerating: number; message: string }> {
  return fetchJSON<{ regenerating: number; message: string }>(`/decks/${deckId}/regenerate-all-audio`, {
    method: 'POST',
    body: noteIds ? JSON.stringify({ noteIds }) : undefined,
  });
}

export async function deleteNote(id: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/notes/${id}`, { method: 'DELETE' });
}

export interface NoteReviewHistory {
  card_type: string;
  card_stats: {
    ease_factor: number;
    interval: number;
    repetitions: number;
    next_review_at: string | null;
  };
  reviews: Array<{
    id: string;
    rating: number;
    time_spent_ms: number | null;
    user_answer: string | null;
    recording_url: string | null;
    reviewed_at: string;
  }>;
}

export async function getNoteHistory(noteId: string): Promise<NoteReviewHistory[]> {
  return fetchJSON<NoteReviewHistory[]>(`/notes/${noteId}/history`);
}

export interface NoteQuestion {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
}

export interface AskToolResult {
  tool: 'edit_current_card' | 'create_flashcards' | 'delete_current_card' | 'create_custom_lesson';
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ReadOnlyToolCall {
  tool: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface NoteQuestionWithTools extends NoteQuestion {
  toolResults?: AskToolResult[];
  readOnlyToolCalls?: ReadOnlyToolCall[];
}

export async function askAboutNote(
  noteId: string,
  question: string,
  context?: { userAnswer?: string; correctAnswer?: string; cardType?: string },
  conversationHistory?: { question: string; answer: string }[]
): Promise<NoteQuestionWithTools> {
  const res = await fetchJSON<NoteQuestionWithTools>(`/notes/${noteId}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question, context, conversationHistory }),
  });
  // Claude bumped words I already have ("⚡ Study it today"): pull the pocket now.
  if (res.readOnlyToolCalls?.some((c) => c.tool === 'bump_cards')) {
    void import('../services/studyBumps').then((m) => m.syncBumps()).catch(() => undefined);
  }
  return res;
}

/** Server-side search of my notes (the fallback when this device has no matching notes). */
export async function searchNotesOnServer(q: string, limit = 50): Promise<{ notes: Array<Note & { deck_name: string }>; total_notes: number }> {
  return fetchJSON(`/notes/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export async function getNoteQuestions(noteId: string): Promise<NoteQuestion[]> {
  return fetchJSON<NoteQuestion[]>(`/notes/${noteId}/questions`);
}

// ============ Cards ============

export async function getDueCards(options?: {
  deckId?: string;
  includeNew?: boolean;
  limit?: number;
}): Promise<CardWithNote[]> {
  const params = new URLSearchParams();
  if (options?.deckId) params.set('deck_id', options.deckId);
  if (options?.includeNew !== undefined) params.set('include_new', String(options.includeNew));
  if (options?.limit) params.set('limit', String(options.limit));

  const query = params.toString();
  return fetchJSON<CardWithNote[]>(`/cards/due${query ? `?${query}` : ''}`);
}

export async function getCard(id: string): Promise<CardWithNote> {
  return fetchJSON<CardWithNote>(`/cards/${id}`);
}

// Queue counts for Anki-style display
export async function getQueueCounts(deckId?: string): Promise<QueueCounts> {
  const params = new URLSearchParams();
  if (deckId) params.set('deck_id', deckId);
  params.set('local_date', getLocalDateString());
  const query = params.toString();
  return fetchJSON<QueueCounts>(`/cards/queue-counts${query ? `?${query}` : ''}`);
}

// Get next card to study with interval previews
export interface NextCardResponse {
  card: CardWithNote | null;
  counts: QueueCounts;
  intervalPreviews?: Record<Rating, IntervalPreview>;
  hasMoreNewCards?: boolean;
}

export async function getNextCard(
  deckId?: string,
  excludeNoteIds: string[] = [],
  ignoreDailyLimit: boolean = false
): Promise<NextCardResponse> {
  const params = new URLSearchParams();
  if (deckId) params.set('deck_id', deckId);
  if (excludeNoteIds.length > 0) params.set('exclude_notes', excludeNoteIds.join(','));
  if (ignoreDailyLimit) params.set('ignore_daily_limit', 'true');
  params.set('local_date', getLocalDateString());
  const query = params.toString();
  return fetchJSON<NextCardResponse>(`/study/next-card${query ? `?${query}` : ''}`);
}

// Submit review with Anki-style scheduling
export interface ReviewResponse {
  review: { id: string } | null;
  counts: QueueCounts;
  next_queue: number;
  next_interval: number;
  next_due: string;
}

export async function submitReview(data: {
  card_id: string;
  rating: Rating;
  time_spent_ms?: number;
  user_answer?: string;
  session_id?: string;
}): Promise<ReviewResponse> {
  return fetchJSON<ReviewResponse>('/study/review', {
    method: 'POST',
    body: JSON.stringify({ ...data, local_date: getLocalDateString() }),
  });
}

// ============ Study Sessions ============

export async function startSession(deckId?: string): Promise<StudySession> {
  return fetchJSON<StudySession>('/study/sessions', {
    method: 'POST',
    body: JSON.stringify({ deck_id: deckId }),
  });
}

export async function getSession(id: string): Promise<SessionWithReviews> {
  return fetchJSON<SessionWithReviews>(`/study/sessions/${id}`);
}

export async function recordReview(
  sessionId: string,
  data: {
    card_id: string;
    rating: Rating;
    time_spent_ms?: number;
    user_answer?: string;
  }
): Promise<{ review: { id: string }; next_review_at: string; interval: number }> {
  return fetchJSON(`/study/sessions/${sessionId}/reviews`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function completeSession(id: string): Promise<StudySession> {
  return fetchJSON<StudySession>(`/study/sessions/${id}/complete`, {
    method: 'PUT',
  });
}

// ============ Note Audio Recordings ============

export async function getNoteAudioRecordings(noteId: string): Promise<NoteAudioRecording[]> {
  return fetchJSON<NoteAudioRecording[]>(`/notes/${noteId}/audio`);
}

export async function addNoteAudioRecording(
  noteId: string,
  audioBlob: Blob,
  speakerName?: string
): Promise<NoteAudioRecording> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.webm');
  if (speakerName) {
    formData.append('speaker_name', speakerName);
  }

  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const response = await fetch(`${API_PATH}/notes/${noteId}/audio`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });

  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    throw new Error('Failed to upload audio recording');
  }

  return response.json();
}

export async function generateNoteAudioRecording(
  noteId: string,
  provider: 'minimax' | 'gtts' = 'gtts',
  options?: { speed?: number; voiceId?: string; speakerName?: string }
): Promise<NoteAudioRecording> {
  return fetchJSON<NoteAudioRecording>(`/notes/${noteId}/audio`, {
    method: 'POST',
    body: JSON.stringify({ generate: true, provider, ...options }),
  });
}

export async function setAudioRecordingPrimary(
  noteId: string,
  recordingId: string
): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/notes/${noteId}/audio/${recordingId}/primary`, {
    method: 'PUT',
  });
}

export async function deleteAudioRecording(
  noteId: string,
  recordingId: string
): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/notes/${noteId}/audio/${recordingId}`, {
    method: 'DELETE',
  });
}

// ============ Audio ============

export async function uploadRecording(cardId: string, audioBlob: Blob): Promise<{ url: string }> {
  console.log('[uploadRecording] Starting upload for card:', cardId);
  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.webm');
  formData.append('card_id', cardId); // Server finds the most recent review for this card

  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  console.log('[uploadRecording] Sending request to:', `${API_PATH}/audio/upload`);
  const response = await fetch(`${API_PATH}/audio/upload`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });

  console.log('[uploadRecording] Response status:', response.status);

  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[uploadRecording] Error response:', errorText);
    throw new Error('Failed to upload recording: ' + errorText);
  }

  const result = await response.json();
  console.log('[uploadRecording] Success:', result);
  return result;
}

export function getAudioUrl(key: string): string {
  return `${API_PATH}/audio/${key}`;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  /** Which server provider answered the upload (whisper | soniox | gemini). */
  provider?: string;
}

/** POST /api/transcribe/live — a short-lived Soniox key for streaming, or { provider: 'upload' }. */
export async function getLiveTranscriptionSession(): Promise<import('@shared/transcription/soniox').LiveTranscriptionSession> {
  return fetchJSON('/transcribe/live', { method: 'POST' });
}

/**
 * POST /api/transcribe — the upload path. `liveError` says why the live stream gave nothing
 * (logged by the server, so a broken live path shows up in its logs).
 */
export async function transcribeAudio(audioBlob: Blob, opts: { liveError?: string | null } = {}): Promise<TranscriptionResult> {
  const formData = new FormData();
  const ext = audioBlob.type.includes('mp4') ? 'm4a' : audioBlob.type.includes('ogg') ? 'ogg' : audioBlob.type.includes('wav') ? 'wav' : 'webm';
  formData.append('file', audioBlob, `recording.${ext}`);
  formData.append('client', 'web');
  if (opts.liveError) formData.append('live_error', opts.liveError.slice(0, 200));

  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const response = await fetch(`${API_PATH}/transcribe`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });

  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    throw new Error('Transcription failed');
  }

  return response.json();
}

// ============ AI Generation ============

export async function generateDeck(
  prompt: string,
  deckName?: string
): Promise<{ deck: Deck; notes: NoteWithCards[] }> {
  return fetchJSON('/ai/generate-deck', {
    method: 'POST',
    body: JSON.stringify({ prompt, deck_name: deckName }),
  });
}

export async function suggestCards(
  context: string,
  count?: number
): Promise<{ suggestions: GeneratedNote[] }> {
  return fetchJSON('/ai/suggest-cards', {
    method: 'POST',
    body: JSON.stringify({ context, count }),
  });
}

// ============ Statistics ============

export async function getOverviewStats(): Promise<OverviewStats> {
  return fetchJSON<OverviewStats>('/stats/overview');
}

export async function getDeckStats(deckId: string): Promise<DeckStats> {
  return fetchJSON<DeckStats>(`/stats/deck/${deckId}`);
}

// ============ Relationships (Tutor-Student) ============

export async function getMyRelationships(): Promise<MyRelationships> {
  return fetchJSON<MyRelationships>('/relationships');
}

export async function createRelationship(
  recipientEmail: string,
  role: RelationshipRole
): Promise<CreateRelationshipResult> {
  return fetchJSON<CreateRelationshipResult>('/relationships', {
    method: 'POST',
    body: JSON.stringify({ recipient_email: recipientEmail, role }),
  });
}

export async function cancelInvitation(id: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/invitations/${id}`, { method: 'DELETE' });
}

export async function getRelationship(id: string): Promise<TutorRelationshipWithUsers> {
  return fetchJSON<TutorRelationshipWithUsers>(`/relationships/${id}`);
}

export async function acceptRelationship(id: string): Promise<TutorRelationshipWithUsers> {
  return fetchJSON<TutorRelationshipWithUsers>(`/relationships/${id}/accept`, {
    method: 'POST',
  });
}

export async function removeRelationship(id: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/relationships/${id}`, { method: 'DELETE' });
}

export async function getStudentProgress(relationshipId: string): Promise<StudentProgress> {
  return fetchJSON<StudentProgress>(`/relationships/${relationshipId}/student-progress`);
}

// ============ Conversations ============

export async function getConversations(relationshipId: string): Promise<ConversationWithLastMessage[]> {
  return fetchJSON<ConversationWithLastMessage[]>(`/relationships/${relationshipId}/conversations`);
}

export interface CreateConversationOptions {
  title?: string;
  scenario?: string;
  user_role?: string;
  ai_role?: string;
  voice_id?: string;
  voice_speed?: number;
}

export async function createConversation(
  relationshipId: string,
  options?: CreateConversationOptions
): Promise<Conversation> {
  return fetchJSON<Conversation>(`/relationships/${relationshipId}/conversations`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

export interface ChatReadState {
  /** created_at of the newest message I have read (docs/CHAT.md §2). */
  me: string | null;
  /** created_at of the newest message the other person has read. */
  other: string | null;
}

export interface MessagesResponse {
  messages: MessageWithSender[];
  latest_timestamp: string | null;
  /** Present once the server has conversation_reads (docs/CHAT.md). */
  read_state?: ChatReadState;
}

export interface MarkReadResponse {
  conversation_id: string;
  last_read_at: string;
  unread: number;
}

/** Move my read marker forward to `upTo` (a message created_at; default = newest). */
export async function markConversationRead(conversationId: string, upTo?: string): Promise<MarkReadResponse> {
  return fetchJSON<MarkReadResponse>(`/conversations/${conversationId}/read`, {
    method: 'POST',
    body: JSON.stringify(upTo ? { up_to: upTo } : {}),
  });
}

export async function getMessages(
  conversationId: string,
  since?: string
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  const query = params.toString();
  return fetchJSON<MessagesResponse>(
    `/conversations/${conversationId}/messages${query ? `?${query}` : ''}`
  );
}

export async function sendMessage(
  conversationId: string,
  content: string,
  replyToMessageId?: string
): Promise<MessageWithSender> {
  return fetchJSON<MessageWithSender>(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, reply_to_message_id: replyToMessageId }),
  });
}

export async function toggleMessageReaction(
  messageId: string,
  emoji: string
): Promise<{ added: boolean }> {
  return fetchJSON<{ added: boolean }>(`/messages/${messageId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}

export async function getMessageDiscussion(
  messageId: string
): Promise<{ id: string; messages: Array<{ role: string; content: string }> }> {
  return fetchJSON<{ id: string; messages: Array<{ role: string; content: string }> }>(
    `/messages/${messageId}/discussion`
  );
}

export async function saveMessageDiscussion(
  messageId: string,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/messages/${messageId}/discussion`, {
    method: 'PUT',
    body: JSON.stringify({ messages }),
  });
}

export interface GeneratedFlashcard {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
}

export async function generateFlashcardFromChat(
  conversationId: string,
  messageIds?: string[]
): Promise<{ flashcard: GeneratedFlashcard }> {
  return fetchJSON<{ flashcard: GeneratedFlashcard }>(
    `/conversations/${conversationId}/generate-flashcard`,
    {
      method: 'POST',
      body: JSON.stringify({ message_ids: messageIds }),
    }
  );
}

export async function generateResponseOptions(
  conversationId: string,
  input?: { intendedMeaning: string; guess?: string }
): Promise<{ explanation?: string; options: GeneratedNoteWithContext[] }> {
  return fetchJSON<{ explanation?: string; options: GeneratedNoteWithContext[] }>(
    `/conversations/${conversationId}/generate-response-options`,
    {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }
  );
}

// ============ AI Conversation ============

export async function getAIResponse(conversationId: string): Promise<AIRespondResponse> {
  return fetchJSON<AIRespondResponse>(`/conversations/${conversationId}/ai-respond`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function initiateAIConversation(conversationId: string): Promise<AIRespondResponse> {
  return fetchJSON<AIRespondResponse>(`/conversations/${conversationId}/ai-initiate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function generateConversationTTS(
  conversationId: string,
  text: string,
  voiceId?: string,
  voiceSpeed?: number
): Promise<ConversationTTSResponse> {
  return fetchJSON<ConversationTTSResponse>(`/conversations/${conversationId}/tts`, {
    method: 'POST',
    body: JSON.stringify({ text, voice_id: voiceId, voice_speed: voiceSpeed }),
  });
}

export async function checkMessage(messageId: string): Promise<CheckMessageResponse> {
  return fetchJSON<CheckMessageResponse>(`/messages/${messageId}/check`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function uploadMessageRecording(
  messageId: string,
  audioBlob: Blob
): Promise<{ recording_url: string }> {
  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const response = await fetch(`${API_PATH}/messages/${messageId}/recording`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...headers,
      'Content-Type': 'audio/webm',
    },
    body: audioBlob,
  });

  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function discussMessage(
  messageId: string,
  question: string,
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[]
): Promise<{ response: string; flashcards: GeneratedNote[] | null }> {
  return fetchJSON<{ response: string; flashcards: GeneratedNote[] | null }>(
    `/messages/${messageId}/discuss`,
    {
      method: 'POST',
      body: JSON.stringify({ question, conversationHistory }),
    }
  );
}

export interface TranslateFlashcardResponse {
  translation: string;
  flashcard: {
    hanzi: string;
    pinyin: string;
    english: string;
    fun_facts?: string;
    context?: string;
  };
}

export async function translateMessageFlashcard(
  messageId: string
): Promise<TranslateFlashcardResponse> {
  return fetchJSON<TranslateFlashcardResponse>(
    `/messages/${messageId}/translate-flashcard`,
    { method: 'POST' }
  );
}

export interface VocabularyDefinition {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
  example?: string;
}

/**
 * Translate one chat message (the message menu's Translate): one short reply, cached
 * on the message for both people. Gives up after 30 s so the button never spins on.
 */
export async function translateMessage(messageId: string): Promise<{ translation: string }> {
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(30_000) : undefined;
  try {
    return await fetchJSON<{ translation: string }>(`/messages/${messageId}/translate`, { method: 'POST', signal });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('It took too long — try again.');
    }
    throw error;
  }
}

export async function translateMessageSegmented(
  messageId: string
): Promise<{ translation: string; segmentation: SentenceBreakdown }> {
  return fetchJSON<{ translation: string; segmentation: SentenceBreakdown }>(
    `/messages/${messageId}/translate-segmented`,
    { method: 'POST' }
  );
}

// ============ Character dictionary (routes/chars.ts) ============

export async function fetchCharRecord(char: string): Promise<{ version: number; record: import('@shared/chars/types').CharRecord }> {
  return fetchJSON(`/chars/${encodeURIComponent(char)}`);
}

export async function fetchCharRecords(chars: string): Promise<{
  version: number;
  records: Record<string, import('@shared/chars/types').CharRecord>;
  missing: string[];
}> {
  return fetchJSON(`/chars?c=${encodeURIComponent(chars)}`);
}

/** The language explorer's word dictionary (≤ 50 words a call; docs/LANGUAGE_EXPLORER.md). */
export async function fetchWordRecords(words: readonly string[]): Promise<{
  version: number;
  records: Record<string, import('@shared/chars/types').WordRecord>;
  missing: string[];
}> {
  return fetchJSON(`/words?w=${encodeURIComponent(words.join(','))}`);
}

export async function fetchCharExplanation(char: string): Promise<{ char: string; explanation: string; cached: boolean }> {
  return fetchJSON(`/chars/${encodeURIComponent(char)}/explain`, { method: 'POST' });
}

export async function defineVocabulary(
  hanzi: string,
  context?: string,
  skipCache?: boolean
): Promise<VocabularyDefinition> {
  return fetchJSON<VocabularyDefinition>(`/vocabulary/define`, {
    method: 'POST',
    body: JSON.stringify({ hanzi, context, skipCache }),
  });
}

export async function textToFlashcard(
  text: string
): Promise<{ hanzi: string; pinyin: string; english: string; fun_facts?: string }> {
  return fetchJSON(`/text-to-flashcard`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/** One conversation; a merged-away id (one chat per pair) answers with the chat it became (`merged_from` = the id asked for). */
export async function getConversation(conversationId: string): Promise<Conversation & { merged_from?: string | null }> {
  return fetchJSON<Conversation & { merged_from?: string | null }>(`/conversations/${conversationId}`);
}

export async function updateConversationVoiceSettings(
  conversationId: string,
  voiceId?: string,
  voiceSpeed?: number
): Promise<Conversation> {
  return fetchJSON<Conversation>(`/conversations/${conversationId}/voice-settings`, {
    method: 'PATCH',
    body: JSON.stringify({ voice_id: voiceId, voice_speed: voiceSpeed }),
  });
}

// ============ Deck Sharing ============

export async function shareDeck(
  relationshipId: string,
  deckId: string,
  priority: 'core' | 'non_urgent' = 'core'
): Promise<SharedDeckWithDetails> {
  return fetchJSON<SharedDeckWithDetails>(`/relationships/${relationshipId}/share-deck`, {
    method: 'POST',
    body: JSON.stringify({ deck_id: deckId, priority }),
  });
}

/** The learner's daily new-card budget across all decks. */
export async function updateStudyBudget(budget: StudyBudgetUpdate): Promise<StudyBudgetInfo> {
  return fetchJSON('/profile/study-budget', { method: 'PUT', body: JSON.stringify(budget) });
}

/** "Order new cards by" (shared/decks/new-card-order.ts): `{ reset: true }` = every default. */
export async function updateNewCardOrder(update: NewCardOrderUpdate | { reset: true }): Promise<NewCardOrderInfo> {
  return fetchJSON('/profile/new-card-order', { method: 'PUT', body: JSON.stringify(update) });
}

/** The tutor's view of a student's daily new-card budget (+ the deck at the top of their queue, for the hint). */
export interface StudentStudyBudget {
  budget: StudyBudgetInfo;
  default: StudyBudget;
  top_deck: { id: string; name: string; words_to_go: number } | null;
}

export async function getStudentStudyBudget(relId: string): Promise<StudentStudyBudget> {
  return fetchJSON(`/relationships/${relId}/student-study-budget`);
}

/** Tutor only: set the student's budget (null = back to the default); posts a chat message from the tutor. */
export async function setStudentStudyBudget(relId: string, update: StudyBudgetUpdate): Promise<{ budget: StudyBudgetInfo; changed: boolean; message_sent: boolean }> {
  return fetchJSON(`/relationships/${relId}/student-study-budget`, { method: 'PUT', body: JSON.stringify(update) });
}

/** Move a deck to the top or bottom of the new-card queue. */
export async function moveDeck(deckId: string, to: 'top' | 'bottom'): Promise<Deck> {
  return fetchJSON<Deck>(`/decks/${deckId}/move`, { method: 'POST', body: JSON.stringify({ to }) });
}

/** Set the whole queue order: first id = studied first. */
export async function reorderDecks(deckIds: string[]): Promise<{ reordered: number }> {
  return fetchJSON('/decks/reorder', { method: 'PUT', body: JSON.stringify({ deck_ids: deckIds }) });
}

export async function getSharedDecks(relationshipId: string): Promise<SharedDeckWithDetails[]> {
  return fetchJSON<SharedDeckWithDetails[]>(`/relationships/${relationshipId}/shared-decks`);
}

export async function getSharedDeckProgress(
  relationshipId: string,
  sharedDeckId: string
): Promise<SharedDeckProgress> {
  return fetchJSON<SharedDeckProgress>(
    `/relationships/${relationshipId}/shared-decks/${sharedDeckId}/progress`
  );
}

// ============ Student Deck Sharing (student shares deck with tutor) ============

export async function studentShareDeck(
  relationshipId: string,
  deckId: string
): Promise<StudentSharedDeckWithDetails> {
  return fetchJSON<StudentSharedDeckWithDetails>(`/relationships/${relationshipId}/student-share-deck`, {
    method: 'POST',
    body: JSON.stringify({ deck_id: deckId }),
  });
}

export async function getStudentSharedDecks(relationshipId: string): Promise<StudentSharedDeckWithDetails[]> {
  return fetchJSON<StudentSharedDeckWithDetails[]>(`/relationships/${relationshipId}/student-shared-decks`);
}

export async function unshareStudentDeck(
  relationshipId: string,
  deckId: string
): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/relationships/${relationshipId}/student-shared-decks/${deckId}`, {
    method: 'DELETE',
  });
}

export async function getStudentSharedDeckProgress(
  relationshipId: string,
  studentSharedDeckId: string
): Promise<SharedDeckProgress> {
  return fetchJSON<SharedDeckProgress>(
    `/relationships/${relationshipId}/student-shared-decks/${studentSharedDeckId}/progress`
  );
}

export async function getDeckTutorShares(deckId: string): Promise<DeckTutorShare[]> {
  return fetchJSON<DeckTutorShare[]>(`/decks/${deckId}/tutor-shares`);
}

// Get progress for user's own deck
export async function getDeckProgress(deckId: string): Promise<DeckProgress> {
  return fetchJSON<DeckProgress>(`/decks/${deckId}/progress`);
}

// ============ Student Progress (Enhanced) ============

export async function getStudentDailyProgress(relationshipId: string): Promise<DailyActivitySummary> {
  return fetchJSON<DailyActivitySummary>(`/relationships/${relationshipId}/student-progress/daily`);
}

export async function getStudentDayCards(relationshipId: string, date: string): Promise<DayCardsDetail> {
  return fetchJSON<DayCardsDetail>(`/relationships/${relationshipId}/student-progress/day/${date}`);
}

export async function getStudentCardReviews(
  relationshipId: string,
  date: string,
  cardId: string
): Promise<CardReviewsDetail> {
  return fetchJSON<CardReviewsDetail>(
    `/relationships/${relationshipId}/student-progress/day/${date}/card/${cardId}`
  );
}

// ============ My Progress (Self-view) ============

export async function getMyDailyProgress(): Promise<MyDailyProgress> {
  return fetchJSON<MyDailyProgress>('/progress/daily');
}

export async function getMyDayCards(date: string): Promise<DayCardsDetail> {
  return fetchJSON<DayCardsDetail>(`/progress/day/${date}`);
}

export async function getMyCardReviews(date: string, cardId: string): Promise<CardReviewsDetail> {
  return fetchJSON<CardReviewsDetail>(`/progress/day/${date}/card/${cardId}`);
}

// ============ Sentence Analysis (Learning Subtitles) ============

export async function analyzeSentence(sentence: string): Promise<SentenceBreakdown> {
  return fetchJSON<SentenceBreakdown>('/sentence/analyze', {
    method: 'POST',
    body: JSON.stringify({ sentence }),
  });
}

// ============ Sentence Coach ============

export async function coachSentence(sentence: string): Promise<SentenceCoachResult> {
  return fetchJSON<SentenceCoachResult>('/sentence/coach', {
    method: 'POST',
    body: JSON.stringify({ sentence }),
  });
}

export async function explainSentence(sentence: string): Promise<SentenceExplanation> {
  return fetchJSON<SentenceExplanation>('/sentence/explain', {
    method: 'POST',
    body: JSON.stringify({ sentence }),
  });
}

// ============ Sentence Coach Conversations ============

/**
 * Start a coach conversation with the button the learner pressed (shared/coach):
 * check / explain / translate. Explain may send the breakdown this device already
 * has cached, which the server stores instead of asking Claude again.
 */
export async function startCoachConversation(
  text: string,
  action?: CoachAction,
  explanation?: SentenceBriefExplanation | null,
  opts: { chatMessageId?: string | null } = {},
): Promise<{
  conversation: CoachConversation;
  messages: CoachMessage[];
  reused?: boolean;
}> {
  // background: the reply is written by the server's queue (a pending message comes back at
  // once and the page polls), so leaving the page never cancels it (docs/CHAT.md "Chat ↔ Coach").
  return fetchJSON('/coach/conversations', {
    method: 'POST',
    body: JSON.stringify({ text, action, explanation: explanation ?? undefined, background: true, chat_message_id: opts.chatMessageId ?? undefined }),
  });
}

export async function getCoachConversations(): Promise<CoachConversationListItem[]> {
  return fetchJSON('/coach/conversations');
}

export async function getCoachConversation(id: string): Promise<{
  conversation: CoachConversation;
  messages: CoachMessage[];
}> {
  return fetchJSON(`/coach/conversations/${id}`);
}

/** A follow-up: 202 with my message and the pending reply (written in the background). */
export async function sendCoachMessage(id: string, message: string): Promise<{
  messages: CoachMessage[];
  toolResults: CoachToolResult[];
}> {
  return fetchJSON(`/coach/conversations/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message, background: true }),
  });
}

/** Retry a reply that failed: back on the server's queue. */
export async function retryCoachReply(id: string, messageId: string): Promise<{
  conversation: CoachConversation;
  messages: CoachMessage[];
}> {
  return fetchJSON(`/coach/conversations/${id}/messages/${messageId}/retry`, { method: 'POST' });
}

export async function deleteCoachConversation(id: string): Promise<void> {
  await fetchJSON(`/coach/conversations/${id}`, { method: 'DELETE' });
}

// ============ Graded Readers ============

export async function getGradedReaders(): Promise<GradedReader[]> {
  return fetchJSON<GradedReader[]>('/readers');
}

export async function getGradedReader(id: string): Promise<GradedReaderWithPages> {
  return fetchJSON<GradedReaderWithPages>(`/readers/${id}`);
}

export interface GenerateReaderOptions {
  // 'decks' (default): story from learned vocabulary of deckIds.
  // 'due_cards': best-effort story featuring the words of noteIds
  // (today's due cards) — natural story over full word coverage.
  source?: 'decks' | 'due_cards';
  deckIds?: string[];
  noteIds?: string[];
  topic?: string;
  difficulty?: DifficultyLevel;
}

export async function generateGradedReader(options: GenerateReaderOptions): Promise<GradedReaderWithPages> {
  return fetchJSON<GradedReaderWithPages>('/readers/generate', {
    method: 'POST',
    body: JSON.stringify({
      source: options.source,
      deck_ids: options.deckIds,
      note_ids: options.noteIds,
      topic: options.topic,
      difficulty: options.difficulty,
    }),
  });
}

export async function deleteGradedReader(id: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/readers/${id}`, { method: 'DELETE' });
}

/** Re-queue a FAILED reader in place (same id; status goes back to 'generating'). */
export async function retryGradedReader(id: string): Promise<GradedReader> {
  return fetchJSON<GradedReader>(`/readers/${id}/retry`, { method: 'POST' });
}

export async function generateReaderPageImage(
  readerId: string,
  pageId: string
): Promise<{ image_url: string }> {
  return fetchJSON<{ image_url: string }>(`/readers/${readerId}/pages/${pageId}/generate-image`, {
    method: 'POST',
  });
}

export function getReaderImageUrl(imageKey: string): string {
  return `${API_PATH}/audio/${imageKey}`;
}

// ============ Reader Editor ============

export async function createBlankReader(data: { title_chinese: string; title_english: string; difficulty_level: DifficultyLevel; topic?: string }): Promise<GradedReaderWithPages> {
  return fetchJSON<GradedReaderWithPages>('/readers', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateGradedReader(readerId: string, data: { title_chinese?: string; title_english?: string; difficulty_level?: DifficultyLevel; topic?: string | null }): Promise<GradedReaderWithPages> {
  return fetchJSON<GradedReaderWithPages>(`/readers/${readerId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function addReaderPage(readerId: string, data: { content_chinese: string; content_pinyin: string; content_english: string; image_prompt?: string | null }): Promise<ReaderPage> {
  return fetchJSON<ReaderPage>(`/readers/${readerId}/pages`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateReaderPage(readerId: string, pageId: string, data: { content_chinese?: string; content_pinyin?: string; content_english?: string; image_prompt?: string | null }): Promise<void> {
  await fetchJSON(`/readers/${readerId}/pages/${pageId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteReaderPage(readerId: string, pageId: string): Promise<void> {
  await fetchJSON(`/readers/${readerId}/pages/${pageId}`, { method: 'DELETE' });
}

export async function reorderReaderPages(readerId: string, pageIds: string[]): Promise<void> {
  await fetchJSON(`/readers/${readerId}/pages/reorder`, { method: 'POST', body: JSON.stringify({ pageIds }) });
}

export async function publishReader(readerId: string): Promise<void> {
  await fetchJSON(`/readers/${readerId}/publish`, { method: 'POST' });
}

export async function generateReaderPageText(readerId: string, pageId: string, field: string, context?: string): Promise<{ text: string }> {
  return fetchJSON<{ text: string }>(`/readers/${readerId}/pages/${pageId}/generate-text`, { method: 'POST', body: JSON.stringify({ field, context }) });
}

// ============ Card State Management ============

export async function recomputeCardStates(): Promise<{
  total_cards: number;
  updated: number;
  errors: number;
}> {
  return fetchJSON<{ total_cards: number; updated: number; errors: number }>(
    '/cards/recompute-states',
    { method: 'POST' }
  );
}

// ============ Feature Requests ============

export interface FeatureRequest {
  id: string;
  user_id: string;
  content: string;
  page_context: string | null;
  screenshot_url: string | null;
  status: string;
  approval_status: string;
  comment_count: number;
  user_name?: string;
  user_email?: string;
  created_at: string;
  updated_at: string;
}

export interface FeatureRequestComment {
  id: string;
  request_id: string;
  author_name: string;
  author_type: string;
  content: string;
  created_at: string;
}

// ============ User Profile ============

export async function getUserBio(): Promise<string | null> {
  const data = await fetchJSON<{ bio: string | null }>('/profile/bio');
  return data.bio;
}

export async function updateUserBio(bio: string | null): Promise<string | null> {
  const data = await fetchJSON<{ bio: string | null }>('/profile/bio', {
    method: 'PUT',
    body: JSON.stringify({ bio }),
  });
  return data.bio;
}

/** Set the "Start on" tab (null = automatic). */
/** Settings → Advanced → "Share usage data" (docs/ANALYTICS.md). Off also deletes what was collected. */
export async function updateShareUsage(share_usage: boolean): Promise<boolean> {
  const data = await fetchJSON<{ share_usage: boolean }>('/profile/analytics', {
    method: 'PUT',
    body: JSON.stringify({ share_usage }),
  });
  return data.share_usage;
}

export async function updateLandingPage(landing_page: LandingPage | null): Promise<LandingPage | null> {
  const data = await fetchJSON<{ landing_page: LandingPage | null }>('/profile/landing-page', {
    method: 'PUT',
    body: JSON.stringify({ landing_page }),
  });
  return data.landing_page;
}

export async function getFeatureRequests(options?: { status?: string; all?: boolean }): Promise<FeatureRequest[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.all) params.set('all', 'true');
  const qs = params.toString();
  const { requests } = await fetchJSON<{ requests: FeatureRequest[] }>(
    `/feature-requests${qs ? `?${qs}` : ''}`
  );
  return requests;
}

export async function uploadFeatureRequestScreenshot(blob: Blob): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('file', blob, 'screenshot.png');

  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const response = await fetch(`${API_PATH}/feature-requests/screenshot`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  return response.json() as Promise<{ url: string }>;
}

export async function createFeatureRequest(content: string, pageContext?: string, consoleLogs?: string, screenshotUrl?: string): Promise<{ id: string }> {
  return fetchJSON<{ id: string }>('/feature-requests', {
    method: 'POST',
    body: JSON.stringify({ content, pageContext, consoleLogs, screenshotUrl }),
  });
}

export async function getFeatureRequest(id: string): Promise<{
  request: FeatureRequest;
  comments: FeatureRequestComment[];
}> {
  return fetchJSON<{ request: FeatureRequest; comments: FeatureRequestComment[] }>(
    `/feature-requests/${id}`
  );
}

export async function updateFeatureRequestStatus(id: string, status: string): Promise<void> {
  await fetchJSON(`/feature-requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function addFeatureRequestComment(id: string, content: string, authorName?: string): Promise<{ id: string }> {
  return fetchJSON<{ id: string }>(`/feature-requests/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content, authorName }),
  });
}

export async function approveFeatureRequest(id: string, approval_status: 'approved' | 'declined'): Promise<void> {
  await fetchJSON(`/feature-requests/${id}/approval`, {
    method: 'PATCH',
    body: JSON.stringify({ approval_status }),
  });
}

export async function getPendingFeatureRequestCount(): Promise<number> {
  const { count } = await fetchJSON<{ count: number }>('/feature-requests/pending-count');
  return count;
}

// ============ Notifications ============

export async function getNotifications(): Promise<AppNotification[]> {
  return fetchJSON<AppNotification[]>('/notifications');
}

export async function getUnreadNotificationCount(): Promise<number> {
  const result = await fetchJSON<{ count: number }>('/notifications/unread-count');
  return result.count;
}

export async function markNotificationRead(id: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

export async function markNotificationsReadByConversation(conversationId: string): Promise<void> {
  await fetchJSON<{ updated: number }>(`/notifications/read-by-conversation/${conversationId}`, {
    method: 'PATCH',
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await fetchJSON<{ updated: number }>('/notifications/read-all', {
    method: 'PATCH',
  });
}

// ============ Grammar Practice ============
// Lesson content/completions are handled offline (see services/grammar-study);
// only the shared GrammarPoint shape lives here.

export interface ExampleSentence {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface GrammarPoint {
  id: string;
  level: string;
  title: string;
  pattern: string;
  explanation: string;
  cgw_url: string | null;
  seed_examples: ExampleSentence[];
  order_index: number;
}

// ============ Lesson Notes ============

export interface LessonNoteFile {
  id: string;
  r2_key: string;
  filename: string;
  content_type: string | null;
  size: number | null;
}

export interface LessonNote {
  id: string;
  raw_text: string;
  given_at: string | null;
  created_at: string;
  files: LessonNoteFile[];
}

export async function listLessonNotes(): Promise<{ notes: LessonNote[] }> {
  return fetchJSON('/lesson-notes');
}

export async function createLessonNote(
  rawText: string,
  givenAt?: string,
): Promise<{ id: string }> {
  return fetchJSON('/lesson-notes', {
    method: 'POST',
    body: JSON.stringify({ raw_text: rawText, given_at: givenAt }),
  });
}

export async function uploadLessonNoteFile(
  noteId: string,
  file: File,
): Promise<{ id: string; r2_key: string; filename: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const headers: Record<string, string> = {};
  if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
  const r = await fetch(`${API_PATH}/lesson-notes/${noteId}/files`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: fd,
  });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  return r.json();
}

export async function deleteLessonNote(id: string): Promise<void> {
  await fetchJSON(`/lesson-notes/${id}`, { method: 'DELETE' });
}

// ============ Daily activities ============

export interface DailyStatus {
  grammar: { point: GrammarPoint | null; done_today: boolean };
  reader_done: boolean;
  today_reader: { reader_id: string; situation_id: string; status: string; error_message?: string | null } | null;
}

export async function getDailyStatus(): Promise<DailyStatus> {
  // local_date keys the one-story-per-day slot to the learner's local day
  // (same convention as the card daily limits) — without it the "new story
  // day" would roll over at UTC midnight, i.e. noon in NZ.
  return fetchJSON(`/daily/status?local_date=${getLocalDateString()}`);
}

// Kick off generation of today's reader. Idempotent per local day — the study
// session and the background sync call this (see ensureDailyReader). The note
// ids of today's due cards are sent so the story can target the words the
// learner is about to review; an empty list means a free story over learned
// vocabulary.
export async function generateDailyReader(dueNoteIds: string[]): Promise<NonNullable<DailyStatus['today_reader']>> {
  return fetchJSON('/daily/reader/generate', {
    method: 'POST',
    body: JSON.stringify({ note_ids: dueNoteIds, local_date: getLocalDateString() }),
  });
}

export async function markDailyActivity(activity: 'reader', refId?: string): Promise<void> {
  await fetchJSON('/daily/mark', {
    method: 'POST',
    body: JSON.stringify({ activity, ref_id: refId }),
  });
}

/** Per-day active study time over every device (`device_ms` = this device's share). */
export interface StudyTimeDayTotal {
  date: string;
  active_ms: number;
  device_ms: number;
}

/** Reports this device's running per-day active study time (rows only ever go up). */
export async function putStudyTime(deviceId: string, days: { date: string; active_ms: number }[]): Promise<StudyTimeDayTotal[]> {
  const res = await fetchJSON<{ days: StudyTimeDayTotal[] }>('/me/study-time', {
    method: 'PUT',
    body: JSON.stringify({ device_id: deviceId, days }),
  });
  return res.days;
}

export async function generatePracticeTTS(
  text: string,
  speed?: number,
  voiceId?: string,
): Promise<{ audio_base64: string; content_type: string }> {
  return fetchJSON('/practice/tts', {
    method: 'POST',
    body: JSON.stringify(voiceId ? { text, speed, voice_id: voiceId } : { text, speed }),
  });
}

// ============ Conversation voices (Settings → Conversation voices) ============

export interface LessonConversationVoiceSettings {
  voices: ConversationVoice[];
  enabled: string[];
  customised: boolean;
  default_enabled: string[];
  default_source: 'admin' | 'app';
  is_admin: boolean;
  speed: number;
  sample_text: string;
}

export async function getLessonConversationVoices(): Promise<LessonConversationVoiceSettings> {
  return fetchJSON('/conversation-voices');
}

/** Save a selection (≥ 1 female + ≥ 1 male; 400 with `problems` otherwise), or `null` to reset to the default. */
export async function saveLessonConversationVoices(enabled: string[] | null): Promise<LessonConversationVoiceSettings> {
  return fetchJSON('/conversation-voices', {
    method: 'PUT',
    body: JSON.stringify(enabled ? { enabled } : { reset: true }),
  });
}

/** The sample line in one voice (made once server-side, kept in R2). */
export async function getConversationVoiceSample(voiceId: string): Promise<{ audio_base64: string; content_type: string }> {
  return fetchJSON(`/conversation-voices/sample?voice=${encodeURIComponent(voiceId)}`);
}

// ============ Conversation audio (the ⚙︎ Audio menu; docs/AUDIO.md "Conversation audio") ============

export interface ConversationAudioView {
  prefs: ConversationAudioPrefs;
  provider: TtsProviderId;
  provider_name: string;
  default_speed: number;
  enabled: string[] | null;
  speed_steps: number[];
  speed_range: { min: number; max: number };
  voices: Array<{ id: string; name: string; gender: 'female' | 'male'; note: string; deliveries: ConversationDelivery[] }>;
  deliveries: Array<{ id: ConversationDelivery; label: string }>;
}

export async function getConversationAudio(): Promise<ConversationAudioView> {
  return fetchJSON('/conversation-audio');
}

/** A partial update (shared/lesson/conversationAudio.ts mergeConversationAudioPrefs); 400 with `problems`. */
export async function updateConversationAudio(update: Record<string, unknown>): Promise<ConversationAudioView> {
  return fetchJSON('/conversation-audio', { method: 'PUT', body: JSON.stringify(update) });
}

/** One conversation line: the provider's own rate, the delivery, optionally made again. */
export async function generateConversationLineTTS(
  text: string,
  opts: { voice: string; speed: number; delivery: ConversationDelivery; regenerate?: boolean },
): Promise<{ audio_base64: string; content_type: string }> {
  return fetchJSON('/practice/tts', {
    method: 'POST',
    body: JSON.stringify({
      text,
      voice_id: opts.voice,
      speed: opts.speed,
      kind: 'conversation',
      delivery: opts.delivery,
      ...(opts.regenerate ? { regenerate: true } : {}),
    }),
  });
}

// ============ Custom Mini Lessons ============

export interface CustomLessonCompletion {
  id: string;
  lesson_id: string;
  correct: number;
  total: number;
  completed_at: string;
  rating: number | null;
}

export interface CustomLessonListItem {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  source: string;
  status: 'active' | 'done';
  created_at: string;
  /** Tutor who assigned this lesson from their library (null for the user's own lessons). */
  assigned_by?: string | null;
  assigned_relationship_id?: string | null;
  spec: import('@shared/lesson').CustomLessonSpec;
  /** The lesson's FSRS review events (absent on locally cached fallbacks). */
  completions?: CustomLessonCompletion[];
}

export async function getCustomLessons(
  status: 'active' | 'done' | 'all' = 'all',
): Promise<CustomLessonListItem[]> {
  const r = await fetchJSON<{ lessons: CustomLessonListItem[] }>(`/custom-lessons?status=${status}`);
  return r.lessons;
}

export async function deleteCustomLessonById(id: string): Promise<void> {
  await fetchJSON(`/custom-lessons/${id}`, { method: 'DELETE' });
}

// ============ Quests (tile-map mini-games) ============

export async function listQuests(): Promise<QuestSummary[]> {
  const r = await fetchJSON<{ quests: QuestSummary[] }>('/quests');
  return r.quests;
}

export async function createQuest(params: {
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  goal_count?: number;
  deck_ids?: string[];
}): Promise<{ id: string; status: string }> {
  return fetchJSON('/quests', { method: 'POST', body: JSON.stringify(params) });
}

export async function getQuest(id: string): Promise<Quest> {
  const r = await fetchJSON<{ quest: Quest }>(`/quests/${id}`);
  return r.quest;
}

export async function completeQuest(id: string, moves: number): Promise<void> {
  await fetchJSON(`/quests/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ moves }),
  });
}

export async function retryQuest(id: string): Promise<{ id: string; status: string }> {
  return fetchJSON(`/quests/${id}/retry`, { method: 'POST' });
}

export async function deleteQuest(id: string): Promise<void> {
  await fetchJSON(`/quests/${id}`, { method: 'DELETE' });
}

// ============ Reader word chips (routes/reader-words.ts) ============

export interface ReaderWordsBackfill {
  pages: Array<{ id: string; reader_id: string; words: import('@shared/reader/words').ReaderWord[] }>;
  remaining: number;
}

/** Split up to `limit` of my reader pages without word chips into words (the given reader's first). */
export async function backfillReaderWords(body: { reader_id?: string; limit?: number } = {}): Promise<ReaderWordsBackfill> {
  return fetchJSON('/reader-words/backfill', { method: 'POST', body: JSON.stringify(body) });
}

/** "More about this word": Haiku's explanation of a word in its sentence + the card fields (cached server-side). */
export async function explainReaderWord(body: { word: string; sentence: string; pinyin?: string; gloss?: string }): Promise<import('@shared/reader/words').ReaderWordExplanation> {
  return fetchJSON('/reader-words/explain', { method: 'POST', body: JSON.stringify(body) });
}
