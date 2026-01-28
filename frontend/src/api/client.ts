import {
  Deck,
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
  StudentProgress,
  DailyActivitySummary,
  DayCardsDetail,
  CardReviewsDetail,
  MyDailyProgress,
  TutorReviewRequestWithDetails,
  TutorReviewRequestStatus,
  AIRespondResponse,
  ConversationTTSResponse,
  CheckMessageResponse,
  GeneratedNoteWithContext,
  SentenceBreakdown,
  CreateRelationshipResult,
} from '../types';

export const API_BASE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : '';

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
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
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

export interface OrphanStats {
  orphan_count: number;
  orphan_size_bytes: number;
  orphan_size_mb: number;
  orphans: Array<{ key: string; size: number }>;
}

export interface CleanupResult {
  deleted_count: number;
  deleted_size_bytes: number;
  deleted_size_mb: number;
}

export async function getStorageStats(): Promise<StorageStats> {
  return fetchJSON<StorageStats>('/admin/storage');
}

export async function getOrphanStats(): Promise<OrphanStats> {
  return fetchJSON<OrphanStats>('/admin/storage/orphans');
}

export async function cleanupOrphans(): Promise<CleanupResult> {
  return fetchJSON<CleanupResult>('/admin/storage/cleanup', { method: 'POST' });
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

export async function getNote(id: string): Promise<NoteWithCards> {
  return fetchJSON<NoteWithCards>(`/notes/${id}`);
}

export async function createNote(
  deckId: string,
  data: { hanzi: string; pinyin: string; english: string; fun_facts?: string; context?: string }
): Promise<NoteWithCards> {
  return fetchJSON<NoteWithCards>(`/decks/${deckId}/notes`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateNote(
  id: string,
  updates: { hanzi?: string; pinyin?: string; english?: string; fun_facts?: string }
): Promise<NoteWithCards> {
  return fetchJSON<NoteWithCards>(`/notes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export interface GenerateAudioOptions {
  speed?: number; // 0.3 - 1.5, default 0.5 for MiniMax, 0.9 for Google
  provider?: 'minimax' | 'gtts'; // Prefer a specific provider
}

export async function generateNoteAudio(noteId: string, options?: GenerateAudioOptions): Promise<Note> {
  return fetchJSON<Note>(`/notes/${noteId}/generate-audio`, {
    method: 'POST',
    body: options ? JSON.stringify(options) : undefined,
  });
}

export async function upgradeNoteAudio(noteId: string): Promise<Note> {
  return fetchJSON<Note>(`/notes/${noteId}/upgrade-audio`, {
    method: 'POST',
  });
}

export async function upgradeAllDeckAudio(deckId: string): Promise<{ upgrading: number; message: string }> {
  return fetchJSON<{ upgrading: number; message: string }>(`/decks/${deckId}/upgrade-all-audio`, {
    method: 'POST',
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

export async function askAboutNote(
  noteId: string,
  question: string,
  context?: { userAnswer?: string; correctAnswer?: string; cardType?: string }
): Promise<NoteQuestion> {
  return fetchJSON<NoteQuestion>(`/notes/${noteId}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question, context }),
  });
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
    body: JSON.stringify(data),
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

export interface MessagesResponse {
  messages: MessageWithSender[];
  latest_timestamp: string | null;
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
  content: string
): Promise<MessageWithSender> {
  return fetchJSON<MessageWithSender>(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
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
  conversationId: string
): Promise<{ options: GeneratedNoteWithContext[] }> {
  return fetchJSON<{ options: GeneratedNoteWithContext[] }>(
    `/conversations/${conversationId}/generate-response-options`,
    {
      method: 'POST',
      body: JSON.stringify({}),
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
  deckId: string
): Promise<SharedDeckWithDetails> {
  return fetchJSON<SharedDeckWithDetails>(`/relationships/${relationshipId}/share-deck`, {
    method: 'POST',
    body: JSON.stringify({ deck_id: deckId }),
  });
}

export async function getSharedDecks(relationshipId: string): Promise<SharedDeckWithDetails[]> {
  return fetchJSON<SharedDeckWithDetails[]>(`/relationships/${relationshipId}/shared-decks`);
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

// ============ Tutor Review Requests ============

export async function createTutorReviewRequest(data: {
  relationship_id: string;
  note_id: string;
  card_id: string;
  review_event_id?: string;
  message: string;
}): Promise<TutorReviewRequestWithDetails> {
  return fetchJSON<TutorReviewRequestWithDetails>('/tutor-review-requests', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getTutorReviewInbox(
  status?: TutorReviewRequestStatus
): Promise<TutorReviewRequestWithDetails[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const query = params.toString();
  return fetchJSON<TutorReviewRequestWithDetails[]>(
    `/tutor-review-requests/inbox${query ? `?${query}` : ''}`
  );
}

export async function getPendingReviewRequestCount(): Promise<{ count: number }> {
  return fetchJSON<{ count: number }>('/tutor-review-requests/pending-count');
}

export async function getStudentSentRequests(
  status?: TutorReviewRequestStatus
): Promise<TutorReviewRequestWithDetails[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const query = params.toString();
  return fetchJSON<TutorReviewRequestWithDetails[]>(
    `/tutor-review-requests/sent${query ? `?${query}` : ''}`
  );
}

export async function getTutorReviewRequest(
  requestId: string
): Promise<TutorReviewRequestWithDetails> {
  return fetchJSON<TutorReviewRequestWithDetails>(`/tutor-review-requests/${requestId}`);
}

export async function respondToTutorReviewRequest(
  requestId: string,
  response: string
): Promise<TutorReviewRequestWithDetails> {
  return fetchJSON<TutorReviewRequestWithDetails>(`/tutor-review-requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ response }),
  });
}

export async function archiveTutorReviewRequest(requestId: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/tutor-review-requests/${requestId}/archive`, {
    method: 'POST',
  });
}

// ============ Sentence Analysis (Learning Subtitles) ============

export async function analyzeSentence(sentence: string): Promise<SentenceBreakdown> {
  return fetchJSON<SentenceBreakdown>('/sentence/analyze', {
    method: 'POST',
    body: JSON.stringify({ sentence }),
  });
}
