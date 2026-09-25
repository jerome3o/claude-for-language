/**
 * Card flags + Ask-Claude history + the card hub. Mirrors
 * worker/src/services/card-flags.ts and worker/src/routes/claude-chats.ts.
 */

import type { Note, CardType } from '../types';

export type CardFlagStatus = 'open' | 'resolved';

export interface CardFlag {
  id: string;
  relationship_id: string;
  student_id: string;
  tutor_id: string;
  note_id: string;
  card_id: string | null;
  message: string;
  status: CardFlagStatus;
  tutor_reply: string | null;
  replied_at: string | null;
  student_seen_reply_at: string | null;
  created_at: string;
  resolved_at: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  card_type: CardType | null;
  student_name: string | null;
  tutor_name: string | null;
}

export interface ClaudeChatQuestion {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

export interface ClaudeChatsResponse {
  questions: ClaudeChatQuestion[];
  next_cursor: string | null;
  total: number;
}

export interface NoteHubCard {
  id: string;
  card_type: CardType;
  queue: number;
  stability: number;
  difficulty: number;
  lapses: number;
  reps: number;
  next_review_at: string | null;
}

export interface NoteHubReview {
  id: string;
  card_id: string;
  card_type: CardType;
  rating: number;
  reviewed_at: string;
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
}

export interface NoteHub {
  note: Note;
  deck: { id: string; name: string };
  owner: { id: string; name: string | null };
  cards: NoteHubCard[];
  recent_reviews: NoteHubReview[];
  review_count: number;
  questions: ClaudeChatQuestion[];
  flags: CardFlag[];
}
