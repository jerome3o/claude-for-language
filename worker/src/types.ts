// Cloudflare bindings
export interface Env {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  ANTHROPIC_API_KEY: string;
  GOOGLE_TTS_API_KEY: string;
  MINIMAX_API_KEY: string;
  ENVIRONMENT: string;
  // Auth secrets
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ADMIN_EMAIL: string;
  NTFY_TOPIC: string;
}

// Audio provider types
export type AudioProvider = 'minimax' | 'gtts';

// Card types
export type CardType = 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi';

// Rating values (SM-2)
export type Rating = 0 | 1 | 2 | 3; // 0=again, 1=hard, 2=good, 3=easy

// Card queue values (Anki-style)
export enum CardQueue {
  NEW = 0,
  LEARNING = 1,
  REVIEW = 2,
  RELEARNING = 3,
}

// User roles (for future tutor feature)
export type UserRole = 'student' | 'tutor';

// Database models
export interface User {
  id: string;
  email: string | null;
  google_id: string | null;
  name: string | null;
  picture_url: string | null;
  role: UserRole;
  is_admin: number;
  last_login_at: string | null;
  created_at: string;
}

export interface AuthSession {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export interface OAuthClient {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string; // JSON array
  grant_types: string;
  created_at: string;
}

export interface OAuthToken {
  id: string;
  client_id: string;
  user_id: string;
  access_token_hash: string;
  refresh_token_hash: string | null;
  scope: string | null;
  expires_at: string;
  created_at: string;
}

export interface OAuthCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
  scope: string | null;
  expires_at: string;
}

export interface Deck {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  new_cards_per_day: number;
  learning_steps: string;  // Space-separated minutes, e.g., "1 10"
  graduating_interval: number;  // Days
  easy_interval: number;  // Days
  relearning_steps: string;  // Space-separated minutes, e.g., "10"
  starting_ease: number;  // Stored as percentage, e.g., 250 = 2.5
  minimum_ease: number;  // Stored as percentage, e.g., 130 = 1.3
  maximum_ease: number;  // Stored as percentage, e.g., 300 = 3.0
  interval_modifier: number;  // Stored as percentage, e.g., 100 = 1.0
  hard_multiplier: number;  // Stored as percentage, e.g., 120 = 1.2
  easy_bonus: number;  // Stored as percentage, e.g., 130 = 1.3
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  deck_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  audio_url: string | null;
  audio_provider: AudioProvider | null;
  fun_facts: string | null;
  context: string | null;  // Conversation context shown on card front
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: string;
  note_id: string;
  card_type: CardType;
  ease_factor: number;
  interval: number;
  repetitions: number;
  next_review_at: string | null;
  queue: CardQueue;
  learning_step: number;
  due_timestamp: number | null;
  created_at: string;
  updated_at: string;
}

export interface StudySession {
  id: string;
  user_id: string | null;
  deck_id: string | null;
  started_at: string;
  completed_at: string | null;
  cards_studied: number;
}

export interface CardReview {
  id: string;
  session_id: string;
  card_id: string;
  rating: Rating;
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
  reviewed_at: string;
}

export interface NoteQuestion {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
}

// API request/response types
export interface CreateDeckRequest {
  name: string;
  description?: string;
}

export interface CreateNoteRequest {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
  context?: string;  // Conversation context to show on card front
}

export interface UpdateNoteRequest {
  hanzi?: string;
  pinyin?: string;
  english?: string;
  fun_facts?: string;
}

export interface StartSessionRequest {
  deck_id?: string; // null = all decks
  include_new?: boolean;
  limit?: number;
}

export interface RecordReviewRequest {
  card_id: string;
  rating: Rating;
  time_spent_ms?: number;
  user_answer?: string;
}

export interface GenerateDeckRequest {
  prompt: string;
  deck_name?: string;
}

export interface SuggestCardsRequest {
  context: string; // e.g., "words related to 吃饭"
  count?: number;
}

// Extended types for API responses (with joins)
export interface NoteWithCards extends Note {
  cards: Card[];
}

export interface DeckWithNotes extends Deck {
  notes: Note[];
}

export interface CardWithNote extends Card {
  note: Note;
}

export interface SessionWithReviews extends StudySession {
  reviews: (CardReview & { card: CardWithNote })[];
}

// AI generation types
export interface GeneratedNote {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
}

export interface GeneratedDeck {
  deck_name: string;
  deck_description: string;
  notes: GeneratedNote[];
}

// Statistics types
export interface OverviewStats {
  total_cards: number;
  cards_due_today: number;
  cards_studied_today: number;
  cards_studied_this_week: number;
  average_accuracy: number;
  streak_days: number;
}

export interface DeckStats {
  deck_id: string;
  deck_name: string;
  total_notes: number;
  total_cards: number;
  cards_due: number;
  cards_mastered: number; // interval > 21 days
  average_ease: number;
}

// Queue counts for Anki-style display
export interface QueueCounts {
  new: number;      // Blue - new cards
  learning: number; // Red - learning + relearning cards
  review: number;   // Green - review cards
}

// Daily counts for new card limits
export interface DailyCount {
  id: string;
  user_id: string;
  deck_id: string | null;
  date: string;
  new_cards_studied: number;
}

// ============ Tutor-Student Relationships ============

export type RelationshipStatus = 'pending' | 'active' | 'removed';
export type RelationshipRole = 'tutor' | 'student';

export interface TutorRelationship {
  id: string;
  requester_id: string;
  recipient_id: string;
  requester_role: RelationshipRole;
  status: RelationshipStatus;
  created_at: string;
  accepted_at: string | null;
}

export interface TutorRelationshipWithUsers extends TutorRelationship {
  requester: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
  recipient: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
}

export interface Conversation {
  id: string;
  relationship_id: string;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
  // AI conversation fields
  scenario: string | null;
  user_role: string | null;
  ai_role: string | null;
  is_ai_conversation: boolean;
  voice_id: string | null;
  voice_speed: number | null;
}

export interface ConversationWithLastMessage extends Conversation {
  last_message?: Message;
  other_user: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
}

export type MessageCheckStatus = 'correct' | 'needs_improvement';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  // Check status for user messages
  check_status: MessageCheckStatus | null;
  check_feedback: string | null;
  recording_url: string | null;
}

export interface MessageWithSender extends Message {
  sender: Pick<User, 'id' | 'name' | 'picture_url'>;
}

export interface SharedDeck {
  id: string;
  relationship_id: string;
  source_deck_id: string;
  target_deck_id: string;
  shared_at: string;
}

export interface SharedDeckWithDetails extends SharedDeck {
  source_deck_name: string;
  target_deck_name: string;
}

// Request/Response types for relationships
export interface CreateRelationshipRequest {
  recipient_email: string;
  role: RelationshipRole; // The role the requester wants to be
}

export interface CreateConversationRequest {
  title?: string;
  // AI conversation fields (optional for regular conversations)
  scenario?: string;
  user_role?: string;
  ai_role?: string;
  voice_id?: string;
  voice_speed?: number;
}

export interface SendMessageRequest {
  content: string;
}

export interface ShareDeckRequest {
  deck_id: string;
}

export interface GenerateFlashcardRequest {
  message_ids?: string[]; // Optional: specific messages to use as context
}

// Response types
export interface MyRelationships {
  tutors: TutorRelationshipWithUsers[];
  students: TutorRelationshipWithUsers[];
  pending_incoming: TutorRelationshipWithUsers[];
  pending_outgoing: TutorRelationshipWithUsers[];
}

export interface StudentProgress {
  user: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
  stats: {
    total_cards: number;
    cards_due_today: number;
    cards_studied_today: number;
    cards_studied_this_week: number;
    average_accuracy: number;
  };
  decks: Array<{
    id: string;
    name: string;
    total_notes: number;
    cards_due: number;
    cards_mastered: number;
  }>;
}

// ============ Tutor Review Requests ============

export type TutorReviewRequestStatus = 'pending' | 'reviewed' | 'archived';

export interface TutorReviewRequest {
  id: string;
  relationship_id: string;
  student_id: string;
  tutor_id: string;
  note_id: string;
  card_id: string;
  review_event_id: string | null;
  message: string;
  status: TutorReviewRequestStatus;
  tutor_response: string | null;
  responded_at: string | null;
  created_at: string;
}

export interface TutorReviewRequestWithDetails extends TutorReviewRequest {
  student: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
  tutor: Pick<User, 'id' | 'email' | 'name' | 'picture_url'>;
  note: Note;
  card: Card;
  review_event: {
    id: string;
    rating: Rating;
    time_spent_ms: number | null;
    user_answer: string | null;
    recording_url: string | null;
    reviewed_at: string;
  } | null;
  deck: Pick<Deck, 'id' | 'name'>;
}

export interface CreateTutorReviewRequest {
  relationship_id: string;
  note_id: string;
  card_id: string;
  review_event_id?: string;
  message: string;
}

export interface RespondToTutorReviewRequest {
  response: string;
}

// ============ AI Conversation Types ============

export const CLAUDE_AI_USER_ID = 'claude-ai';

export interface CreateAIConversationRequest {
  title?: string;
  scenario: string;
  user_role: string;
  ai_role: string;
  voice_id?: string;
  voice_speed?: number;
}

export interface AIRespondRequest {
  // Optional: override voice settings for this response
  voice_id?: string;
  voice_speed?: number;
}

export interface AIRespondResponse {
  message: MessageWithSender;
  audio_base64: string | null;
  audio_content_type: string | null;
}

export interface ConversationTTSRequest {
  text: string;
  voice_id?: string;
  voice_speed?: number;
}

export interface ConversationTTSResponse {
  audio_base64: string;
  content_type: string;
  provider: 'minimax' | 'gtts';
}

export interface CheckMessageResponse {
  status: MessageCheckStatus;
  feedback: string;
  corrections: GeneratedNote[] | null;  // Suggested flashcards for corrections
}

export interface UpdateConversationVoiceRequest {
  voice_id?: string;
  voice_speed?: number;
}

// Generated note with context for conversation-based flashcards
export interface GeneratedNoteWithContext extends GeneratedNote {
  context?: string;
}

// ============ Sentence Breakdown (Learning Subtitles) ============

// A chunk represents an aligned segment across hanzi, pinyin, and english
export interface SentenceChunk {
  hanzi: string;
  pinyin: string;
  english: string;
  // Optional grammar/usage note for this chunk
  note?: string;
}

// The full breakdown of a sentence
export interface SentenceBreakdown {
  // Original input from user
  originalInput: string;
  // What language was the input
  inputLanguage: 'chinese' | 'english';
  // Full sentence in each form
  hanzi: string;
  pinyin: string;
  english: string;
  // Aligned chunks for stepping through
  chunks: SentenceChunk[];
  // Optional overall notes about the sentence
  grammarNotes?: string;
}

// Request to analyze a sentence
export interface AnalyzeSentenceRequest {
  sentence: string;
}

// Response from the API
export interface AnalyzeSentenceResponse extends SentenceBreakdown {}
