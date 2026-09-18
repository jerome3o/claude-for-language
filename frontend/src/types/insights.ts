/**
 * Types for the tutor "Student Insights" feature. Mirrors
 * worker/src/services/insights.ts and worker/src/db/insights-queries.ts.
 */

import type { CardType } from '../types';

export interface InsightNoteRef {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

export interface CardTypeStats {
  attempts: number;
  again_count: number;
  accuracy: number;
}

export interface InsightTotals {
  reviews: number;
  unique_cards: number;
  unique_notes: number;
  days_active: number;
  accuracy: number;
  again_rate: number;
  time_ms: number;
  by_card_type: Partial<Record<CardType, CardTypeStats>>;
  new_words_introduced: number;
}

export interface InsightAttempt {
  event_id: string;
  card_type: CardType;
  rating: number;
  reviewed_at: string;
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
}

export interface StrugglingNote {
  note: InsightNoteRef;
  score: number;
  attempts: number;
  again_count: number;
  again_rate: number;
  hard_count: number;
  forgot_count: number;
  avg_time_ms: number | null;
  last_reviewed_at: string;
  by_card_type: Partial<Record<CardType, CardTypeStats>>;
  wrong_answers: string[];
  wrong_typed_count: number;
  recordings_count: number;
  events: InsightAttempt[];
}

export interface GoingWellNote {
  note: InsightNoteRef;
  attempts: number;
  easy_count: number;
  reason: 'consistent' | 'graduated';
  max_interval_days: number | null;
  last_reviewed_at: string;
}

export type RecordingMarkStatus = 'listened' | 'needs_work';

export interface RecordingMark {
  review_event_id: string;
  status: RecordingMarkStatus;
  comment: string | null;
  updated_at: string;
}

export interface InsightRecording {
  event_id: string;
  note: InsightNoteRef;
  card_type: CardType;
  rating: number;
  reviewed_at: string;
  recording_url: string;
  user_answer: string | null;
  mark: RecordingMark | null;
}

export interface InsightActivity {
  lessons: Array<{ lesson_id: string; title: string; rating: number | null; completed_at: string }>;
  readers: Array<{ reader_id: string; title_chinese: string; title_english: string; rating: number; reviewed_at: string }>;
  quests: Array<{ quest_id: string; title: string; completed_at: string; best_moves: number | null }>;
}

export interface InsightRange {
  from: string;
  to: string;
}

export interface LessonRef {
  id: string;
  lesson_at: string;
}

export interface InsightsReport {
  range: InsightRange;
  since_lesson: LessonRef | null;
  latest_lesson: LessonRef | null;
  totals: InsightTotals;
  struggling: StrugglingNote[];
  going_well: GoingWellNote[];
  activity: InsightActivity;
  recordings: InsightRecording[];
}

export interface TutorLessonLogEntry {
  id: string;
  relationship_id: string;
  tutor_id: string;
  student_id: string;
  lesson_at: string;
  notes: string | null;
  created_at: string;
}

export interface StudentSummary {
  id: string;
  relationship_id: string;
  range_from: string;
  range_to: string;
  narrative_en: string;
  narrative_zh: string;
  stats_json: string | null;
  created_at: string;
}

/** One review event joined to note + deck, as the history explorer lists them. */
export interface HistoryEvent {
  event_id: string;
  card_id: string;
  card_type: CardType;
  note_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  rating: number;
  time_spent_ms: number | null;
  user_answer: string | null;
  recording_url: string | null;
  reviewed_at: string;
}

export interface HistoryPage {
  range: InsightRange;
  events: HistoryEvent[];
  next_cursor: string | null;
  decks?: Array<{ id: string; name: string }>;
}

export interface HistoryQuery {
  from?: string;
  to?: string;
  deck_id?: string;
  card_type?: CardType | '';
  rating?: number | '';
  q?: string;
  cursor?: string;
  limit?: number;
}
