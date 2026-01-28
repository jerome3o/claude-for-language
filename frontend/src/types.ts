// Card types
export type CardType = 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi';

// Audio provider types
export type AudioProvider = 'minimax' | 'gtts';

// Rating values (SM-2)
export type Rating = 0 | 1 | 2 | 3; // 0=again, 1=hard, 2=good, 3=easy

// Card queue values (Anki-style)
export enum CardQueue {
  NEW = 0,
  LEARNING = 1,
  REVIEW = 2,
  RELEARNING = 3,
}

// Queue counts for Anki-style display
export interface QueueCounts {
  new: number;      // Blue - new cards
  learning: number; // Red - learning + relearning cards
  review: number;   // Green - review cards
}

// Interval preview for rating buttons
export interface IntervalPreview {
  intervalText: string;
  queue: CardQueue;
}

// User roles
export type UserRole = 'student' | 'tutor';

// Auth user type (from /api/auth/me)
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  picture_url: string | null;
  role: UserRole;
  is_admin: boolean;
}

// Admin user list type
export interface AdminUser extends AuthUser {
  created_at: string;
  last_login_at: string | null;
  deck_count: number;
  note_count: number;
  review_count: number;
}

// Database models
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

// Extended types for API responses (with joins)
export interface NoteWithCards extends Note {
  cards: Card[];
}

export interface DeckWithNotes extends Deck {
  notes: NoteWithCards[];
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

// Statistics types
export interface OverviewStats {
  total_cards: number;
  cards_due_today: number;
  cards_studied_today: number;
  total_decks: number;
}

export interface DeckStats {
  total_notes: number;
  total_cards: number;
  cards_due: number;
  cards_mastered: number;
}

// Rating display info
export const RATING_INFO: Record<Rating, { label: string; color: string }> = {
  0: { label: 'Again', color: '#ef4444' },
  1: { label: 'Hard', color: '#f97316' },
  2: { label: 'Good', color: '#22c55e' },
  3: { label: 'Easy', color: '#3b82f6' },
};

// Card type display info
export const CARD_TYPE_INFO: Record<CardType, { prompt: string; action: 'speak' | 'type' }> = {
  hanzi_to_meaning: {
    prompt: 'Say this word/phrase aloud',
    action: 'speak',
  },
  meaning_to_hanzi: {
    prompt: 'Type the Chinese characters',
    action: 'type',
  },
  audio_to_hanzi: {
    prompt: 'Type what you hear',
    action: 'type',
  },
};

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

export interface UserSummary {
  id: string;
  email: string | null;
  name: string | null;
  picture_url: string | null;
}

export interface TutorRelationshipWithUsers extends TutorRelationship {
  requester: UserSummary;
  recipient: UserSummary;
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
  sender: {
    id: string;
    name: string | null;
    picture_url: string | null;
  };
}

export interface ConversationWithLastMessage extends Conversation {
  last_message?: Message;
  other_user: UserSummary;
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

// Pending invitations for non-users
export type PendingInvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

export interface PendingInvitation {
  id: string;
  inviter_id: string;
  recipient_email: string;
  inviter_role: RelationshipRole;
  status: PendingInvitationStatus;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface PendingInvitationWithInviter extends PendingInvitation {
  inviter: UserSummary;
}

// Result type for createRelationship - can be either a relationship or pending invitation
export type CreateRelationshipResult =
  | { type: 'relationship'; data: TutorRelationshipWithUsers }
  | { type: 'invitation'; data: PendingInvitationWithInviter };

export interface MyRelationships {
  tutors: TutorRelationshipWithUsers[];
  students: TutorRelationshipWithUsers[];
  pending_incoming: TutorRelationshipWithUsers[];
  pending_outgoing: TutorRelationshipWithUsers[];
  pending_invitations: PendingInvitationWithInviter[];
}

export interface StudentProgress {
  user: UserSummary;
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

// Daily activity summary for student progress (last 30 days)
export interface DailyActivitySummary {
  student: {
    id: string;
    name: string | null;
    email: string | null;
    picture_url: string | null;
  };
  summary: {
    total_reviews_30d: number;
    total_days_active: number;
    average_accuracy: number;
    total_time_ms: number;
  };
  days: Array<{
    date: string;
    reviews_count: number;
    unique_cards: number;
    accuracy: number;
    time_spent_ms: number;
  }>;
}

// Cards reviewed on a specific day
export interface DayCardsDetail {
  date: string;
  summary: {
    total_reviews: number;
    unique_cards: number;
    accuracy: number;
    time_spent_ms: number;
  };
  cards: Array<{
    card_id: string;
    card_type: CardType;
    note: {
      id: string;
      hanzi: string;
      pinyin: string;
      english: string;
    };
    review_count: number;
    ratings: number[];
    average_rating: number;
    total_time_ms: number;
    has_answers: boolean;
    has_recordings: boolean;
  }>;
}

// Self progress summary (without student info)
export interface MyDailyProgress {
  summary: {
    total_reviews_30d: number;
    total_days_active: number;
    average_accuracy: number;
    total_time_ms: number;
  };
  days: Array<{
    date: string;
    reviews_count: number;
    unique_cards: number;
    accuracy: number;
    time_spent_ms: number;
  }>;
}

// Review details for a specific card on a specific day
export interface CardReviewsDetail {
  card: {
    id: string;
    card_type: CardType;
    note: {
      id: string;
      hanzi: string;
      pinyin: string;
      english: string;
      audio_url: string | null;
    };
  };
  reviews: Array<{
    id: string;
    reviewed_at: string;
    rating: number;
    time_spent_ms: number | null;
    user_answer: string | null;
    recording_url: string | null;
  }>;
}

// Helper function to determine the current user's role in a relationship
export function getMyRoleInRelationship(
  relationship: TutorRelationship,
  myId: string
): RelationshipRole {
  const iAmRequester = relationship.requester_id === myId;
  if (iAmRequester) return relationship.requester_role;
  return relationship.requester_role === 'tutor' ? 'student' : 'tutor';
}

// Helper function to get the other user in a relationship
export function getOtherUserInRelationship(
  relationship: TutorRelationshipWithUsers,
  myId: string
): UserSummary {
  return relationship.requester_id === myId
    ? relationship.recipient
    : relationship.requester;
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
  student: UserSummary;
  tutor: UserSummary;
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
  deck: {
    id: string;
    name: string;
  };
}

// ============ AI Conversation Types ============

export const CLAUDE_AI_USER_ID = 'claude-ai';

// Available MiniMax voices
export const MINIMAX_VOICES = [
  { id: 'female-yujie', name: 'Yu Jie (Female, Mature)' },
  { id: 'female-tianmei', name: 'Tian Mei (Female, Sweet)' },
  { id: 'male-qingsong', name: 'Qing Song (Male)' },
  { id: 'male-dongfang', name: 'Dong Fang (Male, Mature)' },
] as const;

export interface AIRespondResponse {
  message: MessageWithSender;
  audio_base64: string | null;
  audio_content_type: string | null;
}

export interface ConversationTTSResponse {
  audio_base64: string;
  content_type: string;
  provider: 'minimax' | 'gtts';
}

export interface CheckMessageResponse {
  status: MessageCheckStatus;
  feedback: string;
  corrections: GeneratedNoteWithContext[] | null;
}

// Generated note with context for conversation-based flashcards
export interface GeneratedNoteWithContext extends GeneratedNote {
  context?: string;
}

// Helper to check if a conversation is with Claude AI
export function isClaudeConversation(conversation: Conversation): boolean {
  return conversation.is_ai_conversation;
}

// Helper to check if a user is Claude AI
export function isClaudeUser(userId: string): boolean {
  return userId === CLAUDE_AI_USER_ID;
}

// ============ Sentence Breakdown (Learning Subtitles) ============

// A chunk represents an aligned segment across hanzi, pinyin, and english
export interface SentenceChunk {
  hanzi: string;
  pinyin: string;
  english: string;
  // Indices into the full English sentence for highlighting (0-based, end is exclusive)
  englishStart: number;
  englishEnd: number;
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
