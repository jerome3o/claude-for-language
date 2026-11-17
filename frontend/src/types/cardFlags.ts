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
  /** "Forget this card": when a card of the note was reset to New (newest first; absent from older servers). */
  forgets?: Array<{ id: string; card_id: string; card_type: string; forgotten_at: string }>;
  review_count: number;
  // (`questions` is still sent for older app builds; this app lists the card's Claude threads.)
  flags: CardFlag[];
}
