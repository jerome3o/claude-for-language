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
  fun_facts: string | null;
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
